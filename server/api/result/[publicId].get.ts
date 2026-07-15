import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import type { ResultSnapshot } from '../../../shared/types/result'
import {
  getServerAssessmentCompletionService,
  type OwnedAssessmentContext,
} from '../../modules/assessment/completion'
import { getAnonymousVisitorId } from '../../utils/anonymous-visitor'
import { AppError, toApiFailure } from '../../utils/app-error'
import { studentSessionCookie } from '../../utils/student-request-security'

type OwnedResultHandlerDependencies = {
  assessment: Pick<ReturnType<typeof getServerAssessmentCompletionService>, 'getOwnedResult'>
  getContext: (event: unknown) => OwnedAssessmentContext
  getPublicId: (event: unknown) => string
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createOwnedResultHandler = (
  dependencies: OwnedResultHandlerDependencies,
) => async (event: unknown): Promise<ApiSuccess<ResultSnapshot> | ApiFailure> => {
  const context = dependencies.getContext(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  try {
    return {
      data: await dependencies.assessment.getOwnedResult(dependencies.getPublicId(event), context),
      requestId: context.requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, context.requestId)
  }
}

const requestContext = (event: unknown): OwnedAssessmentContext => {
  const context = (event as { context?: { requestId?: unknown } }).context
  return {
    anonymousId: getAnonymousVisitorId(event),
    requestId: typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID(),
    sessionToken: getCookie(event as never, studentSessionCookie) ?? '',
  }
}

export default defineEventHandler(event => createOwnedResultHandler({
  assessment: getServerAssessmentCompletionService(),
  getContext: requestContext,
  getPublicId: requestEvent => getRouterParam(requestEvent as never, 'publicId') ?? '',
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
