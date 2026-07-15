import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import {
  getServerCounselingService,
  type CounselingRequestContext,
  type StudentCounselingStatus,
} from '../../modules/counseling/service'
import { getAnonymousVisitorId } from '../../utils/anonymous-visitor'
import { AppError, toApiFailure } from '../../utils/app-error'
import { studentSessionCookie } from '../../utils/student-request-security'

type GetCounselingHandlerDependencies = {
  counseling: Pick<ReturnType<typeof getServerCounselingService>, 'getCurrentCounseling'>
  getContext: (event: unknown) => CounselingRequestContext
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createGetCounselingHandler = (
  dependencies: GetCounselingHandlerDependencies,
) => async (event: unknown): Promise<ApiSuccess<StudentCounselingStatus | null> | ApiFailure> => {
  const context = dependencies.getContext(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  try {
    return {
      data: await dependencies.counseling.getCurrentCounseling(context),
      requestId: context.requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, context.requestId)
  }
}

const requestContext = (event: unknown): CounselingRequestContext => {
  const context = (event as { context?: { requestId?: unknown } }).context
  return {
    anonymousId: getAnonymousVisitorId(event),
    requestId: typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID(),
    sessionToken: getCookie(event as never, studentSessionCookie) ?? '',
  }
}

export default defineEventHandler(event => createGetCounselingHandler({
  counseling: getServerCounselingService(),
  getContext: requestContext,
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
