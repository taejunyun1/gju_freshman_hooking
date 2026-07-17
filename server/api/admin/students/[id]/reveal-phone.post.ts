import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import type { AdminContext } from '../../../../modules/identity/admin-auth'
import {
  getServerAdminStudentsService,
  parseAdminStudentId,
} from '../../../../modules/admin/students'
import { requireRecentAdminContext } from '../../../../utils/admin-context'
import { AppError, toApiFailure } from '../../../../utils/app-error'

type AdminStudentsService = ReturnType<typeof getServerAdminStudentsService>

type RevealHandlerDependencies = {
  students: Pick<AdminStudentsService, 'revealPhone'>
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  requireAdmin: (
    event: unknown,
    options: { recentAuthMinutes: number },
  ) => AdminContext | Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createRevealAdminStudentPhoneHandler = (dependencies: RevealHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<{ phone: string }> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const studentId = parseAdminStudentId(dependencies.getParam(event, 'id'))
    const admin = await dependencies.requireAdmin(event, { recentAuthMinutes: 15 })
    return {
      data: {
        phone: await dependencies.students.revealPhone(studentId, {
          adminUserId: admin.userId,
          traceId: requestId,
        }),
      },
      requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createRevealAdminStudentPhoneHandler({
  students: getServerAdminStudentsService(),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  requireAdmin: (requestEvent, options) => (
    requireRecentAdminContext(requestEvent, options.recentAuthMinutes)
  ),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
