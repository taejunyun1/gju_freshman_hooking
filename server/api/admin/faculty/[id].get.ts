import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../modules/identity/admin-auth'
import { getServerAdminFacultyService, parseAdminFacultyId } from '../../../modules/admin/faculty'
import { AppError, toApiFailure } from '../../../utils/app-error'

type Service = ReturnType<typeof getServerAdminFacultyService>
type Response = Awaited<ReturnType<Service['detail']>>
type Dependencies = {
  faculty: Pick<Service, 'detail'>
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}
export const createAdminFacultyDetailHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const id = parseAdminFacultyId(dependencies.getParam(event, 'id'))
    await dependencies.requireAdmin(event)
    return { data: await dependencies.faculty.detail(id), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}
export default defineEventHandler(event => createAdminFacultyDetailHandler({
  faculty: getServerAdminFacultyService(),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
