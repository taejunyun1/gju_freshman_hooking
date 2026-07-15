import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../modules/identity/admin-auth'
import {
  getServerAdminCounselingService,
  parseAdminCounselingQueueQuery,
} from '../../../modules/counseling/admin-service'
import type { AdminCounselingQueue } from '../../../../shared/schemas/counseling'
import { AppError, toApiFailure } from '../../../utils/app-error'

type ListHandlerDependencies = {
  counseling: Pick<ReturnType<typeof getServerAdminCounselingService>, 'list'>
  getQuery: (event: unknown) => unknown
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminCounselingListHandler = (dependencies: ListHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<AdminCounselingQueue> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    await dependencies.requireAdmin(event)
    const query = parseAdminCounselingQueueQuery(dependencies.getQuery(event))
    return { data: await dependencies.counseling.list(query), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminCounselingListHandler({
  counseling: getServerAdminCounselingService(),
  getQuery: requestEvent => getQuery(requestEvent as never),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
