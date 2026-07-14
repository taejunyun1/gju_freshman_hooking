import { describe, expect, it, vi } from 'vitest'

describe('GET /api/student/session', () => {
  it('returns public session fields plus a memory-only session-bound CSRF token', async () => {
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
      csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      prospectId: 42,
      nickname: '선명한프레임01',
      expiresAt: '2026-07-14T22:00:00.000Z',
    })
    expect(Object.keys(response.data).sort()).toEqual(['csrfToken', 'expiresAt', 'nickname', 'prospectId'])
    expect(JSON.stringify(response)).not.toContain('opaque-session-token')
  })
})
