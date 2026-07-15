import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import {
  getServerAssessmentCompletionService,
  type AssessmentHistoryItem,
  type OwnedAssessmentContext,
} from '../../modules/assessment/completion'
import { getAnonymousVisitorId } from '../../utils/anonymous-visitor'
import { AppError, toApiFailure } from '../../utils/app-error'
import { studentSessionCookie } from '../../utils/student-request-security'

type AssessmentHistoryHandlerDependencies = {
  assessment: Pick<ReturnType<typeof getServerAssessmentCompletionService>, 'getAssessmentHistory'>
  getContext: (event: unknown) => OwnedAssessmentContext
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAssessmentHistoryHandler = (
  dependencies: AssessmentHistoryHandlerDependencies,
) => async (event: unknown): Promise<
  ApiSuccess<{ items: AssessmentHistoryItem[] }> | ApiFailure
> => {
  const context = dependencies.getContext(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  try {
    return {
      data: await dependencies.assessment.getAssessmentHistory(context),
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

export default defineEventHandler(event => createAssessmentHistoryHandler({
  assessment: getServerAssessmentCompletionService(),
  getContext: requestContext,
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
