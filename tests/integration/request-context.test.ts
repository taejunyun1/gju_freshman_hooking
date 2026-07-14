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
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { supabaseUrl: 'http://127.0.0.1:54321' },
    }))
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

  it('allows the exact validated Supabase Auth origin only on administrator documents', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { supabaseUrl: 'https://project-ref.supabase.co/rest/v1' },
    }))
    const { default: requestContext } = await import('../../server/middleware/request-context')
    const adminEvent: TestEvent = { context: {}, path: '/admin/login', responseHeaders: new Map() }
    const recoveryEvent: TestEvent = { context: {}, path: '/admin/recovery', responseHeaders: new Map() }
    const publicEvent: TestEvent = { context: {}, path: '/login', responseHeaders: new Map() }

    requestContext(adminEvent as never)
    requestContext(recoveryEvent as never)
    requestContext(publicEvent as never)

    expect(adminEvent.responseHeaders.get('content-security-policy'))
      .toContain("connect-src 'self' https://project-ref.supabase.co")
    expect(recoveryEvent.responseHeaders.get('content-security-policy'))
      .toContain("connect-src 'self' https://project-ref.supabase.co")
    expect(publicEvent.responseHeaders.get('content-security-policy')).not.toContain('connect-src')
  })

  it.each([
    'ftp://project-ref.supabase.co',
    'http://project-ref.supabase.co',
    'https://user:password@project-ref.supabase.co',
    'javascript:alert(1)',
  ])('rejects an unsafe administrator Supabase URL: %s', async (supabaseUrl) => {
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { supabaseUrl } }))
    const { default: requestContext } = await import('../../server/middleware/request-context')
    const event: TestEvent = { context: {}, path: '/admin/login', responseHeaders: new Map() }

    expect(() => requestContext(event as never)).toThrow('SUPABASE_URL_INVALID')
  })

  it('permits HTTP only for loopback administrator E2E origins', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { supabaseUrl: 'http://localhost:54321/auth/v1' } }))
    const { default: requestContext } = await import('../../server/middleware/request-context')
    const event: TestEvent = { context: {}, path: '/admin/login', responseHeaders: new Map() }

    requestContext(event as never)

    expect(event.responseHeaders.get('content-security-policy'))
      .toContain("connect-src 'self' http://localhost:54321")
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
    expect(event.responseHeaders.get('referrer-policy')).toBe('no-referrer')
    expect(event.responseHeaders.get('x-request-id')).toBe('request-id-1')
  })

  it('prevents shared or private caching for student and administrator API responses only', async () => {
    const { default: requestContext } = await import('../../server/middleware/request-context')
    const studentEvent: TestEvent = { context: {}, path: '/api/student/session', responseHeaders: new Map() }
    const adminEvent: TestEvent = { context: {}, path: '/api/admin/recovery', responseHeaders: new Map() }
    const healthEvent: TestEvent = { context: {}, path: '/api/health', responseHeaders: new Map() }

    requestContext(studentEvent as never)
    requestContext(adminEvent as never)
    requestContext(healthEvent as never)

    expect(studentEvent.responseHeaders.get('cache-control')).toBe('private, no-store')
    expect(adminEvent.responseHeaders.get('cache-control')).toBe('private, no-store')
    expect(healthEvent.responseHeaders.has('cache-control')).toBe(false)
  })
})
