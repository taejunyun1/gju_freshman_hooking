import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../../../server/utils/app-error'

const publicId = '22222222-2222-4222-8222-222222222222'
const context = {
  requestId: 'request-id',
  sessionToken: 'opaque-session-token',
}

const dependencies = () => ({
  consumeRateLimit: vi.fn().mockResolvedValue(true),
  createReport: vi.fn().mockResolvedValue({ accepted: true, created: true }),
  getStudentSession: vi.fn().mockResolvedValue({
    expiresAt: '2026-07-16T12:00:00.000Z',
    nickname: '고요한프레임27',
    prospectId: 27,
  }),
  loadOwnedAssessment: vi.fn().mockResolvedValue({
    assessmentId: 701,
    publicId,
  }),
})

describe('career narrative report service', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getCookie', () => undefined)
    vi.stubGlobal('getHeader', () => undefined)
    vi.stubGlobal('getRequestURL', () => new URL('https://photo-next.example/api/career-narrative/report'))
    vi.stubGlobal('readRawBody', () => undefined)
    vi.stubGlobal('setResponseHeader', () => undefined)
    vi.stubGlobal('setResponseStatus', () => undefined)
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { supabaseUrl: 'https://example.supabase.co' },
      supabaseSecretKey: 'test-secret',
    }))
  })

  it('creates one category-only report for the owned assessment', async () => {
    const deps = dependencies()
    const { createCareerNarrativeReportService } = await import(
      '../../../server/modules/assessment/career-narrative-report'
    )
    const service = createCareerNarrativeReportService(deps)

    await expect(service.report({
      assessmentPublicId: publicId,
      category: 'unsafe',
    }, context)).resolves.toEqual({ accepted: true })

    expect(deps.consumeRateLimit).toHaveBeenCalledWith({
      key: 'prospect:27',
      limit: 3,
      route: '/api/career-narrative/report',
      window: '24 hours',
    })
    expect(deps.loadOwnedAssessment).toHaveBeenCalledWith({
      prospectId: 27,
      publicId,
    })
    expect(deps.createReport).toHaveBeenCalledWith({
      assessmentId: 701,
      category: 'unsafe',
      prospectId: 27,
    })
    expect(JSON.stringify(deps.createReport.mock.calls)).not.toMatch(
      /generated|narrative|phone|nickname|provider|model|prompt/iu,
    )
  })

  it('returns the same public success for a duplicate open report', async () => {
    const deps = dependencies()
    deps.createReport.mockResolvedValue({ accepted: true, created: false })
    const { createCareerNarrativeReportService } = await import(
      '../../../server/modules/assessment/career-narrative-report'
    )

    await expect(createCareerNarrativeReportService(deps).report({
      assessmentPublicId: publicId,
      category: 'inaccurate',
    }, context)).resolves.toEqual({ accepted: true })
  })

  it.each([
    ['extra body field', { assessmentPublicId: publicId, category: 'unsafe', detail: 'free text' }],
    ['unknown category', { assessmentPublicId: publicId, category: 'harmful' }],
    ['invalid result ID', { assessmentPublicId: 'not-a-uuid', category: 'confusing' }],
    ['unsupported UUID version', {
      assessmentPublicId: '22222222-2222-7222-8222-222222222222',
      category: 'confusing',
    }],
  ])('rejects %s without touching the report store', async (_name, input) => {
    const deps = dependencies()
    const { createCareerNarrativeReportService } = await import(
      '../../../server/modules/assessment/career-narrative-report'
    )

    await expect(createCareerNarrativeReportService(deps).report(input, context))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(deps.createReport).not.toHaveBeenCalled()
  })

  it('accepts an already-resolved duplicate without rewriting it', async () => {
    const duplicateInsert = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23505' },
    })
    const existingQuery = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 91,
          assessment_id: 701,
          prospect_id: 27,
          status: 'resolved_copy',
        },
        error: null,
      }),
    }
    existingQuery.eq.mockReturnValue(existingQuery)
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: duplicateInsert }),
    })
    const from = vi.fn()
      .mockReturnValueOnce({
        insert,
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue(existingQuery),
      })
    const { createSupabaseCareerNarrativeReportDependencies } = await import(
      '../../../server/modules/assessment/career-narrative-report'
    )
    const adapter = createSupabaseCareerNarrativeReportDependencies({ from } as never)

    await expect(adapter.createReport({
      assessmentId: 701,
      category: 'unsafe',
      prospectId: 27,
    })).resolves.toEqual({ accepted: true, created: false })

    expect(existingQuery.eq).toHaveBeenNthCalledWith(1, 'assessment_id', 701)
    expect(existingQuery.eq).toHaveBeenNthCalledWith(2, 'prospect_id', 27)
    expect(insert).toHaveBeenCalledWith({
      assessment_id: 701,
      category: 'unsafe',
      prospect_id: 27,
    })
    expect(JSON.stringify(insert.mock.calls)).not.toMatch(
      /generated|narrative|phone|nickname|provider|model|prompt/iu,
    )
  })

  it('sanitizes an expired session, ownership failure, and rate limit', async () => {
    const { createCareerNarrativeReportService } = await import(
      '../../../server/modules/assessment/career-narrative-report'
    )
    const expired = dependencies()
    expired.getStudentSession.mockResolvedValue(null)
    await expect(createCareerNarrativeReportService(expired).report({
      assessmentPublicId: publicId,
      category: 'unsafe',
    }, context)).rejects.toEqual(new AppError('AUTH_FAILED'))

    const foreign = dependencies()
    foreign.loadOwnedAssessment.mockResolvedValue(null)
    await expect(createCareerNarrativeReportService(foreign).report({
      assessmentPublicId: publicId,
      category: 'unsafe',
    }, context)).rejects.toEqual(new AppError('RESULT_NOT_FOUND'))

    const limited = dependencies()
    limited.consumeRateLimit.mockResolvedValue(false)
    await expect(createCareerNarrativeReportService(limited).report({
      assessmentPublicId: publicId,
      category: 'unsafe',
    }, context)).rejects.toEqual(new AppError('RATE_LIMITED'))
  })
})

describe('career narrative report HTTP contract', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getCookie', () => undefined)
    vi.stubGlobal('getHeader', () => undefined)
    vi.stubGlobal('setResponseHeader', () => undefined)
    vi.stubGlobal('setResponseStatus', () => undefined)
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { supabaseUrl: 'https://example.supabase.co' },
      supabaseSecretKey: 'test-secret',
    }))
  })

  it('returns the exact private no-store success envelope', async () => {
    const report = vi.fn().mockResolvedValue({ accepted: true })
    const setHeader = vi.fn()
    const setStatus = vi.fn()
    const { createPostCareerNarrativeReportHandler } = await import(
      '../../../server/api/career-narrative/report.post'
    )
    const handler = createPostCareerNarrativeReportHandler({
      getContentType: () => 'application/json; charset=utf-8',
      getContext: () => context,
      readRawBody: async () => JSON.stringify({
        assessmentPublicId: publicId,
        category: 'confusing',
      }),
      report: { report },
      setHeader,
      setStatus,
    })

    await expect(handler({})).resolves.toEqual({
      data: { accepted: true },
      requestId: 'request-id',
    })
    expect(setHeader).toHaveBeenCalledWith({}, 'cache-control', 'private, no-store')
    expect(setStatus).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledWith({
      assessmentPublicId: publicId,
      category: 'confusing',
    }, context)
  })

  it('maps malformed bodies and private failures to stable public errors', async () => {
    const { createPostCareerNarrativeReportHandler } = await import(
      '../../../server/api/career-narrative/report.post'
    )
    const invalidStatus = vi.fn()
    const invalid = createPostCareerNarrativeReportHandler({
      getContentType: () => 'text/plain',
      getContext: () => context,
      readRawBody: async () => 'private narrative',
      report: { report: vi.fn() },
      setHeader: vi.fn(),
      setStatus: invalidStatus,
    })
    const invalidResponse = await invalid({})
    expect(invalidResponse).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
      requestId: 'request-id',
    })
    expect(invalidStatus).toHaveBeenCalledWith({}, 400)
    expect(JSON.stringify(invalidResponse)).not.toContain('private narrative')

    const internalStatus = vi.fn()
    const internal = createPostCareerNarrativeReportHandler({
      getContentType: () => 'application/json',
      getContext: () => context,
      readRawBody: async () => JSON.stringify({
        assessmentPublicId: publicId,
        category: 'unsafe',
      }),
      report: { report: vi.fn().mockRejectedValue(new Error('database row 701')) },
      setHeader: vi.fn(),
      setStatus: internalStatus,
    })
    const internalResponse = await internal({})
    expect(internalResponse).toMatchObject({
      error: { code: 'INTERNAL_ERROR' },
      requestId: 'request-id',
    })
    expect(internalStatus).toHaveBeenCalledWith({}, 500)
    expect(JSON.stringify(internalResponse)).not.toMatch(/database row 701/u)
  })
})
