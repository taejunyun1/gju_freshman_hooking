import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import type { AdminNarrativeReportReview } from '../../../../../shared/schemas/admin-narrative-reports'
import {
  getServerAdminNarrativeReportsService,
  parseAdminNarrativeReportId,
} from '../../../../modules/admin/narrative-reports'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../../utils/app-error'

type ResultHandlerDependencies = {
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  reports: Pick<ReturnType<typeof getServerAdminNarrativeReportsService>, 'loadResult'>
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminNarrativeReportResultHandler = (
  dependencies: ResultHandlerDependencies,
) => async (
  event: unknown,
): Promise<ApiSuccess<AdminNarrativeReportReview> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    await dependencies.requireAdmin(event)
    const reportId = parseAdminNarrativeReportId(dependencies.getParam(event, 'id'))
    return { data: await dependencies.reports.loadResult(reportId), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminNarrativeReportResultHandler({
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  reports: getServerAdminNarrativeReportsService(),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
