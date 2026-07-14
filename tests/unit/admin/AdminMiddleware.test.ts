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
})
