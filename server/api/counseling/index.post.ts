import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import {
  getServerCounselingService,
  type CounselingRequestContext,
  type StudentCounselingStatus,
} from '../../modules/counseling/service'
import { getAnonymousVisitorId } from '../../utils/anonymous-visitor'
import { AppError, toApiFailure } from '../../utils/app-error'
import { RequestBodyLimitError, readBoundedRequestBody } from '../../utils/bounded-request-body'
import { studentSessionCookie } from '../../utils/student-request-security'

const MAX_BODY_BYTES = 4_096
const encoder = new TextEncoder()

type PostCounselingHandlerDependencies = {
  counseling: Pick<ReturnType<typeof getServerCounselingService>, 'requestCounseling'>
  getContentType: (event: unknown) => string | undefined
  getContext: (event: unknown) => CounselingRequestContext
  readRawBody: (event: unknown) => Promise<string | undefined>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

const isJson = (contentType: string | undefined): boolean => contentType
  ?.split(';', 1)[0]
  ?.trim()
  .toLowerCase() === 'application/json'

export const createPostCounselingHandler = (
  dependencies: PostCounselingHandlerDependencies,
) => async (event: unknown): Promise<ApiSuccess<StudentCounselingStatus> | ApiFailure> => {
  const context = dependencies.getContext(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  try {
    if (!isJson(dependencies.getContentType(event))) throw new AppError('COUNSELING_INVALID')
    const rawBody = await dependencies.readRawBody(event)
    if (!rawBody || encoder.encode(rawBody).byteLength > MAX_BODY_BYTES) {
      throw new AppError('COUNSELING_INVALID')
    }
    let input: unknown
    try {
      input = JSON.parse(rawBody) as unknown
    }
    catch {
      throw new AppError('COUNSELING_INVALID')
    }

    return {
      data: await dependencies.counseling.requestCounseling(input, context),
      requestId: context.requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError
      ? error
      : error instanceof RequestBodyLimitError
        ? new AppError('COUNSELING_INVALID')
        : new AppError('INTERNAL_ERROR')
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

export default defineEventHandler(event => createPostCounselingHandler({
  counseling: getServerCounselingService(),
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getContext: requestContext,
  readRawBody: readBoundedRequestBody,
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
