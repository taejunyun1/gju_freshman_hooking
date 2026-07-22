import { applicantRosterRowSchema } from '../../../shared/schemas/admission-roster'
import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import type { RosterIdentityRequestContext } from '../../modules/identity/roster-auth'
import { getServerStudentSelfRegistrationService } from '../../modules/identity/student-self-registration'
import { AppError, toApiFailure } from '../../utils/app-error'
import { getAnonymousVisitorId } from '../../utils/anonymous-visitor'
import { studentSessionCookie } from '../../utils/student-request-security'
import { studentSessionCookieOptions } from '../../utils/student-session-cookie'
import { getTrustedClientIp } from '../../utils/trusted-client-ip'

type SafeRegistrationResult =
  | { kind: 'created', expiresAt: string }
  | { kind: 'existing' }
  | { kind: 'rate_limited' }

type StudentSelfRegistrationHandlerDependencies = {
  getContext: (event: unknown) => RosterIdentityRequestContext
  identity: Pick<ReturnType<typeof getServerStudentSelfRegistrationService>, 'registerStudent'>
  readBody: (event: unknown) => Promise<unknown>
  setCookie: (event: unknown, name: string, value: string, options: typeof studentSessionCookieOptions) => void
  setStatus: (event: unknown, status: number) => void
}

const defaultContext = (event: unknown): RosterIdentityRequestContext => {
  const requestEvent = event as { context?: { requestId?: unknown } }
  return {
    anonymousId: getAnonymousVisitorId(event),
    ip: getTrustedClientIp(event),
    requestId: typeof requestEvent.context?.requestId === 'string' ? requestEvent.context.requestId : crypto.randomUUID(),
  }
}

export const createStudentSelfRegistrationHandler = (dependencies: StudentSelfRegistrationHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<SafeRegistrationResult> | ApiFailure> => {
  const context = dependencies.getContext(event)
  try {
    let input: ReturnType<typeof applicantRosterRowSchema.parse>
    try {
      input = applicantRosterRowSchema.parse(await dependencies.readBody(event))
    }
    catch {
      throw new AppError('VALIDATION_FAILED')
    }

    const result = await dependencies.identity.registerStudent(input, context)
    if (result.kind === 'created') {
      dependencies.setCookie(event, studentSessionCookie, result.sessionToken, studentSessionCookieOptions)
      return { data: { kind: 'created', expiresAt: result.expiresAt }, requestId: context.requestId }
    }
    return { data: { kind: result.kind }, requestId: context.requestId }
  }
  catch (error) {
    const failure = toApiFailure(error, context.requestId)
    dependencies.setStatus(event, error instanceof AppError ? error.statusCode : 500)
    return failure
  }
}

export default defineEventHandler((event) => createStudentSelfRegistrationHandler({
  getContext: defaultContext,
  identity: getServerStudentSelfRegistrationService(),
  readBody: requestEvent => readBody(requestEvent as never),
  setCookie: (requestEvent, name, value, options) => setCookie(requestEvent as never, name, value, options),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
