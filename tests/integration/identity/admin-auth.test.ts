import { describe, expect, it, vi } from 'vitest'

const verifiedAt = new Date('2026-07-14T10:00:00.000Z')

describe('administrator authentication', () => {
  it('rejects aal1 sessions even when an event claims an admin role', async () => {
    const { createRequireAdmin } = await import('../../../server/modules/identity/admin-auth')
    const requireAdmin = createRequireAdmin({
      findActiveAdmin: async () => ({ id: 'admin-1', role: 'admin' as const }),
      now: () => new Date('2026-07-14T10:01:00.000Z'),
      readAccessToken: () => 'verified-access-token',
      verifyAccessToken: async () => ({ aal: 'aal1', authenticatedAt: verifiedAt, userId: 'admin-1' }),
    })

    await expect(requireAdmin({ role: 'admin' })).rejects.toMatchObject({
      code: 'MFA_REQUIRED',
      statusCode: 403,
    })
  })

  it('requires reauthentication within 15 minutes for sensitive actions', async () => {
    const { createRequireAdmin } = await import('../../../server/modules/identity/admin-auth')
    const requireAdmin = createRequireAdmin({
      findActiveAdmin: async () => ({ id: 'admin-1', role: 'admin' as const }),
      now: () => new Date('2026-07-14T10:16:00.000Z'),
      readAccessToken: () => 'verified-access-token',
      verifyAccessToken: async () => ({ aal: 'aal2', authenticatedAt: verifiedAt, userId: 'admin-1' }),
    })

    await expect(requireAdmin({}, { recentAuthMinutes: 15 })).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
      statusCode: 403,
    })
  })

  it('caps every administrator session at eight hours after verified authentication', async () => {
    const { createRequireAdmin } = await import('../../../server/modules/identity/admin-auth')
    const requireAdmin = createRequireAdmin({
      findActiveAdmin: async () => ({ id: 'admin-1', role: 'admin' as const }),
      now: () => new Date('2026-07-14T18:00:00.001Z'),
      readAccessToken: () => 'verified-access-token',
      verifyAccessToken: async () => ({ aal: 'aal2', authenticatedAt: verifiedAt, userId: 'admin-1' }),
    })

    await expect(requireAdmin({})).rejects.toMatchObject({ code: 'REAUTH_REQUIRED', statusCode: 403 })
  })

  it('allows only an active allow-listed administrator and exposes verified context', async () => {
    const { createRequireAdmin } = await import('../../../server/modules/identity/admin-auth')
    const requireAdmin = createRequireAdmin({
      findActiveAdmin: async (userId: string) => userId === 'admin-1' ? { id: userId, role: 'admin' as const } : null,
      now: () => new Date('2026-07-14T10:01:00.000Z'),
      readAccessToken: () => 'verified-access-token',
      verifyAccessToken: async () => ({ aal: 'aal2', authenticatedAt: verifiedAt, userId: 'admin-1' }),
    })

    await expect(requireAdmin({ userId: 'client-supplied-user' })).resolves.toEqual({
      aal: 'aal2',
      authenticatedAt: verifiedAt,
      role: 'admin',
      userId: 'admin-1',
    })
  })

  it('protects admin APIs but permits the session bootstrap route to perform its own check', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createAdminAuthMiddleware } = await import('../../../server/middleware/10-admin-auth')
    const calls: string[] = []
    const middleware = createAdminAuthMiddleware({
      requireAdmin: async () => {
        calls.push('required')
        return { aal: 'aal2', authenticatedAt: verifiedAt, role: 'admin', userId: 'admin-1' }
      },
    })

    const protectedEvent = { context: {}, path: '/api/admin/recovery/44/approve' }
    await middleware(protectedEvent)
    await middleware({ context: {}, path: '/api/admin/session' })

    expect(calls).toEqual(['required'])
    expect(protectedEvent.context).toMatchObject({ admin: { userId: 'admin-1' } })
  })
})
