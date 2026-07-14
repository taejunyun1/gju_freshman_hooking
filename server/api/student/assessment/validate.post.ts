import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import type { ScoredAssessment } from '../../../modules/assessment/types'
import { getServerAssessmentService } from '../../../modules/assessment/service'
import { AppError, toApiFailure } from '../../../utils/app-error'
import { RequestBodyLimitError, readBoundedRequestBody } from '../../../utils/bounded-request-body'
import { studentSessionCookie } from '../../../utils/student-request-security'
import { getTrustedClientIp } from '../../../utils/trusted-client-ip'

const MAX_BODY_BYTES = 8_192
const encoder = new TextEncoder()

type ValidateAssessmentContext = {
  ip: string
  requestId: string
  sessionToken: string
}

type ValidateAssessmentHandlerDependencies = {
  assessment: Pick<ReturnType<typeof getServerAssessmentService>, 'validateAssessment'>
  getContentType: (event: unknown) => string | undefined
  getContext: (event: unknown) => ValidateAssessmentContext
  readRawBody: (event: unknown) => Promise<string | undefined>
  setStatus: (event: unknown, status: number) => void
}

const isJson = (contentType: string | undefined) => contentType
  ?.split(';', 1)[0]
  ?.trim()
  .toLowerCase() === 'application/json'

export const createValidateAssessmentHandler = (
  dependencies: ValidateAssessmentHandlerDependencies,
) => async (event: unknown): Promise<ApiSuccess<ScoredAssessment> | ApiFailure> => {
  const context = dependencies.getContext(event)
  try {
    if (!isJson(dependencies.getContentType(event))) {
      throw new AppError('ASSESSMENT_INVALID')
    }
    const raw = await dependencies.readRawBody(event)
    if (!raw || encoder.encode(raw).byteLength > MAX_BODY_BYTES) {
      throw new AppError('ASSESSMENT_INVALID')
    }

    let input: unknown
    try {
      input = JSON.parse(raw) as unknown
    }
    catch {
      throw new AppError('ASSESSMENT_INVALID')
    }

    return {
      data: await dependencies.assessment.validateAssessment(input, context),
      requestId: context.requestId,
    }
  }
  catch (error) {
    const appError = error instanceof AppError
      ? error
      : error instanceof RequestBodyLimitError
        ? new AppError('ASSESSMENT_INVALID')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, appError.statusCode)
    return toApiFailure(appError, context.requestId)
  }
}

export default defineEventHandler(event => createValidateAssessmentHandler({
  assessment: getServerAssessmentService(),
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getContext: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return {
      ip: getTrustedClientIp(requestEvent),
      requestId: typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID(),
      sessionToken: getCookie(requestEvent as never, studentSessionCookie) ?? '',
    }
  },
  readRawBody: readBoundedRequestBody,
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
