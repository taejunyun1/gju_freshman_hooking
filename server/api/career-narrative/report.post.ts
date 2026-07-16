import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import type { CareerNarrativeReportResult } from '../../../shared/schemas/career-narrative-report'
import {
  getServerCareerNarrativeReportService,
  type CareerNarrativeReportContext,
} from '../../modules/assessment/career-narrative-report'
import { AppError, toApiFailure } from '../../utils/app-error'
import { RequestBodyLimitError, readBoundedRequestBody } from '../../utils/bounded-request-body'
import { studentSessionCookie } from '../../utils/student-request-security'

const MAX_BODY_BYTES = 1_024
const encoder = new TextEncoder()

type PostCareerNarrativeReportHandlerDependencies = {
  getContentType: (event: unknown) => string | undefined
  getContext: (event: unknown) => CareerNarrativeReportContext
  readRawBody: (event: unknown) => Promise<string | undefined>
  report: Pick<ReturnType<typeof getServerCareerNarrativeReportService>, 'report'>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

const isJson = (contentType: string | undefined): boolean => contentType
  ?.split(';', 1)[0]
  ?.trim()
  .toLowerCase() === 'application/json'

export const createPostCareerNarrativeReportHandler = (
  dependencies: PostCareerNarrativeReportHandlerDependencies,
) => async (
  event: unknown,
): Promise<ApiSuccess<CareerNarrativeReportResult> | ApiFailure> => {
  const context = dependencies.getContext(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')

  try {
    if (!isJson(dependencies.getContentType(event))) throw new AppError('VALIDATION_FAILED')
    const raw = await dependencies.readRawBody(event)
    if (!raw || encoder.encode(raw).byteLength > MAX_BODY_BYTES) {
      throw new AppError('VALIDATION_FAILED')
    }
    let input: unknown
    try {
      input = JSON.parse(raw) as unknown
    }
    catch {
      throw new AppError('VALIDATION_FAILED')
    }

    return {
      data: await dependencies.report.report(input, context),
      requestId: context.requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError
      ? error
      : error instanceof RequestBodyLimitError
        ? new AppError('VALIDATION_FAILED')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, context.requestId)
  }
}

const requestContext = (event: unknown): CareerNarrativeReportContext => {
  const context = (event as { context?: { requestId?: unknown } }).context
  return {
    requestId: typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID(),
    sessionToken: getCookie(event as never, studentSessionCookie) ?? '',
  }
}

export default defineEventHandler(event => createPostCareerNarrativeReportHandler({
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getContext: requestContext,
  readRawBody: readBoundedRequestBody,
  report: getServerCareerNarrativeReportService(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
