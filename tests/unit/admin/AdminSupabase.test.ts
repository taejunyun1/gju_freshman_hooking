import { describe, expect, it, vi } from 'vitest'

describe('administrator-only Supabase Auth wrapper', () => {
  it('disables SDK persistence, refresh, and URL session detection', async () => {
    const { createAdminSupabaseClient } = await import('../../../app/utils/admin-supabase')
    const client = { auth: {} }
    const factory = vi.fn(() => client)

    expect(createAdminSupabaseClient('https://example.supabase.co', 'publishable-key', factory as never)).toBe(client)
    expect(factory).toHaveBeenCalledWith('https://example.supabase.co', 'publishable-key', {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    })
  })

  it('signs in once with a password without calling MFA APIs or exposing the refresh token', async () => {
    const { signInAdminWithPassword } = await import('../../../app/utils/admin-supabase')
    const mfa = {
      challenge: vi.fn(),
      enroll: vi.fn(),
      listFactors: vi.fn(),
      unenroll: vi.fn(),
      verify: vi.fn(),
    }
    const session = {
      access_token: 'short-lived-aal1-token',
      expires_in: 3600,
      refresh_token: 'must-not-leave-sdk-memory',
      user: { id: 'admin-1' },
    }
    const signInWithPassword = vi.fn(async () => ({
      data: {
        session,
        user: { id: 'admin-1' },
      },
      error: null,
    }))
    const signOut = vi.fn(async () => {
      session.access_token = 'removed-with-sdk-session'
      session.expires_in = 0
      session.refresh_token = 'removed-with-sdk-session'
      session.user.id = 'removed-with-sdk-session'
      return { error: null }
    })
    const client = { auth: { mfa, signInWithPassword, signOut } }

    const signedIn = await signInAdminWithPassword(
      client as never,
      'admin@example.test',
      'password-from-form',
    )

    expect(signInWithPassword).toHaveBeenCalledOnce()
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@example.test',
      password: 'password-from-form',
    })
    expect(signOut).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]!)
    expect(Object.values(mfa).every(mock => mock.mock.calls.length === 0)).toBe(true)
    expect(signedIn).toEqual({ accessToken: 'short-lived-aal1-token', expiresIn: 3600, userId: 'admin-1' })
    expect(JSON.stringify(signedIn)).not.toContain('must-not-leave-sdk-memory')
  })

  it.each([
    ['returns an error', vi.fn(async () => ({ error: new Error('provider-sign-out-detail') }))],
    ['throws an exception', vi.fn(async () => { throw new Error('provider-sign-out-detail') })],
  ])('fails closed and sanitizes provider details when local sign-out %s', async (_label, signOut) => {
    const { signInAdminWithPassword } = await import('../../../app/utils/admin-supabase')
    const client = {
      auth: {
        signInWithPassword: vi.fn(async () => ({
          data: {
            session: {
              access_token: 'must-not-be-returned',
              expires_in: 3600,
              refresh_token: 'must-not-be-returned',
              user: { id: 'admin-1' },
            },
            user: { id: 'admin-1' },
          },
          error: null,
        })),
        signOut,
      },
    }

    await expect(signInAdminWithPassword(client as never, 'admin@example.test', 'password-from-form'))
      .rejects.toThrowError(/^ADMIN_AUTH_FAILED$/u)
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('fails closed when password sign-in does not return a complete session', async () => {
    const { signInAdminWithPassword } = await import('../../../app/utils/admin-supabase')
    const signOut = vi.fn()
    const client = {
      auth: {
        signInWithPassword: vi.fn(async () => ({
          data: { session: null, user: null },
          error: new Error('provider-secret-detail'),
        })),
        signOut,
      },
    }

    await expect(signInAdminWithPassword(client as never, 'admin@example.test', 'wrong-password'))
      .rejects.toThrow('ADMIN_AUTH_FAILED')
    expect(signOut).not.toHaveBeenCalled()
  })

  it('removes the MFA authentication helpers from the browser contract', async () => {
    const authModule = await import('../../../app/utils/admin-supabase')

    expect(authModule).not.toHaveProperty('beginAdminAuthentication')
    expect(authModule).not.toHaveProperty('cancelAdminEnrollment')
    expect(authModule).not.toHaveProperty('verifyAdminTotp')
  })
})
