import type { ApiFailure, ApiSuccess, StudentSession } from '../../../shared/types/api'
import { AppError, toApiFailure } from '../../utils/app-error'
import { getServerRosterSessionService } from '../../modules/identity/student-session'
import { studentSessionCookie } from './login.post'
import { deriveStudentCsrfToken } from '../../utils/student-request-security'

type SessionHandlerDependencies = {
  identity: Pick<ReturnType<typeof getServerRosterSessionService>, 'getStudentSession'>
  getCookie: (event: unknown) => string | undefined
  getRequestId: (event: unknown) => string
  setStatus: (event: unknown, status: number) => void
}

export const createSessionHandler = (dependencies: SessionHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<StudentSession> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  try {
    const sessionToken = dependencies.getCookie(event) ?? ''
    const session = await dependencies.identity.getStudentSession(sessionToken)
    if (!session) throw new AppError('AUTH_FAILED')
    return { data: { ...session, csrfToken: await deriveStudentCsrfToken(sessionToken) }, requestId }
  }
  catch (error) {
    const failure = toApiFailure(error, requestId)
    dependencies.setStatus(event, error instanceof AppError ? error.statusCode : 500)
    return failure
  }
}

export default defineEventHandler((event) => createSessionHandler({
  getCookie: (requestEvent) => getCookie(requestEvent as never, studentSessionCookie),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  identity: getServerRosterSessionService(),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
