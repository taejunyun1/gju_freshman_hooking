import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../modules/identity/admin-auth'
import { toApiFailure } from '../../utils/app-error'

type AdminSessionHandlerDependencies = {
  requireAdmin: (event: unknown) => Promise<AdminContext>
  getRequestId: (event: unknown) => string
  setStatus: (event: unknown, status: number) => void
}

export const createAdminSessionHandler = (dependencies: AdminSessionHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<AdminContext> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  try {
    return { data: await dependencies.requireAdmin(event), requestId }
  }
  catch (error) {
    const failure = toApiFailure(error, requestId)
    dependencies.setStatus(event, failure.error.code === 'INTERNAL_ERROR' ? 500 : 403)
    return failure
  }
}

export default defineEventHandler((event) => createAdminSessionHandler({
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  requireAdmin: getServerRequireAdmin(),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
