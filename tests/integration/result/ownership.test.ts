import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAssessmentHistoryHandler } from '../../../server/api/assessment/history.get'
import { createOwnedResultHandler } from '../../../server/api/result/[publicId].get'
import {
  buildCareerNarrativeBrief,
  buildDeterministicCareerNarrativeChoice,
  renderCareerNarrative,
} from '../../../server/modules/assessment/career-narrative'
import { createAssessmentCompletionService } from '../../../server/modules/assessment/completion'
import { decodeResultSnapshot } from '../../../shared/schemas/result'
import type { ResultSnapshot, ResultSnapshotCore } from '../../../shared/types/result'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestId = '77777777-7777-4777-8777-777777777777'
const anonymousId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ownedPublicId = '22222222-2222-4222-8222-222222222222'
const missingPublicId = '33333333-3333-4333-8333-333333333333'
const ownerToken = 'owner-session'
const foreignToken = 'foreign-session'

const snapshotFixture = (
  completedAt = '2026-07-15T11:30:00+09:00',
  topTrack: 'documentary' | 'art_photo' | 'commercial' | 'video' = 'commercial',
  environmentScore = 92.3,
): ResultSnapshot => {
  const remaining = ['documentary', 'art_photo', 'commercial', 'video']
    .filter(track => track !== topTrack) as Array<'documentary' | 'art_photo' | 'commercial' | 'video'>
  const core: ResultSnapshotCore = {
    completedAt,
    selectedInterests: [
      { group: 'work', key: 'work.commercial_image', label: '제품·패션·광고 이미지 만들기' },
      { group: 'result', key: 'result.commercial_fashion', label: '광고·패션 이미지' },
      { group: 'style', key: 'style.studio', label: '스튜디오에서 촬영' },
      { group: 'career', key: 'career.photo', label: '사진을 촬영해 포트폴리오로 완성하고 싶어요.' },
    ],
    trackScores: { documentary: 6.7, art_photo: 50, commercial: 100, video: 20 },
    rankedTracks: [topTrack, ...remaining],
    environmentScore,
    learningPath: [
      { year: 1, resources: [] },
      { year: 2, resources: [] },
      { year: 3, resources: [] },
      { year: 4, resources: [] },
    ],
    resources: {
      course: [],
      equipment: [],
      facility: [],
      extracurricular: [],
      project: [],
      student_work: [],
      career: [],
      support: [],
    },
    faculty: {
      primary: {
        role: 'primary',
        id: 202,
        name: '윤태준',
        title: '교수',
        expertise: '현대예술·예술사진·영상·AI·기술적 이미지',
        reason: '선택한 스튜디오 관심과 전문분야가 연결됩니다.',
        publicContacts: { phone: '062-670-2338', email: 'tjyun@gwangju.ac.kr' },
      },
      backup: {
        role: 'backup',
        id: 201,
        name: '조대연',
        title: '교수',
        expertise: '포토커뮤니케이션·다큐멘터리·시각커뮤니케이션',
        reason: '선택한 사진 관심의 예비 상담 추천입니다.',
        publicContacts: {},
      },
      specialists: [{
        role: 'specialist',
        id: 206,
        name: '곽동욱',
        title: '겸임교수',
        expertise: '광고사진·패션사진·브랜드 이미지',
        reason: '선택한 광고사진 관심을 함께 살펴볼 전문 연계입니다.',
        publicContacts: {},
      }],
    },
  }
  const brief = buildCareerNarrativeBrief(core)
  return decodeResultSnapshot({
    ...core,
    careerNarrative: renderCareerNarrative(
      brief,
      buildDeterministicCareerNarrativeChoice(brief),
      'deterministic',
    ),
  })
}

const ownedRow = (
  assessmentId = 701,
  publicId = ownedPublicId,
  resultSnapshot: unknown = snapshotFixture(),
) => ({
  assessmentId,
  publicId,
  campaignId: 17,
  completedAt: (resultSnapshot as { completedAt?: string }).completedAt
    ?? '2026-07-15T11:30:00+09:00',
  resultSnapshot,
})

const serviceDependencies = (overrides: Record<string, unknown> = {}) => ({
  getStudentSession: async (token: string) => token === ownerToken
    ? { prospectId: 42, nickname: '소유자', expiresAt: '2026-07-16T00:00:00+09:00' }
    : token === foreignToken
      ? { prospectId: 99, nickname: '다른학생', expiresAt: '2026-07-16T00:00:00+09:00' }
      : null,
  consumeRateLimit: vi.fn(async () => true),
  loadActiveOptions: vi.fn(async () => []),
  loadResourceCandidates: vi.fn(async () => []),
  loadFacultyCandidates: vi.fn(async () => ({ faculty: [], specialistLinks: [] })),
  loadCompletedAssessmentByIdempotency: vi.fn(async () => null),
  resolveCareerNarrative: vi.fn(async ({ coreSnapshot }) => {
    const brief = buildCareerNarrativeBrief(coreSnapshot)
    return {
      kind: 'narrative_ready' as const,
      generationId: 91,
      narrative: renderCareerNarrative(
        brief,
        buildDeterministicCareerNarrativeChoice(brief),
        'deterministic',
      ),
    }
  }),
  completeAssessment: vi.fn(async () => ({
    assessmentId: 701,
    publicId: ownedPublicId,
    created: true,
  })),
  loadOwnedAssessment: vi.fn(async () => null),
  loadAssessmentHistory: vi.fn(async () => []),
  recordEvent: vi.fn(async () => undefined),
  now: () => '2026-07-15T11:30:00+09:00',
  ...overrides,
})

type RequestEvent = {
  publicId?: string
  sessionToken: string
  status?: number
  headers: Record<string, string>
}

const handlerContext = (event: unknown) => ({
  anonymousId,
  requestId,
  sessionToken: (event as RequestEvent).sessionToken,
})

const responseMutators = {
  setHeader: (event: unknown, name: string, value: string) => {
    ;(event as RequestEvent).headers[name.toLowerCase()] = value
  },
  setStatus: (event: unknown, status: number) => { (event as RequestEvent).status = status },
}

const resultHandler = (
  assessment: ReturnType<typeof createAssessmentCompletionService>,
) => createOwnedResultHandler({
  assessment,
  getContext: handlerContext,
  getPublicId: event => (event as RequestEvent).publicId ?? '',
  ...responseMutators,
})

const historyHandler = (
  assessment: ReturnType<typeof createAssessmentCompletionService>,
) => createAssessmentHistoryHandler({ assessment, getContext: handlerContext, ...responseMutators })

describe('owned result API', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('filters storage by public ID and prospect, canonically decodes, and emits a minimal viewed metric', async () => {
    const loadOwnedAssessment = vi.fn(async (identity: { prospectId: number, publicId: string }) => (
      identity.prospectId === 42 && identity.publicId === ownedPublicId ? ownedRow() : null
    ))
    const recordEvent = vi.fn(async () => undefined)
    const service = createAssessmentCompletionService(serviceDependencies({
      loadOwnedAssessment,
      recordEvent,
    }))
    const handler = resultHandler(service)
    const event: RequestEvent = {
      publicId: ownedPublicId,
      sessionToken: ownerToken,
      headers: {},
    }

    const response = await handler(event)

    expect(loadOwnedAssessment).toHaveBeenCalledWith({ prospectId: 42, publicId: ownedPublicId })
    expect(response).toEqual({ data: snapshotFixture(), requestId })
    expect(event.status).toBeUndefined()
    expect(event.headers['cache-control']).toBe('private, no-store')
    expect(recordEvent).toHaveBeenCalledOnce()
    const metric = recordEvent.mock.calls[0]![0]
    expect(metric).toEqual({
      anonymousId,
      campaignId: 17,
      eventName: 'result_viewed',
      path: `/api/result/${ownedPublicId}`,
      prospectId: 42,
      properties: { assessment_id: 701, top_track: 'commercial' },
      requestId,
    })
    expect(JSON.stringify(metric)).not.toMatch(/label|reason|phone|email|selected|weight|response/u)
  })

  it('upgrades an owned legacy snapshot in memory without persisting the compatibility result', async () => {
    const current = snapshotFixture()
    const { careerNarrative: _removed, ...legacy } = current
    const loadOwnedAssessment = vi.fn(async () => ownedRow(701, ownedPublicId, legacy))
    const completeAssessment = vi.fn(async () => ({
      assessmentId: 701,
      publicId: ownedPublicId,
      created: false,
    }))
    const service = createAssessmentCompletionService(serviceDependencies({
      completeAssessment,
      loadOwnedAssessment,
    }))
    const firstEvent: RequestEvent = {
      publicId: ownedPublicId,
      sessionToken: ownerToken,
      headers: {},
    }
    const secondEvent: RequestEvent = {
      publicId: ownedPublicId,
      sessionToken: ownerToken,
      headers: {},
    }

    const first = await resultHandler(service)(firstEvent)
    const second = await resultHandler(service)(secondEvent)

    expect(first.data.careerNarrative).toEqual(second.data.careerNarrative)
    expect(first.data.careerNarrative.source).toBe('deterministic')
    expect(first.data.careerNarrative.sentences).toHaveLength(4)
    expect(completeAssessment).not.toHaveBeenCalled()
    expect(loadOwnedAssessment).toHaveBeenCalledTimes(2)
  })

  it('makes a malformed, missing, and foreign UUID the same RESULT_NOT_FOUND 404', async () => {
    const loadOwnedAssessment = vi.fn(async (identity: { prospectId: number, publicId: string }) => (
      identity.prospectId === 42 && identity.publicId === ownedPublicId ? ownedRow() : null
    ))
    const service = createAssessmentCompletionService(serviceDependencies({ loadOwnedAssessment }))
    const handler = resultHandler(service)
    const cases: RequestEvent[] = [
      { publicId: 'not-a-uuid', sessionToken: ownerToken, headers: {} },
      { publicId: missingPublicId, sessionToken: ownerToken, headers: {} },
      { publicId: ownedPublicId, sessionToken: foreignToken, headers: {} },
    ]

    const responses = []
    for (const event of cases) {
      responses.push(await handler(event))
      expect(event.status).toBe(404)
      expect(event.headers['cache-control']).toBe('private, no-store')
    }

    expect(responses[0]).toEqual({
      error: { code: 'RESULT_NOT_FOUND', message: expect.any(String) },
      requestId,
    })
    expect(responses[1]).toEqual(responses[0])
    expect(responses[2]).toEqual(responses[0])
    expect(loadOwnedAssessment).toHaveBeenCalledWith({ prospectId: 42, publicId: missingPublicId })
    expect(loadOwnedAssessment).toHaveBeenCalledWith({ prospectId: 99, publicId: ownedPublicId })
    expect(loadOwnedAssessment).not.toHaveBeenCalledWith({ prospectId: 42, publicId: ownedPublicId })
  })

  it('turns a corrupt owned snapshot into a sanitized internal error without partial data or metrics', async () => {
    const corrupt = { ...snapshotFixture(), environmentScore: 101 }
    const recordEvent = vi.fn(async () => undefined)
    const service = createAssessmentCompletionService(serviceDependencies({
      loadOwnedAssessment: async () => ownedRow(701, ownedPublicId, corrupt),
      recordEvent,
    }))
    const event: RequestEvent = { publicId: ownedPublicId, sessionToken: ownerToken, headers: {} }

    const response = await resultHandler(service)(event)

    expect(event.status).toBe(500)
    expect(response).toEqual({
      error: { code: 'INTERNAL_ERROR', message: expect.any(String) },
      requestId,
    })
    expect(JSON.stringify(response)).not.toMatch(/environmentScore|101|Zod/u)
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('returns the owned canonical result when best-effort result_viewed telemetry fails', async () => {
    const service = createAssessmentCompletionService(serviceDependencies({
      loadOwnedAssessment: async () => ownedRow(),
      recordEvent: async () => { throw new Error('EVENT_WRITE_FAILED: private store detail') },
    }))
    const event: RequestEvent = { publicId: ownedPublicId, sessionToken: ownerToken, headers: {} }

    const response = await resultHandler(service)(event)

    expect(event.status).toBeUndefined()
    expect(response).toEqual({ data: snapshotFixture(), requestId })
    expect(event.headers['cache-control']).toBe('private, no-store')
  })

  it('requires a student session for result and history before storage access', async () => {
    const loadOwnedAssessment = vi.fn(async () => ownedRow())
    const loadAssessmentHistory = vi.fn(async () => [ownedRow()])
    const service = createAssessmentCompletionService(serviceDependencies({
      loadOwnedAssessment,
      loadAssessmentHistory,
    }))
    const resultEvent: RequestEvent = { publicId: ownedPublicId, sessionToken: '', headers: {} }
    const historyEvent: RequestEvent = { sessionToken: '', headers: {} }

    const [resultResponse, historyResponse] = await Promise.all([
      resultHandler(service)(resultEvent),
      historyHandler(service)(historyEvent),
    ])

    expect(resultEvent.status).toBe(401)
    expect(historyEvent.status).toBe(401)
    expect(resultResponse.error.code).toBe('AUTH_FAILED')
    expect(historyResponse.error.code).toBe('AUTH_FAILED')
    expect(loadOwnedAssessment).not.toHaveBeenCalled()
    expect(loadAssessmentHistory).not.toHaveBeenCalled()
  })
})

describe('GET /api/assessment/history', () => {
  it('uses the authoritative database completion time when snapshot time differs by one millisecond', async () => {
    const snapshotTime = '2026-07-15T11:30:00.000+09:00'
    const rowTime = '2026-07-15T11:30:00.001+09:00'
    const row = {
      ...ownedRow(701, ownedPublicId, snapshotFixture(snapshotTime)),
      completedAt: rowTime,
    }
    const service = createAssessmentCompletionService(serviceDependencies({
      loadAssessmentHistory: async () => [row],
    }))
    const event: RequestEvent = { sessionToken: ownerToken, headers: {} }

    const response = await historyHandler(service)(event)

    expect(event.status).toBeUndefined()
    expect(response).toEqual({
      data: {
        items: [expect.objectContaining({ publicId: ownedPublicId, completedAt: rowTime })],
      },
      requestId,
    })
  })

  it('sorts by completed time and ID, caps three, and returns only redacted summaries', async () => {
    const rows = [
      ownedRow(701, '11111111-1111-4111-8111-111111111111', snapshotFixture('2026-07-12T10:00:00+09:00', 'documentary', 70.1)),
      ownedRow(702, '22222222-2222-4222-8222-222222222223', snapshotFixture('2026-07-15T12:00:00+09:00', 'art_photo', 80.2)),
      ownedRow(704, '44444444-4444-4444-8444-444444444444', snapshotFixture('2026-07-15T12:00:00+09:00', 'commercial', 92.3)),
      ownedRow(703, '33333333-3333-4333-8333-333333333334', snapshotFixture('2026-07-14T11:00:00+09:00', 'video', 84.4)),
    ]
    const loadAssessmentHistory = vi.fn(async (prospectId: number) => {
      expect(prospectId).toBe(42)
      return rows
    })
    const service = createAssessmentCompletionService(serviceDependencies({ loadAssessmentHistory }))
    const event: RequestEvent = { sessionToken: ownerToken, headers: {} }

    const response = await historyHandler(service)(event)

    expect(event.headers['cache-control']).toBe('private, no-store')
    expect(response.requestId).toBe(requestId)
    expect(response.data.items.map((item: { publicId: string }) => item.publicId)).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '22222222-2222-4222-8222-222222222223',
      '33333333-3333-4333-8333-333333333334',
    ])
    expect(response.data.items).toHaveLength(3)
    for (const item of response.data.items) {
      expect(Object.keys(item).sort()).toEqual([
        'publicId',
        'completedAt',
        'topTrack',
        'environmentScore',
        'selectedInterests',
      ].sort())
      expect(item.selectedInterests).toEqual(expect.arrayContaining([
        { group: 'work', key: 'work.commercial_image', label: '제품·패션·광고 이미지 만들기' },
      ]))
    }
    expect(response.data.items[0]).toMatchObject({
      completedAt: '2026-07-15T12:00:00+09:00',
      topTrack: 'commercial',
      environmentScore: 92.3,
    })
    expect(JSON.stringify(response)).not.toMatch(
      /trackScores|rankedTracks|resources|faculty|reason|062-670-2338|tjyun@gwangju\.ac\.kr|weight|session/u,
    )
  })

  it('fails closed instead of returning a partial history when any retained snapshot is corrupt', async () => {
    const corrupt = { ...snapshotFixture(), selectedInterests: [] }
    const service = createAssessmentCompletionService(serviceDependencies({
      loadAssessmentHistory: async () => [ownedRow(), ownedRow(702, missingPublicId, corrupt)],
    }))
    const event: RequestEvent = { sessionToken: ownerToken, headers: {} }

    const response = await historyHandler(service)(event)

    expect(event.status).toBe(500)
    expect(response).toEqual({
      error: { code: 'INTERNAL_ERROR', message: expect.any(String) },
      requestId,
    })
    expect(response).not.toHaveProperty('data')
  })
})
