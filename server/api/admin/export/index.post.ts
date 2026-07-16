import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { getServerAdminExportService, parseExportCreateBody } from '../../../modules/admin/export'
import { type AdminContext, getServerRequireAdmin } from '../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../utils/app-error'
import { readBoundedRequestBody, RequestBodyLimitError } from '../../../utils/bounded-request-body'

type Service = ReturnType<typeof getServerAdminExportService>
type Response = Awaited<ReturnType<Service['create']>>
type Dependencies = {
  exports: Pick<Service, 'create'>
  getContentType: (event: unknown) => string | undefined
  getRequestId: (event: unknown) => string
  readRawBody: (event: unknown) => Promise<string | undefined>
  requireAdmin: (event: unknown, options: { recentAuthMinutes: number }) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminExportHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const admin = await dependencies.requireAdmin(event, { recentAuthMinutes: 15 })
    const filters = await parseExportCreateBody(
      dependencies.getContentType(event),
      await dependencies.readRawBody(event),
    )
    return {
      data: await dependencies.exports.create(filters, { adminUserId: admin.userId, traceId: requestId }),
      requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error
      : error instanceof RequestBodyLimitError ? new AppError('EXPORT_INVALID')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminExportHandler({
  exports: getServerAdminExportService(),
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  readRawBody: requestEvent => readBoundedRequestBody(requestEvent, 4_096),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
