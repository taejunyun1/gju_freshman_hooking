import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import type { AdminNarrativeReportItem } from '../../../../../shared/schemas/admin-narrative-reports'
import {
  getServerAdminNarrativeReportsService,
  parseAdminNarrativeReportId,
  parseAdminNarrativeReportResolveInput,
} from '../../../../modules/admin/narrative-reports'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../../utils/app-error'
import {
  RequestBodyLimitError,
  readBoundedRequestBody,
} from '../../../../utils/bounded-request-body'

const MAX_BODY_BYTES = 1_024
const encoder = new TextEncoder()

type ResolveHandlerDependencies = {
  getContentType: (event: unknown) => string | undefined
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  readRawBody: (event: unknown) => Promise<string | undefined>
  reports: Pick<ReturnType<typeof getServerAdminNarrativeReportsService>, 'resolve'>
  requireAdmin: (event: unknown, options: { recentAuthMinutes: number }) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

const isJson = (contentType: string | undefined): boolean => (
  contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
)

export const createResolveAdminNarrativeReportHandler = (
  dependencies: ResolveHandlerDependencies,
) => async (
  event: unknown,
): Promise<ApiSuccess<AdminNarrativeReportItem> | ApiFailure> => {
  const candidateRequestId = dependencies.getRequestId(event)
  const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(candidateRequestId)
    ? candidateRequestId
    : crypto.randomUUID()
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const admin = await dependencies.requireAdmin(event, { recentAuthMinutes: 15 })
    const reportId = parseAdminNarrativeReportId(dependencies.getParam(event, 'id'))
    if (!isJson(dependencies.getContentType(event))) throw new AppError('NARRATIVE_REPORT_INVALID')
    const raw = await dependencies.readRawBody(event)
    if (!raw || encoder.encode(raw).byteLength > MAX_BODY_BYTES) {
      throw new AppError('NARRATIVE_REPORT_INVALID')
    }
    let body: unknown
    try {
      body = JSON.parse(raw) as unknown
    }
    catch {
      throw new AppError('NARRATIVE_REPORT_INVALID')
    }
    const input = parseAdminNarrativeReportResolveInput(body)
    return {
      data: await dependencies.reports.resolve(reportId, input, {
        adminUserId: admin.userId,
        traceId: requestId,
      }),
      requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError
      ? error
      : error instanceof RequestBodyLimitError
        ? new AppError('NARRATIVE_REPORT_INVALID')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createResolveAdminNarrativeReportHandler({
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  readRawBody: readBoundedRequestBody,
  reports: getServerAdminNarrativeReportsService(),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
