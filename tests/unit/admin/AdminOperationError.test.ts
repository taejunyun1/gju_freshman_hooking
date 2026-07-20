import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'

import { explainAdminOperationError } from '../../../app/utils/admin-operation-error'

const apiFailure = (code: string, requestId = 'req-17') => ({
  data: { error: { code, message: 'private database detail' }, requestId },
})

describe('administrator operation error guidance', () => {
  it.each([
    ['ADMIN_REQUIRED', 'counseling', 'loading', '로그인 세션', true, false],
    ['REAUTH_REQUIRED', 'export', 'authenticating', '로그인 세션', true, false],
    ['COUNSELING_INVALID', 'counseling', 'loading', '필터', false, true],
    ['EXPORT_INVALID', 'export', 'checking', '필터', false, true],
    ['EXPORT_FILTER_REQUIRED', 'export', 'collecting', '허용 범위', false, true],
    ['COUNSELING_CONFLICT', 'counseling', 'pagination', '다른 관리자', false, true],
    ['EXPORT_CONFLICT', 'export', 'finalizing', '다른 작업', false, true],
    ['EXPORT_NOT_FOUND', 'export', 'confirming', '만료', false, true],
  ] as const)('maps %s to an actionable safe explanation', (code, operation, phase, reason, requiresLogin, canRetry) => {
    const failure = explainAdminOperationError(apiFailure(code), { operation, phase })

    expect(failure).toMatchObject({
      reason: expect.stringContaining(reason),
      requestId: 'req-17',
      requiresLogin,
      canRetry,
    })
    expect(JSON.stringify(failure)).not.toContain('private database detail')
  })

  it('maps network, invalid response, workbook and download failures by the current export phase', () => {
    const invalidResponse = new ZodError([{ code: 'custom', path: [], message: 'private schema detail' }])
    const cases = [
      [new TypeError('Failed to fetch'), { operation: 'counseling' as const, phase: 'loading' }, '인터넷 연결'],
      [invalidResponse, { operation: 'export' as const, phase: 'collecting' }, '응답 형식'],
      [new Error('EXPORT_WORKBOOK_FAILED'), { operation: 'export' as const, phase: 'building' }, '워크북'],
      [new Error('EXPORT_DOWNLOAD_FAILED'), { operation: 'export' as const, phase: 'downloading' }, '다운로드'],
    ] as const

    for (const [error, context, expected] of cases) {
      const failure = explainAdminOperationError(error, context)
      expect(failure.reason).toContain(expected)
      expect(failure.requestId).toBeNull()
      expect(JSON.stringify(failure)).not.toContain('private')
    }
  })

  it('hides unknown server messages and only renders a validated request identifier', () => {
    const unknown = explainAdminOperationError(apiFailure('INTERNAL_ERROR', 'req-17'), {
      operation: 'export',
      phase: 'confirming',
    })
    const unsafeRequestId = explainAdminOperationError(apiFailure('INTERNAL_ERROR', '<script>alert(1)</script>'), {
      operation: 'counseling',
      phase: 'loading',
    })

    expect(unknown).toMatchObject({ requestId: 'req-17', requiresLogin: false, canRetry: true })
    expect(unknown.reason).toContain('완료 확인')
    expect(JSON.stringify(unknown)).not.toContain('private database detail')
    expect(unsafeRequestId.requestId).toBeNull()
  })

  it('never exposes arbitrary local error messages', () => {
    const failure = explainAdminOperationError(new Error('secret sql text'), {
      operation: 'counseling',
      phase: 'loading',
    })

    expect(JSON.stringify(failure)).not.toContain('secret sql text')
    expect(failure.canRetry).toBe(true)
  })

  it('recognizes an ofetch network cause without traversing circular or unbounded cause chains', () => {
    const fetchError = { name: 'FetchError', cause: new TypeError('private socket failure') }
    const circular: { cause?: unknown } = {}
    circular.cause = circular
    const deeplyNested = Array.from({ length: 8 }).reduce<unknown>((cause) => ({ cause }), new TypeError('too deep'))

    expect(explainAdminOperationError(fetchError, { operation: 'export', phase: 'collecting' }).reason).toContain('인터넷 연결')
    expect(explainAdminOperationError(circular, { operation: 'counseling', phase: 'loading' }).reason).not.toContain('인터넷 연결')
    expect(explainAdminOperationError(deeplyNested, { operation: 'counseling', phase: 'loading' }).reason).not.toContain('인터넷 연결')
  })
})
