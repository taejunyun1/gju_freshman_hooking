import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import { getServerAdminExportService, parseExportCompletionBody, parseExportJobId } from '../../../../modules/admin/export'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../../utils/app-error'
import { readBoundedRequestBody, RequestBodyLimitError } from '../../../../utils/bounded-request-body'

type Service = ReturnType<typeof getServerAdminExportService>
type Response = Awaited<ReturnType<Service['complete']>>
type Dependencies = {
  exports: Pick<Service, 'complete'>
  getContentType: (event: unknown) => string | undefined
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  readRawBody: (event: unknown) => Promise<string | undefined>
  requireAdmin: (event: unknown, options: { recentAuthMinutes: number }) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminExportCompleteHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const admin = await dependencies.requireAdmin(event, { recentAuthMinutes: 15 })
    const jobId = parseExportJobId(dependencies.getParam(event, 'id'))
    const completion = await parseExportCompletionBody(
      dependencies.getContentType(event),
      await dependencies.readRawBody(event),
    )
    return { data: await dependencies.exports.complete(jobId, completion, { adminUserId: admin.userId }), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error
      : error instanceof RequestBodyLimitError ? new AppError('EXPORT_INVALID')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminExportCompleteHandler({
  exports: getServerAdminExportService(),
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  readRawBody: requestEvent => readBoundedRequestBody(requestEvent, 4_096),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
