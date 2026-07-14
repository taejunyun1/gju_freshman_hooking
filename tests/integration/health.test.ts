import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)

describe('GET /api/health', () => {
  it('returns only public health metadata', async () => {
    const secretEntries = {
      SUPABASE_SECRET_KEY: 'service-role-secret-sentinel',
      PHONE_HMAC_KEY: 'phone-hmac-secret-sentinel',
      PHONE_ENCRYPTION_KEY: 'phone-encryption-secret-sentinel',
      PASSWORD_PEPPER: 'password-pepper-secret-sentinel',
    }
    Object.assign(process.env, secretEntries)
    const { default: healthHandler } = await import('../../server/api/health.get')

    const response = await healthHandler({} as never)
    const serialized = JSON.stringify(response)

    expect(Object.keys(response).sort()).toEqual(['commit', 'ok'])
    expect(response.ok).toBe(true)
    expect(response.commit).toEqual(expect.any(String))
    for (const [name, value] of Object.entries(secretEntries)) {
      expect(serialized).not.toContain(name)
      expect(serialized).not.toContain(value)
    }
  })
})
