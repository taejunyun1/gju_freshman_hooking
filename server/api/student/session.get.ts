import type { ApiFailure, ApiSuccess, StudentSession } from '../../../shared/types/api'
import { AppError, toApiFailure } from '../../utils/app-error'
import { getServerIdentityService } from '../../modules/identity/service'
import { studentSessionCookie } from './login.post'

type SessionHandlerDependencies = {
  identity: Pick<ReturnType<typeof getServerIdentityService>, 'getStudentSession'>
  getCookie: (event: unknown) => string | undefined
  getRequestId: (event: unknown) => string
  setStatus: (event: unknown, status: number) => void
}

export const createSessionHandler = (dependencies: SessionHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<StudentSession> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  try {
    const session = await dependencies.identity.getStudentSession(dependencies.getCookie(event) ?? '')
    if (!session) throw new AppError('AUTH_FAILED')
    return { data: session, requestId }
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
  identity: getServerIdentityService(),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
