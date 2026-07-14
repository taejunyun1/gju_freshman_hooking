import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  anonymousVisitorCookie,
  createAnonymousVisitorResolver,
} from '../../../server/utils/anonymous-visitor'
import { createEventsHandler } from '../../../server/api/events.post'
import { createEventWriter } from '../../../server/modules/metrics/events'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestId = '88888888-8888-4888-8888-888888888888'
const anonymousId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type EventInput = {
  body: unknown
  contentType?: string
  origin?: string
  rawBody?: string
  sessionToken?: string
  status?: number
}

const createHandler = (overrides: Partial<Parameters<typeof createEventsHandler>[0]> = {}) => {
  const writes: unknown[] = []
  const rates: unknown[] = []
  const responseHeaders = new Map<string, string>()
  const handler = createEventsHandler({
    consumeRateLimit: async (input) => {
      rates.push(input)
      return true
    },
    getAnonymousId: () => anonymousId,
    getContentType: event => (event as EventInput).contentType ?? 'application/json',
    getIp: () => '203.0.113.88',
    getOrigin: event => (event as EventInput).origin ?? 'https://photo-next.example',
    getRequestId: () => requestId,
    getRequestOrigin: () => 'https://photo-next.example',
    getSessionToken: event => (event as EventInput).sessionToken,
    readRawBody: async event => (event as EventInput).rawBody ?? JSON.stringify((event as EventInput).body),
    readStudentSession: async token => token === 'valid-session'
      ? { prospectId: 42, nickname: '선명한프레임42', expiresAt: '2026-07-15T12:00:00.000Z' }
      : null,
    setHeader: (_event, name, value) => responseHeaders.set(name, value),
    setStatus: (event, status) => { (event as EventInput).status = status },
    writeEvent: async event => { writes.push(event) },
    ...overrides,
  })
  return { handler, rates, responseHeaders, writes }
}

describe('anonymous visitor identity', () => {
  it('reuses an existing canonical lowercase UUID without returning or resetting it', () => {
    const cookies: unknown[] = []
    const resolve = createAnonymousVisitorResolver({
      getCookie: () => anonymousId,
      randomUUID: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      setCookie: (...input) => cookies.push(input),
    })

    expect(resolve({})).toBe(anonymousId)
    expect(cookies).toEqual([])
  })

  it.each([undefined, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 'not-a-uuid'])(
    'replaces a missing or invalid cookie with a protected persistent UUID: %s',
    (stored) => {
      const cookies: Array<{ name: string, value: string, options: Record<string, unknown> }> = []
      const generated = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      const resolve = createAnonymousVisitorResolver({
        getCookie: () => stored,
        randomUUID: () => generated,
        setCookie: (_event, name, value, options) => cookies.push({ name, value, options }),
      })

      expect(resolve({})).toBe(generated)
      expect(cookies).toEqual([{
        name: anonymousVisitorCookie,
        value: generated,
        options: expect.objectContaining({
          httpOnly: true,
          maxAge: expect.any(Number),
          path: '/',
          sameSite: 'lax',
          secure: true,
        }),
      }])
      expect(cookies[0]!.options.maxAge).toBeGreaterThanOrEqual(60 * 60 * 24 * 30)
    },
  )
})

describe('POST /api/events', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('maps the derived browser event to the exact private database insert', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ insert })
    const writer = createEventWriter({ from } as never)
    const properties = { request_id: requestId }

    await writer({
      anonymousId,
      campaignId: null,
      eventName: 'landing_viewed',
      path: '/api/events',
      properties,
      requestId,
    })

    expect(from).toHaveBeenCalledWith('events')
    expect(insert).toHaveBeenCalledWith({
      anonymous_id: anonymousId,
      campaign_id: null,
      event_name: 'landing_viewed',
      path: '/api/events',
      properties,
      prospect_id: null,
    })
  })

  it('derives identity, path, campaign, properties, and rate buckets before insert', async () => {
    const { handler, rates, responseHeaders, writes } = createHandler()
    const event: EventInput = {
      body: {
        eventName: 'assessment_step_completed',
        catalogRevision: `sha256:${'a'.repeat(64)}`,
        group: 'work',
        selectedCount: 4,
      },
      sessionToken: 'valid-session',
    }

    const response = await handler(event)

    expect(rates).toEqual([
      { key: 'ip:203.0.113.88', route: '/api/events', limit: 60, window: '1 minute' },
      { key: `anonymous:${anonymousId}`, route: '/api/events', limit: 30, window: '1 minute' },
    ])
    expect(writes).toEqual([{
      anonymousId,
      campaignId: null,
      eventName: 'assessment_step_completed',
      path: '/api/events',
      properties: {
        request_id: requestId,
        catalog_revision: `sha256:${'a'.repeat(64)}`,
        group: 'work',
        selected_count: 4,
      },
      prospectId: 42,
      requestId,
    }])
    expect(response).toEqual({ data: { accepted: true }, requestId })
    expect(JSON.stringify(response)).not.toContain(anonymousId)
    expect(JSON.stringify(response)).not.toContain('42')
    expect(responseHeaders.get('cache-control')).toBe('private, no-store')
    expect(new TextEncoder().encode(JSON.stringify((writes[0] as { properties: unknown }).properties)).byteLength)
      .toBeLessThanOrEqual(4_096)
  })

  it.each([
    { name: 'unknown event', body: { eventName: 'unknown' } },
    { name: 'unknown field', body: { eventName: 'landing_viewed', path: '/client-path' } },
    { name: 'client prospect', body: { eventName: 'landing_viewed', prospectId: 42 } },
    { name: 'client anonymous ID', body: { eventName: 'landing_viewed', anonymousId } },
    { name: 'client campaign', body: { eventName: 'landing_viewed', campaignId: 1 } },
    { name: 'client properties', body: { eventName: 'landing_viewed', properties: { secret: true } } },
    { name: 'group count above max', body: { eventName: 'assessment_step_completed', catalogRevision: `sha256:${'a'.repeat(64)}`, group: 'work', selectedCount: 5 } },
  ])('rejects $name without writing', async ({ body }) => {
    const { handler, writes } = createHandler()
    const event: EventInput = { body }

    const response = await handler(event)

    expect(event.status).toBe(400)
    expect(writes).toEqual([])
    expect(response.error.code).toBe('VALIDATION_FAILED')
    expect(JSON.stringify(response)).not.toMatch(/client-path|secret|unknown/u)
  })

  it.each([
    { contentType: 'text/plain', origin: 'https://photo-next.example' },
    { contentType: 'application/json', origin: undefined },
    { contentType: 'application/json', origin: 'https://evil.example' },
  ])('requires JSON and exact Origin before event processing: %o', async ({ contentType, origin }) => {
    const { handler, rates, writes } = createHandler({
      getOrigin: () => origin,
    })
    const event: EventInput = { body: { eventName: 'landing_viewed' }, contentType, origin }

    const response = await handler(event)

    expect(event.status).toBe(origin === 'https://photo-next.example' ? 400 : 403)
    expect(rates).toEqual([])
    expect(writes).toEqual([])
    expect(response.error.code).toBe('VALIDATION_FAILED')
  })

  it('enforces the 8192-byte body limit by UTF-8 bytes', async () => {
    const { handler, rates, writes } = createHandler()
    const raw = JSON.stringify({ eventName: 'landing_viewed', padding: '한'.repeat(2_800) })
    expect(raw.length).toBeLessThan(8_192)
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(8_192)
    const event: EventInput = { body: null, rawBody: raw }

    const response = await handler(event)

    expect(event.status).toBe(400)
    expect(response.error.code).toBe('VALIDATION_FAILED')
    expect(rates).toEqual([])
    expect(writes).toEqual([])
  })

  it('stops after the first denied rate bucket and before optional auth or insert', async () => {
    const order: string[] = []
    const { handler } = createHandler({
      consumeRateLimit: async () => {
        order.push('rate-ip')
        return false
      },
      readStudentSession: async () => {
        order.push('session')
        return null
      },
      writeEvent: async () => { order.push('write') },
    })
    const event: EventInput = { body: { eventName: 'landing_viewed' }, sessionToken: 'invalid' }

    const response = await handler(event)

    expect(order).toEqual(['rate-ip'])
    expect(event.status).toBe(429)
    expect(response.error.code).toBe('RATE_LIMITED')
  })

  it('stops after a denied anonymous bucket and before optional auth or insert', async () => {
    const order: string[] = []
    let rateCalls = 0
    const { handler } = createHandler({
      consumeRateLimit: async () => {
        rateCalls += 1
        order.push(rateCalls === 1 ? 'rate-ip' : 'rate-anonymous')
        return rateCalls === 1
      },
      readStudentSession: async () => {
        order.push('session')
        return null
      },
      writeEvent: async () => { order.push('write') },
    })
    const event: EventInput = { body: { eventName: 'landing_viewed' }, sessionToken: 'valid-session' }

    const response = await handler(event)

    expect(order).toEqual(['rate-ip', 'rate-anonymous'])
    expect(event.status).toBe(429)
    expect(response.error.code).toBe('RATE_LIMITED')
  })

  it('continues without a prospect when optional session lookup fails', async () => {
    const { handler, writes } = createHandler({
      readStudentSession: async () => { throw new Error('private upstream detail') },
    })
    const event: EventInput = { body: { eventName: 'landing_viewed' }, sessionToken: 'broken-session' }

    const response = await handler(event)

    expect(event.status).toBeUndefined()
    expect(response).toEqual({ data: { accepted: true }, requestId })
    expect(writes).toEqual([expect.objectContaining({ prospectId: undefined })])
    expect(JSON.stringify(response)).not.toContain('private upstream detail')
  })

  it('returns a generic envelope when event storage fails', async () => {
    const { handler } = createHandler({
      writeEvent: async () => { throw new Error('private database detail') },
    })
    const event: EventInput = { body: { eventName: 'landing_viewed' } }

    const response = await handler(event)

    expect(event.status).toBe(500)
    expect(response.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(response)).not.toContain('private database detail')
  })
})
