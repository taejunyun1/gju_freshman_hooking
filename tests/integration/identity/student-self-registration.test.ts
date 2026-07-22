import { describe, expect, it, vi } from 'vitest'

import { applicantRosterRowSchema } from '../../../shared/schemas/admission-roster'
import { derivePasswordDigest } from '../../../server/modules/identity/roster-credentials'
import { postgresByteaFromBytes } from '../../../server/utils/postgres-bytea'

const keyring = {
  phoneHmacKey: new Uint8Array(32).fill(1),
  nameHmacKey: new Uint8Array(32).fill(2),
  piiEncryptionKey: new Uint8Array(32).fill(3),
  currentPassword: { version: 7, pepper: new Uint8Array(32).fill(4) },
}

const rosterRow = applicantRosterRowSchema.parse({
  name: ' 김지원 ',
  phone: '010-4225-9442',
  highSchool: 'PHOTO 고등학교',
  grade: '고2',
})

const context = {
  anonymousId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ip: '203.0.113.10',
  requestId: '11111111-1111-4111-8111-111111111111',
}

describe('student self-registration service', () => {
  it('registers protected roster values for the one current cycle and returns only an opaque session', async () => {
    const { createStudentSelfRegistrationService } = await import('../../../server/modules/identity/student-self-registration')
    const calls: Array<{ name: string, args: Record<string, unknown> }> = []
    const events: unknown[] = []
    const service = createStudentSelfRegistrationService({
      keyring,
      now: () => new Date('2026-07-22T00:00:00.000Z'),
      random: () => new Uint8Array(32).fill(9),
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        if (name === 'list_admission_cycles_v1') {
          return {
            data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', year: 2026, status: 'current' }],
            error: null,
          }
        }
        return {
          data: { kind: 'created', prospectId: 42, expiresAt: '2026-07-22T12:00:00.000Z' },
          error: null,
        }
      }),
      writeEvent: async event => { events.push(event) },
    })

    const result = await service.registerStudent(rosterRow, context)

    expect(result).toEqual({
      kind: 'created',
      sessionToken: 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk',
      expiresAt: '2026-07-22T12:00:00.000Z',
    })
    expect(calls.map(call => call.name)).toEqual(['list_admission_cycles_v1', 'register_roster_student_v1'])
    const args = calls[1]!.args
    expect(args).toEqual(expect.objectContaining({
      p_expected_cycle_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      p_expected_cycle_year: 2026,
      p_phone_hmac: expect.stringMatching(/^\\x[0-9a-f]{64}$/u),
      p_phone_ciphertext: expect.stringMatching(/^\\x[0-9a-f]+$/u),
      p_phone_iv: expect.stringMatching(/^\\x[0-9a-f]{24}$/u),
      p_name_hmac: expect.stringMatching(/^\\x[0-9a-f]{64}$/u),
      p_name_ciphertext: expect.stringMatching(/^\\x[0-9a-f]+$/u),
      p_name_iv: expect.stringMatching(/^\\x[0-9a-f]{24}$/u),
      p_password_digest: expect.stringMatching(/^\\x[0-9a-f]{64}$/u),
      p_password_key_version: 7,
      p_ip_hmac: expect.stringMatching(/^\\x[0-9a-f]{64}$/u),
      p_token_hash: expect.stringMatching(/^\\x[0-9a-f]{64}$/u),
      p_expires_at: '2026-07-22T12:00:00.000Z',
      p_school_name: 'PHOTO 고등학교',
      p_applicant_stage: 'high2',
    }))
    const serialized = JSON.stringify(args)
    expect(serialized).not.toContain(rosterRow.name)
    expect(serialized).not.toContain(rosterRow.phone)
    expect(serialized).not.toContain('269442')
    expect(Object.keys(result)).not.toContain('prospectId')
    expect(events).toEqual([
      expect.objectContaining({ eventName: 'registration_started', path: '/api/student/register' }),
      expect.objectContaining({ eventName: 'registration_completed', prospectId: 42, path: '/api/student/register' }),
    ])
  })

  it('re-reads a rolled-over cycle and creates only a session whose digest uses the new year', async () => {
    const { createStudentSelfRegistrationService } = await import('../../../server/modules/identity/student-self-registration')
    const cycles = [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', year: 2027, status: 'current' as const },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8', year: 2028, status: 'current' as const },
    ]
    const registrationCalls: Record<string, unknown>[] = []
    const createdAccountDigests: unknown[] = []
    let cycleReads = 0
    const service = createStudentSelfRegistrationService({
      keyring,
      now: () => new Date('2026-07-22T00:00:00.000Z'),
      random: () => new Uint8Array(32).fill(registrationCalls.length + 1),
      rpc: async (name: string, args?: Record<string, unknown>) => {
        if (name === 'list_admission_cycles_v1') {
          return { data: [cycles[cycleReads++]], error: null }
        }
        registrationCalls.push(args ?? {})
        if (registrationCalls.length === 1) return { data: { kind: 'cycle_changed' }, error: null }
        createdAccountDigests.push(args?.p_password_digest)
        return {
          data: { kind: 'created', prospectId: 84, expiresAt: '2026-07-22T12:00:00.000Z' },
          error: null,
        }
      },
      writeEvent: async () => undefined,
    })
    const staleDigest = postgresByteaFromBytes(await derivePasswordDigest('279442', keyring.currentPassword.pepper))
    const currentDigest = postgresByteaFromBytes(await derivePasswordDigest('289442', keyring.currentPassword.pepper))

    await expect(service.registerStudent(rosterRow, context)).resolves.toEqual(expect.objectContaining({
      kind: 'created',
      expiresAt: '2026-07-22T12:00:00.000Z',
    }))

    expect(cycleReads).toBe(2)
    expect(registrationCalls).toHaveLength(2)
    expect(registrationCalls[0]).toEqual(expect.objectContaining({
      p_expected_cycle_id: cycles[0]!.id,
      p_expected_cycle_year: 2027,
      p_password_digest: staleDigest,
    }))
    expect(registrationCalls[1]).toEqual(expect.objectContaining({
      p_expected_cycle_id: cycles[1]!.id,
      p_expected_cycle_year: 2028,
      p_password_digest: currentDigest,
    }))
    expect(createdAccountDigests).toEqual([currentDigest])
    expect(createdAccountDigests).not.toContain(staleDigest)
    expect(registrationCalls[0]!.p_token_hash).not.toBe(registrationCalls[1]!.p_token_hash)
  })

  it('fails closed after one retry when the cycle changes again', async () => {
    const { createStudentSelfRegistrationService } = await import('../../../server/modules/identity/student-self-registration')
    let cycleReads = 0
    let registrationCalls = 0
    const service = createStudentSelfRegistrationService({
      keyring,
      random: () => new Uint8Array(32).fill(registrationCalls + 1),
      rpc: async (name: string) => {
        if (name === 'list_admission_cycles_v1') {
          cycleReads += 1
          return {
            data: [{
              id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${cycleReads}`,
              year: 2026 + cycleReads,
              status: 'current',
            }],
            error: null,
          }
        }
        registrationCalls += 1
        return { data: { kind: 'cycle_changed' }, error: null }
      },
      writeEvent: async () => undefined,
    })

    await expect(service.registerStudent(rosterRow, context)).rejects.toThrow('IDENTITY_STORE_INVALID')
    expect(cycleReads).toBe(2)
    expect(registrationCalls).toBe(2)
  })

  it.each(['existing', 'rate_limited'] as const)('does not issue a browser session when registration is %s', async (kind) => {
    const { createStudentSelfRegistrationService } = await import('../../../server/modules/identity/student-self-registration')
    const random = vi.fn(() => new Uint8Array(32).fill(9))
    const writeEvent = vi.fn(async () => undefined)
    const service = createStudentSelfRegistrationService({
      keyring,
      random,
      rpc: async (name: string) => name === 'list_admission_cycles_v1'
        ? { data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', year: 2026, status: 'current' }], error: null }
        : { data: { kind }, error: null },
      writeEvent,
    })

    await expect(service.registerStudent(rosterRow, context)).resolves.toEqual({ kind })
    expect(random).toHaveBeenCalledOnce()
    expect(writeEvent).toHaveBeenCalledTimes(1)
    expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'registration_started' }))
  })

  it('fails closed for an invalid registration RPC payload', async () => {
    const { createStudentSelfRegistrationService } = await import('../../../server/modules/identity/student-self-registration')
    const service = createStudentSelfRegistrationService({
      keyring,
      rpc: async (name: string) => name === 'list_admission_cycles_v1'
        ? { data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', year: 2026, status: 'current' }], error: null }
        : { data: { kind: 'created', prospectId: '42', expiresAt: 'not-a-date' }, error: null },
      writeEvent: async () => undefined,
    })

    await expect(service.registerStudent(rosterRow, context)).rejects.toThrow('IDENTITY_STORE_INVALID')
  })

  it('fails closed when the registration RPC returns an unsafe integer prospect ID', async () => {
    const { createStudentSelfRegistrationService } = await import('../../../server/modules/identity/student-self-registration')
    const writeEvent = vi.fn(async () => undefined)
    const service = createStudentSelfRegistrationService({
      keyring,
      rpc: async (name: string) => name === 'list_admission_cycles_v1'
        ? { data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', year: 2026, status: 'current' }], error: null }
        : {
            data: {
              kind: 'created',
              prospectId: Number.MAX_SAFE_INTEGER + 1,
              expiresAt: '2026-07-22T12:00:00.000Z',
            },
            error: null,
          },
      writeEvent,
    })

    await expect(service.registerStudent(rosterRow, context)).rejects.toThrow('IDENTITY_STORE_INVALID')
    expect(writeEvent).toHaveBeenCalledTimes(1)
    expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'registration_started' }))
  })
})
