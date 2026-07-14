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
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((bytes: Uint8Array) => bytes.fill(7)),
      randomUUID: vi.fn(() => 'request-id-1'),
    })
  })

  it('uses a request nonce for Nuxt scripts without allowing arbitrary inline scripts', async () => {
    const { default: requestContext } = await import('../../server/middleware/request-context')
    const event: TestEvent = {
      context: {},
      path: '/start',
      responseHeaders: new Map(),
    }

    requestContext(event as never)

    const policy = event.responseHeaders.get('content-security-policy') ?? ''
    expect(event.context.cspNonce).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    expect(policy).toContain(`script-src 'self' 'nonce-${event.context.cspNonce}'`)
    expect(policy).toContain("script-src-attr 'none'")
    expect(policy).toContain(`style-src 'self' 'nonce-${event.context.cspNonce}'`)
    expect(policy).toContain("style-src-attr 'none'")
    expect(policy).not.toContain("'unsafe-inline'")
  })

  it('uses a different nonce for each response and matches each policy exactly', async () => {
    let fill = 0
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((bytes: Uint8Array) => bytes.fill(++fill)),
      randomUUID: vi.fn(() => `request-id-${fill}`),
    })
    const { default: requestContext } = await import('../../server/middleware/request-context')
    const first: TestEvent = { context: {}, path: '/', responseHeaders: new Map() }
    const second: TestEvent = { context: {}, path: '/', responseHeaders: new Map() }

    requestContext(first as never)
    requestContext(second as never)

    expect(first.context.cspNonce).not.toBe(second.context.cspNonce)
    for (const event of [first, second]) {
      const nonce = event.context.cspNonce
      const policy = event.responseHeaders.get('content-security-policy') ?? ''
      expect(policy).toContain(`script-src 'self' 'nonce-${nonce}'`)
      expect(policy).toContain(`style-src 'self' 'nonce-${nonce}'`)
    }
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

    expect(loginEvent.responseHeaders.get('content-security-policy')).toContain("img-src 'self' data:")
    expect(publicEvent.responseHeaders.get('content-security-policy')).not.toContain('data:')
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
