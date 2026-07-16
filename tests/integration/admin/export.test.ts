import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAdminExportHandler } from '../../../server/api/admin/export/index.post'
import { createAdminExportStudentsHandler } from '../../../server/api/admin/export/[id]/students.get'
import { createAdminExportAssessmentsHandler } from '../../../server/api/admin/export/[id]/assessments.get'
import { createAdminExportCounselingHandler } from '../../../server/api/admin/export/[id]/counseling.get'
import { createAdminExportCompleteHandler } from '../../../server/api/admin/export/[id]/complete.post'
import { createAdminExportDownloadedHandler } from '../../../server/api/admin/export/[id]/downloaded.post'
import {
  createAdminExportService,
  decodeAssessmentExportRow,
  decodeCounselingExportRow,
  decodeExportCursor,
  encodeExportCursor,
  parseExportCreateBody,
  parseExportCompletionBody,
  type AdminExportDependencies,
} from '../../../server/modules/admin/export'
import { AppError } from '../../../server/utils/app-error'
import { makeResultSnapshot } from '../../fixtures/result'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const admin = {
  aal: 'aal2' as const,
  authenticatedAt: new Date('2026-07-16T01:55:00.000Z'),
  role: 'admin' as const,
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const createdAt = '2026-07-16T02:00:00.123456Z'
const filterSnapshot = {
  stage: 'high3' as const,
  region: 'gwangju' as const,
  track: 'art_photo' as const,
  campaignId: 7,
  counselingStatus: 'new' as const,
  dateFrom: '2026-07-01',
  dateTo: '2026-07-16',
}

const storedJob = (overrides: Record<string, unknown> = {}) => ({
  id: 71,
  createdByAdminId: admin.userId,
  filterSnapshot,
  status: 'created' as const,
  studentRowCount: 0,
  participationRowCount: 0,
  counselingRowCount: 0,
  errorCode: null,
  createdAt,
  completedAt: null,
  downloadedAt: null,
  ...overrides,
})

const dependencies = (
  overrides: Partial<AdminExportDependencies> = {},
): AdminExportDependencies => ({
  countRows: vi.fn(async () => ({ students: 3, assessments: 5, counseling: 1 })),
  createJob: vi.fn(async () => storedJob()),
  recordExportAudit: vi.fn(async () => undefined),
  failJob: vi.fn(async () => true),
  loadOwnedJob: vi.fn(async ({ jobId, adminUserId }) => (
    jobId === 71 && adminUserId === admin.userId ? storedJob() : null
  )),
  beginJob: vi.fn(async () => true),
  listStudents: vi.fn(async () => []),
  listAssessments: vi.fn(async () => []),
  listCounseling: vi.fn(async () => []),
  completeJob: vi.fn(async () => storedJob({ status: 'completed' })),
  acknowledgeDownload: vi.fn(async () => storedJob({
    status: 'completed',
    completedAt: '2026-07-16T02:05:00.000Z',
    downloadedAt: '2026-07-16T02:06:00.000Z',
  })),
  ...overrides,
})

describe('administrator export contracts', () => {
  beforeEach(() => vi.stubGlobal('defineEventHandler', (handler: unknown) => handler))

  it('accepts only the immutable student-filter snapshot and rejects raw phone or unknown fields', async () => {
    await expect(parseExportCreateBody('application/json', JSON.stringify({ filters: filterSnapshot })))
      .resolves.toEqual(filterSnapshot)
    for (const filters of [
      { query: '010-1234-5678' },
      { school: '010(1234)5678' },
      { phoneList: ['01012345678'] },
      { campaignId: Number.MAX_SAFE_INTEGER + 1 },
      { dateFrom: '2026-02-30' },
    ]) {
      await expect(parseExportCreateBody('application/json', JSON.stringify({ filters })))
        .rejects.toMatchObject({ code: 'EXPORT_INVALID' })
    }
  })

  it('round-trips an exact microsecond created_at/id cursor and rejects non-canonical variants', () => {
    const cursor = encodeExportCursor({ createdAt, id: Number.MAX_SAFE_INTEGER })
    expect(decodeExportCursor(cursor)).toEqual({ createdAt, id: Number.MAX_SAFE_INTEGER })
    expect(() => decodeExportCursor(`${cursor}=`)).toThrowError(AppError)
    expect(() => decodeExportCursor(encodeExportCursor({ createdAt, id: 71 }).replace(/.$/u, 'A')))
      .toThrowError(AppError)
  })

  it('creates the immutable cutoff first, rejects aggregate totals above 30,000, and audits one export unit', async () => {
    const overLimit = dependencies({
      countRows: vi.fn(async () => ({ students: 10_001, assessments: 10_000, counseling: 10_000 })),
    })
    await expect(createAdminExportService(overLimit).create(filterSnapshot, {
      adminUserId: admin.userId,
      traceId: requestId,
    })).rejects.toMatchObject({ code: 'EXPORT_FILTER_REQUIRED' })
    expect(overLimit.createJob).toHaveBeenCalledOnce()
    expect(overLimit.countRows).toHaveBeenCalledWith(filterSnapshot, {
      adminUserId: admin.userId,
      cutoff: createdAt,
      jobId: 71,
    })
    expect(overLimit.failJob).toHaveBeenCalledWith({
      adminUserId: admin.userId,
      errorCode: 'EXPORT_ROW_LIMIT_EXCEEDED',
      jobId: 71,
    })

    const allowed = dependencies()
    await expect(createAdminExportService(allowed).create(filterSnapshot, {
      adminUserId: admin.userId,
      traceId: requestId,
    })).resolves.toMatchObject({ id: 71, status: 'created' })
    expect(allowed.countRows).toHaveBeenCalledWith(filterSnapshot, {
      adminUserId: admin.userId,
      cutoff: createdAt,
      jobId: 71,
    })
    expect(allowed.recordExportAudit).toHaveBeenCalledOnce()
    expect(allowed.recordExportAudit).toHaveBeenCalledWith({
      adminUserId: admin.userId,
      filterSnapshot,
      jobId: 71,
      traceId: requestId,
    })
  })

  it('best-effort terminates a created job when authoritative counting or audit storage fails', async () => {
    for (const failingDependency of ['countRows', 'recordExportAudit'] as const) {
      const deps = dependencies({
        [failingDependency]: vi.fn(async () => { throw new Error('UPSTREAM_PRIVATE_DETAIL') }),
      })
      await expect(createAdminExportService(deps).create(filterSnapshot, {
        adminUserId: admin.userId,
        traceId: requestId,
      })).rejects.toThrowError('UPSTREAM_PRIVATE_DETAIL')
      expect(deps.failJob).toHaveBeenCalledWith({
        adminUserId: admin.userId,
        errorCode: 'EXPORT_INTERNAL_ERROR',
        jobId: 71,
      })
    }
  })

  it('requires recent AAL2 for create and every page, and always scopes the job to its creator', async () => {
    const deps = dependencies()
    const service = createAdminExportService(deps)
    const createEvent: { headers: Record<string, string>, status?: number } = { headers: {} }
    const create = createAdminExportHandler({
      exports: service,
      getContentType: () => 'application/json',
      getRequestId: () => requestId,
      readRawBody: async () => JSON.stringify({ filters: filterSnapshot }),
      requireAdmin: async (_event, options) => {
        expect(options).toEqual({ recentAuthMinutes: 15 })
        return admin
      },
      setHeader: (_event, name, value) => { createEvent.headers[name] = value },
      setStatus: (_event, status) => { createEvent.status = status },
    })
    await create(createEvent)
    expect(createEvent.headers['cache-control']).toBe('private, no-store')

    const pageEvent: { headers: Record<string, string>, status?: number } = { headers: {} }
    const page = createAdminExportStudentsHandler({
      exports: service,
      getParam: () => '71',
      getQuery: () => ({}),
      getRequestId: () => requestId,
      requireAdmin: async (_event, options) => {
        expect(options).toEqual({ recentAuthMinutes: 15 })
        return admin
      },
      setHeader: (_event, name, value) => { pageEvent.headers[name] = value },
      setStatus: (_event, status) => { pageEvent.status = status },
    })
    await page(pageEvent)
    expect(deps.loadOwnedJob).toHaveBeenCalledWith({ jobId: 71, adminUserId: admin.userId })
    expect(pageEvent.headers['cache-control']).toBe('private, no-store')
  })

  it('uses a fixed 1,000-row page, begins created jobs once, and emits only the exact batch envelope', async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      cursor: { createdAt: `2026-07-15T02:00:00.${String(index).padStart(6, '0')}Z`, id: index + 1 },
      item: {
        nickname: `학생${index}`,
        phone: '01012345678',
        schoolName: '광주고등학교',
        currentStage: 'high3' as const,
        region: 'gwangju' as const,
        primaryCareer: 'art_photo' as const,
        secondaryCareer: 'video' as const,
        totalParticipation: 2,
        latestResultAt: createdAt,
        recommendedFaculty: '윤태준',
        assignedFaculty: null,
        counselingStatus: 'new' as const,
      },
    }))
    const deps = dependencies({ listStudents: vi.fn(async input => {
      expect(input.limit).toBe(1_000)
      expect(input.cutoff).toBe(createdAt)
      return rows.slice(0, 1_000)
    }) })
    const result = await createAdminExportService(deps).students(71, undefined, { adminUserId: admin.userId })

    expect(deps.beginJob).toHaveBeenCalledOnce()
    expect(result.items).toHaveLength(1_000)
    expect(Object.keys(result).sort()).toEqual(['items', 'nextCursor'])
    expect(decodeExportCursor(result.nextCursor!)).toEqual(rows[999]!.cursor)
  })

  it('lets two concurrent first pages proceed when one created-to-fetching CAS loses the race', async () => {
    let loadCount = 0
    const deps = dependencies({
      beginJob: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      loadOwnedJob: vi.fn(async () => {
        loadCount += 1
        return loadCount <= 2 ? storedJob() : storedJob({ status: 'fetching' })
      }),
    })
    const service = createAdminExportService(deps)

    const [first, second] = await Promise.all([
      service.students(71, undefined, { adminUserId: admin.userId }),
      service.students(71, undefined, { adminUserId: admin.userId }),
    ])

    expect(first.items).toEqual([])
    expect(second.items).toEqual([])
    expect(deps.beginJob).toHaveBeenCalledTimes(2)
    expect(deps.loadOwnedJob).toHaveBeenCalledTimes(3)
    expect(deps.listStudents).toHaveBeenCalledTimes(2)
  })

  it('fails closed when a lost begin CAS reloads a different stored job identity', async () => {
    const deps = dependencies({
      beginJob: vi.fn(async () => false),
      loadOwnedJob: vi.fn()
        .mockResolvedValueOnce(storedJob())
        .mockResolvedValueOnce(storedJob({
          createdAt: '2026-07-16T02:00:00.123457Z',
          status: 'fetching',
        })),
    })

    await expect(createAdminExportService(deps).students(71, undefined, {
      adminUserId: admin.userId,
    })).rejects.toThrowError('ADMIN_EXPORT_STORE_INVALID')
    expect(deps.listStudents).not.toHaveBeenCalled()
  })

  it('strictly decodes the whole result snapshot before projecting the participation DTO', () => {
    const raw = {
      id: 81,
      created_at: createdAt,
      completed_at: createdAt,
      result_snapshot: makeResultSnapshot(),
      prospect: {
        id: 42,
        nickname: '선명한프레임42',
        assessments: [{ id: 81, created_at: createdAt }],
      },
    }
    expect(decodeAssessmentExportRow(raw)).toMatchObject({
      cursor: { id: 81, createdAt },
      item: {
        nickname: '선명한프레임42',
        sequence: 1,
        documentaryScore: expect.any(Number),
        recommendedResources: expect.any(Array),
      },
    })
    expect(() => decodeAssessmentExportRow({
      ...raw,
      result_snapshot: { ...makeResultSnapshot(), privateField: true },
    })).toThrowError('ADMIN_EXPORT_STORE_INVALID')
  })

  it('projects a legacy result snapshot through the frozen in-memory narrative upgrade', () => {
    const current = makeResultSnapshot()
    const { careerNarrative: _removed, ...legacy } = current
    const raw = {
      id: 82,
      created_at: createdAt,
      completed_at: createdAt,
      result_snapshot: legacy,
      prospect: {
        id: 42,
        nickname: '선명한프레임42',
        assessments: [{ id: 82, created_at: createdAt }],
      },
    }

    const first = decodeAssessmentExportRow(raw)
    const second = decodeAssessmentExportRow(raw)

    expect(first).toEqual(second)
    expect(first.item.recommendedResources).toContain('기초사진실기')
  })

  it('strictly projects counseling recommendation snapshots and keeps result absent', () => {
    const raw = {
      id: 91,
      created_at: createdAt,
      contact_method: 'text',
      availability: 'weekday_evening',
      inquiry: '영상과 AI 편집 진로가 궁금해요.',
      status: 'contacted',
      contacted_at: createdAt,
      completed_at: null,
      admin_note: '전화 후 방문 상담 예정',
      prospect: { nickname: '선명한프레임42' },
      assigned_faculty: { name: '윤태준' },
      recommendations: [
        { role: 'primary', rank: 1, faculty_name_snapshot: '윤태준' },
        { role: 'backup', rank: 1, faculty_name_snapshot: '조대연' },
        { role: 'specialist', rank: 1, faculty_name_snapshot: '박재웅' },
      ],
    }
    expect(decodeCounselingExportRow(raw).item).toMatchObject({
      recommendedPrimaryFaculty: '윤태준',
      recommendedBackupFaculty: '조대연',
      specialistFaculty: ['박재웅'],
      result: null,
      adminNote: '전화 후 방문 상담 예정',
    })
    expect(() => decodeCounselingExportRow({
      ...raw,
      recommendations: [...raw.recommendations, { role: 'primary', rank: 1, faculty_name_snapshot: '김사라' }],
    })).toThrowError('ADMIN_EXPORT_STORE_INVALID')
  })

  it('accepts only strict terminal completion bodies with an aggregate maximum of 30,000', async () => {
    await expect(parseExportCompletionBody('application/json', JSON.stringify({
      status: 'completed',
      studentRowCount: 10_000,
      participationRowCount: 10_000,
      counselingRowCount: 10_000,
      downloaded: false,
    }))).resolves.toMatchObject({ status: 'completed', downloaded: false })
    for (const body of [
      { status: 'fetching', studentRowCount: 0, participationRowCount: 0, counselingRowCount: 0 },
      { status: 'completed', studentRowCount: 10_000, participationRowCount: 10_000, counselingRowCount: 10_000, downloaded: true },
      { status: 'completed', studentRowCount: 30_000, participationRowCount: 1, counselingRowCount: 0, downloaded: false },
      { status: 'failed', studentRowCount: 0, participationRowCount: 0, counselingRowCount: 0, downloaded: true, errorCode: 'EXPORT_FETCH_FAILED' },
      { status: 'failed', studentRowCount: 0, participationRowCount: 0, counselingRowCount: 0, downloaded: false, errorCode: 'UNSTABLE_ERROR' },
    ]) {
      await expect(parseExportCompletionBody('application/json', JSON.stringify(body)))
        .rejects.toMatchObject({ code: 'EXPORT_INVALID' })
    }
  })

  it('accepts completed audit counts only when they match the authoritative cutoff counts', async () => {
    const deps = dependencies({
      loadOwnedJob: vi.fn(async () => storedJob({ status: 'fetching' })),
    })
    const service = createAdminExportService(deps)
    await expect(service.complete(71, {
      status: 'completed',
      studentRowCount: 0,
      participationRowCount: 0,
      counselingRowCount: 0,
      downloaded: false,
    }, { adminUserId: admin.userId })).rejects.toMatchObject({ code: 'EXPORT_INVALID' })
    expect(deps.completeJob).not.toHaveBeenCalled()

    await expect(service.complete(71, {
      status: 'completed',
      studentRowCount: 3,
      participationRowCount: 5,
      counselingRowCount: 1,
      downloaded: false,
    }, { adminUserId: admin.userId })).resolves.toMatchObject({ status: 'completed' })
    expect(deps.countRows).toHaveBeenCalledWith(filterSnapshot, {
      adminUserId: admin.userId,
      cutoff: createdAt,
      jobId: 71,
    })
  })

  it('acknowledges a browser download only for the owning completed job and is idempotent', async () => {
    const completed = storedJob({
      status: 'completed',
      completedAt: '2026-07-16T02:05:00.000Z',
    })
    const acknowledged = storedJob({
      status: 'completed',
      completedAt: '2026-07-16T02:05:00.000Z',
      downloadedAt: '2026-07-16T02:06:00.000Z',
    })
    const deps = dependencies({
      loadOwnedJob: vi.fn()
        .mockResolvedValueOnce(completed)
        .mockResolvedValueOnce(acknowledged),
      acknowledgeDownload: vi.fn(async () => acknowledged),
    })
    const service = createAdminExportService(deps)

    await expect(service.downloaded(71, { adminUserId: admin.userId })).resolves.toMatchObject({
      id: 71,
      status: 'completed',
      downloadedAt: '2026-07-16T02:06:00.000Z',
    })
    await expect(service.downloaded(71, { adminUserId: admin.userId })).resolves.toMatchObject({
      id: 71,
      status: 'completed',
      downloadedAt: '2026-07-16T02:06:00.000Z',
    })
    expect(deps.acknowledgeDownload).toHaveBeenCalledTimes(1)

    const wrongOwner = dependencies({ loadOwnedJob: vi.fn(async () => null) })
    await expect(createAdminExportService(wrongOwner).downloaded(71, {
      adminUserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    })).rejects.toMatchObject({ code: 'EXPORT_NOT_FOUND' })
    expect(wrongOwner.acknowledgeDownload).not.toHaveBeenCalled()

    const fetching = dependencies({
      loadOwnedJob: vi.fn(async () => storedJob({ status: 'fetching' })),
    })
    await expect(createAdminExportService(fetching).downloaded(71, {
      adminUserId: admin.userId,
    })).rejects.toMatchObject({ code: 'EXPORT_CONFLICT' })
    expect(fetching.acknowledgeDownload).not.toHaveBeenCalled()
  })

  it('applies the same recent-auth and private response boundary to all remaining endpoints', async () => {
    const deps = dependencies({
      countRows: vi.fn(async () => ({ students: 0, assessments: 0, counseling: 0 })),
      loadOwnedJob: vi.fn(async () => storedJob({ status: 'fetching' })),
    })
    const service = createAdminExportService(deps)
    const handlers = [
      createAdminExportAssessmentsHandler({
        exports: service,
        getParam: () => '71',
        getQuery: () => ({}),
        getRequestId: () => requestId,
        requireAdmin: async (_event, options) => { expect(options).toEqual({ recentAuthMinutes: 15 }); return admin },
        setHeader: (event, name, value) => { (event as { headers: Record<string, string> }).headers[name] = value },
        setStatus: () => undefined,
      }),
      createAdminExportCounselingHandler({
        exports: service,
        getParam: () => '71',
        getQuery: () => ({}),
        getRequestId: () => requestId,
        requireAdmin: async (_event, options) => { expect(options).toEqual({ recentAuthMinutes: 15 }); return admin },
        setHeader: (event, name, value) => { (event as { headers: Record<string, string> }).headers[name] = value },
        setStatus: () => undefined,
      }),
      createAdminExportCompleteHandler({
        exports: service,
        getContentType: () => 'application/json',
        getParam: () => '71',
        getRequestId: () => requestId,
        readRawBody: async () => JSON.stringify({
          status: 'completed', studentRowCount: 0, participationRowCount: 0,
          counselingRowCount: 0, downloaded: false,
        }),
        requireAdmin: async (_event, options) => { expect(options).toEqual({ recentAuthMinutes: 15 }); return admin },
        setHeader: (event, name, value) => { (event as { headers: Record<string, string> }).headers[name] = value },
        setStatus: () => undefined,
      }),
    ]
    for (const handler of handlers) {
      const event = { headers: {} as Record<string, string> }
      const result = await handler(event)
      expect('data' in result).toBe(true)
      expect(event.headers['cache-control']).toBe('private, no-store')
    }

    const acknowledged = storedJob({
      status: 'completed',
      completedAt: '2026-07-16T02:05:00.000Z',
      downloadedAt: '2026-07-16T02:06:00.000Z',
    })
    const downloadedHandler = createAdminExportDownloadedHandler({
      exports: createAdminExportService(dependencies({
        loadOwnedJob: vi.fn(async () => acknowledged),
      })),
      getParam: () => '71',
      getRequestId: () => requestId,
      requireAdmin: async (_event, options) => { expect(options).toEqual({ recentAuthMinutes: 15 }); return admin },
      setHeader: (event, name, value) => { (event as { headers: Record<string, string> }).headers[name] = value },
      setStatus: () => undefined,
    })
    const downloadedEvent = { headers: {} as Record<string, string> }
    expect('data' in await downloadedHandler(downloadedEvent)).toBe(true)
    expect(downloadedEvent.headers['cache-control']).toBe('private, no-store')
  })
})
