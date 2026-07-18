import { describe, expect, it, vi } from 'vitest'

describe('roster student session adapter', () => {
  it('decrypts a roster student name from the single session RPC response', async () => {
    const { createRosterSessionService } = await import('../../../server/modules/identity/student-session')
    const { protectApplicantName, revealApplicantName } = await import('../../../server/modules/identity/applicant-name')
    const encryptionKey = new Uint8Array(32).fill(3)
    const protectedName = await protectApplicantName('윤 태준', new Uint8Array(32).fill(2), encryptionKey)
    const rpc = vi.fn(async (rpcName: string) => {
      expect(rpcName).toBe('read_roster_student_session_v1')
      return {
        data: {
          kind: 'active',
          prospectId: 42,
          nickname: 'roster:cycle:internal-identifier',
          nameCiphertext: Buffer.from(protectedName.ciphertext).toString('hex'),
          nameIv: Buffer.from(protectedName.iv).toString('hex'),
          expiresAt: '2026-07-17T12:00:00.000Z',
        },
        error: null,
      }
    })
    const service = createRosterSessionService({
      rpc,
      decryptName: protectedName => revealApplicantName(protectedName, encryptionKey),
    })

    const session = await service.getStudentSession('opaque-session-token')

    expect(session).toEqual({
      prospectId: 42,
      nickname: '윤 태준',
      expiresAt: '2026-07-17T12:00:00.000Z',
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('closes an invalid encrypted roster session without returning its internal nickname', async () => {
    const { createRosterSessionService } = await import('../../../server/modules/identity/student-session')
    const rpc = vi.fn(async () => ({
      data: {
        kind: 'active',
        prospectId: 42,
        nickname: 'roster:cycle:internal-identifier',
        nameCiphertext: '00',
        nameIv: '00',
        expiresAt: '2026-07-17T12:00:00.000Z',
      },
      error: null,
    }))
    const service = createRosterSessionService({
      rpc,
      decryptName: async () => 'should-not-be-called',
    })

    await expect(service.getStudentSession('opaque-session-token')).rejects.toThrow('IDENTITY_STORE_INVALID')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('closes a roster session when name decryption fails', async () => {
    const { createRosterSessionService } = await import('../../../server/modules/identity/student-session')
    const rpc = vi.fn(async () => ({
      data: {
        kind: 'active',
        prospectId: 42,
        nickname: 'roster:cycle:internal-identifier',
        nameCiphertext: '00000000000000000000000000000000',
        nameIv: '000000000000000000000000',
        expiresAt: '2026-07-17T12:00:00.000Z',
      },
      error: null,
    }))
    const service = createRosterSessionService({
      rpc,
      decryptName: async () => { throw new Error('AES-GCM decryption failed') },
    })

    await expect(service.getStudentSession('opaque-session-token')).rejects.toThrow('IDENTITY_STORE_INVALID')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('revokes a session through the roster revoke RPC', async () => {
    const { createRosterSessionService } = await import('../../../server/modules/identity/student-session')
    const rpc = vi.fn(async (name: string) => {
      expect(name).toBe('revoke_roster_student_session_v1')
      return { data: { kind: 'success' }, error: null }
    })
    const service = createRosterSessionService({ rpc, decryptName: async () => '지원자' })

    await service.logoutStudent('opaque-session-token')

    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
