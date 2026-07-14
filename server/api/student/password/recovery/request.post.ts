import { z } from 'zod'
import { phoneSchema, regionSchema } from '../../../../../shared/schemas/identity'
import { getServerPasswordRecoveryService } from '../../../../modules/identity/password-recovery'
import { getTrustedClientIp } from '../../../../utils/trusted-client-ip'

const recoveryRequestSchema = z.object({
  phone: phoneSchema,
  nickname: z.string().trim().min(1).max(80),
  region: regionSchema,
})

type RecoveryRequestHandlerDependencies = {
  requestRecovery: (input: z.infer<typeof recoveryRequestSchema> & { ip: string }) => Promise<void>
  getIp: (event: unknown) => string
  readBody: (event: unknown) => Promise<unknown>
  getRequestId: (event: unknown) => string
  setStatus: (event: unknown, status: number) => void
}

export const createRecoveryRequestHandler = (dependencies: RecoveryRequestHandlerDependencies) => async (
  event: unknown,
): Promise<{ accepted: true }> => {
  void dependencies.getRequestId(event)
  try {
    const input = recoveryRequestSchema.parse(await dependencies.readBody(event))
    await dependencies.requestRecovery({ ...input, ip: dependencies.getIp(event) })
  }
  catch {
    // Anonymous recovery deliberately reveals neither identity nor delivery outcomes.
  }
  dependencies.setStatus(event, 202)
  return { accepted: true }
}

export default defineEventHandler((event) => createRecoveryRequestHandler({
  getIp: getTrustedClientIp,
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  readBody: (requestEvent) => readBody(requestEvent as never),
  requestRecovery: getServerPasswordRecoveryService().request,
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
