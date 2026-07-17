import { z } from 'zod'

import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import { getServerRosterStudentCommands } from '../../../../modules/admin/roster-student-commands'
import { parseAdminStudentId } from '../../../../modules/admin/students'
import { getAdminContext } from '../../../../utils/admin-context'
import { AppError, toApiFailure } from '../../../../utils/app-error'

type Commands = ReturnType<typeof getServerRosterStudentCommands>

type Dependencies = {
  commands: Pick<Commands, 'setStatus'>
  getBody: (event: unknown) => Promise<unknown>
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown) => unknown
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

const bodySchema = z.object({
  status: z.enum(['active', 'inactive']),
  confirmation: z.string().max(40),
}).strict()

export const createAdminRosterStudentStatusHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Awaited<ReturnType<Commands['setStatus']>>> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    dependencies.requireAdmin(event)
    const studentId = parseAdminStudentId(dependencies.getParam(event, 'id'))
    const body = bodySchema.parse(await dependencies.getBody(event))
    const expected = body.status === 'inactive' ? `${studentId} 비활성화` : `${studentId} 활성화`
    if (body.confirmation !== expected) throw new AppError('ROSTER_INVALID')
    return { data: await dependencies.commands.setStatus({ studentId, status: body.status }), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : error instanceof z.ZodError ? new AppError('ROSTER_INVALID') : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminRosterStudentStatusHandler({
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
