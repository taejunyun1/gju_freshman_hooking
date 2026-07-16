import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAdminFacultyDetailHandler } from '../../../server/api/admin/faculty/[id].get'
import { createPreviewAdminFacultyHandler } from '../../../server/api/admin/faculty/[id]/preview.post'
import { createPublishAdminFacultyHandler } from '../../../server/api/admin/faculty/[id]/publish.post'
import { createUpdateAdminFacultyHandler } from '../../../server/api/admin/faculty/[id].put'
import { createAdminFacultyListHandler } from '../../../server/api/admin/faculty/index.get'
import {
  createAdminFacultyService,
  createSupabaseAdminFacultyDependencies,
  decodeAdminFacultyRow,
  encodeAdminFacultyCursor,
  parseAdminFacultyJsonBody,
  parseAdminFacultyListQuery,
  parseAdminFacultyUpdate,
  type AdminFacultyServiceDependencies,
} from '../../../server/modules/admin/faculty'
import { AppError, FacultyConflictError } from '../../../server/utils/app-error'
import { RequestBodyLimitError } from '../../../server/utils/bounded-request-body'
import { recommendFaculty as productionRecommendFaculty } from '../../../server/modules/matching/faculty'
import { createBodyGuardWorker } from '../../../cloudflare/request-body-guard.mjs'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestId = '77777777-7777-4777-8777-777777777777'
const admin = {
  aal: 'aal2' as const,
  authenticatedAt: new Date('2026-07-15T01:00:00.000Z'),
  role: 'admin' as const,
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}
const createdAt = '2026-07-14T01:00:00.000000Z'
const updatedAt = '2026-07-15T02:00:00.123456Z'

const visibility = (overrides: Record<string, unknown> = {}) => ({
  office: 'admin_only',
  phone: 'hidden',
  email: 'admin_only',
  website: 'public',
  ...overrides,
})

const profileSections = () => ({
  recommendationRole: '예술·영상·AI·전시·개인창작 총괄',
  education: ['중앙대학교 사진학과'],
  careers: ['광주비엔날레 참여'],
  teachingFields: ['예술사진', '영상촬영'],
  studentProjects: ['AI 이미지·영상 프로젝트'],
  careerPaths: ['미디어아티스트'],
  institutionProjects: [],
  majorWorks: ['Spaceless'],
})

const tags = () => [
  { key: 'art_photo', label: '예술사진', category: 'track' as const, weight: 3, isPrimary: true },
  { key: 'video', label: '영상과 기술(AI·편집·드론)', category: 'track' as const, weight: 3, isPrimary: false },
  { key: 'ai', label: 'AI 이미지·영상', category: 'activity' as const, weight: 3, isPrimary: true },
  { key: 'narrative', label: '내러티브 영상', category: 'activity' as const, weight: 3, isPrimary: false },
  { key: 'exhibition', label: '전시 프로젝트', category: 'result' as const, weight: 2, isPrimary: true },
]

const facultyWrite = (overrides: Record<string, unknown> = {}) => ({
  name: '윤태준',
  title: '교수',
  employmentType: 'full_time' as const,
  consultationRole: 'primary' as const,
  office: '행정관 8층 12호',
  phone: '062-670-2338',
  email: 'tjyun@gwangju.ac.kr',
  website: 'https://www.taejunyun.com',
  contactVisibility: visibility(),
  expertiseSummary: '현대예술·예술사진·영상·AI·기술적 이미지',
  bio: '사진, 영상, 설치와 생성형 AI를 기반으로 동시대 시각예술을 연구합니다.',
  profileSections: profileSections(),
  weeklyCapacity: 10,
  priority: 20,
  sourceDate: '2026-07-14',
  lastVerifiedAt: '2026-07-14T09:00:00+09:00',
  imagePath: null,
  tags: tags(),
  specialistLinks: [],
  ...overrides,
})

const specialistWrite = (overrides: Record<string, unknown> = {}) => ({
  ...facultyWrite(),
  name: '박재웅',
  title: '겸임교수',
  employmentType: 'practitioner' as const,
  consultationRole: 'specialist' as const,
  expertiseSummary: '영상콘텐츠·드론·VR·360 영상',
  weeklyCapacity: 0,
  tags: [{ key: 'drone', label: '드론촬영', category: 'specialist' as const, weight: 3, isPrimary: true }],
  specialistLinks: [{ primaryFacultyId: 1, tagKey: 'drone', priority: 100, explanationTemplate: '드론 실무 연계' }],
  ...overrides,
})

const storedFaculty = (overrides: Record<string, unknown> = {}) => ({
  id: 2,
  ...facultyWrite(),
  status: 'draft' as const,
  createdAt,
  updatedAt,
  openAssignedCount: 1,
  ...overrides,
})

const storedFacultyListItem = (overrides: Record<string, unknown> = {}) => {
  const faculty = storedFaculty(overrides)
  return {
    id: faculty.id,
    name: faculty.name,
    title: faculty.title,
    employmentType: faculty.employmentType,
    consultationRole: faculty.consultationRole,
    status: faculty.status,
    weeklyCapacity: faculty.weeklyCapacity,
    openAssignedCount: faculty.openAssignedCount,
    lastVerifiedAt: faculty.lastVerifiedAt,
    primaryTags: faculty.tags.filter(tag => tag.isPrimary),
    updatedAt: faculty.updatedAt,
  }
}

const rawFacultyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 2,
  name: '윤태준',
  title: '교수',
  employment_type: 'full_time',
  consultation_role: 'primary',
  office: '행정관 8층 12호',
  phone: '062-670-2338',
  email: 'tjyun@gwangju.ac.kr',
  website: 'https://www.taejunyun.com',
  contact_visibility: visibility(),
  expertise_summary: '현대예술·예술사진·영상·AI·기술적 이미지',
  bio: '사진, 영상, 설치와 생성형 AI를 기반으로 동시대 시각예술을 연구합니다.',
  profile_sections: profileSections(),
  status: 'draft',
  weekly_capacity: 10,
  priority: 20,
  source_date: '2026-07-14',
  last_verified_at: '2026-07-14T00:00:00.000000Z',
  image_path: null,
  created_at: createdAt,
  updated_at: updatedAt,
  faculty_tags: tags().map(tag => ({
    tag_key: tag.key,
    tag_label: tag.label,
    category: tag.category,
    weight: tag.weight,
    is_primary: tag.isPrimary,
  })),
  faculty_specialist_links: [],
  counseling_requests: [{ status: 'assigned' }, { status: 'completed' }],
  ...overrides,
})

const primary = (id: number, name: string, tagKey: 'documentary' | 'art_photo' = 'documentary') => storedFaculty({
  id,
  name,
  expertiseSummary: tagKey === 'documentary' ? '다큐멘터리·기록' : '예술사진·영상·AI·기술적 이미지',
  status: 'active',
  tags: [
    { key: tagKey, label: tagKey === 'documentary' ? '다큐멘터리 사진' : '예술사진', category: 'track', weight: 3, isPrimary: true },
    { key: 'social', label: '사회 기록', category: 'activity', weight: 2, isPrimary: true },
    { key: 'local_record', label: '지역 기록', category: 'activity', weight: 2, isPrimary: false },
    { key: 'photo_story', label: '포토스토리', category: 'result', weight: 2, isPrimary: true },
  ],
})

const specialist = (id: number, name: string, keys: string[]) => storedFaculty({
  id,
  name,
  title: '겸임교수',
  employmentType: 'practitioner',
  consultationRole: 'specialist',
  expertiseSummary: `${keys.join('·')} 전문`,
  status: 'active',
  weeklyCapacity: 0,
  tags: keys.map((key, index) => ({ key, label: key, category: 'specialist', weight: 3, isPrimary: index === 0 })),
  specialistLinks: keys.map((key, index) => ({
    primaryFacultyId: key === 'commercial' ? null : 2,
    tagKey: key,
    priority: 100 - index,
    explanationTemplate: `${key} 실무 연계`,
  })),
})

const deps = (overrides: Partial<AdminFacultyServiceDependencies> = {}): AdminFacultyServiceDependencies => ({
  listFaculty: vi.fn(async () => [storedFacultyListItem()]),
  loadFaculty: vi.fn(async () => storedFaculty()),
  listRecommendationFaculty: vi.fn(async () => [
    primary(1, '조대연'),
    primary(2, '윤태준', 'art_photo'),
    primary(3, '김사라'),
    specialist(4, '박재웅', ['video', 'drone']),
    specialist(6, '곽동욱', ['commercial', 'fashion', 'product', 'brand', 'studio', 'lighting']),
  ]),
  updateFaculty: vi.fn(async input => ({ kind: 'updated' as const, faculty: storedFaculty({ ...input.faculty, updatedAt }) })),
  publishFaculty: vi.fn(async () => ({ kind: 'updated' as const, faculty: storedFaculty({ status: 'active' }) })),
  recommendFaculty: vi.fn(() => ({
    primary: { role: 'primary', id: 2, name: '윤태준', title: '교수', expertise: '예술사진·영상·AI·기술적 이미지', reason: '추천 총괄교수입니다.', publicContacts: { website: 'https://www.taejunyun.com' } },
    backup: { role: 'backup', id: 1, name: '조대연', title: '교수', expertise: '다큐멘터리', reason: '예비 상담교수로 추천합니다.', publicContacts: {} },
    specialists: [],
    facultyFit: 90,
  })),
  now: () => new Date('2026-07-16T00:00:00.000Z'),
  ...overrides,
})

const event = () => ({ headers: {} as Record<string, string>, status: undefined as number | undefined })
const responseDeps = (target: ReturnType<typeof event>) => ({
  getRequestId: () => requestId,
  setHeader: (_event: unknown, name: string, value: string) => { target.headers[name] = value },
  setStatus: (_event: unknown, status: number) => { target.status = status },
})
const jsonDeps = (body: unknown) => ({
  getContentType: () => 'application/json',
  readRawBody: async () => JSON.stringify(body),
})

describe('administrator faculty reads', () => {
  beforeEach(() => vi.stubGlobal('defineEventHandler', (handler: unknown) => handler))

  it('requires an AAL2 admin and returns a strict summary list with a canonical cursor', async () => {
    const listFaculty = vi.fn(async () => [
      storedFacultyListItem({ id: 6, name: '곽동욱' }),
      storedFacultyListItem({ id: 5, name: '정철호' }),
      storedFacultyListItem({ id: 4, name: '박재웅', updatedAt: '2026-07-14T02:00:00.000000Z' }),
    ])
    const target = event()
    const requireAdmin = vi.fn(async () => admin)
    const handler = createAdminFacultyListHandler({
      faculty: createAdminFacultyService(deps({ listFaculty })),
      getQuery: () => ({ query: '윤', employmentType: 'full_time', consultationRole: 'primary', status: 'draft', tag: 'art_photo', limit: '2' }),
      requireAdmin,
      ...responseDeps(target),
    })

    const response = await handler(target)

    expect(requireAdmin).toHaveBeenCalledWith(target)
    expect(listFaculty).toHaveBeenCalledWith(expect.objectContaining({ limit: 3, tag: 'art_photo' }))
    expect(target.headers).toEqual({
      'cache-control': 'private, no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response).toMatchObject({ data: { items: [{ id: 6 }, { id: 5 }] } })
    if (!('data' in response)) throw new Error('expected data')
    expect(response.data.items[0]).not.toHaveProperty('phone')
    expect(response.data.nextCursor).toBe(encodeAdminFacultyCursor({ updatedAt, id: 5 }))
  })

  it('returns raw contacts only from the strict administrator detail DTO', async () => {
    const target = event()
    const handler = createAdminFacultyDetailHandler({
      faculty: createAdminFacultyService(deps()),
      getParam: () => '2',
      requireAdmin: async () => admin,
      ...responseDeps(target),
    })
    const response = await handler(target)
    expect(response).toMatchObject({ data: { faculty: {
      id: 2,
      phone: '062-670-2338',
      email: 'tjyun@gwangju.ac.kr',
      contactVisibility: { phone: 'hidden' },
    } } })
  })

  it('fails closed on unexpected store columns and relation values', () => {
    expect(() => decodeAdminFacultyRow({ ...rawFacultyRow(), leaked_secret: 'no' }))
      .toThrow('ADMIN_FACULTY_STORE_INVALID')
    expect(decodeAdminFacultyRow(rawFacultyRow({ faculty_tags: [] }))).toMatchObject({ tags: [] })
    expect(decodeAdminFacultyRow(rawFacultyRow({ bio: '첫 문단입니다.\n\n둘째 문단입니다.' })))
      .toMatchObject({ bio: '첫 문단입니다.\n\n둘째 문단입니다.' })
    const seededStyleBio = '첫 문단입니다.\n\n둘째 문단입니다.\n세 번째 줄입니다.'
    expect(parseAdminFacultyUpdate({
      expectedUpdatedAt: updatedAt,
      faculty: facultyWrite({ bio: seededStyleBio }),
    }).faculty.bio).toBe(seededStyleBio)
    for (const unsafeBio of [
      '첫 문단\r둘째 문단',
      '첫 문단\t둘째 문단',
      '첫 문단\u0000둘째 문단',
      '첫 문단\u0085둘째 문단',
      '첫 문단\uD800둘째 문단',
    ]) {
      expect(() => parseAdminFacultyUpdate({
        expectedUpdatedAt: updatedAt,
        faculty: facultyWrite({ bio: unsafeBio }),
      })).toThrow('FACULTY_INVALID')
    }
    expect(() => decodeAdminFacultyRow(rawFacultyRow({ faculty_tags: [{
      tag_key: 'art_photo', tag_label: '예술사진', category: null, weight: 3, is_primary: true,
    }] }))).toThrow('ADMIN_FACULTY_STORE_INVALID')
    expect(() => decodeAdminFacultyRow(rawFacultyRow({ counseling_requests: [{ status: 'unknown' }] })))
      .toThrow('ADMIN_FACULTY_STORE_INVALID')
  })

  it('uses SELECT-only queries, escapes text filters, and preserves identical timestamp pagination', async () => {
    const calls = { from: [] as string[], select: [] as string[], or: [] as string[], rpc: [] as string[] }
    const query = {
      eq: () => query,
      limit: () => query,
      or: (value: string) => { calls.or.push(value); return query },
      order: () => query,
      select: (value: string) => { calls.select.push(value); return query },
      then: <T>(resolve: (value: { data: unknown[], error: null }) => T | PromiseLike<T>) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    const client = {
      from: vi.fn((table: string) => { calls.from.push(table); return query }),
      rpc: vi.fn((name: string) => { calls.rpc.push(name); return Promise.resolve({ data: null, error: null }) }),
    } as never
    const adapter = createSupabaseAdminFacultyDependencies(client)
    await adapter.listFaculty({ query: '윤%,_"', cursor: { updatedAt, id: 7 }, limit: 21 })

    expect(calls.from).toEqual(['faculty'])
    expect(calls.rpc).toEqual([])
    expect(calls.select[0]).not.toContain('*')
    expect(calls.select[0]).not.toMatch(/phone|email|office|website|bio/u)
    expect(calls.or).toContain('updated_at.lt.2026-07-15T02:00:00.123456Z,and(updated_at.eq.2026-07-15T02:00:00.123456Z,id.lt.7)')
    expect(calls.or[0]).toContain('name.ilike."%윤\\%,\\_\\"%"')
  })

  it('accepts only a canonical updatedAt/id cursor and exact supported filters', () => {
    const cursor = encodeAdminFacultyCursor({ updatedAt, id: 7 })
    expect(parseAdminFacultyListQuery({ cursor, limit: '20' })).toMatchObject({
      cursor: { updatedAt, id: 7 }, limit: 20,
    })
    const extra = Buffer.from(JSON.stringify({ updatedAt, id: 7, extra: true })).toString('base64url')
    for (const invalid of ['', `${cursor}=`, extra, '***']) {
      expect(() => parseAdminFacultyListQuery({ cursor: invalid, limit: '20' })).toThrow('FACULTY_INVALID')
    }
    expect(() => parseAdminFacultyListQuery({ limit: '20', unknown: 'x' })).toThrow('FACULTY_INVALID')
  })
})

describe('administrator faculty writes', () => {
  it.each([
    ['/api/admin/faculty/2', 'PUT', 256 * 1024],
    ['/api/admin/faculty/2/preview', 'POST', 256 * 1024],
    ['/api/admin/faculty/2/publish', 'POST', 1024],
  ] as const)('bounds the Cloudflare request before Nitro for %s', async (path, method, maximum) => {
    const cancelled = vi.fn()
    const pull = vi.fn()
    const request = new Request(`https://photo-next.example${path}`, {
      body: new ReadableStream<Uint8Array>({ cancel: cancelled, pull }),
      duplex: 'half',
      headers: { 'content-length': String(maximum + 1), 'content-type': 'application/json' },
      method,
    } as RequestInit)
    const forwarded: Array<{ bytes: number, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(guarded: Request) {
        forwarded.push({
          bytes: (await guarded.arrayBuffer()).byteLength,
          marker: guarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(pull).not.toHaveBeenCalled()
    expect(cancelled).toHaveBeenCalledOnce()
    expect(forwarded).toEqual([{ bytes: 2, marker: '1' }])
  })

  it('accepts exact JSON media types and rejects unknown charset, oversized, and malformed bodies', async () => {
    await expect(parseAdminFacultyJsonBody('application/json', '{}')).resolves.toEqual({})
    await expect(parseAdminFacultyJsonBody('Application/JSON; Charset=UTF-8', '{}')).resolves.toEqual({})
    await expect(parseAdminFacultyJsonBody('application/json; charset=utf-8; x=y', '{}')).rejects.toMatchObject({ code: 'FACULTY_INVALID' })
    await expect(parseAdminFacultyJsonBody('application/jsonp', '{}')).rejects.toMatchObject({ code: 'FACULTY_INVALID' })
    await expect(parseAdminFacultyJsonBody('application/json', '{')).rejects.toMatchObject({ code: 'FACULTY_INVALID' })
    await expect(parseAdminFacultyJsonBody('application/json', `{"x":"${'가'.repeat(100_000)}"}`)).rejects.toMatchObject({ code: 'FACULTY_INVALID' })
  })

  it('preserves PostgreSQL microseconds and rejects timestamps with unsupported precision', () => {
    expect(parseAdminFacultyUpdate({ expectedUpdatedAt: updatedAt, faculty: facultyWrite() }).expectedUpdatedAt)
      .toBe(updatedAt)
    expect(() => parseAdminFacultyUpdate({
      expectedUpdatedAt: '2026-07-15T02:00:00.1234567Z', faculty: facultyWrite(),
    })).toThrow('FACULTY_INVALID')
  })

  it('authenticates before reading update bodies and sends only the exact write contract', async () => {
    const target = event()
    const order: string[] = []
    const update = vi.fn(async () => ({ faculty: storedFaculty() }))
    const handler = createUpdateAdminFacultyHandler({
      faculty: { update },
      getContentType: () => 'application/json',
      getParam: () => '2',
      readRawBody: async () => { order.push('body'); return JSON.stringify({ expectedUpdatedAt: updatedAt, faculty: facultyWrite() }) },
      requireAdmin: async () => { order.push('auth'); return admin },
      ...responseDeps(target),
    })
    const response = await handler(target)

    expect(order).toEqual(['auth', 'body'])
    expect(update).toHaveBeenCalledWith(2, { expectedUpdatedAt: updatedAt, faculty: facultyWrite() }, { adminUserId: admin.userId, requestId })
    expect(response).toMatchObject({ data: { faculty: { id: 2 } } })
  })

  it('does not read an update body when authentication fails and keeps no-store on the error', async () => {
    const target = event()
    const readRawBody = vi.fn(async () => JSON.stringify({}))
    const handler = createUpdateAdminFacultyHandler({
      faculty: { update: vi.fn() },
      getContentType: () => 'application/json',
      getParam: () => '2',
      readRawBody,
      requireAdmin: async () => { throw new AppError('MFA_REQUIRED') },
      ...responseDeps(target),
    })
    const response = await handler(target)
    expect(readRawBody).not.toHaveBeenCalled()
    expect(response).toMatchObject({ error: { code: 'MFA_REQUIRED' } })
    expect(target.headers['cache-control']).toBe('private, no-store')
  })

  it('authenticates preview and publish before either request body is read', async () => {
    for (const build of [createPreviewAdminFacultyHandler, createPublishAdminFacultyHandler]) {
      const target = event()
      const readRawBody = vi.fn(async () => JSON.stringify({}))
      const handler = build({
        faculty: { preview: vi.fn(), publish: vi.fn() } as never,
        getContentType: () => 'application/json',
        getParam: () => '2',
        readRawBody,
        requireAdmin: async () => { throw new AppError('MFA_REQUIRED') },
        ...responseDeps(target),
      })
      const response = await handler(target)
      expect(readRawBody).not.toHaveBeenCalled()
      expect(response).toMatchObject({ error: { code: 'MFA_REQUIRED' } })
      expect(target.headers['cache-control']).toBe('private, no-store')
    }
  })

  it('rejects role, taxonomy, duplicate primary, link ownership, Yoon scope, and unknown keys', async () => {
    const service = createAdminFacultyService(deps())
    const invalid = [
      facultyWrite({ consultationRole: 'specialist' }),
      facultyWrite({ tags: [{ key: 'documentary', label: '다큐멘터리', category: 'track', weight: 3, isPrimary: true }] }),
      facultyWrite({ tags: [...tags(), { key: 'video', label: '영상', category: 'activity', weight: 2, isPrimary: true }] }),
      facultyWrite({ specialistLinks: [{ primaryFacultyId: 1, tagKey: 'drone', priority: 1, explanationTemplate: '드론 연계' }] }),
      facultyWrite({ expertiseSummary: '예술사진과 영상' }),
      { ...facultyWrite(), unexpected: true },
    ]
    for (const faculty of invalid) {
      await expect(service.update(2, { expectedUpdatedAt: updatedAt, faculty } as never, { adminUserId: admin.userId, requestId }))
        .rejects.toBeInstanceOf(AppError)
    }
  })

  it('uses RPC-only mutation and maps an optimistic conflict to a strict current administrator DTO', async () => {
    const calls: Array<{ name: string, args: unknown }> = []
    const current = rawFacultyRow({ updated_at: '2026-07-15T02:00:00.123457Z' })
    const singleQuery = {
      eq: () => singleQuery,
      maybeSingle: async () => ({ data: current, error: null }),
      select: () => singleQuery,
    }
    const client = {
      from: vi.fn(() => singleQuery),
      rpc: vi.fn(async (name: string, args: unknown) => {
        calls.push({ name, args })
        return { data: { status: 'conflict', facultyUpdatedAt: '2026-07-15T02:00:00.123457Z' }, error: null }
      }),
    } as never
    const service = createAdminFacultyService({
      ...deps(),
      ...createSupabaseAdminFacultyDependencies(client),
      recommendFaculty: deps().recommendFaculty,
      now: deps().now,
    })

    await expect(service.update(2, { expectedUpdatedAt: updatedAt, faculty: facultyWrite() }, { adminUserId: admin.userId, requestId }))
      .rejects.toMatchObject({ code: 'FACULTY_CONFLICT', current: { updatedAt: '2026-07-15T02:00:00.123457Z' } })
    expect(calls).toEqual([{ name: 'update_admin_faculty', args: expect.objectContaining({
      p_expected_updated_at: updatedAt,
      p_faculty_id: 2,
      p_admin_user_id: admin.userId,
      p_request_id: requestId,
    }) }])
    expect(client.from).toHaveBeenCalledWith('faculty')
  })

  it('returns only the stable conflict message and strict current payload, never database text', async () => {
    const target = event()
    const current = storedFaculty({ updatedAt: '2026-07-15T02:00:00.123457Z' })
    const handler = createUpdateAdminFacultyHandler({
      faculty: { update: vi.fn(async () => { throw new FacultyConflictError(current) }) },
      getContentType: () => 'application/json',
      getParam: () => '2',
      readRawBody: async () => JSON.stringify({ expectedUpdatedAt: updatedAt, faculty: facultyWrite() }),
      requireAdmin: async () => admin,
      ...responseDeps(target),
    })
    const response = await handler(target)
    expect(response).toMatchObject({
      error: {
        code: 'FACULTY_CONFLICT',
        message: '교수진 정보가 이미 변경되었습니다. 최신 내용을 확인해 주세요.',
        current: { id: 2, updatedAt: '2026-07-15T02:00:00.123457Z' },
      },
    })
    expect(JSON.stringify(response)).not.toMatch(/duplicate key|sqlstate|details|hint|stack/iu)
  })

  it.each([
    'FACULTY_STATUS_INVALID', 'FACULTY_ROLE_INVALID', 'FACULTY_CAPACITY_REQUIRED', 'CONTACT_VERIFICATION_REQUIRED',
    'FACULTY_SPECIALIST_TAG_REQUIRED', 'FACULTY_TAG_INVALID', 'FACULTY_LINK_INVALID',
    'FACULTY_TAXONOMY_INVALID', 'FACULTY_YOON_SCOPE_REQUIRED',
  ] as const)('preserves the stable database invariant code %s', async (code) => {
    const service = createAdminFacultyService(deps({
      publishFaculty: vi.fn(async () => { throw new AppError(code) }),
    }))
    await expect(service.publish(2, updatedAt, { adminUserId: admin.userId, requestId }))
      .rejects.toMatchObject({ code })
  })

  it('uses a 1 KiB bounded body for publish and returns validation errors without reading twice', async () => {
    const target = event()
    const readRawBody = vi.fn(async () => { throw new RequestBodyLimitError() })
    const handler = createPublishAdminFacultyHandler({
      faculty: { publish: vi.fn() },
      getContentType: () => 'application/json',
      getParam: () => '2',
      readRawBody,
      requireAdmin: async () => admin,
      ...responseDeps(target),
    })
    const response = await handler(target)
    expect(readRawBody).toHaveBeenCalledTimes(1)
    expect(response).toMatchObject({ error: { code: 'FACULTY_INVALID' } })
  })
})

describe('administrator faculty production preview', () => {
  it('candidate/link 입력 순서와 비활성 후보에 관계없이 production preview가 byte-equivalent하다', async () => {
    const jo = storedFaculty({
      id: 1, name: '조대연', status: 'active', priority: 30,
      expertiseSummary: '포토커뮤니케이션·다큐멘터리·시각커뮤니케이션',
      tags: [
        { key: 'documentary', label: '다큐멘터리 사진', category: 'track', weight: 3, isPrimary: true },
        { key: 'social', label: '사회와 사람의 기록', category: 'activity', weight: 3, isPrimary: true },
        { key: 'photo_story', label: '포토스토리', category: 'result', weight: 3, isPrimary: true },
      ],
    })
    const yoon = storedFaculty({ id: 2, status: 'active' })
    const kim = storedFaculty({
      id: 3, name: '김사라', status: 'active', priority: 25,
      expertiseSummary: '다큐멘터리·지역기록·사진아카이브',
      tags: [
        { key: 'documentary', label: '다큐멘터리 사진', category: 'track', weight: 3, isPrimary: true },
        { key: 'local_record', label: '지역문화 기록', category: 'activity', weight: 3, isPrimary: true },
        { key: 'field_research', label: '현장조사', category: 'activity', weight: 3, isPrimary: false },
        { key: 'archive', label: '사진 아카이브', category: 'result', weight: 3, isPrimary: true },
      ],
    })
    const park = specialist(4, '박재웅', ['video', 'drone'])
    const kwak = specialist(6, '곽동욱', ['commercial', 'fashion', 'product', 'brand', 'studio', 'lighting'])
    const archivedPrimary = { ...jo, id: 7, name: '보관 총괄', status: 'archived' as const, priority: 32_767 }
    const draftSpecialist = { ...kwak, id: 8, name: '초안 전문', status: 'draft' as const, priority: 32_767 }
    const candidates = [jo, yoon, kim, park, kwak, archivedPrimary, draftSpecialist]
    const previewWith = async (ordered: typeof candidates) => createAdminFacultyService(deps({
      loadFaculty: vi.fn(async () => yoon),
      listRecommendationFaculty: vi.fn(async () => ordered),
      recommendFaculty: productionRecommendFaculty,
    })).preview(2, facultyWrite())

    const normal = await previewWith(candidates)
    const reversed = await previewWith([...candidates].reverse())

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(normal))
    const outputIds = normal.scenarios.flatMap(({ recommendation }) => [
      recommendation.primary.id,
      recommendation.backup.id,
      ...recommendation.specialists.map(person => person.id),
    ])
    expect(outputIds).not.toContain(7)
    expect(outputIds).not.toContain(8)
  })

  it.each([
    {
      label: '전문교원 용량이 0이 아님',
      current: storedFaculty({ id: 4, ...specialistWrite(), status: 'draft' }),
      faculty: specialistWrite({ weeklyCapacity: 1 }),
      code: 'FACULTY_CAPACITY_REQUIRED',
    },
    {
      label: '전문 태그의 가중치가 모두 0',
      current: storedFaculty({ id: 4, ...specialistWrite(), status: 'draft' }),
      faculty: specialistWrite({
        tags: [{ key: 'drone', label: '드론촬영', category: 'specialist', weight: 0, isPrimary: true }],
      }),
      code: 'FACULTY_SPECIALIST_TAG_REQUIRED',
    },
    {
      label: '자기 자신을 총괄교수로 연결',
      current: storedFaculty({ id: 2, status: 'active' }),
      faculty: specialistWrite({
        specialistLinks: [{ primaryFacultyId: 2, tagKey: 'drone', priority: 100, explanationTemplate: '드론 실무 연계' }],
      }),
      code: 'FACULTY_LINK_INVALID',
    },
  ])('recommender 전에 $label을 $code로 거부한다', async ({ current, faculty, code }) => {
    const recommendFaculty = vi.fn(deps().recommendFaculty)
    const service = createAdminFacultyService(deps({
      loadFaculty: vi.fn(async () => current),
      recommendFaculty,
    }))

    await expect(service.preview(current.id, faculty)).rejects.toMatchObject({ code })
    expect(recommendFaculty).not.toHaveBeenCalled()
  })

  it('변경되지 않은 public 연락처는 기존 검증시각을 유지하고 새 공개값은 microsecond 단위로 더 새로우면 허용한다', async () => {
    const current = storedFaculty({ lastVerifiedAt: '2026-07-14T00:00:00.123456Z' })
    const unchangedRecommender = vi.fn(deps().recommendFaculty)
    const unchangedService = createAdminFacultyService(deps({
      loadFaculty: vi.fn(async () => current),
      recommendFaculty: unchangedRecommender,
    }))
    await expect(unchangedService.preview(2, facultyWrite({
      lastVerifiedAt: '2026-07-14T09:00:00.123456+09:00',
    }))).resolves.toHaveProperty('scenarios')
    expect(unchangedRecommender).toHaveBeenCalledTimes(4)

    const changedRecommender = vi.fn(deps().recommendFaculty)
    const changedService = createAdminFacultyService(deps({
      loadFaculty: vi.fn(async () => current),
      recommendFaculty: changedRecommender,
    }))
    await expect(changedService.preview(2, facultyWrite({
      contactVisibility: visibility({ email: 'public' }),
      lastVerifiedAt: '2026-07-14T00:00:00.123457Z',
    }))).resolves.toHaveProperty('scenarios')
    expect(changedRecommender).toHaveBeenCalledTimes(4)
  })

  it('public 값과 visibility가 같아도 제안 검증시각이 현재보다 오래되면 추천 전에 거부한다', async () => {
    const current = storedFaculty({ lastVerifiedAt: '2026-07-14T00:00:00.123456Z' })
    const recommendFaculty = vi.fn(deps().recommendFaculty)
    const service = createAdminFacultyService(deps({
      loadFaculty: vi.fn(async () => current),
      recommendFaculty,
    }))

    await expect(service.preview(2, facultyWrite({
      lastVerifiedAt: '2026-07-14T09:00:00.123455+09:00',
    }))).rejects.toMatchObject({ code: 'CONTACT_VERIFICATION_REQUIRED' })
    expect(recommendFaculty).not.toHaveBeenCalled()
  })

  it('활성 총괄교수로 들어오는 전문 링크가 있으면 역할 변경을 미리보기 전에 거부한다', async () => {
    const current = storedFaculty({ id: 2, status: 'active' })
    const inbound = specialist(4, '박재웅', ['drone'])
    const recommendFaculty = vi.fn(deps().recommendFaculty)
    const service = createAdminFacultyService(deps({
      loadFaculty: vi.fn(async () => current),
      listRecommendationFaculty: vi.fn(async () => [
        primary(1, '조대연'), current, primary(3, '김사라'), inbound,
      ]),
      recommendFaculty,
    }))

    await expect(service.preview(2, specialistWrite({
      specialistLinks: [{ primaryFacultyId: 1, tagKey: 'drone', priority: 100, explanationTemplate: '드론 실무 연계' }],
    }))).rejects.toMatchObject({ code: 'FACULTY_LINK_INVALID' })
    expect(recommendFaculty).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: '새 연락처를 public으로 전환',
      faculty: facultyWrite({ contactVisibility: visibility({ email: 'public' }) }),
    },
    {
      label: '기존 public 연락처 원문을 변경',
      faculty: facultyWrite({ website: 'https://portfolio.taejunyun.com' }),
    },
  ])('$label하면 현재보다 새로운 검증시각 없이는 추천기를 호출하지 않는다', async ({ faculty }) => {
    const current = storedFaculty()
    const recommendFaculty = vi.fn(deps().recommendFaculty)
    const service = createAdminFacultyService(deps({
      loadFaculty: vi.fn(async () => current),
      recommendFaculty,
    }))

    await expect(service.preview(2, faculty)).rejects.toMatchObject({ code: 'CONTACT_VERIFICATION_REQUIRED' })
    expect(recommendFaculty).not.toHaveBeenCalled()
  })

  it('uses the production scorer for social documentary, local archive, video-drone, and commercial-fashion', async () => {
    const jo = storedFaculty({
      id: 1, name: '조대연', status: 'active', priority: 30,
      expertiseSummary: '포토커뮤니케이션·다큐멘터리·시각커뮤니케이션',
      tags: [
        { key: 'documentary', label: '다큐멘터리 사진', category: 'track', weight: 3, isPrimary: true },
        { key: 'social', label: '사회와 사람의 기록', category: 'activity', weight: 3, isPrimary: true },
        { key: 'record', label: '기록', category: 'activity', weight: 3, isPrimary: false },
        { key: 'photo_communication', label: '포토커뮤니케이션', category: 'activity', weight: 3, isPrimary: false },
        { key: 'photo_story', label: '포토스토리', category: 'result', weight: 3, isPrimary: true },
      ],
    })
    const yoon = storedFaculty({ status: 'active' })
    const kim = storedFaculty({
      id: 3, name: '김사라', status: 'active', priority: 25,
      expertiseSummary: '다큐멘터리·지역기록·사진아카이브',
      tags: [
        { key: 'documentary', label: '다큐멘터리 사진', category: 'track', weight: 3, isPrimary: true },
        { key: 'local_record', label: '지역문화 기록', category: 'activity', weight: 3, isPrimary: true },
        { key: 'field_research', label: '현장조사', category: 'activity', weight: 3, isPrimary: false },
        { key: 'public_institution', label: '공공기관 프로젝트', category: 'activity', weight: 3, isPrimary: false },
        { key: 'archive', label: '사진 아카이브', category: 'result', weight: 3, isPrimary: true },
      ],
    })
    const park = specialist(4, '박재웅', ['video', 'drone'])
    const kwak = specialist(6, '곽동욱', ['commercial', 'fashion', 'product', 'brand', 'studio', 'lighting'])
    const candidates = [jo, yoon, kim, park, kwak]
    const service = createAdminFacultyService(deps({
      loadFaculty: vi.fn(async () => yoon),
      listRecommendationFaculty: vi.fn(async () => candidates),
      recommendFaculty: productionRecommendFaculty,
    }))

    const preview = await service.preview(2, facultyWrite())

    expect(preview.scenarios[0]!.recommendation.primary.name).toBe('조대연')
    expect(preview.scenarios[1]!.recommendation.primary.name).toBe('김사라')
    expect(preview.scenarios[2]!.recommendation.primary.name).toBe('윤태준')
    expect(preview.scenarios[2]!.recommendation.specialists.map(person => person.name)).toContain('박재웅')
    expect(preview.scenarios[3]!.recommendation.specialists.map(person => person.name)).toContain('곽동욱')
  })

  it('does not mutate, overlays the target, and invokes the recommender exactly once for each fixed scenario', async () => {
    const recommendFaculty = deps().recommendFaculty as ReturnType<typeof vi.fn>
    const dependencies = deps({ recommendFaculty })
    const service = createAdminFacultyService(dependencies)
    const result = await service.preview(2, facultyWrite())

    expect(result.scenarios.map(scenario => scenario.key)).toEqual([
      'social_photo_story', 'local_archive', 'video_drone', 'commercial_fashion',
    ])
    expect(recommendFaculty).toHaveBeenCalledTimes(4)
    expect(dependencies.updateFaculty).not.toHaveBeenCalled()
    expect(dependencies.publishFaculty).not.toHaveBeenCalled()
    const videoCall = recommendFaculty.mock.calls[2]![0]
    expect(videoCall.student).toMatchObject({
      trackScores: { art_photo: 82, video: 96 },
      interestVector: { ai: 0.9, drone: 1 },
      selectedLabels: { ai: 'AI·기술적 이미지' },
    })
    expect(videoCall.faculty.find((faculty: { id: number }) => faculty.id === 2)).toMatchObject({ status: 'active' })
  })

  it('filters each public contact field and never returns visibility, verification, raw hidden contacts, or link explanations', async () => {
    const target = event()
    const handler = createPreviewAdminFacultyHandler({
      faculty: createAdminFacultyService(deps()),
      getContentType: () => 'application/json',
      getParam: () => '2',
      requireAdmin: async () => admin,
      ...jsonDeps({ faculty: facultyWrite() }),
      ...responseDeps(target),
    })
    const response = await handler(target)
    const serialized = JSON.stringify(response)
    expect(serialized).toContain('https://www.taejunyun.com')
    expect(serialized).not.toContain('062-670-2338')
    expect(serialized).not.toContain('tjyun@gwangju.ac.kr')
    expect(serialized).not.toContain('contactVisibility')
    expect(serialized).not.toContain('lastVerifiedAt')
    expect(serialized).not.toContain('explanationTemplate')
  })

  it('returns content-not-ready only for the production not-ready failure and sanitizes all other recommender errors', async () => {
    for (const [message, code] of [
      ['FACULTY_CONTENT_NOT_READY', 'FACULTY_CONTENT_NOT_READY'],
      ['FACULTY_INPUT_INVALID: hidden@example.com', 'INTERNAL_ERROR'],
    ] as const) {
      const service = createAdminFacultyService(deps({ recommendFaculty: () => { throw new Error(message) } }))
      await expect(service.preview(2, facultyWrite())).rejects.toMatchObject({ code })
    }
  })

  it.each([
    facultyWrite({ weeklyCapacity: 0 }),
    facultyWrite({ contactVisibility: visibility({ email: 'public' }), email: null }),
    facultyWrite({ lastVerifiedAt: '2027-01-01T00:00:00Z' }),
  ])('fails preview publication validation before calling the recommender %#', async (faculty) => {
    const recommendFaculty = vi.fn(deps().recommendFaculty)
    const service = createAdminFacultyService(deps({ recommendFaculty }))
    await expect(service.preview(2, faculty as never)).rejects.toBeInstanceOf(AppError)
    expect(recommendFaculty).not.toHaveBeenCalled()
  })
})
