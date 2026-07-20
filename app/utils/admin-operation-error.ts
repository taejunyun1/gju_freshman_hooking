import { z } from 'zod'

export type AdminOperationContext = {
  operation: 'counseling' | 'export'
  phase: string
}

export type AdminOperationFailure = {
  reason: string
  action: string
  requestId: string | null
  requiresLogin: boolean
  canRetry: boolean
}

type SafeFailurePayload = {
  code: string
  requestId: string | null
  status: number | null
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/u
const AUTH_CODES = new Set(['ADMIN_REQUIRED', 'ADMIN_SESSION_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'])
const LOCAL_CODES = new Set([
  'EXPORT_DOWNLOAD_FAILED',
  'EXPORT_PAGE_INVALID',
  'EXPORT_WORKBOOK_FAILED',
  'EXPORT_WORKBOOK_MODULE_INVALID',
])

const asSafeString = (value: unknown): string => typeof value === 'string' ? value : ''
const asStatus = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) ? value : null

const readSafeFailurePayload = (error: unknown): SafeFailurePayload => {
  if (typeof error !== 'object' || error === null) return { code: '', requestId: null, status: null }
  const value = error as {
    data?: { error?: { code?: unknown }, requestId?: unknown }
    response?: { status?: unknown, _data?: { error?: { code?: unknown }, requestId?: unknown } }
    status?: unknown
    statusCode?: unknown
    message?: unknown
  }
  const data = value.data ?? value.response?._data
  const responseCode = asSafeString(data?.error?.code)
  const localCode = asSafeString(value.message)
  const code = responseCode || (LOCAL_CODES.has(localCode) ? localCode : '')
  const rawRequestId = data?.requestId
  return {
    code,
    requestId: typeof rawRequestId === 'string' && SAFE_REQUEST_ID.test(rawRequestId) ? rawRequestId : null,
    status: asStatus(value.response?.status) ?? asStatus(value.status) ?? asStatus(value.statusCode),
  }
}

const exportPhaseLabel = (phase: string): string => {
  if (phase === 'checking') return '범위 확인'
  if (phase === 'authenticating') return '인증 확인'
  if (phase === 'collecting') return '데이터 수집'
  if (phase === 'building') return '워크북 생성'
  if (phase === 'downloading') return '다운로드'
  if (phase === 'confirming') return '완료 확인'
  if (phase === 'finalizing') return '완료 처리'
  return '작업 처리'
}

const fallback = (payload: SafeFailurePayload, context: AdminOperationContext): AdminOperationFailure => ({
  reason: context.operation === 'counseling'
    ? '서버가 상담 목록을 처리하지 못했습니다.'
    : `내보내기 ${exportPhaseLabel(context.phase)} 단계에서 작업을 처리하지 못했습니다.`,
  action: '잠시 후 다시 시도하고, 반복되면 요청 번호를 운영 담당자에게 전달해 주세요.',
  requestId: payload.requestId,
  requiresLogin: false,
  canRetry: true,
})

export const explainAdminOperationError = (
  error: unknown,
  context: AdminOperationContext,
): AdminOperationFailure => {
  const payload = readSafeFailurePayload(error)
  if (AUTH_CODES.has(payload.code) || payload.status === 401 || payload.status === 403) {
    return {
      reason: '관리자 로그인 세션이 만료되었거나 권한을 확인할 수 없습니다.',
      action: '다시 로그인한 뒤 작업을 시작해 주세요.',
      requestId: payload.requestId,
      requiresLogin: true,
      canRetry: false,
    }
  }
  if (payload.code === 'COUNSELING_INVALID' || payload.code === 'EXPORT_INVALID') {
    return {
      reason: '선택한 필터 값이 올바르지 않습니다.',
      action: '날짜와 선택 조건을 확인한 뒤 다시 시도해 주세요.',
      requestId: payload.requestId,
      requiresLogin: false,
      canRetry: true,
    }
  }
  if (payload.code === 'EXPORT_FILTER_REQUIRED') {
    return {
      reason: '내보낼 결과가 XLSX 허용 범위를 초과했습니다.',
      action: '내보내기 대상·담당 교수·날짜 필터로 범위를 줄여 주세요.',
      requestId: payload.requestId,
      requiresLogin: false,
      canRetry: true,
    }
  }
  if (payload.code === 'COUNSELING_CONFLICT' || payload.code === 'COUNSELING_VERSION_CONFLICT') {
    return {
      reason: '다른 관리자가 상담 정보를 먼저 변경했습니다.',
      action: '목록을 새로고침한 뒤 최신 상태에서 다시 진행해 주세요.',
      requestId: payload.requestId,
      requiresLogin: false,
      canRetry: true,
    }
  }
  if (payload.code === 'EXPORT_CONFLICT') {
    return {
      reason: '같은 범위의 다른 작업이 먼저 처리되고 있습니다.',
      action: '잠시 후 다시 시도하거나 범위를 좁혀 새 작업을 시작해 주세요.',
      requestId: payload.requestId,
      requiresLogin: false,
      canRetry: true,
    }
  }
  if (payload.code === 'EXPORT_WORKBOOK_FAILED' || payload.code === 'EXPORT_WORKBOOK_MODULE_INVALID') {
    return {
      reason: '워크북 파일을 생성하지 못했습니다.',
      action: '잠시 후 다시 시도하고, 반복되면 요청 번호를 운영 담당자에게 전달해 주세요.',
      requestId: payload.requestId,
      requiresLogin: false,
      canRetry: true,
    }
  }
  if (payload.code === 'EXPORT_DOWNLOAD_FAILED') {
    return {
      reason: '브라우저에서 XLSX 다운로드를 시작하지 못했습니다.',
      action: '브라우저의 다운로드 차단을 확인한 뒤 다시 시도해 주세요.',
      requestId: payload.requestId,
      requiresLogin: false,
      canRetry: true,
    }
  }
  if (error instanceof z.ZodError || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ZodError')) {
    return {
      reason: context.operation === 'counseling'
        ? '상담 목록 응답 형식을 확인할 수 없습니다.'
        : `내보내기 ${exportPhaseLabel(context.phase)} 단계의 응답 형식을 확인할 수 없습니다.`,
      action: '잠시 후 다시 시도하고, 반복되면 요청 번호를 운영 담당자에게 전달해 주세요.',
      requestId: payload.requestId,
      requiresLogin: false,
      canRetry: true,
    }
  }
  if (error instanceof TypeError) {
    return {
      reason: context.operation === 'export'
        ? `내보내기 ${exportPhaseLabel(context.phase)} 중 인터넷 연결 또는 서버 응답을 확인할 수 없습니다.`
        : '인터넷 연결 또는 서버 응답을 확인할 수 없습니다.',
      action: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
      requestId: payload.requestId,
      requiresLogin: false,
      canRetry: true,
    }
  }
  return fallback(payload, context)
}
