import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEventsHandler } from '../../../server/api/events.post'
import { createEventWriter } from '../../../server/modules/metrics/events'
import { makeResultSnapshot, resultPublicId } from '../../fixtures/result'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestId = '88888888-8888-4888-8888-888888888888'
const anonymousId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const missingPublicId = '33333333-3333-4333-8333-333333333333'

type EventInput = {
  body: unknown
  contentType?: string
  origin?: string
  rawBody?: string
  sessionToken?: string
  status?: number
  headers?: Record<string, string>
}

type OwnedAssessment = {
  assessmentId: number
  publicId: string
  campaignId: number | null
  completedAt: string
  resultSnapshot: unknown
}

type ResourceEventDependencies = Parameters<typeof createEventsHandler>[0] & {
  loadOwnedAssessment: (identity: { prospectId: number, publicId: string }) => Promise<OwnedAssessment | null>
}

const ownedAssessment = (resultSnapshot: unknown = makeResultSnapshot()): OwnedAssessment => ({
  assessmentId: 701,
  publicId: resultPublicId,
  campaignId: 17,
  completedAt: '2026-07-15T11:30:00+09:00',
  resultSnapshot,
})

const resourceBody = (overrides: Record<string, unknown> = {}) => ({
  eventName: 'resource_opened',
  resultPublicId,
  resourceId: 201,
  resourceType: 'equipment',
  ...overrides,
})

const createHandler = (overrides: Partial<ResourceEventDependencies> = {}) => {
  const writes: unknown[] = []
  const loads: Array<{ prospectId: number, publicId: string }> = []
  const dependencies: ResourceEventDependencies = {
    consumeRateLimit: async () => true,
    getAnonymousId: () => anonymousId,
    getContentType: event => (event as EventInput).contentType ?? 'application/json',
    getIp: () => '203.0.113.88',
    getOrigin: event => (event as EventInput).origin ?? 'https://photo-next.example',
    getRequestId: () => requestId,
    getRequestOrigin: () => 'https://photo-next.example',
    getSessionToken: event => (event as EventInput).sessionToken,
    loadOwnedAssessment: async (identity) => {
      loads.push(identity)
      return identity.prospectId === 42 && identity.publicId === resultPublicId
        ? ownedAssessment()
        : null
    },
    readRawBody: async event => (event as EventInput).rawBody
      ?? JSON.stringify((event as EventInput).body),
    readStudentSession: async token => token === 'owner-session'
      ? { prospectId: 42, nickname: '소유자', expiresAt: '2026-07-16T00:00:00+09:00' }
      : token === 'foreign-session'
        ? { prospectId: 99, nickname: '다른학생', expiresAt: '2026-07-16T00:00:00+09:00' }
        : null,
    setHeader: (event, name, value) => {
      const input = event as EventInput
      input.headers ??= {}
      input.headers[name.toLowerCase()] = value
    },
    setStatus: (event, status) => { (event as EventInput).status = status },
    writeEvent: async event => { writes.push(event) },
    ...overrides,
  }

  return { handler: createEventsHandler(dependencies), loads, writes }
}

describe('resource_opened browser event', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('requires the owner and verifies exact resource membership in the canonical snapshot', async () => {
    const { handler, loads, writes } = createHandler()
    const event: EventInput = { body: resourceBody(), sessionToken: 'owner-session' }

    const response = await handler(event)

    expect(loads).toEqual([{ prospectId: 42, publicId: resultPublicId }])
    expect(writes).toEqual([{
      anonymousId,
      eventName: 'resource_opened',
      path: '/api/events',
      prospectId: 42,
      properties: {
        assessment_id: 701,
        resource_id: 201,
        resource_type: 'equipment',
      },
      requestId,
    }])
    expect(response).toEqual({ data: { accepted: true }, requestId })
    expect(event.headers?.['cache-control']).toBe('private, no-store')
    expect(JSON.stringify(writes[0])).not.toMatch(
      /22222222|connectionReason|selectedInterests|제품|윤태준|062-670-2338|tjyun/u,
    )
  })

  it.each([
    ['course', 101],
    ['equipment', 201],
    ['facility', 203],
    ['extracurricular', 301],
    ['project', 302],
    ['student_work', 401],
    ['career', 501],
    ['support', 601],
  ])('accepts a present %s snapshot resource', async (resourceType, resourceId) => {
    const { handler, writes } = createHandler()
    const event: EventInput = {
      body: resourceBody({ resourceId, resourceType }),
      sessionToken: 'owner-session',
    }

    const response = await handler(event)

    expect(response).toEqual({ data: { accepted: true }, requestId })
    expect(writes).toEqual([
      expect.objectContaining({
        eventName: 'resource_opened',
        properties: { assessment_id: 701, resource_id: resourceId, resource_type: resourceType },
      }),
    ])
  })

  it.each([
    ['malformed result ID', resourceBody({ resultPublicId: 'not-a-uuid' }), 'owner-session'],
    ['missing result', resourceBody({ resultPublicId: missingPublicId }), 'owner-session'],
    ['foreign result', resourceBody(), 'foreign-session'],
    ['absent resource ID', resourceBody({ resourceId: 999 }), 'owner-session'],
    ['mismatched resource type', resourceBody({ resourceType: 'facility' }), 'owner-session'],
  ])('makes a %s indistinguishable from every other unavailable resource', async (_case, body, sessionToken) => {
    const { handler, writes } = createHandler()
    const event: EventInput = { body, sessionToken }

    const response = await handler(event)

    expect(event.status).toBe(404)
    expect(response).toEqual({
      error: { code: 'RESULT_NOT_FOUND', message: expect.any(String) },
      requestId,
    })
    expect(writes).toEqual([])
    expect(JSON.stringify(response)).not.toMatch(/not-a-uuid|999|facility|prospect|snapshot/u)
  })

  it.each([undefined, 'invalid-session'])('requires a valid student session before owned storage access: %s', async (sessionToken) => {
    const loadOwnedAssessment = vi.fn(async () => ownedAssessment())
    const { handler, writes } = createHandler({ loadOwnedAssessment })
    const event: EventInput = { body: resourceBody(), sessionToken }

    const response = await handler(event)

    expect(event.status).toBe(401)
    expect(response).toEqual({
      error: { code: 'AUTH_FAILED', message: expect.any(String) },
      requestId,
    })
    expect(loadOwnedAssessment).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it.each([
    resourceBody({ resourceId: 0 }),
    resourceBody({ resourceId: Number.MAX_SAFE_INTEGER + 1 }),
    resourceBody({ resourceType: 'inventory_item' }),
    { ...resourceBody(), reason: 'client supplied private reason' },
  ])('rejects a non-exact resource event input without ownership lookup', async (body) => {
    const loadOwnedAssessment = vi.fn(async () => ownedAssessment())
    const { handler, writes } = createHandler({ loadOwnedAssessment })
    const event: EventInput = { body, sessionToken: 'owner-session' }

    const response = await handler(event)

    expect(event.status).toBe(400)
    expect(response.error.code).toBe('VALIDATION_FAILED')
    expect(loadOwnedAssessment).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('canonically decodes the owned snapshot and fails closed before writing when it is corrupt', async () => {
    const { handler, writes } = createHandler({
      loadOwnedAssessment: async () => ownedAssessment({
        resources: { equipment: [{ id: 201, type: 'equipment' }] },
        selectedInterests: [{ label: 'private free text' }],
      }),
    })
    const event: EventInput = { body: resourceBody(), sessionToken: 'owner-session' }

    const response = await handler(event)

    expect(event.status).toBe(500)
    expect(response).toEqual({
      error: { code: 'INTERNAL_ERROR', message: expect.any(String) },
      requestId,
    })
    expect(JSON.stringify(response)).not.toMatch(/private free text|Zod|resources/u)
    expect(writes).toEqual([])
  })

  it('persists only internal resource identifiers plus the writer-added request ID', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const writer = createEventWriter({
      from: vi.fn().mockReturnValue({ insert }),
    } as never)

    await writer({
      anonymousId,
      eventName: 'resource_opened',
      path: '/api/events',
      prospectId: 42,
      properties: {
        assessment_id: 701,
        resource_id: 201,
        resource_type: 'equipment',
      },
      requestId,
    } as never)

    expect(insert).toHaveBeenCalledWith({
      anonymous_id: anonymousId,
      campaign_id: null,
      event_name: 'resource_opened',
      path: '/api/events',
      properties: {
        assessment_id: 701,
        resource_id: 201,
        resource_type: 'equipment',
        request_id: requestId,
      },
      prospect_id: 42,
    })
    const inserted = insert.mock.calls[0]![0]
    expect(Object.keys(inserted.properties).sort()).toEqual([
      'assessment_id',
      'request_id',
      'resource_id',
      'resource_type',
    ])
    expect(JSON.stringify(inserted)).not.toMatch(/22222222|reason|label|contact|faculty/u)
  })
})
