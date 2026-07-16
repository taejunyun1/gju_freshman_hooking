import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminContext } from '../../../server/modules/identity/admin-auth'
import { AppError } from '../../../server/utils/app-error'

const admin: AdminContext = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: 'admin',
  aal: 'aal2',
  authenticatedAt: new Date('2026-07-16T01:00:00.000Z'),
}
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const assessmentPublicId = '22222222-2222-4222-8222-222222222222'
const updatedAt = '2026-07-16T02:00:00.123456Z'

const rawItem = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  category: 'unsafe',
  priority: 0,
  created_at: '2026-07-16T01:30:00.123456Z',
  updated_at: updatedAt,
  status: 'open',
  assessments: { public_id: assessmentPublicId },
  ...overrides,
})

describe('admin narrative report module', () => {
  it('uses a canonical priority/created/id cursor and rejects unknown query input', async () => {
    const {
      encodeAdminNarrativeReportCursor,
      parseAdminNarrativeReportListQuery,
    } = await import('../../../server/modules/admin/narrative-reports')
    const cursor = encodeAdminNarrativeReportCursor({
      priority: 0,
      createdAt: '2026-07-16T01:30:00.123456Z',
      id: 7,
    })

    expect(parseAdminNarrativeReportListQuery({ cursor, limit: '20' })).toEqual({
      cursor: {
        priority: 0,
        createdAt: '2026-07-16T01:30:00.123456Z',
        id: 7,
      },
      limit: 20,
    })
    expect(() => parseAdminNarrativeReportListQuery({ cursor: `${cursor}=`, limit: '20' }))
      .toThrow('NARRATIVE_REPORT_INVALID')
    expect(() => parseAdminNarrativeReportListQuery({ limit: '51' }))
      .toThrow('NARRATIVE_REPORT_INVALID')
    expect(() => parseAdminNarrativeReportListQuery({ status: 'resolved_unsafe' }))
      .toThrow('NARRATIVE_REPORT_INVALID')
  })

  it('projects only the bounded queue DTO and keeps unsafe first then oldest', async () => {
    const listReports = vi.fn().mockResolvedValue([
      rawItem(),
      rawItem({
        id: 9,
        category: 'confusing',
        priority: 1,
        created_at: '2026-07-15T01:00:00.000001Z',
        updated_at: '2026-07-15T01:00:00.000001Z',
        assessments: { public_id: '33333333-3333-4333-8333-333333333333' },
      }),
    ])
    const { createAdminNarrativeReportsService } = await import(
      '../../../server/modules/admin/narrative-reports'
    )
    const result = await createAdminNarrativeReportsService({
      listReports,
      resolveReport: vi.fn(),
    }).list({ limit: 20 })

    expect(result.items).toEqual([
      {
        id: 7,
        category: 'unsafe',
        priority: 'urgent',
        createdAt: '2026-07-16T01:30:00.123456Z',
        updatedAt,
        status: 'open',
        assessmentPublicId,
        resultPath: '/api/admin/narrative-reports/7/result',
      },
      {
        id: 9,
        category: 'confusing',
        priority: 'standard',
        createdAt: '2026-07-15T01:00:00.000001Z',
        updatedAt: '2026-07-15T01:00:00.000001Z',
        status: 'open',
        assessmentPublicId: '33333333-3333-4333-8333-333333333333',
        resultPath: '/api/admin/narrative-reports/9/result',
      },
    ])
    expect(result.nextCursor).toBeNull()
    expect(Object.keys(result.items[0]!).sort()).toEqual([
      'assessmentPublicId',
      'category',
      'createdAt',
      'id',
      'priority',
      'resultPath',
      'status',
      'updatedAt',
    ])
    expect(Object.keys(result.items[1]!).sort()).toEqual(Object.keys(result.items[0]!).sort())
  })

  it('applies the exact open queue selection, priority order, and keyset continuation', async () => {
    const query = {
      eq: vi.fn(),
      or: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue({ data: [rawItem()], error: null }),
      select: vi.fn(),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.or.mockReturnValue(query)
    query.order.mockReturnValue(query)
    const client = { from: vi.fn(() => query), rpc: vi.fn() }
    const {
      createSupabaseAdminNarrativeReportsDependencies,
    } = await import('../../../server/modules/admin/narrative-reports')
    const dependencies = createSupabaseAdminNarrativeReportsDependencies(client as never)

    await dependencies.listReports({
      limit: 20,
      cursor: {
        priority: 0,
        createdAt: '2026-07-16T01:30:00.123456Z',
        id: 7,
      },
    })

    expect(query.select).toHaveBeenCalledWith(
      'id,category,priority,created_at,updated_at,status,assessments!inner(public_id)',
    )
    expect(query.eq).toHaveBeenCalledWith('status', 'open')
    expect(query.or).toHaveBeenCalledWith(
      'priority.gt.0,and(priority.eq.0,created_at.gt.2026-07-16T01:30:00.123456Z),and(priority.eq.0,created_at.eq.2026-07-16T01:30:00.123456Z,id.gt.7)',
    )
    expect(query.order.mock.calls).toEqual([
      ['priority', { ascending: true }],
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ])
    expect(query.limit).toHaveBeenCalledWith(20)
  })

  it('passes one unchanged UUID to the exact resolution RPC and exposes a stable conflict snapshot', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        kind: 'conflict',
        current: {
          id: 7,
          category: 'unsafe',
          priority: 0,
          createdAt: '2026-07-16T01:30:00.123456Z',
          updatedAt,
          status: 'resolved_unsafe',
          assessmentPublicId,
        },
      },
      error: null,
    })
    const {
      createAdminNarrativeReportsService,
      createSupabaseAdminNarrativeReportsDependencies,
    } = await import('../../../server/modules/admin/narrative-reports')
    const dependencies = createSupabaseAdminNarrativeReportsDependencies({
      from: vi.fn(),
      rpc,
    } as never)
    const service = createAdminNarrativeReportsService(dependencies)

    await expect(service.resolve(7, {
      expectedUpdatedAt: updatedAt,
      resolution: 'resolved_unsafe',
    }, {
      adminUserId: admin.userId,
      traceId: requestId,
    })).rejects.toMatchObject({
      code: 'NARRATIVE_REPORT_CONFLICT',
      current: {
        id: 7,
        status: 'resolved_unsafe',
      },
    })
    expect(rpc).toHaveBeenCalledWith('resolve_career_narrative_report', {
      p_admin_user_id: admin.userId,
      p_audit_request_id: requestId,
      p_expected_updated_at: updatedAt,
      p_report_id: 7,
      p_resolution: 'resolved_unsafe',
    })
    expect(JSON.stringify(rpc.mock.calls[0]?.[1])).not.toMatch(/BigInt|phone|nickname|contact/iu)
  })
})

describe('admin narrative report routes', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getHeader', () => undefined)
    vi.stubGlobal('getQuery', () => ({}))
    vi.stubGlobal('getRouterParam', () => undefined)
    vi.stubGlobal('setResponseHeader', () => undefined)
    vi.stubGlobal('setResponseStatus', () => undefined)
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { supabaseUrl: 'https://example.supabase.co' },
      supabaseSecretKey: 'test-secret',
    }))
  })

  it('requires AAL2 and returns a private category-only queue', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    const requireAdmin = vi.fn().mockResolvedValue(admin)
    const setHeader = vi.fn()
    const { createAdminNarrativeReportsListHandler } = await import(
      '../../../server/api/admin/narrative-reports/index.get'
    )
    const handler = createAdminNarrativeReportsListHandler({
      getQuery: () => ({ limit: '20' }),
      getRequestId: () => requestId,
      reports: { list },
      requireAdmin,
      setHeader,
      setStatus: vi.fn(),
    })

    await expect(handler({})).resolves.toEqual({
      data: { items: [], nextCursor: null },
      requestId,
    })
    expect(requireAdmin).toHaveBeenCalledWith({})
    expect(setHeader).toHaveBeenCalledWith({}, 'cache-control', 'private, no-store')
    expect(list).toHaveBeenCalledWith({ limit: 20 })
  })

  it.each(['ADMIN_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'] as const)(
    'discloses no queue data when %s is raised',
    async (code) => {
      const { createAdminNarrativeReportsListHandler } = await import(
        '../../../server/api/admin/narrative-reports/index.get'
      )
      const setStatus = vi.fn()
      const response = await createAdminNarrativeReportsListHandler({
        getQuery: () => ({}),
        getRequestId: () => requestId,
        reports: { list: vi.fn() },
        requireAdmin: vi.fn(async () => { throw new AppError(code) }),
        setHeader: vi.fn(),
        setStatus,
      })({})

      expect(response).toMatchObject({ error: { code }, requestId })
      expect(setStatus).toHaveBeenCalledWith({}, 403)
      expect(JSON.stringify(response)).not.toMatch(/unsafe|assessment|narrative/u)
    },
  )

  it('requires recent AAL2 before parsing and resolving, preserving the request UUID', async () => {
    const order: string[] = []
    const resolve = vi.fn().mockResolvedValue({
      id: 7,
      category: 'unsafe',
      priority: 'urgent',
      createdAt: '2026-07-16T01:30:00.123456Z',
      updatedAt: '2026-07-16T02:01:00.000000Z',
      status: 'resolved_unsafe',
      assessmentPublicId,
      resultPath: '/api/admin/narrative-reports/7/result',
    })
    const requireAdmin = vi.fn(async (_event, options) => {
      order.push('auth')
      expect(options).toEqual({ recentAuthMinutes: 15 })
      return admin
    })
    const { createResolveAdminNarrativeReportHandler } = await import(
      '../../../server/api/admin/narrative-reports/[id]/resolve.post'
    )
    const handler = createResolveAdminNarrativeReportHandler({
      getContentType: () => 'application/json',
      getParam: () => {
        order.push('param')
        return '7'
      },
      getRequestId: () => requestId,
      readRawBody: async () => {
        order.push('body')
        return JSON.stringify({
          expectedUpdatedAt: updatedAt,
          resolution: 'resolved_unsafe',
        })
      },
      reports: { resolve },
      requireAdmin,
      setHeader: vi.fn(),
      setStatus: vi.fn(),
    })

    await expect(handler({})).resolves.toMatchObject({
      data: { id: 7, status: 'resolved_unsafe' },
      requestId,
    })
    expect(order).toEqual(['auth', 'param', 'body'])
    expect(resolve).toHaveBeenCalledWith(7, {
      expectedUpdatedAt: updatedAt,
      resolution: 'resolved_unsafe',
    }, {
      adminUserId: admin.userId,
      traceId: requestId,
    })
  })

  it('maps stale resolution to 409 with the current category-only snapshot', async () => {
    const current = {
      id: 7,
      category: 'unsafe',
      priority: 'urgent',
      createdAt: '2026-07-16T01:30:00.123456Z',
      updatedAt,
      status: 'resolved_unsafe',
      assessmentPublicId,
      resultPath: '/api/admin/narrative-reports/7/result',
    }
    const { NarrativeReportConflictError } = await import('../../../server/utils/app-error')
    const { createResolveAdminNarrativeReportHandler } = await import(
      '../../../server/api/admin/narrative-reports/[id]/resolve.post'
    )
    const setStatus = vi.fn()
    const response = await createResolveAdminNarrativeReportHandler({
      getContentType: () => 'application/json',
      getParam: () => '7',
      getRequestId: () => requestId,
      readRawBody: async () => JSON.stringify({
        expectedUpdatedAt: updatedAt,
        resolution: 'resolved_unsafe',
      }),
      reports: { resolve: vi.fn(async () => { throw new NarrativeReportConflictError(current) }) },
      requireAdmin: vi.fn(async () => admin),
      setHeader: vi.fn(),
      setStatus,
    })({})

    expect(response).toMatchObject({
      error: { code: 'NARRATIVE_REPORT_CONFLICT', current },
      requestId,
    })
    expect(setStatus).toHaveBeenCalledWith({}, 409)
    expect(JSON.stringify(response)).not.toMatch(/sentence|phone|nickname|school|contact/iu)
  })

  it('loads the immutable narrative result through a separate AAL2 Bearer boundary', async () => {
    const order: string[] = []
    const loadResult = vi.fn().mockResolvedValue({
      reportId: 7,
      assessmentPublicId,
      selectedInterests: [
        { group: 'work', label: '예술사진 촬영' },
        { group: 'result', label: '전시 결과물' },
        { group: 'style', label: '개인 창작' },
        { group: 'career', label: '사진작가' },
      ],
      rankedTracks: ['art_photo', 'video', 'documentary', 'commercial'],
      learningCourseTitles: ['현대사진'],
      faculty: {
        primary: { name: '윤태준', title: '교수', expertise: '현대예술·예술사진·영상·AI·기술적 이미지' },
        specialists: [],
      },
      narrativeSentences: [
        '첫 번째 검증 문장입니다.',
        '두 번째 검증 문장입니다.',
        '세 번째 검증 문장입니다.',
        '네 번째 검증 문장입니다.',
      ],
    })
    const requireAdmin = vi.fn(async () => {
      order.push('auth')
      return admin
    })
    const { createAdminNarrativeReportResultHandler } = await import(
      '../../../server/api/admin/narrative-reports/[id]/result.get'
    )
    const handler = createAdminNarrativeReportResultHandler({
      getParam: () => {
        order.push('param')
        return '7'
      },
      getRequestId: () => requestId,
      reports: { loadResult },
      requireAdmin,
      setHeader: vi.fn(),
      setStatus: vi.fn(),
    })

    await expect(handler({})).resolves.toMatchObject({
      data: {
        reportId: 7,
        assessmentPublicId,
        selectedInterests: expect.any(Array),
        rankedTracks: ['art_photo', 'video', 'documentary', 'commercial'],
        narrativeSentences: expect.any(Array),
      },
      requestId,
    })
    expect(requireAdmin).toHaveBeenCalledWith({})
    expect(loadResult).toHaveBeenCalledWith(7)
    expect(order).toEqual(['auth', 'param'])
  })

  it('uses the exact report-to-assessment projection and returns no student contact fields', async () => {
    const { makeResultSnapshot } = await import('../../fixtures/result')
    const snapshot = makeResultSnapshot()
    const query = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 7,
          assessments: {
            public_id: assessmentPublicId,
            result_snapshot: snapshot,
          },
        },
        error: null,
      }),
      select: vi.fn(),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    const {
      createAdminNarrativeReportsService,
      createSupabaseAdminNarrativeReportsDependencies,
    } = await import(
      '../../../server/modules/admin/narrative-reports'
    )
    const dependencies = createSupabaseAdminNarrativeReportsDependencies({
      from: vi.fn(() => query),
      rpc: vi.fn(),
    } as never)

    const result = await createAdminNarrativeReportsService(dependencies).loadResult(7)

    expect(query.select).toHaveBeenCalledWith(
      'id,assessments!inner(public_id,result_snapshot)',
    )
    expect(query.eq).toHaveBeenCalledWith('id', 7)
    expect(Object.keys(result).sort()).toEqual([
      'assessmentPublicId',
      'faculty',
      'learningCourseTitles',
      'narrativeSentences',
      'rankedTracks',
      'reportId',
      'selectedInterests',
    ])
    expect(JSON.stringify(result)).not.toMatch(/phone|nickname|school|contact|email/iu)
    expect(JSON.stringify(result)).not.toMatch(/evidenceIds|source|provider|model/iu)
  })
})
