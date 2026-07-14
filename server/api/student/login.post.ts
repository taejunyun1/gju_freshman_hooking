import { loginSchema } from '../../../shared/schemas/identity'
import type { ApiFailure, ApiSuccess, LoginResult } from '../../../shared/types/api'
import { AppError, toApiFailure } from '../../utils/app-error'
import { getServerIdentityService, type IdentityRequestContext } from '../../modules/identity/service'

export const studentSessionCookie = 'photo_next_session'

const sessionCookieOptions = {
  httpOnly: true,
  maxAge: 12 * 60 * 60,
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
}

type LoginHandlerDependencies = {
  identity: Pick<ReturnType<typeof getServerIdentityService>, 'loginStudent'>
  getContext: (event: unknown) => IdentityRequestContext
  readBody: (event: unknown) => Promise<unknown>
  setCookie: (event: unknown, name: string, value: string, options: typeof sessionCookieOptions) => void
  setStatus: (event: unknown, status: number) => void
}

const defaultContext = (event: unknown): IdentityRequestContext => {
  const requestEvent = event as { context?: { requestId?: unknown } }
  return {
    ip: getRequestIP(event as never, { xForwardedFor: true }) ?? 'unknown',
    requestId: typeof requestEvent.context?.requestId === 'string' ? requestEvent.context.requestId : crypto.randomUUID(),
  }
}

export const createLoginHandler = (dependencies: LoginHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Omit<Extract<LoginResult, { kind: 'authenticated' }>, 'sessionToken'>> | ApiFailure> => {
  const context = dependencies.getContext(event)
  try {
    let input: ReturnType<typeof loginSchema.parse>
    try {
      input = loginSchema.parse(await dependencies.readBody(event))
    }
    catch {
      throw new AppError('AUTH_FAILED')
    }

    const result = await dependencies.identity.loginStudent(input, context)
    if (result.kind === 'failed') throw new AppError('AUTH_FAILED')

    dependencies.setCookie(event, studentSessionCookie, result.sessionToken, sessionCookieOptions)
    return { data: { kind: result.kind, expiresAt: result.expiresAt }, requestId: context.requestId }
  }
  catch (error) {
    const failure = toApiFailure(error instanceof AppError && error.code === 'AUTH_FAILED' ? error : error, context.requestId)
    dependencies.setStatus(event, error instanceof AppError ? error.statusCode : 500)
    return failure
  }
}

export default defineEventHandler((event) => createLoginHandler({
  getContext: defaultContext,
  identity: getServerIdentityService(),
  readBody: (requestEvent) => readBody(requestEvent as never),
  setCookie: (requestEvent, name, value, options) => setCookie(requestEvent as never, name, value, options),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
