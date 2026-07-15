import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseAssessmentCatalog } from '../../../scripts/seed-assessment-options'
import { createSubmitAssessmentHandler } from '../../../server/api/assessment/submit.post'
import { createAssessmentCatalogRevision } from '../../../server/modules/assessment/catalog-revision'
import {
  createAssessmentCompletionService,
  createSupabaseAssessmentCompletionDependencies,
} from '../../../server/modules/assessment/completion'
import type { FacultyRecommendationCandidate } from '../../../server/modules/matching/faculty'
import type { ResourceCandidate } from '../../../server/modules/matching/resources'
import { AppError } from '../../../server/utils/app-error'
import { RequestBodyLimitError } from '../../../server/utils/bounded-request-body'
import { decodeResultSnapshot } from '../../../shared/schemas/result'
import type { AssessmentSelections } from '../../../shared/types/domain'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestId = '77777777-7777-4777-8777-777777777777'
const anonymousId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const sessionToken = 'opaque-student-session'
const idempotencyKey = '11111111-1111-4111-8111-11111111111a'
const publicId = '22222222-2222-4222-8222-22222222222b'
const completedAt = '2026-07-15T11:30:00+09:00'

const catalog = () => parseAssessmentCatalog(JSON.parse(
  readFileSync('supabase/seed/assessment-options.json', 'utf8'),
) as unknown)

const selections = (): AssessmentSelections => ({
  work: ['work.commercial_image'],
  result: ['result.commercial_fashion'],
  style: ['style.studio'],
  career: ['career.photo'],
  careerOther: null,
})

const tag = (key: string) => ({ key, weight: 3, isPrimary: true })

const resourceCandidates = (): ResourceCandidate[] => [
  {
    id: 101,
    type: 'course',
    title: '라이팅과 스튜디오',
    summary: '스튜디오 조명으로 상업 이미지를 완성하는 교과입니다.',
    status: 'active',
    visibility: 'public',
    priority: 30,
    sourceDate: '2026-07-14',
    metadata: {
      gradeYear: 1,
      term: '2학기',
      credits: 3,
      goalSummary: '조명 설계와 스튜디오 촬영을 익히는',
    },
    tags: [tag('commercial')],
  },
  {
    id: 102,
    type: 'equipment',
    title: '스튜디오 조명 세트',
    summary: '광고사진 제작을 뒷받침하는 학과 기자재입니다.',
    status: 'active',
    visibility: 'public',
    priority: 20,
    sourceDate: '2026-07-14',
    metadata: {
      locationLabel: '사진영상미디어학과 기자재실',
      confirmedQuantity: 6,
      reservationUrl: 'https://gjureserve.co.kr',
      accessMode: 'reservation',
      accessLabel: '예약 가능',
      inventoryCodes: ['SECRET-INVENTORY-CODE'],
    },
    tags: [tag('commercial')],
  },
  {
    id: 103,
    type: 'facility',
    title: '스튜디오 A(호리존)',
    summary: '제품·패션 촬영을 위한 호리존 스튜디오입니다.',
    status: 'active',
    visibility: 'public',
    priority: 10,
    sourceDate: '2026-07-14',
    metadata: {
      locationLabel: '스튜디오 A',
      operationNote: '사용 전 학과에 운영 시간을 확인합니다.',
      lastVerifiedAt: '2026-07-14T09:00:00+09:00',
    },
    tags: [tag('commercial')],
  },
  {
    id: 104,
    type: 'project',
    title: '브랜드 캠페인 프로젝트',
    summary: '브랜드 이미지를 기획하고 촬영하는 프로젝트입니다.',
    status: 'active',
    visibility: 'public',
    priority: 10,
    sourceDate: '2026-07-14',
    metadata: {},
    tags: [tag('commercial')],
  },
  {
    id: 105,
    type: 'student_work',
    title: '상업사진 포트폴리오',
    summary: '재학생의 광고사진 결과물 예시입니다.',
    status: 'active',
    visibility: 'public',
    priority: 10,
    sourceDate: '2026-07-14',
    metadata: { imagePath: 'images/student-work/commercial.webp', imageAlt: '제품 광고사진 작품' },
    tags: [tag('commercial')],
  },
  {
    id: 106,
    type: 'career',
    title: '광고사진가',
    summary: '브랜드와 제품의 시각 이미지를 제작하는 진로입니다.',
    status: 'active',
    visibility: 'public',
    priority: 10,
    sourceDate: '2026-07-14',
    metadata: {},
    tags: [tag('commercial')],
  },
  {
    id: 107,
    type: 'support',
    title: '학과 포트폴리오 피드백',
    summary: '포트폴리오 제작 과정에서 피드백을 받을 수 있습니다.',
    status: 'active',
    visibility: 'public',
    priority: 10,
    sourceDate: '2026-07-14',
    metadata: {},
    tags: [tag('commercial')],
  },
]

const hiddenContacts = () => ({
  office: 'admin_only' as const,
  phone: 'admin_only' as const,
  email: 'admin_only' as const,
  website: 'admin_only' as const,
})

const primaryFaculty = (
  id: number,
  name: string,
  expertise: string,
  priority: number,
  tags: FacultyRecommendationCandidate['tags'],
): FacultyRecommendationCandidate => ({
  id,
  name,
  title: '교수',
  expertise,
  status: 'active',
  employmentType: 'full_time',
  consultationRole: 'primary',
  weeklyCapacity: 10,
  openAssignedCount: 0,
  priority,
  contacts: { email: `${id}@gwangju.ac.kr` },
  contactVisibility: hiddenContacts(),
  tags,
})

const facultyCandidates = () => ({
  faculty: [
    primaryFaculty(201, '조대연', '포토커뮤니케이션·다큐멘터리·시각커뮤니케이션', 30, [
      { key: 'documentary', label: '다큐멘터리', category: 'track', weight: 3, isPrimary: true },
    ]),
    primaryFaculty(202, '윤태준', '현대예술·예술사진·영상촬영·융합이미지', 20, [
      { key: 'art_photo', label: '예술사진', category: 'track', weight: 3, isPrimary: true },
      { key: 'studio', label: '스튜디오 촬영', category: 'activity', weight: 3, isPrimary: true },
      { key: 'portfolio', label: '포트폴리오', category: 'result', weight: 3, isPrimary: true },
      { key: 'photography', label: '사진 진로', category: 'career', weight: 3, isPrimary: true },
    ]),
    primaryFaculty(203, '김사라', '다큐멘터리·지역기록·사진아카이브', 25, [
      { key: 'documentary', label: '다큐멘터리', category: 'track', weight: 3, isPrimary: true },
    ]),
    {
      id: 206,
      name: '곽동욱',
      title: '겸임교수',
      expertise: '광고사진·패션사진·브랜드 이미지',
      status: 'active',
      employmentType: 'practitioner',
      consultationRole: 'specialist',
      weeklyCapacity: 0,
      openAssignedCount: 0,
      priority: 100,
      contacts: { email: 'kwakdwstudio@naver.com' },
      contactVisibility: hiddenContacts(),
      tags: [
        { key: 'commercial', label: '광고사진', category: 'specialist', weight: 3, isPrimary: true },
        { key: 'commercial', label: '광고사진 포트폴리오', category: 'result', weight: 3, isPrimary: false },
      ],
    } satisfies FacultyRecommendationCandidate,
  ],
  specialistLinks: [
    { primaryFacultyId: null, specialistFacultyId: 206, tagKey: 'commercial', priority: 100 },
  ],
})

const envelope = (revision: string) => ({
  catalogRevision: revision,
  selections: selections(),
  idempotencyKey,
})

const serviceDependencies = (
  overrides: Record<string, unknown> = {},
) => ({
  getStudentSession: async (token: string) => token === sessionToken
    ? { prospectId: 42, nickname: '선명한프레임42', expiresAt: '2026-07-16T00:00:00+09:00' }
    : null,
  consumeRateLimit: vi.fn(async () => true),
  loadActiveOptions: vi.fn(async () => catalog()),
  loadResourceCandidates: vi.fn(async () => resourceCandidates()),
  loadFacultyCandidates: vi.fn(async () => facultyCandidates()),
  completeAssessment: vi.fn(async () => ({ assessmentId: 701, publicId, created: true })),
  loadOwnedAssessment: vi.fn(async () => null),
  loadAssessmentHistory: vi.fn(async () => []),
  recordEvent: vi.fn(async () => undefined),
  now: () => completedAt,
  ...overrides,
})

const context = {
  anonymousId,
  ip: '203.0.113.42',
  requestId,
  sessionToken,
  campaignId: 17,
}

const createSubmit = (
  assessment: { submitAssessment: (input: unknown, submitContext: typeof context) => Promise<{ publicId: string }> },
  overrides: Record<string, unknown> = {},
) => createSubmitAssessmentHandler({
  assessment,
  getContentType: () => 'application/json; charset=utf-8',
  getContext: () => context,
  readRawBody: async event => (event as { rawBody: string }).rawBody,
  setHeader: (event, name, value) => {
    ;(event as { headers: Record<string, string> }).headers[name.toLowerCase()] = value
  },
  setStatus: (event, status) => { (event as { status?: number }).status = status },
  ...overrides,
})

describe('assessment completion service', () => {
  it('validates the exact revision envelope and persists one canonical scoring and matching snapshot', async () => {
    const revision = await createAssessmentCatalogRevision(catalog())
    const dependencies = serviceDependencies()
    const service = createAssessmentCompletionService(dependencies)

    await expect(service.submitAssessment(envelope(revision), context)).resolves.toEqual({ publicId })

    expect(dependencies.consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      key: 'prospect:42',
      route: '/api/assessment/submit',
    }))
    expect(dependencies.completeAssessment).toHaveBeenCalledOnce()
    const persisted = dependencies.completeAssessment.mock.calls[0]![0]
    expect(Object.keys(persisted).sort()).toEqual([
      'campaignId',
      'environmentScore',
      'idempotencyKey',
      'prospectId',
      'responses',
      'resultSnapshot',
      'trackScores',
    ].sort())
    expect(persisted).toMatchObject({
      prospectId: 42,
      campaignId: 17,
      idempotencyKey,
      trackScores: { documentary: 6.7, art_photo: 50, commercial: 100, video: 20 },
      environmentScore: 92.3,
    })
    expect(persisted.responses).toEqual([
      {
        group: 'work',
        optionKey: 'work.commercial_image',
        optionLabel: '제품·패션·광고 이미지 만들기',
        trackWeights: { documentary: 0, art_photo: 1, commercial: 3, video: 1 },
        freeText: null,
      },
      {
        group: 'result',
        optionKey: 'result.commercial_fashion',
        optionLabel: '광고·패션 이미지',
        trackWeights: { documentary: 0, art_photo: 1, commercial: 3, video: 0 },
        freeText: null,
      },
      {
        group: 'style',
        optionKey: 'style.studio',
        optionLabel: '스튜디오에서 촬영',
        trackWeights: { documentary: 0, art_photo: 2, commercial: 3, video: 2 },
        freeText: null,
      },
      {
        group: 'career',
        optionKey: 'career.photo',
        optionLabel: '사진을 직접 촬영하고 보정해 작품·광고·포트폴리오로 완성하고 싶어요.',
        trackWeights: { documentary: 1, art_photo: 3, commercial: 3, video: 0 },
        freeText: null,
      },
    ])

    const snapshot = decodeResultSnapshot(persisted.resultSnapshot)
    expect(snapshot).toMatchObject({
      completedAt,
      selectedInterests: [
        { group: 'work', key: 'work.commercial_image', label: '제품·패션·광고 이미지 만들기' },
        { group: 'result', key: 'result.commercial_fashion', label: '광고·패션 이미지' },
        { group: 'style', key: 'style.studio', label: '스튜디오에서 촬영' },
        { group: 'career', key: 'career.photo', label: expect.any(String) },
      ],
      trackScores: { documentary: 6.7, art_photo: 50, commercial: 100, video: 20 },
      rankedTracks: ['commercial', 'art_photo', 'video', 'documentary'],
      environmentScore: 92.3,
    })
    expect(snapshot.learningPath.map(({ year, resources }) => [year, resources.map(({ id }) => id)]))
      .toEqual([[1, [101]], [2, []], [3, []], [4, []]])
    expect(Object.fromEntries(Object.entries(snapshot.resources).map(([type, resources]) => [
      type,
      resources.map(({ id }) => id),
    ]))).toEqual({
      course: [101],
      equipment: [102],
      facility: [103],
      extracurricular: [],
      project: [104],
      student_work: [105],
      career: [106],
      support: [107],
    })
    expect(snapshot.faculty).toMatchObject({
      primary: { id: 202, role: 'primary' },
      backup: { id: 201, role: 'backup' },
      specialists: [{ id: 206, role: 'specialist' }],
    })
    expect(JSON.stringify(snapshot)).not.toContain('SECRET-INVENTORY-CODE')
  })

  it('persists a positively matched max-bound project with a canonical bounded connection reason', async () => {
    const maxLabel = `${'관'.repeat(198)}📷`
    const maxTitle = `${'제'.repeat(198)}📷`
    const maxSummary = `${'요'.repeat(998)}📷`
    const activeOptions = catalog().map(option => option.optionKey === 'work.commercial_image'
      ? { ...option, label: maxLabel }
      : option)
    const candidates = resourceCandidates()
    const project = candidates.find(candidate => candidate.type === 'project')!
    ;(project as { title: string }).title = maxTitle
    ;(project as { summary: string }).summary = maxSummary
    const completeAssessment = vi.fn(async () => ({ assessmentId: 701, publicId, created: true }))
    const service = createAssessmentCompletionService(serviceDependencies({
      loadActiveOptions: async () => activeOptions,
      loadResourceCandidates: async () => candidates,
      completeAssessment,
    }))
    const revision = await createAssessmentCatalogRevision(activeOptions)

    await expect(service.submitAssessment(envelope(revision), context)).resolves.toEqual({ publicId })

    const snapshot = decodeResultSnapshot(completeAssessment.mock.calls[0]![0].resultSnapshot)
    expect(snapshot.resources.project).toHaveLength(1)
    expect(snapshot.resources.project[0]).toMatchObject({ title: maxTitle, summary: maxSummary })
    const reason = snapshot.resources.project[0]!.connectionReason
    expect(reason.length).toBeLessThanOrEqual(1_000)
    expect(reason).toContain(maxTitle)
    expect(reason).toContain(maxLabel)
    expect([...reason].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
    })).toBe(true)
    expect(decodeResultSnapshot(snapshot)).toEqual(snapshot)
  })

  it('authenticates before the prospect rate limit and stops before content when denied', async () => {
    const order: string[] = []
    const dependencies = serviceDependencies({
      getStudentSession: async () => {
        order.push('session')
        return { prospectId: 42, nickname: '학생', expiresAt: '2026-07-16T00:00:00+09:00' }
      },
      consumeRateLimit: async () => {
        order.push('rate')
        return false
      },
      loadActiveOptions: async () => {
        order.push('catalog')
        return catalog()
      },
    })
    const service = createAssessmentCompletionService(dependencies)
    const revision = await createAssessmentCatalogRevision(catalog())

    await expect(service.submitAssessment(envelope(revision), context))
      .rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(order).toEqual(['session', 'rate'])

    const anonymous = createAssessmentCompletionService(serviceDependencies({
      getStudentSession: async () => null,
      consumeRateLimit: vi.fn(async () => true),
    }))
    await expect(anonymous.submitAssessment(envelope(revision), context))
      .rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('rejects unknown envelope keys and UUID variants, and fails stale before matching or RPC', async () => {
    const revision = await createAssessmentCatalogRevision(catalog())
    const loadResources = vi.fn(async () => resourceCandidates())
    const loadFaculty = vi.fn(async () => facultyCandidates())
    const rpc = vi.fn(async () => ({ assessmentId: 701, publicId, created: true }))
    const service = createAssessmentCompletionService(serviceDependencies({
      loadResourceCandidates: loadResources,
      loadFacultyCandidates: loadFaculty,
      completeAssessment: rpc,
    }))

    await expect(service.submitAssessment({ ...envelope(revision), privateField: true }, context))
      .rejects.toMatchObject({ code: 'ASSESSMENT_INVALID' })
    await expect(service.submitAssessment({ ...envelope(revision), idempotencyKey: idempotencyKey.toUpperCase() }, context))
      .rejects.toMatchObject({ code: 'ASSESSMENT_INVALID' })
    await expect(service.submitAssessment(envelope(`sha256:${'0'.repeat(64)}`), context))
      .rejects.toMatchObject({ code: 'ASSESSMENT_CATALOG_STALE' })
    expect(loadResources).not.toHaveBeenCalled()
    expect(loadFaculty).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('suppresses completion telemetry for an idempotent RPC retry', async () => {
    const revision = await createAssessmentCatalogRevision(catalog())
    const recordEvent = vi.fn(async () => undefined)
    const service = createAssessmentCompletionService(serviceDependencies({
      completeAssessment: vi.fn(async () => ({ assessmentId: 701, publicId, created: false })),
      recordEvent,
    }))

    await expect(service.submitAssessment(envelope(revision), context)).resolves.toEqual({ publicId })
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('returns committed success when best-effort telemetry fails and emits only minimal completion fields', async () => {
    const revision = await createAssessmentCatalogRevision(catalog())
    const recordEvent = vi.fn(async () => { throw new Error('EVENT_WRITE_FAILED: private store detail') })
    const service = createAssessmentCompletionService(serviceDependencies({ recordEvent }))

    await expect(service.submitAssessment(envelope(revision), context)).resolves.toEqual({ publicId })
    expect(recordEvent).toHaveBeenCalledOnce()
    const event = recordEvent.mock.calls[0]![0]
    expect(event).toEqual({
      anonymousId,
      campaignId: 17,
      eventName: 'assessment_completed',
      path: '/api/assessment/submit',
      prospectId: 42,
      properties: { assessment_id: 701, top_track: 'commercial' },
      requestId,
    })
    expect(JSON.stringify(event)).not.toMatch(/freeText|optionLabel|trackWeights|reason|email|phone/u)
  })

  it.each([
    {
      name: 'malformed resource candidate',
      overrides: () => ({
        loadResourceCandidates: async () => [{ ...resourceCandidates()[0], id: '101' }],
      }),
    },
    {
      name: 'duplicate faculty join identity',
      overrides: () => ({
        loadFacultyCandidates: async () => {
          const candidates = facultyCandidates()
          return { ...candidates, faculty: [...candidates.faculty, candidates.faculty[0]] }
        },
      }),
    },
    {
      name: 'fewer than two active primaries',
      overrides: () => ({
        loadFacultyCandidates: async () => {
          const candidates = facultyCandidates()
          return {
            ...candidates,
            faculty: candidates.faculty.filter(person => person.consultationRole === 'specialist'
              || person.id === 201),
          }
        },
      }),
    },
    {
      name: 'malformed RPC response',
      overrides: () => ({
        completeAssessment: async () => ({ assessmentId: 0, publicId: 'not-a-uuid', created: 'yes' }),
      }),
    },
  ])('fails closed for $name without exposing a raw content/store error', async ({ overrides }) => {
    const revision = await createAssessmentCatalogRevision(catalog())
    const service = createAssessmentCompletionService(serviceDependencies(overrides()))

    await expect(service.submitAssessment(envelope(revision), context))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
  })

  it.each([
    {
      name: 'course term beyond the result bound',
      mutate: (candidates: ResourceCandidate[]) => {
        ;(candidates[0]!.metadata as { term: string }).term = '1'.repeat(21)
      },
    },
    {
      name: 'equipment location beyond the result bound',
      mutate: (candidates: ResourceCandidate[]) => {
        ;(candidates[1]!.metadata as { locationLabel: string }).locationLabel = '기'.repeat(121)
      },
    },
    {
      name: 'facility operation note beyond the result bound',
      mutate: (candidates: ResourceCandidate[]) => {
        ;(candidates[2]!.metadata as { operationNote: string }).operationNote = '운'.repeat(1_001)
      },
    },
    {
      name: 'unsafe student-work image path',
      mutate: (candidates: ResourceCandidate[]) => {
        ;(candidates[4]!.metadata as { imagePath: string }).imagePath = '../private.webp'
      },
    },
    {
      name: 'impossible source calendar date',
      mutate: (candidates: ResourceCandidate[]) => {
        ;(candidates[3] as unknown as { sourceDate: string }).sourceDate = '2026-02-31'
      },
    },
    {
      name: 'control character in a common summary',
      mutate: (candidates: ResourceCandidate[]) => {
        ;(candidates[5] as unknown as { summary: string }).summary = '유효하지\n않은 요약'
      },
    },
    {
      name: 'common title beyond the result bound',
      mutate: (candidates: ResourceCandidate[]) => {
        ;(candidates[6] as unknown as { title: string }).title = '지'.repeat(201)
      },
    },
    {
      name: 'fractional resource tag weight',
      mutate: (candidates: ResourceCandidate[]) => {
        ;(candidates[3]!.tags[0] as { weight: number }).weight = 1.5
      },
    },
  ])('fails closed before RPC for $name instead of silently dropping the row', async ({ mutate }) => {
    const revision = await createAssessmentCatalogRevision(catalog())
    const candidates = resourceCandidates()
    mutate(candidates)
    const completeAssessment = vi.fn(async () => ({ assessmentId: 701, publicId, created: true }))
    const service = createAssessmentCompletionService(serviceDependencies({
      loadResourceCandidates: async () => candidates,
      completeAssessment,
    }))

    await expect(service.submitAssessment(envelope(revision), context))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(completeAssessment).not.toHaveBeenCalled()
  })
})

const rawFacultyRow = (input: {
  id: number
  consultationRole: 'primary' | 'specialist'
  employmentType: 'full_time' | 'adjunct'
  tagCategory: 'track' | 'specialist'
  tagKey: string
}) => ({
  id: input.id,
  name: input.consultationRole === 'primary' ? '윤태준' : '박재웅',
  title: input.consultationRole === 'primary' ? '교수' : '겸임교수',
  expertise_summary: input.consultationRole === 'primary' ? '영상촬영' : '드론촬영',
  status: 'active',
  employment_type: input.employmentType,
  consultation_role: input.consultationRole,
  weekly_capacity: input.consultationRole === 'primary' ? 10 : 0,
  priority: 10,
  office: null,
  phone: null,
  email: null,
  website: null,
  contact_visibility: {
    office: 'admin_only',
    phone: 'admin_only',
    email: 'admin_only',
    website: 'admin_only',
  },
  faculty_tags: [{
    tag_key: input.tagKey,
    tag_label: input.tagKey === 'video' ? '영상촬영' : '드론촬영',
    category: input.tagCategory,
    weight: 3,
    is_primary: true,
  }],
})

const supabaseFacultyDependencies = (links: unknown[]) => {
  const facultyRows = [
    rawFacultyRow({ id: 202, consultationRole: 'primary', employmentType: 'full_time', tagCategory: 'track', tagKey: 'video' }),
    rawFacultyRow({ id: 204, consultationRole: 'specialist', employmentType: 'adjunct', tagCategory: 'specialist', tagKey: 'drone' }),
  ]
  const client = {
    from: vi.fn((table: string) => table === 'faculty'
      ? { select: () => ({ eq: async () => ({ data: facultyRows, error: null }) }) }
      : { select: async () => ({ data: links, error: null }) }),
    rpc: vi.fn(),
  }
  return createSupabaseAssessmentCompletionDependencies(client as never)
}

describe('Supabase completion dependency decoding', () => {
  it('keeps only links whose nullable primary and specialist are in the active faculty set', async () => {
    const dependencies = supabaseFacultyDependencies([
      { primary_faculty_id: 202, specialist_faculty_id: 204, tag_key: 'drone', priority: 100 },
      { primary_faculty_id: null, specialist_faculty_id: 204, tag_key: 'drone', priority: 90 },
      { primary_faculty_id: 999, specialist_faculty_id: 204, tag_key: 'drone', priority: 80 },
      { primary_faculty_id: 202, specialist_faculty_id: 998, tag_key: 'drone', priority: 70 },
    ])

    await expect(dependencies.loadFacultyCandidates()).resolves.toMatchObject({
      specialistLinks: [
        { primaryFacultyId: 202, specialistFacultyId: 204, tagKey: 'drone', priority: 100 },
        { primaryFacultyId: null, specialistFacultyId: 204, tagKey: 'drone', priority: 90 },
      ],
    })
  })

  it.each([
    {
      name: 'duplicate raw link identity',
      links: [
        { primary_faculty_id: 202, specialist_faculty_id: 204, tag_key: 'drone', priority: 100 },
        { primary_faculty_id: 202, specialist_faculty_id: 204, tag_key: 'drone', priority: 100 },
      ],
    },
    {
      name: 'extra raw link field',
      links: [{
        primary_faculty_id: 202,
        specialist_faculty_id: 204,
        tag_key: 'drone',
        priority: 100,
        private_note: 'must reject',
      }],
    },
    {
      name: 'raw link priority above the storage bound',
      links: [{
        primary_faculty_id: 202,
        specialist_faculty_id: 204,
        tag_key: 'drone',
        priority: 32_768,
      }],
    },
    {
      name: 'self-link outside the active faculty set',
      links: [{
        primary_faculty_id: 999,
        specialist_faculty_id: 999,
        tag_key: 'drone',
        priority: 100,
      }],
    },
  ])('rejects $name before active-link filtering', async ({ links }) => {
    await expect(supabaseFacultyDependencies(links).loadFacultyCandidates()).rejects.toThrow()
  })

  it('maps only an exact raw complete_assessment row', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ assessment_id: 701, public_id: publicId, created: true }],
      error: null,
    })
    const dependencies = createSupabaseAssessmentCompletionDependencies({ rpc } as never)

    await expect(dependencies.completeAssessment({
      prospectId: 42,
      idempotencyKey,
      campaignId: 17,
      trackScores: { documentary: 6.7, art_photo: 50, commercial: 100, video: 20 },
      environmentScore: 92.3,
      resultSnapshot: {} as never,
      responses: [],
    })).resolves.toEqual({ assessmentId: 701, publicId, created: true })
  })

  it.each([
    {
      name: 'extra RPC field',
      row: { assessment_id: 701, public_id: publicId, created: true, private_detail: 'reject' },
    },
    {
      name: 'wrong RPC field type',
      row: { assessment_id: '701', public_id: publicId, created: true },
    },
    {
      name: 'uppercase public UUID',
      row: { assessment_id: 701, public_id: publicId.toUpperCase(), created: true },
    },
  ])('rejects $name before mapping the RPC result', async ({ row }) => {
    const dependencies = createSupabaseAssessmentCompletionDependencies({
      rpc: vi.fn().mockResolvedValue({ data: [row], error: null }),
    } as never)

    await expect(dependencies.completeAssessment({
      prospectId: 42,
      idempotencyKey,
      campaignId: 17,
      trackScores: { documentary: 6.7, art_photo: 50, commercial: 100, video: 20 },
      environmentScore: 92.3,
      resultSnapshot: {} as never,
      responses: [],
    })).rejects.toThrow()
  })
})

describe('POST /api/assessment/submit', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('accepts only the exact JSON body and returns the private exact success envelope', async () => {
    const revision = await createAssessmentCatalogRevision(catalog())
    const submitAssessment = vi.fn(async () => ({ publicId }))
    const handler = createSubmit({ submitAssessment })
    const event = {
      rawBody: JSON.stringify(envelope(revision)),
      headers: {} as Record<string, string>,
      status: undefined as number | undefined,
    }

    const response = await handler(event)

    expect(submitAssessment).toHaveBeenCalledWith(envelope(revision), context)
    expect(response).toEqual({ data: { publicId }, requestId })
    expect(event.status).toBeUndefined()
    expect(event.headers['cache-control']).toBe('private, no-store')
  })

  it.each([
    ['auth', new AppError('AUTH_FAILED'), 401, 'AUTH_FAILED'],
    ['rate', new AppError('RATE_LIMITED'), 429, 'RATE_LIMITED'],
    ['content', new Error('FACULTY_CONTENT_NOT_READY: internal faculty row'), 500, 'INTERNAL_ERROR'],
  ])('sanitizes %s failures', async (_name, error, status, code) => {
    const handler = createSubmit({ submitAssessment: async () => { throw error } })
    const event = { rawBody: '{}', headers: {} as Record<string, string>, status: undefined as number | undefined }

    const response = await handler(event)

    expect(event.status).toBe(status)
    expect(response).toEqual({
      error: { code, message: expect.any(String) },
      requestId,
    })
    expect(JSON.stringify(response)).not.toMatch(/FACULTY_CONTENT_NOT_READY|internal faculty row/u)
  })

  it('enforces JSON and the 8192-byte UTF-8 limit before calling the service', async () => {
    const submitAssessment = vi.fn(async () => ({ publicId }))
    const oversized = JSON.stringify({ padding: '한'.repeat(2_800) })
    expect(oversized.length).toBeLessThan(8_192)
    expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(8_192)

    for (const handler of [
      createSubmit({ submitAssessment }, { getContentType: () => 'text/plain' }),
      createSubmit({ submitAssessment }),
      createSubmit({ submitAssessment }, {
        readRawBody: async () => { throw new RequestBodyLimitError() },
      }),
    ]) {
      const event = { rawBody: oversized, headers: {} as Record<string, string>, status: undefined as number | undefined }
      const response = await handler(event)
      expect(event.status).toBe(422)
      expect(response).toEqual({
        error: { code: 'ASSESSMENT_INVALID', message: expect.any(String) },
        requestId,
      })
    }
    expect(submitAssessment).not.toHaveBeenCalled()
  })
})
