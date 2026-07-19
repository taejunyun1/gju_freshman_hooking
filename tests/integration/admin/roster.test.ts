import { describe, expect, it, vi } from 'vitest'

import { createApplicantRosterService } from '../../../server/modules/admin/applicant-roster'
import { protectApplicantName } from '../../../server/modules/identity/applicant-name'
import { protectPhone } from '../../../server/modules/identity/phone'

const cycleId = '11111111-1111-4111-8111-111111111111'
const adminUserId = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
const currentCycle = {
  id: cycleId,
  year: 2026,
  status: 'current' as const,
  rosterVersion: 4,
  passwordKeyVersion: 1,
  createdAt: '2026-07-20T00:00:00.000Z',
  archivedAt: null,
}
const keyring = {
  phoneHmacKey: new Uint8Array(32).fill(1),
  nameHmacKey: new Uint8Array(32).fill(2),
  piiEncryptionKey: new Uint8Array(32).fill(3),
  currentPassword: { version: 1, pepper: new Uint8Array(32).fill(4) },
}

const row = {
  name: '윤 태준',
  phone: '010-1234-5678',
  highSchool: '광주고',
  grade: '고3',
}

describe('applicant roster service', () => {
  it('maps protected preview rows back to plaintext only after the RPC response', async () => {
    const rpc = vi.fn(async (_name: string, args?: Record<string, unknown>) => {
      const protectedRow = (args!.p_rows as Array<Record<string, unknown>>)[0]!
      return { data: {
        cycleId, rosterVersion: 4,
        counts: { add: 1, update: 0, inactive: 0, unchanged: 0 },
        rows: [{ rowNumber: 1, action: 'add', phoneHmac: protectedRow.phoneHmac, changedFields: [] }],
        inactiveApplicantIds: [],
      }, error: null }
    })

    await expect(createApplicantRosterService({ keyring, rpc }).preview({ cycleId, rows: [row] }))
      .resolves.toMatchObject({ rows: [{ rowNumber: 1, action: 'add', row: { name: '윤 태준', phone: '01012345678' }, changedFields: [] }] })

    const payload = rpc.mock.calls[0]![1]!.p_rows as Array<Record<string, unknown>>
    expect(payload[0]).not.toHaveProperty('name')
    expect(payload[0]).not.toHaveProperty('phone')
    expect(payload[0]).toMatchObject({ phoneHmac: expect.any(String), nameHmac: expect.any(String) })
  })

  it('applies a normalized roster through exactly one protected RPC', async () => {
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => name === 'list_admission_cycles_v1'
      ? { data: [currentCycle], error: null }
      : ({ data: {
      kind: 'success', cycleId, previousVersion: 4, rosterVersion: 5,
      counts: { add: 1, update: 0, inactive: 0, unchanged: 0 },
      added: [{ hmac: (args!.p_rows as Array<Record<string, unknown>>)[0]!.phoneHmac, generation: 1 }], credentials: [],
    }, error: null }))
    const service = createApplicantRosterService({ keyring, rpc })

    const result = await service.apply({
      cycleId,
      expectedVersion: 4,
      idempotencyKey: requestId,
      rows: [row],
    }, { adminUserId, requestId: '44444444-4444-4444-8444-444444444444' })

    expect(result).toMatchObject({ cycleId, rosterVersion: 5, credentials: [{ name: '윤 태준', phone: '01012345678' }] })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('apply_applicant_roster_v1', expect.objectContaining({
      p_expected_version: 4,
      p_request_id: requestId,
      p_rows: [expect.objectContaining({
        applicantStage: 'high3', schoolName: '광주고', passwordDigest: expect.any(String),
        phoneHmac: expect.any(String), nameHmac: expect.any(String),
      })],
    }))
    const payload = rpc.mock.calls[1]![1]!.p_rows as Array<Record<string, unknown>>
    expect(payload[0]).not.toHaveProperty('name')
  })

  it('returns credentials only for additions in a mixed roster import', async () => {
    const addedRow = { ...row, name: '새 지원자', phone: '010-1234-9999' }
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'list_admission_cycles_v1') return { data: [currentCycle], error: null }
      const rows = args!.p_rows as Array<Record<string, unknown>>
      return { data: {
        kind: 'success', cycleId, previousVersion: 4, rosterVersion: 5,
        counts: { add: 1, update: 1, inactive: 0, unchanged: 0 },
        added: [{ hmac: rows[1]!.phoneHmac, generation: 1 }],
        credentials: [],
      }, error: null }
    })
    const service = createApplicantRosterService({ keyring, rpc })

    const result = await service.apply({
      cycleId, expectedVersion: 4, idempotencyKey: requestId, rows: [row, addedRow],
    }, { adminUserId, requestId })

    expect(result.credentials).toHaveLength(1)
    expect(result.credentials[0]).toMatchObject({ name: '새 지원자', phone: '01012349999' })
  })

  it('requires cycleId when regenerating current credentials', async () => {
    const [name, phone] = await Promise.all([
      protectApplicantName('윤 태준', keyring.nameHmacKey, keyring.piiEncryptionKey),
      protectPhone('01012345678', keyring.phoneHmacKey, keyring.piiEncryptionKey),
    ])
    const rpc = vi.fn(async (rpcName: string) => rpcName === 'list_admission_cycles_v1'
      ? { data: [currentCycle], error: null }
      : ({ data: [{
        id: 42,
        cycleId,
        nameCiphertext: Buffer.from(name.ciphertext).toString('hex'), nameIv: Buffer.from(name.iv).toString('hex'),
        phoneCiphertext: Buffer.from(phone.ciphertext).toString('hex'), phoneIv: Buffer.from(phone.iv).toString('hex'),
        passwordGeneration: 1, passwordKeyVersion: 1,
      }], error: null }))

    const credentials = await createApplicantRosterService({ keyring, rpc }).currentCredentials()
    expect(credentials).toMatchObject([{ name: '윤 태준', phone: '01012345678' }])
    expect(credentials[0]?.password).toBe('265678')
    expect(credentials[0]).not.toHaveProperty('id')
  })
})
