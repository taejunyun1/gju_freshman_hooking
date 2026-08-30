import { describe, expect, it, vi } from 'vitest'
import { createSupabaseKeepalive } from '../../cloudflare/supabase-keepalive.mjs'

describe('Supabase keepalive', () => {
  it('uses the public runtime credentials for one bounded, data-free Auth settings request', async () => {
    const request = vi.fn(async () => new Response('[]', { status: 200 }))
    const keepalive = createSupabaseKeepalive({ fetchImpl: request })

    await expect(keepalive({
      NUXT_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
      NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
    })).resolves.toEqual({ status: 'ok' })

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(
      'https://example-project.supabase.co/auth/v1/settings',
      expect.objectContaining({
        headers: {
          apikey: 'public-key',
          authorization: 'Bearer public-key',
          accept: 'application/json',
        },
      }),
    )
  })

  it('fails without exposing credentials when the Supabase request is unavailable', async () => {
    const keepalive = createSupabaseKeepalive({
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    })

    await expect(keepalive({
      NUXT_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
      NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
    })).rejects.toThrow('SUPABASE_KEEPALIVE_FAILED:503')
  })
})
