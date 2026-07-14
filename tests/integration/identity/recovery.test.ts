import { describe, expect, it, vi } from 'vitest'

const validRequest = { nickname: '빛의기록27', phone: '01012345678', region: 'gwangju' }

describe('student password recovery', () => {
  it('returns identical accepted responses for matching and unknown recovery identities', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createRecoveryRequestHandler } = await import('../../../server/api/student/password/recovery/request.post')
    const requested: unknown[] = []
    const requestRecovery = createRecoveryRequestHandler({
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
    expect(requested).toHaveLength(2)
  })

  it('generates a 128-bit approval code, persists only its hash, and audits no secret values', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    const stored: Array<Record<string, unknown>> = []
    const auditEvents: Array<Record<string, unknown>> = []
    const recovery = createPasswordRecoveryService({
      approveRequest: async (input: Record<string, unknown>) => { stored.push(input); return true },
      createRequest: async () => undefined,
      findRecoveryProspect: async () => null,
      now: () => new Date('2026-07-14T10:00:00.000Z'),
      passwordPepper: new Uint8Array(32).fill(9),
      random: (length: number) => new Uint8Array(length).fill(7),
      readCredentialByProspectId: async () => null,
      readStudentSession: async () => null,
      revokeOtherStudentSessionsAndUpdatePassword: async () => false,
      completeCredentialRecovery: async () => false,
      writeAuditEvent: async (input: Record<string, unknown>) => { auditEvents.push(input) },
    })

    const approved = await recovery.approve({ adminUserId: 'admin-1', requestId: 77, traceId: 'trace-1' })

    expect(approved.code).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(approved.expiresAt).toBe('2026-07-14T10:15:00.000Z')
    expect(stored).toEqual([expect.objectContaining({
      adminUserId: 'admin-1',
      codeHash: expect.any(Uint8Array),
      expiresAt: new Date('2026-07-14T10:15:00.000Z'),
      requestId: 77,
    })])
    expect((stored[0]!.codeHash as Uint8Array)).toHaveLength(32)
    expect(JSON.stringify(stored)).not.toContain(approved.code)
    expect(auditEvents).toEqual([{
      action: 'credential_recovery_approved',
      adminUserId: 'admin-1',
      requestId: 'trace-1',
      targetId: '77',
      targetType: 'credential_recovery_request',
    }])
  })

  it('completes recovery only through the atomic RPC and revokes every active session', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    let activeSessionCount = 3
    const rpcInputs: Array<Record<string, unknown>> = []
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => false,
      createRequest: async () => undefined,
      findRecoveryProspect: async () => null,
      now: () => new Date('2026-07-14T10:00:00.000Z'),
      passwordPepper: new Uint8Array(32).fill(9),
      random: (length: number) => new Uint8Array(length).fill(8),
      readCredentialByProspectId: async () => null,
      readStudentSession: async () => null,
      revokeOtherStudentSessionsAndUpdatePassword: async () => false,
      completeCredentialRecovery: async (input: Record<string, unknown>) => {
        rpcInputs.push(input)
        activeSessionCount = 0
        return true
      },
      writeAuditEvent: async () => undefined,
    })

    await expect(recovery.complete({ code: 'recover-code', newPassword: '새비밀번호-88' })).resolves.toEqual({ ok: true })
    expect(activeSessionCount).toBe(0)
    expect(rpcInputs).toEqual([expect.objectContaining({
      codeHash: expect.any(Uint8Array),
      passwordHash: expect.any(Uint8Array),
      passwordSalt: expect.any(Uint8Array),
    })])
    expect(Object.keys(rpcInputs[0]!).sort()).toEqual(['codeHash', 'passwordHash', 'passwordSalt'])
    expect(JSON.stringify(rpcInputs)).not.toContain('새비밀번호-88')
  })

  it('requires an active student session and current password before changing the password', async () => {
    const { createPasswordRecoveryService } = await import('../../../server/modules/identity/password-recovery')
    const updates: Array<Record<string, unknown>> = []
    const recovery = createPasswordRecoveryService({
      approveRequest: async () => false,
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
      revokeOtherStudentSessionsAndUpdatePassword: async (input: Record<string, unknown>) => { updates.push(input); return true },
      completeCredentialRecovery: async () => false,
      verifyCurrentPassword: async (password: string) => password === '현재비밀번호-77',
      writeAuditEvent: async () => undefined,
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
    expect(updates).toEqual([expect.objectContaining({ prospectId: 44, sessionTokenHash: expect.any(Uint8Array) })])
  })
})
