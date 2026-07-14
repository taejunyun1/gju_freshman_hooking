import { describe, expect, it, vi } from 'vitest'

const validRequest = { nickname: '빛의기록27', phone: '01012345678', region: 'gwangju' }

describe('student password recovery', () => {
  it('encodes and decodes PostgREST bytea values without changing the bytes', async () => {
    const { bytesFromPostgresBytea, postgresByteaFromBytes } = await import('../../../server/modules/identity/password-recovery')
    const bytes = Uint8Array.from([0, 1, 15, 16, 127, 128, 255])

    expect(postgresByteaFromBytes(bytes)).toBe('\\x00010f107f80ff')
    expect(bytesFromPostgresBytea('\\x00010f107f80ff')).toEqual(bytes)
  })

  it('returns identical accepted responses for matching and unknown recovery identities', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createRecoveryRequestHandler } = await import('../../../server/api/student/password/recovery/request.post')
    const requested: unknown[] = []
    const requestRecovery = createRecoveryRequestHandler({
      getIp: () => '203.0.113.91',
      getRequestId: () => 'request-1',
      readBody: async (event: { body: unknown }) => event.body,
      requestRecovery: async (input: unknown) => { requested.push(input) },
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })

    const matchingEvent: { body: unknown, status?: number } = { body: validRequest }
    const unknownEvent: { body: unknown, status?: number } = {
      body: { nickname: '없는닉네임00', phone: '01099999999', region: 'capital' },
    }
    const matching = await requestRecovery(matchingEvent)
    const unknown = await requestRecovery(unknownEvent)

    expect(matchingEvent.status).toBe(202)
    expect(unknownEvent.status).toBe(202)
    expect(matching).toEqual({ accepted: true })
    expect(unknown).toEqual(matching)
    expect(requested).toEqual([
      { ...validRequest, ip: '203.0.113.91' },
      { nickname: '없는닉네임00', phone: '01099999999', region: 'capital', ip: '203.0.113.91' },
    ])
  })

  it('enforces exact anonymous request IP and phone-HMAC budgets before prospect lookup', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    const calls: Array<{ key: string, limit: number, route: string, window: string } | { lookup: true }> = []
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => null,
      changeStudentPassword: async () => false,
      completeCredentialRecovery: async () => false,
      consumeRateLimit: async (input) => { calls.push(input); return true },
      createRequest: async () => undefined,
      findRecoveryProspect: async () => { calls.push({ lookup: true }); return null },
      passwordPepper: new Uint8Array(32).fill(9),
      phoneHmacKey: new Uint8Array(32).fill(7),
      readCredentialByProspectId: async () => null,
      readStudentSession: async () => null,
    })

    await recovery.request({ ...validRequest, ip: '203.0.113.91' })

    expect(calls).toEqual([
      {
        key: '203.0.113.91',
        limit: 10,
        route: '/api/student/password/recovery/request:ip',
        window: '1 hour',
      },
      {
        key: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        limit: 3,
        route: '/api/student/password/recovery/request:phone',
        window: '1 hour',
      },
      { lookup: true },
    ])
  })

  it('does not look up a recovery identity or queue work after a request bucket is exhausted', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    const findRecoveryProspect = vi.fn()
    const createRequest = vi.fn()
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => null,
      changeStudentPassword: async () => false,
      completeCredentialRecovery: async () => false,
      consumeRateLimit: async () => false,
      createRequest,
      findRecoveryProspect,
      passwordPepper: new Uint8Array(32).fill(9),
      phoneHmacKey: new Uint8Array(32).fill(7),
      readCredentialByProspectId: async () => null,
      readStudentSession: async () => null,
    })

    await expect(recovery.request({ ...validRequest, ip: '203.0.113.91' })).resolves.toBeUndefined()

    expect(findRecoveryProspect).not.toHaveBeenCalled()
    expect(createRequest).not.toHaveBeenCalled()
  })

  it('returns the one-time code only from an atomic approval transaction and audits no secret values', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    const stored: Array<Record<string, unknown>> = []
    const code = 'BwcHBwcHBwcHBwcHBwcHBw'
    const expiresAt = new Date('2026-07-14T10:15:00.000Z')
    const recovery = createPasswordRecoveryService({
      approveRequest: async (input: Record<string, unknown>) => { stored.push(input); return { code, expiresAt } },
      createRequest: async () => undefined,
      findRecoveryProspect: async () => null,
      now: () => new Date('2026-07-14T10:00:00.000Z'),
      passwordPepper: new Uint8Array(32).fill(9),
      random: (length: number) => new Uint8Array(length).fill(7),
      readCredentialByProspectId: async () => null,
      readStudentSession: async () => null,
      changeStudentPassword: async () => false,
      completeCredentialRecovery: async () => false,
      consumeRateLimit: async () => true,
    })

    const approved = await recovery.approve({ adminUserId: 'admin-1', requestId: 77, traceId: 'trace-1' })

    expect(approved.code).toBe(code)
    expect(approved.expiresAt).toBe(expiresAt.toISOString())
    expect(stored).toEqual([{ adminUserId: 'admin-1', requestId: 77, traceId: 'trace-1' }])
    expect(JSON.stringify(stored)).not.toContain(approved.code)
  })

  it('does not generate a code when the atomic approval transaction rejects an expired request', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    let randomCalls = 0
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => null,
      createRequest: async () => undefined,
      findRecoveryProspect: async () => null,
      now: () => new Date('2026-07-14T10:00:00.000Z'),
      passwordPepper: new Uint8Array(32).fill(9),
      random: (length: number) => { randomCalls += 1; return new Uint8Array(length).fill(8) },
      readCredentialByProspectId: async () => null,
      readStudentSession: async () => null,
      changeStudentPassword: async () => false,
      completeCredentialRecovery: async () => false,
      consumeRateLimit: async () => true,
    })

    await expect(recovery.approve({ adminUserId: 'admin-1', requestId: 77, traceId: 'trace-1' }))
      .rejects.toMatchObject({ code: 'RECOVERY_INVALID' })
    expect(randomCalls).toBe(0)
  })

  it('completes recovery only through the atomic RPC and revokes every active session', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    let activeSessionCount = 3
    const rpcInputs: Array<Record<string, unknown>> = []
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => null,
      createRequest: async () => undefined,
      findRecoveryProspect: async () => null,
      now: () => new Date('2026-07-14T10:00:00.000Z'),
      passwordPepper: new Uint8Array(32).fill(9),
      random: (length: number) => new Uint8Array(length).fill(8),
      readCredentialByProspectId: async () => null,
      readStudentSession: async () => null,
      changeStudentPassword: async () => false,
      completeCredentialRecovery: async (input: Record<string, unknown>) => {
        rpcInputs.push(input)
        activeSessionCount = 0
        return true
      },
      consumeRateLimit: async () => true,
    })

    await expect(recovery.complete({ code: 'recover-code', ip: '203.0.113.92', newPassword: '새비밀번호-88' })).resolves.toEqual({ ok: true })
    expect(activeSessionCount).toBe(0)
    expect(rpcInputs).toEqual([expect.objectContaining({
      codeHash: expect.any(Uint8Array),
      passwordHash: expect.any(Uint8Array),
      passwordSalt: expect.any(Uint8Array),
    })])
    expect(Object.keys(rpcInputs[0]!).sort()).toEqual(['codeHash', 'passwordHash', 'passwordSalt'])
    expect(JSON.stringify(rpcInputs)).not.toContain('새비밀번호-88')
  })

  it('checks exact completion IP and code-hash budgets before expensive password derivation', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    const order: string[] = []
    const calls: unknown[] = []
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => null,
      changeStudentPassword: async () => false,
      completeCredentialRecovery: async () => true,
      consumeRateLimit: async (input) => { order.push(`rate:${input.route}`); calls.push(input); return true },
      createRequest: async () => undefined,
      derivePassword: async (_password, salt) => {
        order.push('derive')
        return { hash: new Uint8Array(32).fill(4), salt }
      },
      findRecoveryProspect: async () => null,
      passwordPepper: new Uint8Array(32).fill(9),
      random: length => new Uint8Array(length).fill(7),
      readCredentialByProspectId: async () => null,
      readStudentSession: async () => null,
    })

    await recovery.complete({ code: 'recover-code', ip: '203.0.113.92', newPassword: '새비밀번호-88' })

    expect(calls).toEqual([
      {
        key: '203.0.113.92',
        limit: 10,
        route: '/api/student/password/recovery/complete:ip',
        window: '5 minutes',
      },
      {
        key: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        limit: 5,
        route: '/api/student/password/recovery/complete:code',
        window: '15 minutes',
      },
    ])
    expect(order).toEqual([
      'rate:/api/student/password/recovery/complete:ip',
      'rate:/api/student/password/recovery/complete:code',
      'derive',
    ])
  })

  it('rejects exhausted completion attempts generically before random salt or password derivation', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    const random = vi.fn((length: number) => new Uint8Array(length))
    const derivePassword = vi.fn()
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => null,
      changeStudentPassword: async () => false,
      completeCredentialRecovery: async () => false,
      consumeRateLimit: async () => false,
      createRequest: async () => undefined,
      derivePassword,
      findRecoveryProspect: async () => null,
      passwordPepper: new Uint8Array(32).fill(9),
      random,
      readCredentialByProspectId: async () => null,
      readStudentSession: async () => null,
    })

    await expect(recovery.complete({ code: 'any-code', ip: '203.0.113.92', newPassword: '새비밀번호-88' }))
      .rejects.toMatchObject({ code: 'RECOVERY_INVALID' })
    expect(random).not.toHaveBeenCalled()
    expect(derivePassword).not.toHaveBeenCalled()
  })

  it('verifies the current password before calling the recovery-safe change transaction', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    const updates: Array<Record<string, unknown>> = []
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => null,
      createRequest: async () => undefined,
      findRecoveryProspect: async () => null,
      now: () => new Date('2026-07-14T10:00:00.000Z'),
      passwordPepper: new Uint8Array(32).fill(9),
      random: (length: number) => new Uint8Array(length).fill(8),
      readCredentialByProspectId: async () => ({
        passwordHash: new Uint8Array(32),
        passwordSalt: new Uint8Array(16).fill(3),
      }),
      readStudentSession: async (token: string) => token === 'active-session'
        ? { prospectId: 44, tokenHash: new Uint8Array(32).fill(5) }
        : null,
      changeStudentPassword: async (input: Record<string, unknown>) => { updates.push(input); return true },
      completeCredentialRecovery: async () => false,
      consumeRateLimit: async () => true,
      verifyCurrentPassword: async (password: string) => password === '현재비밀번호-77',
    })

    await expect(recovery.changePassword({
      currentPassword: '현재비밀번호-77',
      newPassword: '새비밀번호-88',
      sessionToken: 'active-session',
    })).resolves.toEqual({ ok: true })
    await expect(recovery.changePassword({
      currentPassword: '현재비밀번호-77',
      newPassword: '새비밀번호-88',
      sessionToken: '',
    })).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(updates).toEqual([{
      passwordHash: expect.any(Uint8Array),
      passwordSalt: expect.any(Uint8Array),
      sessionTokenHash: expect.any(Uint8Array),
    }])
  })

  it('cannot overwrite recovery when recovery revokes the initiating session before mutation', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    const recoveredPasswordHash = new Uint8Array(32).fill(9)
    let storedPasswordHash = new Uint8Array(32).fill(4)
    let initiatingSessionRevoked = false
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => null,
      changeStudentPassword: async (input) => {
        if (initiatingSessionRevoked) return false
        storedPasswordHash = input.passwordHash
        return true
      },
      completeCredentialRecovery: async () => false,
      consumeRateLimit: async () => true,
      createRequest: async () => undefined,
      findRecoveryProspect: async () => null,
      passwordPepper: new Uint8Array(32).fill(8),
      random: length => new Uint8Array(length).fill(7),
      readCredentialByProspectId: async () => ({
        passwordHash: new Uint8Array(32).fill(4),
        passwordSalt: new Uint8Array(16).fill(5),
      }),
      readStudentSession: async () => ({
        prospectId: 44,
        tokenHash: new Uint8Array(32).fill(6),
      }),
      verifyCurrentPassword: async () => {
        initiatingSessionRevoked = true
        storedPasswordHash = recoveredPasswordHash
        return true
      },
    })

    await expect(recovery.changePassword({
      currentPassword: '현재비밀번호-77',
      newPassword: '새비밀번호-88',
      sessionToken: 'active-before-recovery',
    })).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(storedPasswordHash).toEqual(recoveredPasswordHash)
  })
})
