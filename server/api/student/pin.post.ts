import { studentPinChangeSchema } from '../../../shared/schemas/identity'
import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import { getServerStudentPinService } from '../../modules/identity/student-pin'
import { AppError, toApiFailure } from '../../utils/app-error'
import { studentSessionCookie } from '../../utils/student-request-security'
import { studentSessionCookieOptions } from '../../utils/student-session-cookie'

type PinChangeHandlerDependencies = {
  getCookie: (event: unknown) => string | undefined
  getRequestId: (event: unknown) => string
  pin: Pick<ReturnType<typeof getServerStudentPinService>, 'changePin'>
  readBody: (event: unknown) => Promise<unknown>
  setCookie: (event: unknown, name: string, value: string, options: typeof studentSessionCookieOptions) => void
  setStatus: (event: unknown, status: number) => void
}

export const createStudentPinChangeHandler = (dependencies: PinChangeHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<{ kind: 'authenticated', expiresAt: string }> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  try {
    const input = studentPinChangeSchema.safeParse(await dependencies.readBody(event))
    if (!input.success) throw new AppError('AUTH_FAILED')
    const result = await dependencies.pin.changePin({
      currentPin: input.data.currentPin,
      nextPin: input.data.nextPin,
      sessionToken: dependencies.getCookie(event) ?? '',
    })
    if (!result) throw new AppError('AUTH_FAILED')
    dependencies.setCookie(event, studentSessionCookie, result.sessionToken, studentSessionCookieOptions)
    return { data: { kind: 'authenticated', expiresAt: result.expiresAt }, requestId }
  }
  catch (error) {
    const failure = toApiFailure(error instanceof AppError ? error : new AppError('INTERNAL_ERROR'), requestId)
    dependencies.setStatus(event, error instanceof AppError ? error.statusCode : 500)
    return failure
  }
}

export default defineEventHandler(event => createStudentPinChangeHandler({
  getCookie: requestEvent => getCookie(requestEvent as never, studentSessionCookie),
  getRequestId: requestEvent => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  pin: getServerStudentPinService(),
  readBody: requestEvent => readBody(requestEvent as never),
  setCookie: (requestEvent, name, value, options) => setCookie(requestEvent as never, name, value, options),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
