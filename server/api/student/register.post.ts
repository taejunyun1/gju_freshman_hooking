import { registerSchema } from '../../../shared/schemas/identity'
import type { ApiFailure, ApiSuccess, RegistrationResult } from '../../../shared/types/api'
import { AppError, toApiFailure } from '../../utils/app-error'
import { getServerIdentityService, type IdentityRequestContext } from '../../modules/identity/service'
import { getTrustedClientIp } from '../../utils/trusted-client-ip'

type RegisterHandlerDependencies = {
  identity: Pick<ReturnType<typeof getServerIdentityService>, 'registerStudent'>
  getContext: (event: unknown) => IdentityRequestContext
  readBody: (event: unknown) => Promise<unknown>
  setStatus: (event: unknown, status: number) => void
}

const defaultContext = (event: unknown): IdentityRequestContext => {
  const requestEvent = event as { context?: { requestId?: unknown } }
  return {
    ip: getTrustedClientIp(event),
    requestId: typeof requestEvent.context?.requestId === 'string' ? requestEvent.context.requestId : crypto.randomUUID(),
  }
}

export const createRegisterHandler = (dependencies: RegisterHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<RegistrationResult> | ApiFailure> => {
  const context = dependencies.getContext(event)
  try {
    let input: ReturnType<typeof registerSchema.parse>
    try {
      input = registerSchema.parse(await dependencies.readBody(event))
    }
    catch {
      throw new AppError('VALIDATION_FAILED')
    }

    const result = await dependencies.identity.registerStudent(input, context)
    return { data: result, requestId: context.requestId }
  }
  catch (error) {
    const failure = toApiFailure(error, context.requestId)
    dependencies.setStatus(event, error instanceof AppError ? error.statusCode : 500)
    return failure
  }
}

export default defineEventHandler((event) => createRegisterHandler({
  getContext: defaultContext,
  identity: getServerIdentityService(),
  readBody: (requestEvent) => readBody(requestEvent as never),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
