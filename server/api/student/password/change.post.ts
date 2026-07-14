import { z } from 'zod'
import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { getServerPasswordRecoveryService } from '../../../modules/identity/password-recovery'
import { AppError, toApiFailure } from '../../../utils/app-error'
import { studentSessionCookie } from '../login.post'

const changePasswordSchema = z.object({
  currentPassword: z.string().min(7).max(128),
  newPassword: z.string().min(7).max(128),
})

type ChangePasswordHandlerDependencies = {
  changePassword: (input: z.infer<typeof changePasswordSchema> & { sessionToken: string }) => Promise<{ ok: true }>
  getCookie: (event: unknown) => string | undefined
  getRequestId: (event: unknown) => string
  readBody: (event: unknown) => Promise<unknown>
  setStatus: (event: unknown, status: number) => void
}

export const createChangePasswordHandler = (dependencies: ChangePasswordHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<{ ok: true }> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  try {
    let input: z.infer<typeof changePasswordSchema>
    try {
      input = changePasswordSchema.parse(await dependencies.readBody(event))
    }
    catch {
      throw new AppError('VALIDATION_FAILED')
    }
    const result = await dependencies.changePassword({ ...input, sessionToken: dependencies.getCookie(event) ?? '' })
    return { data: result, requestId }
  }
  catch (error) {
    const failure = toApiFailure(error, requestId)
    dependencies.setStatus(event, error instanceof AppError ? error.statusCode : 500)
    return failure
  }
}

export default defineEventHandler((event) => createChangePasswordHandler({
  changePassword: getServerPasswordRecoveryService().changePassword,
  getCookie: (requestEvent) => getCookie(requestEvent as never, studentSessionCookie),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  readBody: (requestEvent) => readBody(requestEvent as never),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
