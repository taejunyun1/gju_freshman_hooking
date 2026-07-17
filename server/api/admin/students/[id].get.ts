import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import type { AdminContext } from '../../../modules/identity/admin-auth'
import {
  getServerAdminStudentsService,
  parseAdminStudentId,
} from '../../../modules/admin/students'
import { getAdminContext } from '../../../utils/admin-context'
import { AppError, toApiFailure } from '../../../utils/app-error'

type AdminStudentsService = ReturnType<typeof getServerAdminStudentsService>
type AdminStudentDetail = Awaited<ReturnType<AdminStudentsService['detail']>>

type DetailHandlerDependencies = {
  students: Pick<AdminStudentsService, 'detail'>
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown) => AdminContext | Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminStudentDetailHandler = (dependencies: DetailHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<AdminStudentDetail> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const studentId = parseAdminStudentId(dependencies.getParam(event, 'id'))
    await dependencies.requireAdmin(event)
    return { data: await dependencies.students.detail(studentId), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminStudentDetailHandler({
  students: getServerAdminStudentsService(),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  requireAdmin: getAdminContext,
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
