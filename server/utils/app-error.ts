import type { ApiFailure } from '../../shared/types/api'

type AppErrorCode = ApiFailure['error']['code']

const publicMessages: Record<AppErrorCode, string> = {
  AUTH_FAILED: '입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.',
  VALIDATION_FAILED: '입력 항목을 다시 확인해 주세요.',
  RATE_LIMITED: '잠시 후 다시 시도해 주세요.',
  INTERNAL_ERROR: '잠시 후 다시 시도해 주세요.',
}

const statusCodes: Record<AppErrorCode, number> = {
  AUTH_FAILED: 401,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
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
