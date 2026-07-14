import type { ApiFailure, ApiSuccess } from '../../../shared/types/api'
import { toApiFailure } from '../../utils/app-error'
import { getServerIdentityService } from '../../modules/identity/service'
import { studentSessionCookie } from './login.post'

const deletedCookieOptions = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
}

export default defineEventHandler(async (event): Promise<ApiSuccess<{ ok: true }> | ApiFailure> => {
  const requestId = typeof event.context.requestId === 'string' ? event.context.requestId : crypto.randomUUID()
  try {
    const sessionToken = getCookie(event, studentSessionCookie) ?? ''
    await getServerIdentityService().logoutStudent(sessionToken)
    deleteCookie(event, studentSessionCookie, deletedCookieOptions)
    return { data: { ok: true }, requestId }
  }
  catch (error) {
    const failure = toApiFailure(error, requestId)
    setResponseStatus(event, 500)
    return failure
  }
})
