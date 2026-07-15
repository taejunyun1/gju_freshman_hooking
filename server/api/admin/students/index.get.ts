import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../modules/identity/admin-auth'
import {
  getServerAdminStudentsService,
  parseAdminStudentsListQuery,
} from '../../../modules/admin/students'
import { AppError, toApiFailure } from '../../../utils/app-error'

type AdminStudentsService = ReturnType<typeof getServerAdminStudentsService>
type AdminStudentsList = Awaited<ReturnType<AdminStudentsService['list']>>

type ListHandlerDependencies = {
  students: Pick<AdminStudentsService, 'list'>
  getQuery: (event: unknown) => unknown
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminStudentsListHandler = (dependencies: ListHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<AdminStudentsList> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    await dependencies.requireAdmin(event)
    const query = parseAdminStudentsListQuery(dependencies.getQuery(event))
    return { data: await dependencies.students.list(query), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminStudentsListHandler({
  students: getServerAdminStudentsService(),
  getQuery: requestEvent => getQuery(requestEvent as never),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
