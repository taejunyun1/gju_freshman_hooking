import { describe, expect, it, vi } from 'vitest'

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
      enrollTotp: vi.fn(),
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
})
