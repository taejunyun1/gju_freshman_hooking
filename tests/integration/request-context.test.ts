import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestEvent = {
  context: Record<string, unknown>
  path: string
  responseHeaders: Map<string, string>
}

vi.stubGlobal('defineEventHandler', (handler: (event: TestEvent) => void) => handler)
vi.stubGlobal('getRequestURL', (event: TestEvent) => new URL(event.path, 'https://photo-next.example'))
vi.stubGlobal('setResponseHeader', (event: TestEvent, name: string, value: string) => {
  event.responseHeaders.set(name, value)
})

describe('request context security headers', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'request-id-1') })
  })

  it('allows Supabase TOTP data images only on the administrator login response', async () => {
    const { default: requestContext } = await import('../../server/middleware/request-context')
    const loginEvent: TestEvent = {
      context: {},
      path: '/admin/login?redirect=/admin',
      responseHeaders: new Map(),
    }
    const publicEvent: TestEvent = {
      context: {},
      path: '/',
      responseHeaders: new Map(),
    }

    requestContext(loginEvent as never)
    requestContext(publicEvent as never)

    expect(loginEvent.responseHeaders.get('content-security-policy')).toBe(
      "default-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
    )
    expect(publicEvent.responseHeaders.get('content-security-policy')).toBe(
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
    )
  })

  it('preserves the existing response hardening headers', async () => {
    const { default: requestContext } = await import('../../server/middleware/request-context')
    const event: TestEvent = {
      context: {},
      path: '/admin/login',
      responseHeaders: new Map(),
    }

    requestContext(event as never)

    expect(event.context.requestId).toBe('request-id-1')
    expect(event.responseHeaders.get('x-content-type-options')).toBe('nosniff')
    expect(event.responseHeaders.get('x-request-id')).toBe('request-id-1')
  })
})
