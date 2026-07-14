import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { getServerPasswordRecoveryService } from '../../../../modules/identity/password-recovery'
import { AppError, toApiFailure } from '../../../../utils/app-error'

type RecoveryApprovalHandlerDependencies = {
  approveRecovery: (input: { requestId: number, adminUserId: string, traceId: string }) => Promise<{ code: string, expiresAt: string }>
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown, options: { recentAuthMinutes: number }) => Promise<AdminContext>
  setStatus: (event: unknown, status: number) => void
}

export const createRecoveryApprovalHandler = (dependencies: RecoveryApprovalHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<{ code: string, expiresAt: string }> | ApiFailure> => {
  const traceId = dependencies.getRequestId(event)
  try {
    const requestId = Number(dependencies.getParam(event, 'id'))
    if (!Number.isSafeInteger(requestId) || requestId < 1) throw new AppError('VALIDATION_FAILED')
    const admin = await dependencies.requireAdmin(event, { recentAuthMinutes: 15 })
    return { data: await dependencies.approveRecovery({ requestId, adminUserId: admin.userId, traceId }), requestId: traceId }
  }
  catch (error) {
    const failure = toApiFailure(error, traceId)
    dependencies.setStatus(event, error instanceof AppError ? error.statusCode : 500)
    return failure
  }
}

export default defineEventHandler((event) => createRecoveryApprovalHandler({
  approveRecovery: getServerPasswordRecoveryService().approve,
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  requireAdmin: getServerRequireAdmin(),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
