import { describe, expect, it, vi } from 'vitest'

import { applicantRosterRowSchema } from '../../../shared/schemas/admission-roster'

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
})
