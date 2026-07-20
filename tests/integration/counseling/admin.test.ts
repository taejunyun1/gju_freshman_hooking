import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createAssignCounselingHandler } from '../../../server/api/admin/counseling/[id]/assign.post'
import { createReopenCounselingHandler } from '../../../server/api/admin/counseling/[id]/reopen.post'
import { createRevealCounselingPhoneHandler } from '../../../server/api/admin/counseling/[id]/reveal-phone.post'
import { createCounselingSummaryHandler } from '../../../server/api/admin/counseling/[id]/summary.get'
import { createTransitionCounselingHandler } from '../../../server/api/admin/counseling/[id]/transition.post'
import { createAdminCounselingListHandler } from '../../../server/api/admin/counseling/index.get'
import {
  createAdminCounselingService,
  createSupabaseAdminCounselingDependencies,
  decodeAdminCounselingRow,
  encodeCounselingCursor,
  type AdminCounselingServiceDependencies,
} from '../../../server/modules/counseling/admin-service'
import { AppError } from '../../../server/utils/app-error'
import { RequestBodyLimitError } from '../../../server/utils/bounded-request-body'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const traceId = '77777777-7777-4777-8777-777777777777'
const adminUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const requestPublicId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const assessmentPublicId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const createdAt = '2026-07-15T01:00:00.000Z'
const rosterPlaceholder = `roster:11111111-1111-4111-8111-111111111111:${'ab'.repeat(32)}`

const admin = {
  aal: 'aal2' as const,
  authenticatedAt: new Date('2026-07-15T01:00:00.000Z'),
  role: 'admin' as const,
  userId: adminUserId,
}

const storedRequest = (overrides: Record<string, unknown> = {}) => ({
  requestId: 73,
  publicId: requestPublicId,
  prospectId: 42,
  assessmentPublicId,
  campaignId: 9,
  primaryTrack: 'commercial',
  secondaryTrack: 'art_photo',
  selectedWorkLabels: ['제품·패션·광고 이미지 만들기'],
  selectedCareerLabels: ['사진을 직접 촬영하고 보정해 작품·광고·포트폴리오로 완성하고 싶어요.'],
  status: 'assigned',
  contactMethod: 'phone',
  availability: 'weekday_afternoon',
  inquiry: '입학 준비 포트폴리오가 궁금해요.',
  consentedAt: createdAt,
  assignedAt: createdAt,
  contactedAt: null,
  completedAt: null,
  closedAt: null,
  version: 1,
  createdAt,
  updatedAt: createdAt,
  prospect: {
    nickname: '선명한프레임42',
    schoolName: '광주고등학교',
    applicantStage: 'high3',
    region: 'gwangju',
    phoneCiphertext: new Uint8Array([1, 2, 3]),
    phoneIv: new Uint8Array([4, 5, 6]),
  },
  assignedFaculty: { id: 202, name: '윤태준', title: '교수' },
  recommendations: [
    { id: 202, name: '윤태준', title: '교수', role: 'primary', rank: 1 },
    { id: 201, name: '조대연', title: '교수', role: 'backup', rank: 1 },
    { id: 206, name: '곽동욱', title: '겸임교수', role: 'specialist', rank: 1 },
  ],
  ...overrides,
})

const dependencies = (
  overrides: Partial<AdminCounselingServiceDependencies> = {},
): AdminCounselingServiceDependencies => ({
  decryptPhone: vi.fn(async () => '01012345678'),
  listAssignableFaculty: vi.fn(async () => [
    { id: 201, name: '조대연', title: '교수' },
    { id: 202, name: '윤태준', title: '교수' },
  ]),
  listRequests: vi.fn(async () => [storedRequest()]),
  loadRequest: vi.fn(async ({ publicId }: { publicId: string }) => (
    publicId === requestPublicId ? storedRequest() : null
  )),
  recordSensitiveAccess: vi.fn(async () => undefined),
  reopenRequest: vi.fn(async () => ({ requestId: 73, status: 'new', version: 4, updatedAt: createdAt })),
  transitionRequest: vi.fn(async ({ to }: { to: string }) => ({
    requestId: 73,
    status: to,
    version: 2,
    assignedFacultyId: 202,
    assignedAt: createdAt,
    contactedAt: to === 'contacted' || to === 'completed' ? createdAt : null,
    completedAt: to === 'completed' ? createdAt : null,
    closedAt: to === 'closed' ? createdAt : null,
    updatedAt: createdAt,
  })),
  ...overrides,
})

const handlerEvent = (body?: unknown) => ({ body, headers: {} as Record<string, string>, status: undefined as number | undefined })

const commonRouteDependencies = (
  service: ReturnType<typeof createAdminCounselingService>,
  body?: unknown,
) => ({
  counseling: service,
  getContentType: () => 'application/json',
  getParam: () => requestPublicId,
  getRequestId: () => traceId,
  readRawBody: async () => body === undefined ? undefined : JSON.stringify(body),
  requireAdmin: vi.fn(async () => admin),
  setHeader: (event: unknown, name: string, value: string) => {
    ;(event as { headers: Record<string, string> }).headers[name] = value
  },
  setStatus: (event: unknown, status: number) => {
    ;(event as { status?: number }).status = status
  },
})

describe('administrator counseling queue', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('applies a deterministic bounded cursor and returns masked, durable context only', async () => {
    const deps = dependencies()
    const service = createAdminCounselingService(deps)
    const cursor = encodeCounselingCursor({ createdAt, id: 73 })
    const event = handlerEvent()
    const requireAdmin = vi.fn(async () => admin)
    const handler = createAdminCounselingListHandler({
      counseling: service,
      getQuery: () => ({
        assignedFacultyId: '202',
        createdFrom: '2026-07-01T00:00:00.000Z',
        createdTo: '2026-07-31T23:59:59.999Z',
        cursor,
        limit: '20',
        primaryTrack: 'commercial',
        status: 'assigned',
      }),
      getRequestId: () => traceId,
      requireAdmin,
      setHeader: (target, name, value) => { (target as typeof event).headers[name] = value },
      setStatus: (target, status) => { (target as typeof event).status = status },
    })

    const response = await handler(event)

    expect(requireAdmin).toHaveBeenCalledWith(event)
    expect(deps.listRequests).toHaveBeenCalledWith({
      assignedFacultyId: 202,
      createdFrom: '2026-07-01T00:00:00.000Z',
      createdTo: '2026-07-31T23:59:59.999Z',
      cursor: { createdAt, id: 73 },
      limit: 21,
      primaryTrack: 'commercial',
      status: 'assigned',
    })
    expect(event.headers['cache-control']).toBe('private, no-store')
    expect(response).toMatchObject({
      data: {
        faculty: [
          { id: 201, name: '조대연', title: '교수' },
          { id: 202, name: '윤태준', title: '교수' },
        ],
        items: [{
          id: requestPublicId,
          assessmentPublicId,
          maskedPhone: '010-****-5678',
          primaryTrack: 'commercial',
          secondaryTrack: 'art_photo',
          selectedWorkLabels: ['제품·패션·광고 이미지 만들기'],
          selectedCareerLabels: expect.any(Array),
          recommendations: [
            expect.objectContaining({ name: '윤태준', role: 'primary' }),
            expect.objectContaining({ name: '조대연', role: 'backup' }),
            expect.objectContaining({ name: '곽동욱', role: 'specialist' }),
          ],
          version: 1,
        }],
        nextCursor: null,
      },
      requestId: traceId,
    })
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('campaignId')
    expect(serialized).not.toMatch(/01012345678|phoneCiphertext|phoneIv|adminNote|ciphertext/u)
  })

  it('keeps the queue available when one stored phone cannot be decrypted', async () => {
    const unavailablePublicId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const unavailable = storedRequest({
      requestId: 74,
      publicId: unavailablePublicId,
      prospect: {
        ...storedRequest().prospect,
        phoneCiphertext: new Uint8Array([9, 9, 9]),
      },
    })
    const decryptPhone = vi.fn(async ({ ciphertext }: { ciphertext: Uint8Array }) => {
      if (ciphertext[0] === 9) throw new Error('legacy phone key mismatch: private detail')
      return '01012345678'
    })
    const service = createAdminCounselingService(dependencies({
      decryptPhone,
      listRequests: vi.fn(async () => [unavailable, storedRequest()]),
    }))
    const event = handlerEvent()
    const handler = createAdminCounselingListHandler({
      counseling: service,
      getQuery: () => ({ limit: '20' }),
      getRequestId: () => traceId,
      requireAdmin: async () => admin,
      setHeader: vi.fn(),
      setStatus: (target, status) => { (target as typeof event).status = status },
    })

    const response = await handler(event)

    expect(event.status).toBeUndefined()
    expect(response).toMatchObject({
      data: {
        items: [
          {
            id: unavailablePublicId,
            maskedPhone: null,
            phoneStatus: 'verification_required',
          },
          {
            id: requestPublicId,
            maskedPhone: '010-****-5678',
            phoneStatus: 'available',
          },
        ],
      },
      requestId: traceId,
    })
    expect(JSON.stringify(response)).not.toMatch(/legacy phone key mismatch|01012345678|phoneCiphertext|phoneIv/iu)
  })

  it('decrypts a roster applicant name without exposing the internal placeholder', async () => {
    const decryptName = vi.fn(async () => '윤 태준')
    const rosterRequest = storedRequest({
      prospect: {
        ...storedRequest().prospect,
        nickname: rosterPlaceholder,
        nameCiphertext: new Uint8Array(16).fill(3),
        nameIv: new Uint8Array(12).fill(4),
      },
    })
    const service = createAdminCounselingService(dependencies({
      decryptName,
      listRequests: vi.fn(async () => [rosterRequest]),
    } as never))

    const result = await service.list({ limit: 20 })

    expect(result.items).toEqual([
      expect.objectContaining({ nickname: '윤 태준', nameStatus: 'available' }),
    ])
    expect(JSON.stringify(result)).not.toContain(rosterPlaceholder)
    expect(decryptName).toHaveBeenCalledWith({
      ciphertext: rosterRequest.prospect.nameCiphertext,
      iv: rosterRequest.prospect.nameIv,
    })
  })

  it.each([
    ['missing encrypted name', {}],
    ['name decryption failure', {
      nameCiphertext: new Uint8Array(16).fill(3),
      nameIv: new Uint8Array(12).fill(4),
    }],
  ])('keeps a roster counseling item private and usable after %s', async (scenario, encryptedName) => {
    const rosterRequest = storedRequest({
      prospect: {
        ...storedRequest().prospect,
        nickname: rosterPlaceholder,
        ...encryptedName,
      },
    })
    const decryptName = vi.fn(async () => {
      throw new Error(`private ${scenario} detail`)
    })
    const service = createAdminCounselingService(dependencies({
      decryptName,
      listRequests: vi.fn(async () => [rosterRequest]),
    } as never))

    const result = await service.list({ limit: 20 })

    expect(result.items).toEqual([
      expect.objectContaining({
        nickname: '학생 이름 확인 필요',
        nameStatus: 'verification_required',
      }),
    ])
    expect(JSON.stringify(result)).not.toMatch(/roster:|private .* detail/iu)
  })

  it('uses the decrypted roster applicant name in a counseling summary', async () => {
    const rosterRequest = storedRequest({
      prospect: {
        ...storedRequest().prospect,
        nickname: rosterPlaceholder,
        nameCiphertext: new Uint8Array(16).fill(3),
        nameIv: new Uint8Array(12).fill(4),
      },
    })
    const service = createAdminCounselingService(dependencies({
      decryptName: vi.fn(async () => '윤 태준'),
      loadRequest: vi.fn(async () => rosterRequest),
    } as never))

    const summary = await service.summary(requestPublicId, { adminUserId, traceId })

    expect(summary).toContain('상담 학생: 윤 태준')
    expect(summary).not.toContain(rosterPlaceholder)
  })

  it('rejects malformed, oversized, array-valued, reversed-date, and forged cursors', async () => {
    const setStatus = vi.fn()
    const listRequests = vi.fn(async () => [])
    const handlerFor = (query: Record<string, unknown>) => createAdminCounselingListHandler({
      counseling: createAdminCounselingService(dependencies({ listRequests })),
      getQuery: () => query,
      getRequestId: () => traceId,
      requireAdmin: async () => admin,
      setHeader: vi.fn(),
      setStatus,
    })

    for (const query of [
      { unknown: 'value' },
      { campaignId: '9' },
      { limit: ['20'] },
      { limit: '51' },
      { cursor: 'not-a-valid-cursor' },
      { createdFrom: '2026-08-01T00:00:00.000Z', createdTo: '2026-07-01T00:00:00.000Z' },
    ]) {
      const response = await handlerFor(query)(handlerEvent())
      expect(response).toMatchObject({ error: { code: 'COUNSELING_INVALID' } })
    }
    expect(listRequests).not.toHaveBeenCalled()
    expect(setStatus).toHaveBeenCalledWith(expect.anything(), 422)
  })
})

describe('administrator counseling mutations', () => {
  it('maps bounded-reader overflow to a 422 without invoking a mutation', async () => {
    const deps = dependencies()
    const service = createAdminCounselingService(deps)
    const routes = [
      createAssignCounselingHandler,
      createTransitionCounselingHandler,
      createReopenCounselingHandler,
    ]

    for (const createHandler of routes) {
      const event = handlerEvent()
      const routeDeps = {
        ...commonRouteDependencies(service),
        readRawBody: vi.fn(async () => { throw new RequestBodyLimitError() }),
      }
      const response = await createHandler(routeDeps as never)(event)

      expect(event.status).toBe(422)
      expect(response).toMatchObject({ error: { code: 'COUNSELING_INVALID' } })
    }
    expect(deps.transitionRequest).not.toHaveBeenCalled()
    expect(deps.reopenRequest).not.toHaveBeenCalled()
  })

  it('assigns active faculty through an audited optimistic transition', async () => {
    let loadCount = 0
    const deps = dependencies({
      loadRequest: vi.fn(async () => loadCount++ === 0
        ? storedRequest()
        : storedRequest({ version: 2 })),
    })
    const service = createAdminCounselingService(deps)
    const event = handlerEvent({ assignedFacultyId: 202, expectedVersion: 1 })
    const routeDeps = commonRouteDependencies(service, event.body)
    const handler = createAssignCounselingHandler(routeDeps)

    const response = await handler(event)

    expect(routeDeps.requireAdmin).toHaveBeenCalledWith(event)
    expect(deps.transitionRequest).toHaveBeenCalledWith({
      adminUserId,
      assignedFacultyId: 202,
      expectedVersion: 1,
      requestId: 73,
      to: 'assigned',
      traceId,
    })
    expect(response).toMatchObject({ data: { id: requestPublicId, status: 'assigned', version: 2 } })
    expect(JSON.stringify(response)).not.toContain('adminNote')
  })

  it('maps stale and invalid transitions to a 409 with a sanitized current row', async () => {
    const deps = dependencies({
      transitionRequest: vi.fn(async () => { throw Object.assign(new Error('conflict'), { code: '40001' }) }),
    })
    const service = createAdminCounselingService(deps)
    const event = handlerEvent({ expectedVersion: 1, to: 'completed' })
    const routeDeps = commonRouteDependencies(service, event.body)
    const handler = createTransitionCounselingHandler(routeDeps)

    const response = await handler(event)

    expect(event.status).toBe(409)
    expect(response).toMatchObject({
      error: {
        code: 'COUNSELING_CONFLICT',
        current: { id: requestPublicId, status: 'assigned', version: 1 },
      },
    })
    expect(JSON.stringify(response)).not.toMatch(/01012345678|phoneCiphertext|inquiry|adminNote/u)
  })

  it('requires a nonblank reopen reason and delegates terminal reopening to the audited RPC', async () => {
    let loadCount = 0
    const deps = dependencies({
      loadRequest: vi.fn(async () => loadCount++ < 1
        ? storedRequest({ status: 'closed', closedAt: createdAt })
        : storedRequest({
            status: 'new',
            version: 4,
            assignedAt: null,
            assignedFaculty: null,
            closedAt: null,
          })),
    })
    const service = createAdminCounselingService(deps)
    const invalidEvent = handlerEvent({ expectedVersion: 3, reason: '   ' })
    const invalidDeps = commonRouteDependencies(service, invalidEvent.body)
    const invalid = await createReopenCounselingHandler(invalidDeps)(invalidEvent)

    expect(invalid).toMatchObject({ error: { code: 'COUNSELING_INVALID' } })
    expect(deps.reopenRequest).not.toHaveBeenCalled()

    const event = handlerEvent({ expectedVersion: 3, reason: '학생 재요청' })
    const routeDeps = commonRouteDependencies(service, event.body)
    const response = await createReopenCounselingHandler(routeDeps)(event)

    expect(deps.reopenRequest).toHaveBeenCalledWith({
      adminUserId,
      expectedVersion: 3,
      reason: '학생 재요청',
      requestId: 73,
      traceId,
    })
    expect(response).toMatchObject({ data: { id: requestPublicId, status: 'new', version: 4 } })
  })
})

describe('administrator counseling sensitive reads', () => {
  it('returns 403 and discloses nothing when AAL2 or recent authentication is missing', async () => {
    for (const code of ['MFA_REQUIRED', 'REAUTH_REQUIRED'] as const) {
      const deps = dependencies()
      const service = createAdminCounselingService(deps)
      const event = handlerEvent()
      const routeDeps = {
        ...commonRouteDependencies(service),
        requireAdmin: vi.fn(async () => { throw new AppError(code) }),
      }
      const response = await createRevealCounselingPhoneHandler(routeDeps)(event)

      expect(event.status).toBe(403)
      expect(response).toMatchObject({ error: { code } })
      expect(deps.decryptPhone).not.toHaveBeenCalled()
      expect(deps.recordSensitiveAccess).not.toHaveBeenCalled()
    }
  })

  it('requires recent MFA, returns only the exact phone envelope, and audits before disclosure', async () => {
    const calls: string[] = []
    const deps = dependencies({
      decryptPhone: vi.fn(async () => {
        calls.push('decrypt')
        return '01012345678'
      }),
      recordSensitiveAccess: vi.fn(async () => { calls.push('audit') }),
    })
    const service = createAdminCounselingService(deps)
    const event = handlerEvent()
    const routeDeps = commonRouteDependencies(service)
    const handler = createRevealCounselingPhoneHandler(routeDeps)

    const response = await handler(event)

    expect(routeDeps.requireAdmin).toHaveBeenCalledWith(event, { recentAuthMinutes: 15 })
    expect(calls).toEqual(['decrypt', 'audit'])
    expect(deps.recordSensitiveAccess).toHaveBeenCalledWith({
      action: 'phone_reveal',
      adminUserId,
      requestId: 73,
      traceId,
    })
    expect(event.headers['cache-control']).toBe('private, no-store')
    expect(event.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(response).toEqual({ data: { phone: '01012345678' }, requestId: traceId })
  })

  it('builds a nonpersisted exact plain-text summary and audits it without plaintext metadata', async () => {
    const deps = dependencies()
    const service = createAdminCounselingService(deps)
    const event = handlerEvent()
    const routeDeps = commonRouteDependencies(service)
    const handler = createCounselingSummaryHandler(routeDeps)

    const response = await handler(event)

    expect(routeDeps.requireAdmin).toHaveBeenCalledWith(event, { recentAuthMinutes: 15 })
    expect(deps.recordSensitiveAccess).toHaveBeenCalledWith({
      action: 'summary',
      adminUserId,
      requestId: 73,
      traceId,
    })
    expect(event.headers['cache-control']).toBe('private, no-store')
    expect(event.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(response).toMatchObject({
      data: {
        summary: expect.stringContaining('상담 학생: 선명한프레임42\n연락처: 01012345678'),
      },
      requestId: traceId,
    })
    if ('data' in response) {
      expect(response.data.summary).toContain('관심 트랙: 광고사진, 예술사진')
      expect(response.data.summary).toContain('선택한 활동: 제품·패션·광고 이미지 만들기')
      expect(response.data.summary).toContain('추천 총괄교수: 윤태준 교수')
      expect(response.data.summary).toContain('실제 배정교수: 윤태준 교수')
    }
    expect(JSON.stringify(vi.mocked(deps.recordSensitiveAccess).mock.calls)).not.toMatch(/01012345678|입학 준비/u)
  })

  it('returns 404 for an unknown public identifier without revealing another record', async () => {
    const service = createAdminCounselingService(dependencies())
    const event = handlerEvent()
    const routeDeps = { ...commonRouteDependencies(service), getParam: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }
    const response = await createRevealCounselingPhoneHandler(routeDeps)(event)

    expect(event.status).toBe(404)
    expect(response).toMatchObject({ error: { code: 'COUNSELING_NOT_FOUND' } })
  })

  it('canonicalizes an uppercase public UUID before store lookup and strict ownership comparison', async () => {
    const loadRequest = vi.fn(async () => storedRequest())
    const service = createAdminCounselingService(dependencies({ loadRequest }))
    const event = handlerEvent()
    const routeDeps = {
      ...commonRouteDependencies(service),
      getParam: () => requestPublicId.toUpperCase(),
    }

    const response = await createRevealCounselingPhoneHandler(routeDeps)(event)

    expect(event.status).toBeUndefined()
    expect(response).toEqual({ data: { phone: '01012345678' }, requestId: traceId })
    expect(loadRequest).toHaveBeenCalledWith({ publicId: requestPublicId })
  })
})

describe('administrator counseling store decoder', () => {
  const rawRow = (overrides: Record<string, unknown> = {}) => ({
    id: 73,
    public_id: requestPublicId,
    prospect_id: 42,
    assessment_public_id_snapshot: assessmentPublicId,
    campaign_id_snapshot: 9,
    primary_track_snapshot: 'commercial',
    secondary_track_snapshot: 'art_photo',
    selected_work_labels_snapshot: ['제품·패션·광고 이미지 만들기'],
    selected_career_labels_snapshot: ['사진 직접 촬영·보정'],
    status: 'assigned',
    contact_method: 'phone',
    availability: 'weekday_afternoon',
    inquiry: '입학 준비 포트폴리오가 궁금해요.',
    consented_at: createdAt,
    assigned_at: createdAt,
    contacted_at: null,
    completed_at: null,
    closed_at: null,
    version: 1,
    created_at: createdAt,
    updated_at: createdAt,
    prospect: {
      nickname: '선명한프레임42',
      school_name: '광주고등학교',
      applicant_stage: 'high3',
      region: 'gwangju',
      phone_ciphertext: '\\x010203',
      phone_iv: '\\x040506',
    },
    assigned_faculty: { id: 202, name: '윤태준', title: '교수' },
    recommendations: [
      { faculty_id: 202, faculty_name_snapshot: '윤태준', faculty_title_snapshot: '교수', role: 'primary', rank: 1 },
      { faculty_id: 201, faculty_name_snapshot: '조대연', faculty_title_snapshot: '교수', role: 'backup', rank: 1 },
    ],
    ...overrides,
  })

  it('accepts the exact database projection and rejects extra private or malformed fields', () => {
    expect(decodeAdminCounselingRow(rawRow())).toMatchObject({
      assessmentPublicId,
      publicId: requestPublicId,
      prospect: { nickname: '선명한프레임42' },
    })
    expect(() => decodeAdminCounselingRow(rawRow({ admin_note: '내부 메모' }))).toThrow('COUNSELING_ADMIN_STORE_INVALID')
    expect(() => decodeAdminCounselingRow(rawRow({ public_id: requestPublicId.toUpperCase() })))
      .toThrow('COUNSELING_ADMIN_STORE_INVALID')
    expect(() => decodeAdminCounselingRow(rawRow({ selected_work_labels_snapshot: [] }))).toThrow('COUNSELING_ADMIN_STORE_INVALID')
    expect(() => decodeAdminCounselingRow(rawRow({ status: 'completed', completed_at: null })))
      .toThrow('COUNSELING_ADMIN_STORE_INVALID')
    expect(() => decodeAdminCounselingRow(rawRow({ prospect: { ...rawRow().prospect, phone_ciphertext: '01012345678' } })))
      .toThrow('COUNSELING_ADMIN_STORE_INVALID')
  })

  it('accepts a roster placeholder with only the encrypted applicant-name envelope', () => {
    expect(rosterPlaceholder).toHaveLength(108)
    const request = decodeAdminCounselingRow(rawRow({
      prospect: {
        ...rawRow().prospect,
        nickname: rosterPlaceholder,
        name_ciphertext: `\\x${'03'.repeat(16)}`,
        name_iv: `\\x${'04'.repeat(12)}`,
      },
    }))

    expect(request.prospect).toMatchObject({
      nickname: rosterPlaceholder,
      nameCiphertext: expect.any(Uint8Array),
      nameIv: expect.any(Uint8Array),
    })
  })

  it('preserves only allow-listed database conflict reasons for public 409 mapping', async () => {
    for (const reason of ['COUNSELING_TRANSITION_INVALID', 'COUNSELING_OPEN_REQUEST_EXISTS'] as const) {
      const client = {
        rpc: vi.fn(async () => ({ data: null, error: { code: 'P0001', message: reason } })),
      } as unknown as SupabaseClient
      const adapter = createSupabaseAdminCounselingDependencies(client, async () => '01012345678')

      await expect(adapter.transitionRequest({
        adminUserId,
        assignedFacultyId: null,
        expectedVersion: 1,
        requestId: 73,
        to: 'contacted',
        traceId,
      })).rejects.toMatchObject({ code: reason })
    }
  })

  it('fixes the exact queue projection, filters, cursor grammar, ordering, limit, and decoder boundary', async () => {
    const calls = {
      eq: [] as Array<[string, unknown]>,
      gte: [] as Array<[string, unknown]>,
      limit: [] as number[],
      lte: [] as Array<[string, unknown]>,
      or: [] as string[],
      order: [] as Array<[string, { ascending?: boolean } | undefined]>,
      select: [] as string[],
    }
    const query = {
      eq: (column: string, value: unknown) => {
        calls.eq.push([column, value])
        return query
      },
      gte: (column: string, value: unknown) => {
        calls.gte.push([column, value])
        return query
      },
      limit: (value: number) => {
        calls.limit.push(value)
        return query
      },
      lte: (column: string, value: unknown) => {
        calls.lte.push([column, value])
        return query
      },
      or: (value: string) => {
        calls.or.push(value)
        return query
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        calls.order.push([column, options])
        return query
      },
      select: (selection: string) => {
        calls.select.push(selection)
        return query
      },
      then: <Result>(
        resolve: (value: { data: unknown[], error: null }) => Result | PromiseLike<Result>,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: [rawRow()], error: null }).then(resolve, reject),
    }
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient
    const adapter = createSupabaseAdminCounselingDependencies(client, async () => '01012345678')

    const result = await adapter.listRequests({
      assignedFacultyId: 202,
      campaignId: 9 as never,
      createdFrom: '2026-07-01T00:00:00.000Z',
      createdTo: '2026-07-31T23:59:59.999Z',
      cursor: { createdAt, id: 73 },
      limit: 21,
      primaryTrack: 'commercial',
      status: 'assigned',
    })

    expect(result).toEqual([expect.objectContaining({
      assessmentPublicId,
      primaryTrack: 'commercial',
      prospect: expect.objectContaining({ nickname: '선명한프레임42' }),
      publicId: requestPublicId,
      requestId: 73,
    })])
    expect(client.from).toHaveBeenCalledWith('counseling_requests')
    expect(calls.select.map(value => value.replace(/\s+/gu, ''))).toEqual([
      'id,public_id,prospect_id,assessment_public_id_snapshot,campaign_id_snapshot,primary_track_snapshot,secondary_track_snapshot,selected_work_labels_snapshot,selected_career_labels_snapshot,status,contact_method,availability,inquiry,consented_at,assigned_at,contacted_at,completed_at,closed_at,version,created_at,updated_at,prospect:prospects!inner(nickname,name_ciphertext,name_iv,school_name,applicant_stage,region,phone_ciphertext,phone_iv),assigned_faculty:faculty!counseling_requests_assigned_faculty_fk(id,name,title),recommendations:counseling_faculty_recommendations(faculty_id,faculty_name_snapshot,faculty_title_snapshot,role,rank)',
    ])
    expect(calls.eq).toEqual([
      ['status', 'assigned'],
      ['primary_track_snapshot', 'commercial'],
      ['assigned_faculty_id', 202],
    ])
    expect(calls.eq).not.toContainEqual(['campaign_id_snapshot', 9])
    expect(calls.gte).toEqual([['created_at', '2026-07-01T00:00:00.000Z']])
    expect(calls.lte).toEqual([['created_at', '2026-07-31T23:59:59.999Z']])
    expect(calls.or).toEqual([
      'created_at.lt.2026-07-15T01:00:00.000Z,and(created_at.eq.2026-07-15T01:00:00.000Z,id.lt.73)',
    ])
    expect(calls.order).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(calls.limit).toEqual([21])
    const projection = calls.select[0] ?? ''
    for (const forbidden of ['admin_note', 'consent_given', 'phone_hmac']) {
      expect(projection).not.toContain(forbidden)
    }
    expect(projection.replace(/\s+/gu, '')).not.toMatch(/(^|[,(])assessment_id([,)]|$)/u)
  })
})
