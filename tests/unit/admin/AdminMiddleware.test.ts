import { describe, expect, it, vi } from 'vitest'

describe('administrator route middleware', () => {
  it('skips the login route and avoids redirect loops', async () => {
    vi.stubGlobal('defineNuxtRouteMiddleware', (guard: unknown) => guard)
    vi.stubGlobal('navigateTo', vi.fn())
    const { createAdminRouteGuard } = await import('../../../app/middleware/admin')
    const guard = createAdminRouteGuard({ clear: vi.fn(), isVerified: false }, navigateTo)

    await guard({ fullPath: '/admin/login', path: '/admin/login' })

    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('redirects an unauthenticated protected route to login with a safe admin path', async () => {
    vi.stubGlobal('defineNuxtRouteMiddleware', (guard: unknown) => guard)
    const navigate = vi.fn((target: unknown) => target)
    const { createAdminRouteGuard } = await import('../../../app/middleware/admin')
    const guard = createAdminRouteGuard({ clear: vi.fn(), isVerified: false }, navigate)

    await guard({ fullPath: '/admin/recovery?state=pending', path: '/admin/recovery' })

    expect(navigate).toHaveBeenCalledWith({
      path: '/admin/login',
      query: { redirect: '/admin/recovery?state=pending' },
      replace: true,
    })
  })

  it('does not compose server administrator dependencies for public routes', async () => {
    vi.resetModules()
    const getServerRequireAdmin = vi.fn(() => {
      throw new Error('SERVER_CONFIG_INVALID')
    })
    vi.doMock('../../../server/modules/identity/admin-auth', () => ({ getServerRequireAdmin }))
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', ({ statusCode, statusMessage }: { statusCode: number, statusMessage: string }) => (
      Object.assign(new Error(statusMessage), { statusCode, statusMessage })
    ))
    const { default: adminAuthMiddleware } = await import('../../../server/middleware/admin-auth')

    await expect(adminAuthMiddleware({ path: '/api/health', context: {} } as never)).resolves.toBeUndefined()
    await expect(adminAuthMiddleware({ path: '/admin/login', context: {} } as never)).resolves.toBeUndefined()
    expect(getServerRequireAdmin).not.toHaveBeenCalled()
  })
})
