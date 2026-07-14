import { describe, expect, it, vi } from 'vitest'

type TestFactor = {
  factor_type: 'totp'
  id: string
  status: 'unverified' | 'verified'
}

describe('local administrator bootstrap guard', () => {
  it.each([
    'http://localhost:54321',
    'http://127.0.0.1:54321',
  ])('permits the exact local Supabase hosts: %s', async (url) => {
    const { isLocalSupabaseUrl } = await import('../../../scripts/bootstrap-local-admin')

    expect(isLocalSupabaseUrl(url)).toBe(true)
  })

  it.each([
    'https://project.supabase.co',
    'http://localhost.example.com:54321',
    'http://localhost@project.supabase.co',
    'not-a-url',
  ])('rejects nonlocal or misleading Supabase URLs before calling an adapter: %s', async (url) => {
    const { bootstrapLocalAdmin } = await import('../../../scripts/bootstrap-local-admin')
    const adapter = {
      createUser: vi.fn(),
      signIn: vi.fn(),
      upsertAdmin: vi.fn(),
    }

    await expect(bootstrapLocalAdmin({
      email: 'local-admin@example.test',
      password: 'environment-only-password',
      supabaseUrl: url,
    }, adapter, vi.fn())).rejects.toThrow('LOCAL_SUPABASE_URL_REQUIRED')
    expect(adapter.createUser).not.toHaveBeenCalled()
    expect(adapter.signIn).not.toHaveBeenCalled()
  })

  it('leaves TOTP enrollment to the browser and reuses the single verified factor on later login', async () => {
    const { bootstrapLocalAdmin } = await import('../../../scripts/bootstrap-local-admin')
    const { beginAdminAuthentication, verifyAdminTotp } = await import('../../../app/utils/admin-supabase')
    const factors: TestFactor[] = []
    const write = vi.fn()
    const adapter = {
      createUser: vi.fn(async () => 'admin-1'),
      signIn: vi.fn(async () => undefined),
      upsertAdmin: vi.fn(async () => undefined),
    }
    const enroll = vi.fn(async () => {
      const factor: TestFactor = { factor_type: 'totp', id: 'browser-factor-1', status: 'unverified' }
      factors.push(factor)
      return {
        data: {
          id: factor.id,
          totp: {
            qr_code: 'data:image/svg+xml;utf-8,%3Csvg%3Eauth-qr%3C%2Fsvg%3E',
            secret: 'auth-generated-secret',
            uri: 'otpauth://totp/PHOTO%3ANEXT?secret=auth-generated-secret',
          },
          type: 'totp',
        },
        error: null,
      }
    })
    const browserClient = {
      auth: {
        mfa: {
          challenge: vi.fn(async ({ factorId }: { factorId: string }) => ({
            data: { expires_at: 1_784_000_000, id: `challenge-for-${factorId}`, type: 'totp' },
            error: null,
          })),
          enroll,
          listFactors: vi.fn(async () => ({
            data: {
              all: [...factors],
              phone: [],
              totp: factors.filter(factor => factor.status === 'verified'),
              webauthn: [],
            },
            error: null,
          })),
          verify: vi.fn(async ({ factorId }: { factorId: string }) => {
            const factor = factors.find(candidate => candidate.id === factorId)
            if (factor) factor.status = 'verified'
            return {
              data: {
                access_token: 'short-lived-aal2-token',
                expires_in: 3600,
                refresh_token: 'sdk-only-refresh-token',
                token_type: 'bearer',
                user: { id: 'admin-1' },
              },
              error: null,
            }
          }),
        },
        signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
      },
    }

    await bootstrapLocalAdmin({
      email: 'local-admin@example.test',
      password: 'environment-only-password',
      supabaseUrl: 'http://127.0.0.1:54321',
    }, adapter, write)

    expect(factors).toEqual([])
    expect(adapter.createUser.mock.invocationCallOrder[0]).toBeLessThan(adapter.signIn.mock.invocationCallOrder[0]!)
    expect(adapter.signIn.mock.invocationCallOrder[0]).toBeLessThan(adapter.upsertAdmin.mock.invocationCallOrder[0]!)
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith('Local administrator ready. Enroll TOTP on first browser login at /admin/login.')
    expect(JSON.stringify(write.mock.calls)).not.toContain('environment-only-password')
    expect(JSON.stringify(write.mock.calls)).not.toContain('secret=')

    const firstLogin = await beginAdminAuthentication(browserClient as never, 'local-admin@example.test', 'environment-only-password')
    expect(firstLogin.factorId).toBe('browser-factor-1')
    expect(factors).toEqual([{ factor_type: 'totp', id: 'browser-factor-1', status: 'unverified' }])

    await verifyAdminTotp(browserClient as never, firstLogin.factorId, '123456')
    expect(factors).toEqual([{ factor_type: 'totp', id: 'browser-factor-1', status: 'verified' }])

    const laterLogin = await beginAdminAuthentication(browserClient as never, 'local-admin@example.test', 'environment-only-password')
    expect(laterLogin).toEqual({ enrollment: null, factorId: 'browser-factor-1' })
    expect(enroll).toHaveBeenCalledOnce()
    expect(factors).toHaveLength(1)
  })
})
