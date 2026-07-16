import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import { getServerAdminExportService, parseExportJobId, parseExportPageQuery } from '../../../../modules/admin/export'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../../utils/app-error'

type Service = ReturnType<typeof getServerAdminExportService>
type Response = Awaited<ReturnType<Service['counseling']>>
type Dependencies = {
  exports: Pick<Service, 'counseling'>
  getParam: (event: unknown, name: string) => string | undefined
  getQuery: (event: unknown) => unknown
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown, options: { recentAuthMinutes: number }) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminExportCounselingHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const admin = await dependencies.requireAdmin(event, { recentAuthMinutes: 15 })
    const jobId = parseExportJobId(dependencies.getParam(event, 'id'))
    const cursor = parseExportPageQuery(dependencies.getQuery(event))
    return { data: await dependencies.exports.counseling(jobId, cursor, { adminUserId: admin.userId }), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminExportCounselingHandler({
  exports: getServerAdminExportService(),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getQuery: requestEvent => getQuery(requestEvent as never),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
