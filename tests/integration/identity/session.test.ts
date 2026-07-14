import { describe, expect, it, vi } from 'vitest'

describe('GET /api/student/session', () => {
  it('returns only prospect ID, nickname, and expiry for an active session', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createSessionHandler } = await import('../../../server/api/student/session.get')
    const handler = createSessionHandler({
      getCookie: () => 'opaque-session-token',
      getRequestId: () => '55555555-5555-4555-8555-555555555555',
      identity: {
        getStudentSession: async (token: string) => {
          expect(token).toBe('opaque-session-token')
          return { prospectId: 42, nickname: '선명한프레임01', expiresAt: '2026-07-14T22:00:00.000Z' }
        },
      },
      setStatus: () => undefined,
    })

    const response = await handler({})

    expect(response.data).toEqual({
      prospectId: 42,
      nickname: '선명한프레임01',
      expiresAt: '2026-07-14T22:00:00.000Z',
    })
    expect(Object.keys(response.data).sort()).toEqual(['expiresAt', 'nickname', 'prospectId'])
  })
})
