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

  it('lists an existing verified TOTP factor after password sign-in', async () => {
    const { beginAdminAuthentication } = await import('../../../app/utils/admin-supabase')
    const enroll = vi.fn()
    const client = {
      auth: {
        mfa: {
          enroll,
          listFactors: vi.fn(async () => ({
            data: { all: [], phone: [], totp: [{ id: 'factor-1', status: 'verified' }], webauthn: [] },
            error: null,
          })),
        },
        signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
      },
    }

    await expect(beginAdminAuthentication(client as never, 'admin@example.test', 'password-from-form')).resolves.toEqual({
      factorId: 'factor-1',
      enrollment: null,
    })
    expect(enroll).not.toHaveBeenCalled()
  })

  it('uses Auth-generated TOTP enrollment when no verified factor exists', async () => {
    const { beginAdminAuthentication } = await import('../../../app/utils/admin-supabase')
    const client = {
      auth: {
        mfa: {
          enroll: vi.fn(async () => ({
            data: {
              id: 'new-factor',
              totp: { qr_code: '<svg>auth-qr</svg>', secret: 'auth-generated-secret', uri: 'otpauth://auth-generated' },
              type: 'totp',
            },
            error: null,
          })),
          listFactors: vi.fn(async () => ({ data: { all: [], phone: [], totp: [], webauthn: [] }, error: null })),
        },
        signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
      },
    }

    await expect(beginAdminAuthentication(client as never, 'admin@example.test', 'password-from-form')).resolves.toEqual({
      factorId: 'new-factor',
      enrollment: { qrCode: '<svg>auth-qr</svg>', secret: 'auth-generated-secret' },
    })
    expect(client.auth.mfa.enroll).toHaveBeenCalledWith({
      factorType: 'totp',
      friendlyName: 'PHOTO:NEXT administrator',
    })
  })

  it('explicitly challenges and verifies TOTP while dropping the returned refresh token', async () => {
    const { verifyAdminTotp } = await import('../../../app/utils/admin-supabase')
    const verify = vi.fn(async () => ({
      data: {
        access_token: 'short-lived-aal2-token',
        expires_in: 3600,
        refresh_token: 'must-not-leave-sdk-memory',
        token_type: 'bearer',
        user: { id: 'admin-1' },
      },
      error: null,
    }))
    const client = {
      auth: {
        mfa: {
          challenge: vi.fn(async () => ({ data: { id: 'challenge-1', type: 'totp' }, error: null })),
          verify,
        },
      },
    }

    const verified = await verifyAdminTotp(client as never, 'factor-1', '123456')

    expect(client.auth.mfa.challenge).toHaveBeenCalledWith({ factorId: 'factor-1' })
    expect(verify).toHaveBeenCalledWith({ challengeId: 'challenge-1', code: '123456', factorId: 'factor-1' })
    expect(verified).toEqual({ accessToken: 'short-lived-aal2-token', expiresIn: 3600, userId: 'admin-1' })
    expect(JSON.stringify(verified)).not.toContain('must-not-leave-sdk-memory')
  })
})
