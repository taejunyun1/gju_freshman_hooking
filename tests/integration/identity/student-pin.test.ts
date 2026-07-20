import { describe, expect, it, vi } from 'vitest'

describe('student PIN self-service adapter', () => {
  const keyring = {
    phoneHmacKey: new Uint8Array(32).fill(1),
    nameHmacKey: new Uint8Array(32).fill(2),
    piiEncryptionKey: new Uint8Array(32).fill(3),
    currentPassword: { version: 7, pepper: new Uint8Array(32).fill(4) },
  }

  it('changes a signed-in PIN through one digest-only RPC and replaces the session', async () => {
    const { createStudentPinService } = await import('../../../server/modules/identity/student-pin')
    const rpc = vi.fn(async () => ({
      data: { kind: 'authenticated', prospectId: 42, expiresAt: '2026-07-20T12:00:00.000Z' },
      error: null,
    }))
    const service = createStudentPinService({
      currentCycle: async () => ({ year: 2026 }),
      keyring,
      now: () => new Date('2026-07-20T00:00:00.000Z'),
      random: () => new Uint8Array(32).fill(9),
      rpc,
      sessions: { getStudentSession: async () => ({ prospectId: 42, nickname: '학생', expiresAt: '2026-07-20T12:00:00.000Z' }) },
    })

    const result = await service.changePin({
      currentPin: '269442',
      nextPin: '123456',
      sessionToken: 'current-session-token',
    })

    expect(result).toMatchObject({
      expiresAt: '2026-07-20T12:00:00.000Z',
      sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
    })
    expect(rpc).toHaveBeenCalledWith('change_roster_student_pin_self_v1', expect.objectContaining({
      p_current_digest: expect.any(String),
      p_next_digest: expect.any(String),
      p_next_token_hash: expect.any(String),
      p_session_token_hash: expect.any(String),
    }))
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('269442')
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('123456')
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('current-session-token')
  })

  it('does not issue a replacement cookie when the authoritative PIN RPC rejects an expired session', async () => {
    const { createStudentPinService } = await import('../../../server/modules/identity/student-pin')
    const rpc = vi.fn(async () => ({ data: { kind: 'failed' }, error: null }))
    const service = createStudentPinService({
      currentCycle: async () => ({ year: 2026 }),
      keyring,
      rpc,
      sessions: { getStudentSession: async () => null },
    })

    await expect(service.changePin({ sessionToken: 'expired', currentPin: '269442', nextPin: '123456' })).resolves.toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('resets to year-plus-phone initial PIN through one reset RPC without returning the PIN', async () => {
    const { createStudentPinService } = await import('../../../server/modules/identity/student-pin')
    const rpc = vi.fn(async () => ({
      data: { kind: 'authenticated', prospectId: 42, expiresAt: '2026-07-20T12:00:00.000Z' },
      error: null,
    }))
    const service = createStudentPinService({
      currentCycle: async () => ({ year: 2026 }),
      keyring,
      now: () => new Date('2026-07-20T00:00:00.000Z'),
      random: () => new Uint8Array(32).fill(8),
      rpc,
      sessions: { getStudentSession: async () => null },
    })

    const result = await service.resetForgottenPin({ phone: '010-4225-9442' })

    expect(result).toMatchObject({
      expiresAt: '2026-07-20T12:00:00.000Z',
      sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
    })
    expect(rpc).toHaveBeenCalledWith('reset_roster_student_pin_and_assessment_v1', expect.objectContaining({
      p_initial_digest: expect.any(String),
      p_next_token_hash: expect.any(String),
      p_phone_hmac: expect.any(String),
    }))
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('269442')
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('01042259442')
  })
})
