import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../../utils/app-error'
import { getServerSupabaseClient } from '../../../../utils/supabase'

type CopyAuditInput = {
  action: 'credential_recovery_code_copied'
  adminUserId: string
  metadata: Record<string, never>
  requestId: string
  targetId: string
  targetType: 'credential_recovery_request'
}

type RecoveryCopyHandlerDependencies = {
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  readBody: (event: unknown) => Promise<unknown>
  requireAdmin: (event: unknown, options: { recentAuthMinutes: number }) => Promise<AdminContext>
  setStatus: (event: unknown, status: number) => void
  writeAuditEvent: (input: CopyAuditInput) => Promise<void>
}

const parseCopyBody = (body: unknown, pathRequestId: number): void => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('VALIDATION_FAILED')
  const record = body as Record<string, unknown>
  if (Object.keys(record).length !== 1 || record.requestId !== pathRequestId) throw new AppError('VALIDATION_FAILED')
}

export const createRecoveryCopyHandler = (dependencies: RecoveryCopyHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<{ recorded: true }> | ApiFailure> => {
  const traceId = dependencies.getRequestId(event)
  try {
    const requestId = Number(dependencies.getParam(event, 'id'))
    if (!Number.isSafeInteger(requestId) || requestId < 1) throw new AppError('VALIDATION_FAILED')
    parseCopyBody(await dependencies.readBody(event), requestId)
    const admin = await dependencies.requireAdmin(event, { recentAuthMinutes: 15 })
    await dependencies.writeAuditEvent({
      action: 'credential_recovery_code_copied',
      adminUserId: admin.userId,
      metadata: {},
      requestId: traceId,
      targetId: String(requestId),
      targetType: 'credential_recovery_request',
    })
    return { data: { recorded: true }, requestId: traceId }
  }
  catch (error) {
    const failure = toApiFailure(error, traceId)
    dependencies.setStatus(event, error instanceof AppError ? error.statusCode : 500)
    return failure
  }
}

export default defineEventHandler((event) => {
  const client = getServerSupabaseClient()
  return createRecoveryCopyHandler({
    getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
    getRequestId: (requestEvent) => {
      const context = (requestEvent as { context?: { requestId?: unknown } }).context
      return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
    },
    readBody: requestEvent => readBody(requestEvent as never),
    requireAdmin: getServerRequireAdmin(),
    setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
    writeAuditEvent: async (input) => {
      const { error } = await client.from('audit_events').insert({
        action: input.action,
        admin_user_id: input.adminUserId,
        metadata: input.metadata,
        request_id: input.requestId,
        target_id: input.targetId,
        target_type: input.targetType,
      })
      if (error) throw new Error('AUDIT_STORE_UNAVAILABLE')
    },
  })(event)
})
