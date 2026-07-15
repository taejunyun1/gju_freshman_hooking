import type { ApiFailure } from '../../shared/types/api'

type AppErrorCode = ApiFailure['error']['code']

const publicMessages: Record<AppErrorCode, string> = {
  AUTH_FAILED: '입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.',
  VALIDATION_FAILED: '입력 항목을 다시 확인해 주세요.',
  RATE_LIMITED: '잠시 후 다시 시도해 주세요.',
  INTERNAL_ERROR: '잠시 후 다시 시도해 주세요.',
  ADMIN_REQUIRED: '관리자 권한을 확인할 수 없습니다.',
  MFA_REQUIRED: '추가 인증이 필요합니다.',
  REAUTH_REQUIRED: '최근 인증이 필요합니다.',
  RECOVERY_INVALID: '복구 정보를 확인하거나 새 복구 코드를 요청해 주세요.',
  ASSESSMENT_INVALID: '평가 응답을 다시 확인해 주세요.',
  ASSESSMENT_CATALOG_STALE: '평가 선택지가 변경되었습니다. 다시 확인해 주세요.',
  RESULT_NOT_FOUND: '요청한 결과를 찾을 수 없습니다.',
}

const statusCodes: Record<AppErrorCode, number> = {
  AUTH_FAILED: 401,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  ADMIN_REQUIRED: 403,
  MFA_REQUIRED: 403,
  REAUTH_REQUIRED: 403,
  RECOVERY_INVALID: 401,
  ASSESSMENT_INVALID: 422,
  ASSESSMENT_CATALOG_STALE: 409,
  RESULT_NOT_FOUND: 404,
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly statusCode: number

  constructor(code: AppErrorCode) {
    super(code)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCodes[code]
  }
}

export const toAppError = (error: unknown): AppError => error instanceof AppError ? error : new AppError('INTERNAL_ERROR')

export const toApiFailure = (error: unknown, requestId: string): ApiFailure => {
  const appError = toAppError(error)
  return {
    error: { code: appError.code, message: publicMessages[appError.code] },
    requestId,
  }
}
