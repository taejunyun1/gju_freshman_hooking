import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createGetCounselingHandler } from '../../../server/api/counseling/index.get'
import { createPostCounselingHandler } from '../../../server/api/counseling/index.post'
import {
  createCounselingService,
  createSupabaseCounselingDependencies,
  type CounselingServiceDependencies,
} from '../../../server/modules/counseling/service'
import { RequestBodyLimitError } from '../../../server/utils/bounded-request-body'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestId = '77777777-7777-4777-8777-777777777777'
const anonymousId = '88888888-8888-4888-8888-888888888888'
const sessionToken = 'opaque-student-session'
const assessmentPublicId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const counselingPublicId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const createdAt = '2026-07-15T01:00:00.000Z'

const validInput = {
  assessmentPublicId,
  contactMethod: 'phone',
  availability: 'weekday_afternoon',
  inquiry: '입학 준비 포트폴리오가 궁금해요.',
  consent: true,
} as const

const storedRequest = (overrides: Record<string, unknown> = {}) => ({
  requestId: 73,
  publicId: counselingPublicId,
  prospectId: 42,
  assessmentPublicId,
  status: 'new',
  contactMethod: 'phone',
  availability: 'weekday_afternoon',
  inquiry: '입학 준비 포트폴리오가 궁금해요.',
  consentedAt: createdAt,
  assignedAt: null,
  contactedAt: null,
  completedAt: null,
  closedAt: null,
  version: 0,
  createdAt,
  updatedAt: createdAt,
  assignedFaculty: null,
  recommendations: [
    {
      name: '윤태준',
      title: '교수',
      expertise: '현대예술·예술사진·영상촬영·융합이미지',
      reason: '예술사진과 영상촬영 관심을 연결합니다.',
      role: 'primary',
      rank: 1,
    },
    {
      name: '조대연',
      title: '교수',
      expertise: '포토커뮤니케이션·다큐멘터리',
      reason: '기록과 포토스토리를 보완합니다.',
      role: 'backup',
      rank: 1,
    },
  ],
  ...overrides,
})

const serviceDependencies = (
  overrides: Partial<CounselingServiceDependencies> = {},
): CounselingServiceDependencies => ({
  getStudentSession: vi.fn(async (token: string) => token === sessionToken
    ? { prospectId: 42, nickname: '선명한프레임42', expiresAt: '2026-07-16T00:00:00.000Z' }
    : null),
  loadOwnedAssessment: vi.fn(async ({ prospectId, publicId }: { prospectId: number, publicId: string }) => (
    prospectId === 42 && publicId === assessmentPublicId
      ? { assessmentId: 17, publicId: assessmentPublicId }
      : null
  )),
  createRequest: vi.fn(async () => ({ requestId: 73, publicId: counselingPublicId, created: true })),
  loadRequest: vi.fn(async () => storedRequest()),
  recordEvent: vi.fn(async () => undefined),
  ...overrides,
})

const requestContext = {
  anonymousId,
  requestId,
  sessionToken,
}

type FakeQueryResponse = {
  data: unknown
  error: { code: string } | null
}

type FakeQueryCall = {
  table: string
  select: string | null
  filters: Array<{ column: string, value: unknown }>
  orders: Array<{ column: string, ascending: boolean | undefined }>
  limit: number | null
}

const createFakeSupabaseClient = (input: {
  queryResponses?: Record<string, FakeQueryResponse[]>
  rpcResponses?: FakeQueryResponse[]
} = {}) => {
  const queryResponses = Object.fromEntries(Object.entries(input.queryResponses ?? {}).map(
    ([table, responses]) => [table, [...responses]],
  ))
  const rpcResponses = [...(input.rpcResponses ?? [])]
  const calls: FakeQueryCall[] = []
  const from = vi.fn((table: string) => {
    const call: FakeQueryCall = {
      table,
      select: null,
      filters: [],
      orders: [],
      limit: null,
    }
    calls.push(call)
    const query = {
      select: (selection: string) => {
        call.select = selection
        return query
      },
      eq: (column: string, value: unknown) => {
        call.filters.push({ column, value })
        return query
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        call.orders.push({ column, ascending: options?.ascending })
        return query
      },
      limit: (value: number) => {
        call.limit = value
        return query
      },
      maybeSingle: async () => queryResponses[table]?.shift() ?? { data: null, error: null },
    }
    return query
  })
  const rpc = vi.fn(async () => rpcResponses.shift() ?? { data: null, error: null })
  return {
    calls,
    client: { from, rpc } as unknown as SupabaseClient,
    rpc,
  }
}

const rawRequestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 73,
  public_id: counselingPublicId,
  prospect_id: 42,
  status: 'new',
  contact_method: 'phone',
  availability: 'weekday_afternoon',
  inquiry: '입학 준비 포트폴리오가 궁금해요.',
  consented_at: createdAt,
  assigned_at: null,
  contacted_at: null,
  completed_at: null,
  closed_at: null,
  version: 0,
  created_at: createdAt,
  updated_at: createdAt,
  assessment: { public_id: assessmentPublicId },
  assigned_faculty: null,
  recommendations: [
    {
      faculty_name_snapshot: '윤태준',
      faculty_title_snapshot: '교수',
      expertise_snapshot: '현대예술·예술사진·영상촬영·융합이미지',
      reason_snapshot: '예술사진과 영상촬영 관심을 연결합니다.',
      role: 'primary',
      rank: 1,
    },
    {
      faculty_name_snapshot: '조대연',
      faculty_title_snapshot: '교수',
      expertise_snapshot: '포토커뮤니케이션·다큐멘터리',
      reason_snapshot: '기록과 포토스토리를 보완합니다.',
      role: 'backup',
      rank: 1,
    },
  ],
  ...overrides,
})

const createPost = (
  service = createCounselingService(serviceDependencies()),
  overrides: Partial<Parameters<typeof createPostCounselingHandler>[0]> = {},
) => createPostCounselingHandler({
  counseling: service,
  getContentType: () => 'application/json; charset=utf-8',
  getContext: () => requestContext,
  readRawBody: async event => (event as { rawBody?: string }).rawBody,
  setHeader: (event, name, value) => {
    (event as { headers: Record<string, string> }).headers[name] = value
  },
  setStatus: (event, status) => { (event as { status?: number }).status = status },
  ...overrides,
})

const createGet = (
  service = createCounselingService(serviceDependencies()),
) => createGetCounselingHandler({
  counseling: service,
  getContext: () => requestContext,
  setHeader: (event, name, value) => {
    (event as { headers: Record<string, string> }).headers[name] = value
  },
  setStatus: (event, status) => { (event as { status?: number }).status = status },
})

describe('POST /api/counseling', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('creates an owned request and returns only the student-safe public contract', async () => {
    const dependencies = serviceDependencies()
    const handler = createPost(createCounselingService(dependencies))
    const event = {
      rawBody: JSON.stringify(validInput),
      headers: {} as Record<string, string>,
      status: undefined as number | undefined,
    }

    const response = await handler(event)

    expect(event.status).toBeUndefined()
    expect(event.headers['cache-control']).toBe('private, no-store')
    expect(dependencies.loadOwnedAssessment).toHaveBeenCalledWith({
      prospectId: 42,
      publicId: assessmentPublicId,
    })
    expect(dependencies.createRequest).toHaveBeenCalledWith({
      prospectId: 42,
      assessmentId: 17,
      contactMethod: 'phone',
      availability: 'weekday_afternoon',
      inquiry: '입학 준비 포트폴리오가 궁금해요.',
      consent: true,
    })
    expect(response).toEqual({
      data: {
        id: counselingPublicId,
        assessmentPublicId,
        status: 'new',
        contactMethod: 'phone',
        availability: 'weekday_afternoon',
        inquiry: '입학 준비 포트폴리오가 궁금해요.',
        consentedAt: createdAt,
        assignedAt: null,
        contactedAt: null,
        completedAt: null,
        closedAt: null,
        version: 0,
        createdAt,
        updatedAt: createdAt,
        assignedFaculty: null,
        recommendations: expect.arrayContaining([
          expect.objectContaining({ name: '윤태준', role: 'primary', rank: 1 }),
        ]),
      },
      requestId,
    })
    const serialized = JSON.stringify(response)
    for (const forbidden of [
      '"adminNote"',
      '"admin_note"',
      '"prospectId"',
      '"requestId":73',
      '"facultyId"',
      '"phone":',
      '"email":',
      '"office":',
      '"website":',
    ]) expect(serialized).not.toContain(forbidden)
  })

  it('returns the existing open request on duplicate submit without overwriting it or emitting twice', async () => {
    const dependencies = serviceDependencies()
    dependencies.createRequest
      .mockResolvedValueOnce({ requestId: 73, publicId: counselingPublicId, created: true })
      .mockResolvedValueOnce({ requestId: 73, publicId: counselingPublicId, created: false })
    dependencies.loadRequest.mockResolvedValue(storedRequest({
      contactMethod: 'phone',
      availability: 'weekday_afternoon',
      inquiry: '첫 신청 내용',
    }))
    const service = createCounselingService(dependencies)

    const first = await service.requestCounseling(validInput, requestContext)
    const second = await service.requestCounseling({
      ...validInput,
      contactMethod: 'visit',
      availability: 'weekend',
      inquiry: '덮어쓰면 안 됨',
    }, requestContext)

    expect(second.id).toBe(first.id)
    expect(second).toEqual(expect.objectContaining({
      contactMethod: 'phone',
      availability: 'weekday_afternoon',
      inquiry: '첫 신청 내용',
    }))
    expect(dependencies.recordEvent).toHaveBeenCalledOnce()
    expect(dependencies.recordEvent).toHaveBeenCalledWith({
      anonymousId,
      eventName: 'counseling_requested',
      path: '/api/counseling',
      prospectId: 42,
      properties: { assessment_id: 17, counseling_request_id: 73 },
      requestId,
    })
  })

  it('returns an existing open request when a different owned assessment is submitted', async () => {
    const differentAssessmentPublicId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const dependencies = serviceDependencies({
      loadOwnedAssessment: vi.fn(async ({ prospectId, publicId }) => (
        prospectId === 42 && publicId === differentAssessmentPublicId
          ? { assessmentId: 18, publicId: differentAssessmentPublicId }
          : null
      )),
      createRequest: vi.fn(async () => ({
        requestId: 73,
        publicId: counselingPublicId,
        created: false,
      })),
      loadRequest: vi.fn(async () => storedRequest({ assessmentPublicId })),
    })
    const service = createCounselingService(dependencies)

    await expect(service.requestCounseling({
      ...validInput,
      assessmentPublicId: differentAssessmentPublicId,
      contactMethod: 'visit',
      availability: 'weekend',
      inquiry: '두 번째 결과로 다시 신청',
    }, requestContext)).resolves.toEqual(expect.objectContaining({
      id: counselingPublicId,
      assessmentPublicId,
      contactMethod: 'phone',
      availability: 'weekday_afternoon',
    }))
    expect(dependencies.recordEvent).not.toHaveBeenCalled()
  })

  it('allows a created request assessment retention race but rejects a different retained assessment', async () => {
    const nullableAssessment = createCounselingService(serviceDependencies({
      loadRequest: vi.fn(async () => storedRequest({ assessmentPublicId: null })),
    }))
    const mismatchedAssessment = createCounselingService(serviceDependencies({
      loadRequest: vi.fn(async () => storedRequest({
        assessmentPublicId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      })),
    }))

    await expect(nullableAssessment.requestCounseling(validInput, requestContext)).resolves.toEqual(
      expect.objectContaining({ assessmentPublicId: null }),
    )
    await expect(mismatchedAssessment.requestCounseling(validInput, requestContext)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
  })

  it('does not fail a created request when best-effort analytics fails', async () => {
    const dependencies = serviceDependencies({
      recordEvent: vi.fn(async () => { throw new Error('EVENT_WRITE_FAILED') }),
    })
    const service = createCounselingService(dependencies)

    await expect(service.requestCounseling(validInput, requestContext)).resolves.toEqual(
      expect.objectContaining({ id: counselingPublicId }),
    )
  })

  it('fails closed when store rows do not preserve the authenticated ownership chain', async () => {
    const wrongAssessment = createCounselingService(serviceDependencies({
      loadOwnedAssessment: vi.fn(async () => ({
        assessmentId: 17,
        publicId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      })),
    }))
    const wrongProspect = createCounselingService(serviceDependencies({
      loadRequest: vi.fn(async () => storedRequest({ prospectId: 99 })),
    }))
    const wrongRequestId = createCounselingService(serviceDependencies({
      loadRequest: vi.fn(async () => storedRequest({ requestId: 74 })),
    }))
    const wrongRequestPublicId = createCounselingService(serviceDependencies({
      loadRequest: vi.fn(async () => storedRequest({
        publicId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      })),
    }))

    await expect(wrongAssessment.requestCounseling(validInput, requestContext)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
    await expect(wrongProspect.requestCounseling(validInput, requestContext)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
    await expect(wrongRequestId.requestCounseling(validInput, requestContext)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
    await expect(wrongRequestPublicId.requestCounseling(validInput, requestContext)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
  })

  it('rejects missing transfer consent with a sanitized 422 before any store call', async () => {
    const dependencies = serviceDependencies()
    const handler = createPost(createCounselingService(dependencies))
    const event = {
      rawBody: JSON.stringify({ ...validInput, consent: false }),
      headers: {} as Record<string, string>,
      status: undefined as number | undefined,
    }

    const response = await handler(event)

    expect(event.status).toBe(422)
    expect(response).toEqual({
      error: { code: 'COUNSELING_INVALID', message: expect.any(String) },
      requestId,
    })
    expect(JSON.stringify(response)).not.toContain('consent')
    expect(dependencies.loadOwnedAssessment).not.toHaveBeenCalled()
    expect(dependencies.createRequest).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing student session and 404 for a foreign result', async () => {
    const unauthenticated = serviceDependencies({ getStudentSession: vi.fn(async () => null) })
    const foreign = serviceDependencies({ loadOwnedAssessment: vi.fn(async () => null) })
    const unauthenticatedEvent = {
      rawBody: JSON.stringify(validInput),
      headers: {} as Record<string, string>,
      status: undefined as number | undefined,
    }
    const foreignEvent = {
      rawBody: JSON.stringify(validInput),
      headers: {} as Record<string, string>,
      status: undefined as number | undefined,
    }

    const unauthenticatedResponse = await createPost(
      createCounselingService(unauthenticated),
    )(unauthenticatedEvent)
    const foreignResponse = await createPost(
      createCounselingService(foreign),
    )(foreignEvent)

    expect(unauthenticatedEvent.status).toBe(401)
    expect(unauthenticatedResponse).toEqual({
      error: { code: 'AUTH_FAILED', message: expect.any(String) },
      requestId,
    })
    expect(foreignEvent.status).toBe(404)
    expect(foreignResponse).toEqual({
      error: { code: 'RESULT_NOT_FOUND', message: expect.any(String) },
      requestId,
    })
  })

  it.each([
    { name: 'wrong content type', overrides: { getContentType: () => 'text/plain' } },
    { name: 'missing body', overrides: { readRawBody: async () => undefined } },
    { name: 'malformed JSON', overrides: { readRawBody: async () => '{' } },
    { name: 'oversized body', overrides: { readRawBody: async () => JSON.stringify({ ...validInput, inquiry: 'a'.repeat(5_000) }) } },
    { name: 'bounded reader failure', overrides: { readRawBody: async () => { throw new RequestBodyLimitError() } } },
  ])('rejects $name as a sanitized 422', async ({ overrides }) => {
    const handler = createPost(undefined, overrides)
    const event = {
      rawBody: JSON.stringify(validInput),
      headers: {} as Record<string, string>,
      status: undefined as number | undefined,
    }

    const response = await handler(event)

    expect(event.status).toBe(422)
    expect(response).toEqual({
      error: { code: 'COUNSELING_INVALID', message: expect.any(String) },
      requestId,
    })
  })
})

describe('GET /api/counseling', () => {
  it('returns the latest student-owned status and reveals assigned faculty only after assignment', async () => {
    const dependencies = serviceDependencies({
      loadRequest: vi.fn(async () => storedRequest({
        status: 'assigned',
        version: 1,
        assignedAt: '2026-07-15T02:00:00.000Z',
        updatedAt: '2026-07-15T02:00:00.000Z',
        assignedFaculty: {
          name: '윤태준',
          title: '교수',
          expertise: '현대예술·예술사진·영상촬영·융합이미지',
        },
      })),
    })
    const handler = createGet(createCounselingService(dependencies))
    const event = { headers: {} as Record<string, string>, status: undefined as number | undefined }

    const response = await handler(event)

    expect(event.headers['cache-control']).toBe('private, no-store')
    expect(dependencies.loadRequest).toHaveBeenCalledWith({ prospectId: 42 })
    expect(response).toEqual({
      data: expect.objectContaining({
        id: counselingPublicId,
        assessmentPublicId,
        status: 'assigned',
        version: 1,
        assignedFaculty: {
          name: '윤태준',
          title: '교수',
          expertise: '현대예술·예술사진·영상촬영·융합이미지',
        },
      }),
      requestId,
    })
    const serialized = JSON.stringify(response)
    for (const forbidden of [
      '"adminNote"',
      '"admin_note"',
      '"phone":',
      '"email":',
      '"office":',
      '"website":',
      '"facultyId"',
      '"prospectId"',
    ]) expect(serialized).not.toContain(forbidden)
  })

  it('returns a successful null state when the student has no counseling request', async () => {
    const service = createCounselingService(serviceDependencies({
      loadRequest: vi.fn(async () => null),
    }))
    const handler = createGet(service)
    const event = { headers: {} as Record<string, string>, status: undefined as number | undefined }

    await expect(handler(event)).resolves.toEqual({ data: null, requestId })
    expect(event.headers['cache-control']).toBe('private, no-store')
  })

  it('requires a valid student session', async () => {
    const service = createCounselingService(serviceDependencies({
      getStudentSession: vi.fn(async () => null),
    }))
    const handler = createGet(service)
    const event = { headers: {} as Record<string, string>, status: undefined as number | undefined }

    const response = await handler(event)

    expect(event.status).toBe(401)
    expect(response).toEqual({
      error: { code: 'AUTH_FAILED', message: expect.any(String) },
      requestId,
    })
  })

  it('fails closed when a store response contains forbidden or malformed fields', async () => {
    const service = createCounselingService(serviceDependencies({
      loadRequest: vi.fn(async () => ({ ...storedRequest(), adminNote: '노출하면 안 됨' })),
    }))
    const handler = createGet(service)
    const event = { headers: {} as Record<string, string>, status: undefined as number | undefined }

    const response = await handler(event)

    expect(event.status).toBe(500)
    expect(response).toEqual({
      error: { code: 'INTERNAL_ERROR', message: expect.any(String) },
      requestId,
    })
    expect(JSON.stringify(response)).not.toContain('노출하면')
  })
})

describe('Supabase counseling adapter boundaries', () => {
  it('loads only a completed assessment filtered by both public ID and prospect ID', async () => {
    const fake = createFakeSupabaseClient({
      queryResponses: {
        assessments: [{
          data: { id: 17, public_id: assessmentPublicId },
          error: null,
        }],
      },
    })
    const dependencies = createSupabaseCounselingDependencies(fake.client)

    await expect(dependencies.loadOwnedAssessment({
      prospectId: 42,
      publicId: assessmentPublicId,
    })).resolves.toEqual({ assessmentId: 17, publicId: assessmentPublicId })
    expect(fake.calls).toEqual([{
      table: 'assessments',
      select: 'id,public_id',
      filters: [
        { column: 'public_id', value: assessmentPublicId },
        { column: 'prospect_id', value: 42 },
        { column: 'status', value: 'completed' },
      ],
      orders: [],
      limit: null,
    }])
  })

  it('orders the current request deterministically and selects no private contact or admin fields', async () => {
    const fake = createFakeSupabaseClient({
      queryResponses: {
        counseling_requests: [{ data: rawRequestRow(), error: null }],
      },
    })
    const dependencies = createSupabaseCounselingDependencies(fake.client)

    await expect(dependencies.loadRequest({ prospectId: 42 })).resolves.toEqual(
      expect.objectContaining({
        requestId: 73,
        prospectId: 42,
        assessmentPublicId,
      }),
    )
    const call = fake.calls[0]
    expect(call).toEqual(expect.objectContaining({
      table: 'counseling_requests',
      filters: [{ column: 'prospect_id', value: 42 }],
      orders: [
        { column: 'created_at', ascending: false },
        { column: 'id', ascending: false },
      ],
      limit: 1,
    }))
    const selection = call?.select?.replace(/\s+/gu, '') ?? ''
    expect(selection).toContain('assessment:assessments!counseling_requests_assessment_fk(public_id)')
    expect(selection).toContain('assigned_faculty:faculty!counseling_requests_assigned_faculty_fk(name,title,expertise_summary)')
    expect(selection).toContain('recommendations:counseling_faculty_recommendations(faculty_name_snapshot,faculty_title_snapshot,expertise_snapshot,reason_snapshot,role,rank)')
    for (const forbidden of [
      'admin_note',
      'assigned_faculty_id',
      'faculty_id',
      'phone',
      'email',
      'office',
      'website',
      'contact_visibility',
    ]) expect(selection).not.toContain(forbidden)
  })

  it('filters the request-ID path by both prospect and request and maps a deleted assessment to null', async () => {
    const fake = createFakeSupabaseClient({
      queryResponses: {
        counseling_requests: [{
          data: rawRequestRow({ assessment: null }),
          error: null,
        }],
      },
    })
    const dependencies = createSupabaseCounselingDependencies(fake.client)

    await expect(dependencies.loadRequest({ prospectId: 42, requestId: 73 })).resolves.toEqual(
      expect.objectContaining({ assessmentPublicId: null }),
    )
    expect(fake.calls[0]).toEqual(expect.objectContaining({
      filters: [
        { column: 'prospect_id', value: 42 },
        { column: 'id', value: 73 },
      ],
      orders: [],
      limit: null,
    }))
  })

  it('passes the exact RPC contract and rejects malformed RPC cardinality', async () => {
    const validFake = createFakeSupabaseClient({
      rpcResponses: [{
        data: [{
          counseling_request_id: 73,
          public_id: counselingPublicId,
          created: true,
        }],
        error: null,
      }],
    })
    const validDependencies = createSupabaseCounselingDependencies(validFake.client)

    await expect(validDependencies.createRequest({
      prospectId: 42,
      assessmentId: 17,
      contactMethod: 'phone',
      availability: 'weekday_afternoon',
      inquiry: '입학 준비 포트폴리오가 궁금해요.',
      consent: true,
    })).resolves.toEqual({ requestId: 73, publicId: counselingPublicId, created: true })
    expect(validFake.rpc).toHaveBeenCalledWith('create_counseling_request', {
      p_prospect_id: 42,
      p_assessment_id: 17,
      p_contact_method: 'phone',
      p_availability: 'weekday_afternoon',
      p_inquiry: '입학 준비 포트폴리오가 궁금해요.',
      p_consent_given: true,
    })

    const malformedFake = createFakeSupabaseClient({
      rpcResponses: [{ data: [], error: null }],
    })
    const malformedDependencies = createSupabaseCounselingDependencies(malformedFake.client)
    await expect(malformedDependencies.createRequest({
      prospectId: 42,
      assessmentId: 17,
      contactMethod: 'phone',
      availability: 'weekday_afternoon',
      inquiry: null,
      consent: true,
    })).rejects.toThrow('COUNSELING_RPC_INVALID')
  })

  it('fails closed on unexpected assessment and request query fields', async () => {
    const assessmentFake = createFakeSupabaseClient({
      queryResponses: {
        assessments: [{
          data: { id: 17, public_id: assessmentPublicId, phone: '010-0000-0000' },
          error: null,
        }],
      },
    })
    const requestFake = createFakeSupabaseClient({
      queryResponses: {
        counseling_requests: [{
          data: rawRequestRow({ admin_note: '노출하면 안 됨' }),
          error: null,
        }],
      },
    })

    await expect(createSupabaseCounselingDependencies(assessmentFake.client).loadOwnedAssessment({
      prospectId: 42,
      publicId: assessmentPublicId,
    })).rejects.toThrow('COUNSELING_STORE_INVALID')
    await expect(createSupabaseCounselingDependencies(requestFake.client).loadRequest({
      prospectId: 42,
    })).rejects.toThrow('COUNSELING_STORE_INVALID')
  })
})
