import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAssessmentCatalog } from '../../../scripts/seed-assessment-options'
import { createOptionsHandler } from '../../../server/api/assessment/options.get'
import { createValidateAssessmentHandler } from '../../../server/api/student/assessment/validate.post'
import {
  createAssessmentService,
  createSupabaseAssessmentDependencies,
} from '../../../server/modules/assessment/service'
import { createAssessmentCatalogRevision } from '../../../server/modules/assessment/catalog-revision'
import { RequestBodyLimitError } from '../../../server/utils/bounded-request-body'
import type { AssessmentOption, AssessmentSelections } from '../../../shared/types/domain'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestId = '77777777-7777-4777-8777-777777777777'
const sessionToken = 'opaque-student-session'
const canonicalRevision = 'sha256:c147c6dc013f7c7886ee4dbd5cd0a1a51c2e1a23295f8368bb636672c4b87819'

const canonicalCatalog = () => parseAssessmentCatalog(JSON.parse(
  readFileSync('supabase/seed/assessment-options.json', 'utf8'),
) as unknown)

const validSelections = (): AssessmentSelections => ({
  work: ['work.commercial_image'],
  result: ['result.commercial_fashion'],
  style: ['style.studio'],
  career: ['career.photo'],
  careerOther: null,
})

const rawBody = (input: unknown) => JSON.stringify(input)

const serviceDependencies = (overrides: Partial<Parameters<typeof createAssessmentService>[0]> = {}) => ({
  consumeRateLimit: async () => true,
  getStudentSession: async (token: string) => token === sessionToken
    ? { prospectId: 42, nickname: '선명한프레임42', expiresAt: '2026-07-15T12:00:00.000Z' }
    : null,
  loadActiveOptions: async () => canonicalCatalog(),
  ...overrides,
})

const createValidate = (
  service = createAssessmentService(serviceDependencies()),
  overrides: Partial<Parameters<typeof createValidateAssessmentHandler>[0]> = {},
) => createValidateAssessmentHandler({
  assessment: service,
  getContext: () => ({ ip: '203.0.113.42', requestId, sessionToken }),
  getContentType: () => 'application/json; charset=utf-8',
  readRawBody: async event => (event as { rawBody: string }).rawBody,
  setStatus: (event, status) => { (event as { status?: number }).status = status },
  ...overrides,
})

describe('assessment catalog revision', () => {
  it('matches the approved seed SHA with runtime-safe canonical object ordering', async () => {
    const catalog = canonicalCatalog()
    const reorderedObjects = catalog.map(option => Object.fromEntries(
      Object.entries(option).reverse(),
    ) as unknown as AssessmentOption)

    await expect(createAssessmentCatalogRevision(catalog)).resolves.toBe(canonicalRevision)
    await expect(createAssessmentCatalogRevision(reorderedObjects)).resolves.toBe(canonicalRevision)
  })
})

describe('GET /api/assessment/options', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('returns only the active public catalog in fixed group and option order', async () => {
    const draft: AssessmentOption = {
      ...canonicalCatalog()[0]!,
      optionKey: 'work.private_draft',
      label: 'private draft label',
      status: 'draft',
      sortOrder: 99,
    }
    const service = createAssessmentService(serviceDependencies({
      loadActiveOptions: async () => [draft, ...canonicalCatalog().reverse()],
    }))
    const handler = createOptionsHandler({
      assessment: service,
      getRequestId: () => requestId,
      setStatus: () => undefined,
    })

    const response = await handler({})
    const serialized = JSON.stringify(response)

    expect(Object.keys(response)).toEqual(['data', 'requestId'])
    expect(Object.keys(response.data)).toEqual(['catalogRevision', 'groups', 'limits'])
    expect(response.requestId).toBe(requestId)
    expect(response.data.catalogRevision).toBe(canonicalRevision)
    expect(response.data.groups.map(group => [group.key, group.options.length])).toEqual([
      ['work', 10],
      ['result', 8],
      ['style', 6],
      ['career', 4],
    ])
    expect(response.data.groups[0]?.options[0]).toEqual({
      key: 'work.photo_everyday',
      label: '인물·풍경·일상을 사진으로 촬영하기',
      visualKey: 'photo_frame',
    })
    expect(response.data.limits).toEqual({
      work: { min: 1, max: 4 },
      result: { min: 1, max: 3 },
      style: { min: 1, max: 2 },
      career: { min: 1, max: 2 },
    })
    const responseKeys: string[] = []
    JSON.stringify(response, (key, value) => {
      if (key) responseKeys.push(key)
      return value
    })
    const forbiddenKeys = [
      'id',
      'status',
      'trackWeights',
      'interestTags',
      'weight',
    ]
    expect(responseKeys).toContain('visualKey')
    for (const forbiddenKey of forbiddenKeys) {
      expect(responseKeys).not.toContain(forbiddenKey)
    }
    expect(serialized).not.toContain('private draft label')
  })

  it('composes public options without initializing student identity crypto', async () => {
    const sessionReaderFactory = vi.fn(() => { throw new Error('identity crypto is intentionally unavailable') })
    const catalog = canonicalCatalog()
    const order = vi.fn().mockReturnThis()
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    order.mockReturnValueOnce({ order }).mockReturnValueOnce({ order }).mockResolvedValueOnce({
      data: catalog.map(option => ({
        description: option.description ?? null,
        interest_tags: option.interestTags,
        label: option.label,
        option_key: option.optionKey,
        question_group: option.group,
        sort_order: option.sortOrder,
        status: option.status,
        track_weights: option.trackWeights,
        visual_key: option.visualKey,
      })),
      error: null,
    })
    const client = {
      from: vi.fn().mockReturnValue({ select }),
      rpc: vi.fn(),
    }
    const service = createAssessmentService(createSupabaseAssessmentDependencies(
      client as never,
      sessionReaderFactory,
    ))

    await expect(service.getOptions()).resolves.toEqual(expect.objectContaining({
      catalogRevision: canonicalRevision,
    }))
    expect(sessionReaderFactory).not.toHaveBeenCalled()
  })
})

describe('POST /api/student/assessment/validate', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('authenticates, rate limits, loads one catalog, then scores with the current revision', async () => {
    const order: string[] = []
    const rateInputs: unknown[] = []
    const service = createAssessmentService(serviceDependencies({
      getStudentSession: async () => {
        order.push('session')
        return { prospectId: 42, nickname: '선명한프레임42', expiresAt: '2026-07-15T12:00:00.000Z' }
      },
      consumeRateLimit: async (input) => {
        order.push('rate')
        rateInputs.push(input)
        return true
      },
      loadActiveOptions: async () => {
        order.push('catalog')
        return canonicalCatalog()
      },
    }))
    const handler = createValidate(service)
    const event = {
      rawBody: rawBody({ catalogRevision: canonicalRevision, selections: validSelections() }),
      status: undefined as number | undefined,
    }

    const response = await handler(event)

    expect(order).toEqual(['session', 'rate', 'catalog'])
    expect(rateInputs).toEqual([{
      key: 'prospect:42',
      route: '/api/student/assessment/validate',
      limit: 20,
      window: '5 minutes',
    }])
    expect(event.status).toBeUndefined()
    expect(response).toEqual({
      data: {
        trackScores: expect.objectContaining({ commercial: 100 }),
        rankedTracks: expect.arrayContaining(['documentary', 'art_photo', 'commercial', 'video']),
        interestVector: expect.any(Object),
      },
      requestId,
    })
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('trackWeights')
    expect(serialized).not.toContain('interestTags')
  })

  it('lazily reuses the route Supabase client for one student session reader', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() }
    const getStudentSession = vi.fn().mockResolvedValue({
      prospectId: 42,
      nickname: '선명한프레임42',
      expiresAt: '2026-07-15T12:00:00.000Z',
    })
    const sessionReaderFactory = vi.fn((_client?: unknown) => ({ getStudentSession }))
    const dependencies = createSupabaseAssessmentDependencies(
      client as never,
      sessionReaderFactory,
    )

    await dependencies.getStudentSession(sessionToken)
    await dependencies.getStudentSession(sessionToken)

    expect(sessionReaderFactory).toHaveBeenCalledOnce()
    expect(sessionReaderFactory).toHaveBeenCalledWith(client)
    expect(getStudentSession).toHaveBeenCalledTimes(2)
  })

  it.each([
    { name: 'five work choices', mutate: () => ({ ...validSelections(), work: ['work.photo_everyday', 'work.video_scene', 'work.video_post', 'work.commercial_image', 'work.interview_life'] }) },
    { name: 'unknown option', mutate: () => ({ ...validSelections(), work: ['work.unknown'] }) },
    { name: 'unknown top-level field', mutate: () => validSelections(), extra: { privateField: true } },
  ])('returns a sanitized 422 for $name', async ({ mutate, extra }) => {
    const handler = createValidate()
    const event = {
      rawBody: rawBody({ catalogRevision: canonicalRevision, selections: mutate(), ...extra }),
      status: undefined as number | undefined,
    }

    const response = await handler(event)

    expect(event.status).toBe(422)
    expect(response).toEqual({
      error: { code: 'ASSESSMENT_INVALID', message: expect.any(String) },
      requestId,
    })
    expect(response).not.toHaveProperty('ok')
    expect(response).not.toHaveProperty('fieldErrors')
    expect(JSON.stringify(response)).not.toMatch(/work\.unknown|privateField|trackWeights|interestTags/u)
  })

  it('returns stale before selection scoring and uses the same single catalog read', async () => {
    let catalogReads = 0
    const service = createAssessmentService(serviceDependencies({
      loadActiveOptions: async () => {
        catalogReads += 1
        return canonicalCatalog()
      },
    }))
    const handler = createValidate(service)
    const event = {
      rawBody: rawBody({ catalogRevision: 'stale', selections: { work: [] } }),
      status: undefined as number | undefined,
    }

    const response = await handler(event)

    expect(catalogReads).toBe(1)
    expect(event.status).toBe(409)
    expect(response).toEqual({
      error: { code: 'ASSESSMENT_CATALOG_STALE', message: expect.any(String) },
      requestId,
    })
    expect(JSON.stringify(response)).not.toContain('stale')
  })

  it('requires an active session before rate limiting or loading the catalog', async () => {
    const order: string[] = []
    const service = createAssessmentService(serviceDependencies({
      getStudentSession: async () => {
        order.push('session')
        return null
      },
      consumeRateLimit: async () => {
        order.push('rate')
        return true
      },
      loadActiveOptions: async () => {
        order.push('catalog')
        return canonicalCatalog()
      },
    }))
    const handler = createValidate(service)
    const event = {
      rawBody: rawBody({ catalogRevision: canonicalRevision, selections: validSelections() }),
      status: undefined as number | undefined,
    }

    const response = await handler(event)

    expect(order).toEqual(['session'])
    expect(event.status).toBe(401)
    expect(response.error.code).toBe('AUTH_FAILED')
  })

  it('stops on a denied prospect bucket before loading the catalog', async () => {
    const order: string[] = []
    const service = createAssessmentService(serviceDependencies({
      getStudentSession: async () => {
        order.push('session')
        return { prospectId: 42, nickname: '선명한프레임42', expiresAt: '2026-07-15T12:00:00.000Z' }
      },
      consumeRateLimit: async () => {
        order.push('rate')
        return false
      },
      loadActiveOptions: async () => {
        order.push('catalog')
        return canonicalCatalog()
      },
    }))
    const handler = createValidate(service)
    const event = {
      rawBody: rawBody({ catalogRevision: canonicalRevision, selections: validSelections() }),
      status: undefined as number | undefined,
    }

    const response = await handler(event)

    expect(order).toEqual(['session', 'rate'])
    expect(event.status).toBe(429)
    expect(response.error.code).toBe('RATE_LIMITED')
  })

  it('enforces the 8192-byte raw body limit using UTF-8 bytes', async () => {
    let serviceCalls = 0
    const handler = createValidate({
      validateAssessment: async () => {
        serviceCalls += 1
        throw new Error('must not run')
      },
    })
    const oversized = rawBody({
      catalogRevision: canonicalRevision,
      selections: validSelections(),
      padding: '한'.repeat(2_800),
    })
    expect(oversized.length).toBeLessThan(8_192)
    expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(8_192)
    const event = { rawBody: oversized, status: undefined as number | undefined }

    const response = await handler(event)

    expect(serviceCalls).toBe(0)
    expect(event.status).toBe(422)
    expect(response.error.code).toBe('ASSESSMENT_INVALID')
  })

  it('maps a pre-Nitro body overflow to the sanitized assessment envelope', async () => {
    const handler = createValidate(undefined, {
      readRawBody: async () => { throw new RequestBodyLimitError() },
    })
    const event = { rawBody: '{}', status: undefined as number | undefined }

    const response = await handler(event)

    expect(event.status).toBe(422)
    expect(response).toEqual({
      error: { code: 'ASSESSMENT_INVALID', message: expect.any(String) },
      requestId,
    })
    expect(JSON.stringify(response)).not.toContain('REQUEST_BODY_TOO_LARGE')
  })
})
