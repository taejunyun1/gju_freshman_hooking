import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAdminStudentDetailHandler } from '../../../server/api/admin/students/[id].get'
import { createRevealAdminStudentPhoneHandler } from '../../../server/api/admin/students/[id]/reveal-phone.post'
import { createAdminStudentsListHandler } from '../../../server/api/admin/students/index.get'
import {
  createAdminStudentsService,
  createSupabaseAdminStudentsDependencies,
  decodeAdminStudentRow,
  encodeAdminStudentsCursor,
  type AdminStudentsServiceDependencies,
} from '../../../server/modules/admin/students'
import { AppError } from '../../../server/utils/app-error'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const traceId = '77777777-7777-4777-8777-777777777777'
const adminUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const resultIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const
const counselingId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const lastActiveAt = '2026-07-15T01:00:00.000Z'
const olderActiveAt = '2026-07-14T01:00:00.000Z'
const createdAt = '2026-07-01T01:00:00.000Z'
const phone = '01012345678'

const admin = {
  aal: 'aal2' as const,
  authenticatedAt: new Date('2026-07-15T01:00:00.000Z'),
  role: 'admin' as const,
  userId: adminUserId,
}

const storedStudent = (overrides: Record<string, unknown> = {}) => ({
  studentId: 42,
  nickname: '선명한프레임42',
  phoneCiphertext: new Uint8Array(16).fill(1),
  phoneIv: new Uint8Array(12).fill(2),
  schoolName: '광주고등학교',
  applicantStage: 'high3',
  region: 'gwangju',
  status: 'active',
  lastActiveAt,
  createdAt,
  ...overrides,
})

const storedResults = () => resultIds.map((publicId, index) => ({
  publicId,
  completedAt: `2026-07-${String(15 - index).padStart(2, '0')}T01:00:00.000Z`,
  campaignId: index === 0 ? 9 : null,
  primaryTrack: index === 0 ? 'commercial' : 'art_photo',
  secondaryTrack: index === 0 ? 'art_photo' : 'documentary',
  trackScores: {
    documentary: 40 + index,
    art_photo: 80 - index,
    commercial: 90 - index,
    video: 30 + index,
  },
}))

const storedCounseling = () => [{
  publicId: counselingId,
  status: 'assigned',
  contactMethod: 'phone',
  availability: 'weekday_afternoon',
  inquiry: '입학 준비 포트폴리오가 궁금해요.',
  assignedFaculty: { id: 202, name: '윤태준', title: '교수' },
  createdAt,
}]

const dependencies = (
  overrides: Partial<AdminStudentsServiceDependencies> = {},
): AdminStudentsServiceDependencies => ({
  decryptPhone: vi.fn(async () => phone),
  hashPhone: vi.fn(async () => new Uint8Array(32).fill(7)),
  listStudents: vi.fn(async () => [storedStudent()]),
  loadStudent: vi.fn(async ({ studentId }: { studentId: number }) => (
    studentId === 42 ? storedStudent() : null
  )),
  listRecentResults: vi.fn(async () => storedResults()),
  listCounselingHistory: vi.fn(async () => storedCounseling()),
  recordSensitiveAccess: vi.fn(async () => undefined),
  ...overrides,
})

const event = () => ({
  headers: {} as Record<string, string>,
  status: undefined as number | undefined,
})

const responseDependencies = (target: ReturnType<typeof event>) => ({
  getRequestId: () => traceId,
  setHeader: (_event: unknown, name: string, value: string) => { target.headers[name] = value },
  setStatus: (_event: unknown, status: number) => { target.status = status },
})

describe('administrator student list', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('requires an active AAL2 administrator and returns a private masked list', async () => {
    const serviceDependencies = dependencies()
    const target = event()
    const requireAdmin = vi.fn(async () => admin)
    const handler = createAdminStudentsListHandler({
      students: createAdminStudentsService(serviceDependencies),
      getQuery: () => ({}),
      requireAdmin,
      ...responseDependencies(target),
    })

    const response = await handler(target)

    expect(requireAdmin).toHaveBeenCalledWith(target)
    expect(serviceDependencies.listStudents).toHaveBeenCalledWith({ limit: 21 })
    expect(target.headers['cache-control']).toBe('private, no-store')
    expect(response).toMatchObject({
      data: {
        items: [{
          id: 42,
          nickname: '선명한프레임42',
          phone: '010-****-5678',
          schoolName: '광주고등학교',
          applicantStage: 'high3',
          region: 'gwangju',
          lastActiveAt,
        }],
        nextCursor: null,
      },
      requestId: traceId,
    })
    expect(JSON.stringify(response)).not.toMatch(/01012345678|phoneCiphertext|phoneIv|phoneHmac|ciphertext|hmac/iu)
  })

  it('uses a stable last_active_at/id cursor without duplicates across tied pages', async () => {
    const listStudents = vi.fn(async (input: { cursor?: { lastActiveAt: string, id: number } }) => (
      input.cursor
        ? [storedStudent({ studentId: 42, lastActiveAt: olderActiveAt })]
        : [
            storedStudent({ studentId: 44 }),
            storedStudent({ studentId: 43 }),
            storedStudent({ studentId: 42, lastActiveAt: olderActiveAt }),
          ]
    ))
    const serviceDependencies = dependencies({ listStudents })
    let query: Record<string, unknown> = { limit: '2' }
    const target = event()
    const handler = createAdminStudentsListHandler({
      students: createAdminStudentsService(serviceDependencies),
      getQuery: () => query,
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })

    const first = await handler(target)
    expect(first).toMatchObject({ data: { items: [{ id: 44 }, { id: 43 }] } })
    if (!('data' in first)) throw new Error('expected first page')
    expect(first.data.nextCursor).toBe(encodeAdminStudentsCursor({ lastActiveAt, id: 43 }))

    query = { cursor: first.data.nextCursor, limit: '2' }
    const second = await handler(target)
    if (!('data' in second)) throw new Error('expected second page')
    expect(second.data.items.map(item => item.id)).toEqual([42])
    expect(new Set([...first.data.items, ...second.data.items].map(item => item.id)).size).toBe(3)
    expect(listStudents).toHaveBeenLastCalledWith({
      cursor: { lastActiveAt, id: 43 },
      limit: 3,
    })
  })

  it('bounds every filter and forwards relation filters to the store', async () => {
    const serviceDependencies = dependencies({ listStudents: vi.fn(async () => []) })
    const target = event()
    const handler = createAdminStudentsListHandler({
      students: createAdminStudentsService(serviceDependencies),
      getQuery: () => ({
        query: '프레임',
        stage: 'high3',
        region: 'gwangju',
        school: '광주고',
        track: 'commercial',
        campaign: '9',
        counselingStatus: 'assigned',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        limit: '20',
      }),
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })

    await handler(target)

    expect(serviceDependencies.listStudents).toHaveBeenCalledWith({
      query: '프레임',
      stage: 'high3',
      region: 'gwangju',
      school: '광주고',
      track: 'commercial',
      campaignId: 9,
      counselingStatus: 'assigned',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      limit: 21,
    })
  })

  it('turns only a canonical full 010 query into an exact HMAC lookup without logging plaintext', async () => {
    const digest = new Uint8Array(32).fill(9)
    const hashPhone = vi.fn(async () => digest)
    const listStudents = vi.fn(async () => [])
    const logSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    ]
    const target = event()
    const handler = createAdminStudentsListHandler({
      students: createAdminStudentsService(dependencies({ hashPhone, listStudents })),
      getQuery: () => ({ query: '010-1234-5678' }),
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })

    await handler(target)

    expect(hashPhone).toHaveBeenCalledWith(phone)
    expect(listStudents).toHaveBeenCalledWith({ phoneHmac: digest, limit: 21 })
    expect(JSON.stringify(listStudents.mock.calls)).not.toContain(phone)
    expect(logSpies.flatMap(spy => spy.mock.calls).join(' ')).not.toContain(phone)
    logSpies.forEach(spy => spy.mockRestore())
  })

  it('escapes text search and applies track, campaign, counseling, and date filters in PostgREST', async () => {
    const calls = {
      eq: [] as Array<[string, unknown]>,
      gte: [] as Array<[string, unknown]>,
      ilike: [] as Array<[string, string]>,
      limit: [] as number[],
      lt: [] as Array<[string, unknown]>,
      lte: [] as Array<[string, unknown]>,
      or: [] as string[],
      order: [] as Array<[string, { ascending?: boolean } | undefined]>,
      select: [] as string[],
    }
    const queryBuilder = {
      eq: (column: string, value: unknown) => { calls.eq.push([column, value]); return queryBuilder },
      gte: (column: string, value: unknown) => { calls.gte.push([column, value]); return queryBuilder },
      ilike: (column: string, value: string) => { calls.ilike.push([column, value]); return queryBuilder },
      limit: (value: number) => { calls.limit.push(value); return queryBuilder },
      lt: (column: string, value: unknown) => { calls.lt.push([column, value]); return queryBuilder },
      lte: (column: string, value: unknown) => { calls.lte.push([column, value]); return queryBuilder },
      or: (value: string) => { calls.or.push(value); return queryBuilder },
      order: (column: string, options?: { ascending?: boolean }) => {
        calls.order.push([column, options]); return queryBuilder
      },
      select: (selection: string) => { calls.select.push(selection); return queryBuilder },
      then: <Result>(resolve: (value: { data: unknown[], error: null }) => Result | PromiseLike<Result>) => (
        Promise.resolve({ data: [], error: null }).then(resolve)
      ),
    }
    const client = { from: vi.fn(() => queryBuilder) } as unknown as SupabaseClient
    const adapter = createSupabaseAdminStudentsDependencies(client, {
      decryptPhone: async () => phone,
      hashPhone: async () => new Uint8Array(32).fill(7),
    })

    await adapter.listStudents({
      query: '빛%_\\프레임',
      school: '광주%_\\고',
      stage: 'high3',
      region: 'gwangju',
      track: 'commercial',
      campaignId: 9,
      counselingStatus: 'assigned',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      cursor: { lastActiveAt, id: 43 },
      limit: 21,
    })

    expect(client.from).toHaveBeenCalledWith('prospects')
    expect(calls.eq).toEqual(expect.arrayContaining([
      ['status', 'active'],
      ['applicant_stage', 'high3'],
      ['region', 'gwangju'],
      ['assessments.status', 'completed'],
      ['assessments.result_snapshot->rankedTracks->>0', 'commercial'],
      ['assessments.campaign_id', 9],
      ['counseling_requests.status', 'assigned'],
    ]))
    expect(calls.gte).toContainEqual(['assessments.completed_at', '2026-06-30T15:00:00.000Z'])
    expect(calls.lt).toContainEqual(['assessments.completed_at', '2026-07-31T15:00:00.000Z'])
    expect(calls.lte).toEqual([])
    expect('2026-07-31T14:59:59.999500Z' < String(calls.lt[0]?.[1])).toBe(true)
    expect(calls.or).toContain(
      'nickname.ilike."%빛\\\\%\\\\_\\\\\\\\프레임%",school_name.ilike."%빛\\\\%\\\\_\\\\\\\\프레임%"',
    )
    expect(calls.ilike).toContainEqual(['school_name', '%광주\\%\\_\\\\고%'])
    expect(calls.or).toContain(
      `last_active_at.lt.${lastActiveAt},and(last_active_at.eq.${lastActiveAt},id.lt.43)`,
    )
    expect(calls.order).toEqual([
      ['last_active_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(calls.limit).toEqual([21])
    const projection = calls.select.join(',').replace(/\s+/gu, '')
    expect(projection).toContain('assessments!inner')
    expect(projection).toContain('counseling_requests!inner')
    expect(projection).not.toMatch(/phone_hmac|student_credentials|student_sessions|password_hash|token_hash/iu)
  })

  it('rejects malformed cursors, unbounded filters, arrays, controls, and unknown keys before store access', async () => {
    const listStudents = vi.fn(async () => [])
    const target = event()
    const handlerFor = (rawQuery: Record<string, unknown>) => createAdminStudentsListHandler({
      students: createAdminStudentsService(dependencies({ listStudents })),
      getQuery: () => rawQuery,
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })

    for (const rawQuery of [
      { unknown: 'value' },
      { query: 'x'.repeat(101) },
      { school: 'x'.repeat(41) },
      { query: 'bad\u0000value' },
      { region: 'unknown' },
      { stage: ['high3'] },
      { campaign: '9007199254740992' },
      { limit: '51' },
      { cursor: 'not-a-canonical-cursor' },
      { dateFrom: '2026-08-01', dateTo: '2026-07-01' },
    ]) {
      const response = await handlerFor(rawQuery)(target)
      expect(response).toMatchObject({ error: { code: 'STUDENT_INVALID' } })
      expect(target.status).toBe(422)
    }
    expect(listStudents).not.toHaveBeenCalled()
  })
})

describe('administrator student detail', () => {
  it('returns exact basic data, the latest three result summaries, and counseling without credentials or sessions', async () => {
    const serviceDependencies = dependencies()
    const target = event()
    const handler = createAdminStudentDetailHandler({
      students: createAdminStudentsService(serviceDependencies),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })

    const response = await handler(target)

    expect(serviceDependencies.listRecentResults).toHaveBeenCalledWith({ studentId: 42, limit: 3 })
    expect(serviceDependencies.listCounselingHistory).toHaveBeenCalledWith({ studentId: 42 })
    expect(response).toEqual({
      data: {
        student: {
          id: 42,
          nickname: '선명한프레임42',
          phone: '010-****-5678',
          schoolName: '광주고등학교',
          applicantStage: 'high3',
          region: 'gwangju',
          status: 'active',
          lastActiveAt,
          createdAt,
        },
        recentResults: storedResults().map(result => ({
          id: result.publicId,
          completedAt: result.completedAt,
          campaignId: result.campaignId,
          primaryTrack: result.primaryTrack,
          secondaryTrack: result.secondaryTrack,
          trackScores: result.trackScores,
        })),
        counseling: storedCounseling().map(item => ({
          id: item.publicId,
          status: item.status,
          contactMethod: item.contactMethod,
          availability: item.availability,
          inquiry: item.inquiry,
          assignedFaculty: item.assignedFaculty,
          createdAt: item.createdAt,
        })),
      },
      requestId: traceId,
    })
    expect(JSON.stringify(response)).not.toMatch(
      /phoneCiphertext|phoneIv|phoneHmac|password|salt|failedAttempts|lockedUntil|session|token/iu,
    )
  })

  it('returns the same generic not-found envelope for an absent active student', async () => {
    const target = event()
    const handler = createAdminStudentDetailHandler({
      students: createAdminStudentsService(dependencies({ loadStudent: vi.fn(async () => null) })),
      getParam: () => '404',
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })

    const response = await handler(target)

    expect(target.status).toBe(404)
    expect(response).toMatchObject({ error: { code: 'STUDENT_NOT_FOUND' }, requestId: traceId })
    expect(JSON.stringify(response)).not.toMatch(/404|010|nickname|school/iu)
  })

  it('rejects malformed and unsafe student identifiers before loading data', async () => {
    for (const id of ['', '0', '-1', '1.5', '9007199254740992', '42%2Fcredentials']) {
      const loadStudent = vi.fn(async () => storedStudent())
      const target = event()
      const response = await createAdminStudentDetailHandler({
        students: createAdminStudentsService(dependencies({ loadStudent })),
        getParam: () => id,
        requireAdmin: async () => admin,
        ...responseDependencies(target),
      })(target)

      expect(target.status).toBe(400)
      expect(response).toMatchObject({ error: { code: 'VALIDATION_FAILED' } })
      expect(loadStudent).not.toHaveBeenCalled()
    }
  })
})

describe('administrator student phone reveal', () => {
  it('requires authentication no older than 15 minutes, returns digits only, and audits without plaintext', async () => {
    const calls: string[] = []
    const decryptPhone = vi.fn(async () => { calls.push('decrypt'); return phone })
    const recordSensitiveAccess = vi.fn(async () => { calls.push('audit') })
    const serviceDependencies = dependencies({ decryptPhone, recordSensitiveAccess })
    const target = event()
    const requireAdmin = vi.fn(async () => admin)
    const handler = createRevealAdminStudentPhoneHandler({
      students: createAdminStudentsService(serviceDependencies),
      getParam: () => '42',
      requireAdmin,
      ...responseDependencies(target),
    })

    const response = await handler(target)

    expect(requireAdmin).toHaveBeenCalledWith(target, { recentAuthMinutes: 15 })
    expect(calls).toEqual(['decrypt', 'audit'])
    expect(recordSensitiveAccess).toHaveBeenCalledWith({
      action: 'admin_phone_revealed',
      adminUserId,
      studentId: 42,
      traceId,
    })
    expect(JSON.stringify(recordSensitiveAccess.mock.calls)).not.toContain(phone)
    expect(target.headers['cache-control']).toBe('private, no-store')
    expect(target.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(response).toEqual({ data: { phone }, requestId: traceId })
  })

  it('returns 403 without decrypting or auditing when recent AAL2 is stale', async () => {
    const serviceDependencies = dependencies()
    const target = event()
    const response = await createRevealAdminStudentPhoneHandler({
      students: createAdminStudentsService(serviceDependencies),
      getParam: () => '42',
      requireAdmin: vi.fn(async () => { throw new AppError('REAUTH_REQUIRED') }),
      ...responseDependencies(target),
    })(target)

    expect(target.status).toBe(403)
    expect(response).toMatchObject({ error: { code: 'REAUTH_REQUIRED' } })
    expect(serviceDependencies.decryptPhone).not.toHaveBeenCalled()
    expect(serviceDependencies.recordSensitiveAccess).not.toHaveBeenCalled()
  })

  it('does not reveal or audit an unknown student and returns a generic 404', async () => {
    const serviceDependencies = dependencies({ loadStudent: vi.fn(async () => null) })
    const target = event()
    const response = await createRevealAdminStudentPhoneHandler({
      students: createAdminStudentsService(serviceDependencies),
      getParam: () => '404',
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })(target)

    expect(target.status).toBe(404)
    expect(response).toMatchObject({ error: { code: 'STUDENT_NOT_FOUND' } })
    expect(serviceDependencies.decryptPhone).not.toHaveBeenCalled()
    expect(serviceDependencies.recordSensitiveAccess).not.toHaveBeenCalled()
  })
})

describe('administrator student store DTO', () => {
  const rosterPlaceholder = `roster:11111111-1111-4111-8111-111111111111:${'ab'.repeat(32)}`

  const rawRow = (overrides: Record<string, unknown> = {}) => ({
    id: 42,
    nickname: '선명한프레임42',
    phone_ciphertext: `\\x${'01'.repeat(16)}`,
    phone_iv: `\\x${'02'.repeat(12)}`,
    school_name: '광주고등학교',
    applicant_stage: 'high3',
    region: 'gwangju',
    status: 'active',
    last_active_at: lastActiveAt,
    created_at: createdAt,
    ...overrides,
  })

  it('accepts the exact projection and rejects malformed or private database fields', () => {
    expect(decodeAdminStudentRow(rawRow())).toMatchObject({
      studentId: 42,
      nickname: '선명한프레임42',
      phoneCiphertext: expect.any(Uint8Array),
      phoneIv: expect.any(Uint8Array),
    })
    for (const malformed of [
      rawRow({ phone_hmac: `\\x${'03'.repeat(32)}` }),
      rawRow({ password_hash: `\\x${'04'.repeat(32)}` }),
      rawRow({ token_hash: `\\x${'05'.repeat(32)}` }),
      rawRow({ phone_ciphertext: phone }),
      rawRow({ phone_iv: '\\x01' }),
      rawRow({ id: 0 }),
      rawRow({ nickname: 'bad\u0000nickname' }),
      rawRow({ nickname: ` ${rosterPlaceholder}` }),
      rawRow({ nickname: 'x'.repeat(129) }),
      rawRow({ last_active_at: 'not-a-date' }),
    ]) {
      expect(() => decodeAdminStudentRow(malformed)).toThrow('ADMIN_STUDENT_STORE_INVALID')
    }
  })

  it('accepts the longest roster placeholder but exposes the decrypted applicant name', async () => {
    expect(rosterPlaceholder).toHaveLength(108)
    const student = decodeAdminStudentRow(rawRow({
      nickname: rosterPlaceholder,
      admission_cycle_id: '11111111-1111-4111-8111-111111111111',
      is_test: false,
      name_ciphertext: `\\x${'03'.repeat(16)}`,
      name_iv: `\\x${'04'.repeat(12)}`,
    }))
    const decryptName = vi.fn(async () => '윤 태준')
    const service = createAdminStudentsService(dependencies({
      decryptName,
      listStudents: vi.fn(async () => [student]),
    }))

    const result = await service.list({ limit: 20 })

    expect(result.items).toEqual([expect.objectContaining({ nickname: '윤 태준' })])
    expect(JSON.stringify(result)).not.toContain(rosterPlaceholder)
    expect(decryptName).toHaveBeenCalledWith({
      ciphertext: student.nameCiphertext,
      iv: student.nameIv,
    })
  })

  it.each([
    ['missing encrypted name', {}],
    ['missing encrypted-name IV', { nameCiphertext: new Uint8Array(16).fill(3) }],
    ['missing encrypted-name ciphertext', { nameIv: new Uint8Array(12).fill(4) }],
  ])('fails closed without exposing a roster placeholder when %s', async (_scenario, encryptedName) => {
    const service = createAdminStudentsService(dependencies({
      listStudents: vi.fn(async () => [storedStudent({ nickname: rosterPlaceholder, ...encryptedName })]),
    }))

    const outcome = await service.list({ limit: 20 })
      .then(result => JSON.stringify(result))
      .catch(error => String(error))

    expect(outcome).toContain('ADMIN_STUDENT_STORE_INVALID')
    expect(outcome).not.toContain(rosterPlaceholder)
  })
})
