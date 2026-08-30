import { describe, expect, it, vi } from 'vitest'
import { withSupabaseKeepalive } from '../../cloudflare/scheduled-worker.mjs'

describe('scheduled worker wrapper', () => {
  it('preserves Nitro scheduled hooks and keeps Supabase active in the same cron event', async () => {
    const nitroScheduled = vi.fn(async () => undefined)
    const keepalive = vi.fn(async () => ({ status: 'ok' }))
    const worker = { fetch: vi.fn(), scheduled: nitroScheduled }
    const waitUntil = vi.fn()
    const environment = { NUXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }
    const controller = { cron: '17 3 * * *' }
    const context = { waitUntil }

    const scheduledWorker = withSupabaseKeepalive(worker, keepalive)
    await scheduledWorker.scheduled(controller, environment, context)

    expect(nitroScheduled).toHaveBeenCalledWith(controller, environment, context)
    expect(keepalive).toHaveBeenCalledWith(environment)
    expect(waitUntil).toHaveBeenCalledOnce()
    await expect(waitUntil.mock.calls[0][0]).resolves.toEqual({ status: 'ok' })
  })
})
