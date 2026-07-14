import { z } from 'zod'
import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import { getServerPasswordRecoveryService } from '../../../../modules/identity/password-recovery'
import { AppError, toApiFailure } from '../../../../utils/app-error'
import { getTrustedClientIp } from '../../../../utils/trusted-client-ip'

const completeRecoverySchema = z.object({
  code: z.string().min(1).max(128),
  newPassword: z.string().min(7).max(128),
})

type CompleteRecoveryHandlerDependencies = {
  completeRecovery: (input: z.infer<typeof completeRecoverySchema> & { ip: string }) => Promise<{ ok: true }>
  getIp: (event: unknown) => string
  getRequestId: (event: unknown) => string
  readBody: (event: unknown) => Promise<unknown>
  setStatus: (event: unknown, status: number) => void
}

export const createCompleteRecoveryHandler = (dependencies: CompleteRecoveryHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<{ ok: true }> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  try {
    let input: z.infer<typeof completeRecoverySchema>
    try {
      input = completeRecoverySchema.parse(await dependencies.readBody(event))
    }
    catch {
      throw new AppError('RECOVERY_INVALID')
    }
    return { data: await dependencies.completeRecovery({ ...input, ip: dependencies.getIp(event) }), requestId }
  }
  catch (error) {
    const failure = toApiFailure(error, requestId)
    dependencies.setStatus(event, error instanceof AppError ? error.statusCode : 500)
    return failure
  }
}

export default defineEventHandler((event) => createCompleteRecoveryHandler({
  completeRecovery: getServerPasswordRecoveryService().complete,
  getIp: getTrustedClientIp,
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  readBody: (requestEvent) => readBody(requestEvent as never),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
