import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import {
  getServerAssessmentCompletionService,
  type AssessmentCompletionContext,
} from '../../modules/assessment/completion'
import { getAnonymousVisitorId } from '../../utils/anonymous-visitor'
import { AppError, toApiFailure } from '../../utils/app-error'
import { RequestBodyLimitError, readBoundedRequestBody } from '../../utils/bounded-request-body'
import { studentSessionCookie } from '../../utils/student-request-security'
import { getTrustedClientIp } from '../../utils/trusted-client-ip'
import { getServerVerifiedCampaignId, type VerifiedCampaignId } from '../../utils/campaign-attribution'

const MAX_BODY_BYTES = 8_192
const encoder = new TextEncoder()

type SubmitAssessmentHandlerDependencies = {
  assessment: Pick<ReturnType<typeof getServerAssessmentCompletionService>, 'submitAssessment'>
  getContentType: (event: unknown) => string | undefined
  getCampaignId?: (event: unknown) => Promise<VerifiedCampaignId | null>
  getContext: (event: unknown) => AssessmentCompletionContext
  readRawBody: (event: unknown) => Promise<string | undefined>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

const isJson = (contentType: string | undefined): boolean => contentType
  ?.split(';', 1)[0]
  ?.trim()
  .toLowerCase() === 'application/json'

export const createSubmitAssessmentHandler = (
  dependencies: SubmitAssessmentHandlerDependencies,
) => async (event: unknown): Promise<ApiSuccess<{ publicId: string }> | ApiFailure> => {
  const baseContext = dependencies.getContext(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  try {
    if (!isJson(dependencies.getContentType(event))) throw new AppError('ASSESSMENT_INVALID')
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
    const context: AssessmentCompletionContext = {
      ...baseContext,
      ...(dependencies.getCampaignId
        ? { resolveCampaignId: () => dependencies.getCampaignId!(event) }
        : {}),
    }
    return {
      data: await dependencies.assessment.submitAssessment(input, context),
      requestId: context.requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError
      ? error
      : error instanceof RequestBodyLimitError
        ? new AppError('ASSESSMENT_INVALID')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, baseContext.requestId)
  }
}

const requestContext = (event: unknown): AssessmentCompletionContext => {
  const context = (event as { context?: { requestId?: unknown } }).context
  return {
    anonymousId: getAnonymousVisitorId(event),
    ip: getTrustedClientIp(event),
    requestId: typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID(),
    sessionToken: getCookie(event as never, studentSessionCookie) ?? '',
  }
}

export default defineEventHandler(event => createSubmitAssessmentHandler({
  assessment: getServerAssessmentCompletionService(),
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getCampaignId: getServerVerifiedCampaignId,
  getContext: requestContext,
  readRawBody: readBoundedRequestBody,
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
