import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { getServerRosterStudentCommands } from '../../../modules/admin/roster-student-commands'
import { parseAdminStudentId } from '../../../modules/admin/students'
import { getAdminContext } from '../../../utils/admin-context'
import { AppError, toApiFailure } from '../../../utils/app-error'

type Commands = ReturnType<typeof getServerRosterStudentCommands>

type Dependencies = {
  commands: Pick<Commands, 'updateProfile'>
  getBody: (event: unknown) => Promise<unknown>
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown) => unknown
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminRosterStudentPatchHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Awaited<ReturnType<Commands['updateProfile']>>> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    dependencies.requireAdmin(event)
    return {
      data: await dependencies.commands.updateProfile({
        ...(await dependencies.getBody(event) as Record<string, unknown>),
        studentId: parseAdminStudentId(dependencies.getParam(event, 'id')),
      }),
      requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminRosterStudentPatchHandler({
  commands: getServerRosterStudentCommands(),
  getBody: requestEvent => readBody(requestEvent as never),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId
    : crypto.randomUUID(),
  requireAdmin: getAdminContext,
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
