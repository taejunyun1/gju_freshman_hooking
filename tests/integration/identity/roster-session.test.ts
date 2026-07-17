import { describe, expect, it, vi } from 'vitest'

describe('roster student session adapter', () => {
  it('reads a session through the roster read RPC without touching last_seen_at', async () => {
    const { createRosterSessionService } = await import('../../../server/modules/identity/student-session')
    const rpc = vi.fn(async (name: string) => {
      expect(name).toBe('read_roster_student_session_v1')
      return {
        data: {
          kind: 'active',
          prospectId: 42,
          nickname: '지원자',
          expiresAt: '2026-07-17T12:00:00.000Z',
        },
        error: null,
      }
    })
    const service = createRosterSessionService({ rpc })

    const session = await service.getStudentSession('opaque-session-token')

    expect(session).toEqual({
      prospectId: 42,
      nickname: '지원자',
      expiresAt: '2026-07-17T12:00:00.000Z',
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('revokes a session through the roster revoke RPC', async () => {
    const { createRosterSessionService } = await import('../../../server/modules/identity/student-session')
    const rpc = vi.fn(async (name: string) => {
      expect(name).toBe('revoke_roster_student_session_v1')
      return { data: { kind: 'success' }, error: null }
    })
    const service = createRosterSessionService({ rpc })

    await service.logoutStudent('opaque-session-token')

    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
