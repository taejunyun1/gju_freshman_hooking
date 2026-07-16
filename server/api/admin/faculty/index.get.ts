import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../modules/identity/admin-auth'
import { getServerAdminFacultyService, parseAdminFacultyListQuery } from '../../../modules/admin/faculty'
import { AppError, toApiFailure } from '../../../utils/app-error'

type Service = ReturnType<typeof getServerAdminFacultyService>
type Response = Awaited<ReturnType<Service['list']>>
type Dependencies = {
  faculty: Pick<Service, 'list'>
  getQuery: (event: unknown) => unknown
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminFacultyListHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    await dependencies.requireAdmin(event)
    return { data: await dependencies.faculty.list(parseAdminFacultyListQuery(dependencies.getQuery(event))), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminFacultyListHandler({
  faculty: getServerAdminFacultyService(),
  getQuery: requestEvent => getQuery(requestEvent as never),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
