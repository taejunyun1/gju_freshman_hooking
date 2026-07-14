import { studentCsrfHeader, studentSessionCookie, verifyStudentCsrfToken } from '../utils/student-request-security'

type StudentRequestSecurityDependencies = {
  getCsrf: (event: unknown) => string | undefined
  getMethod: (event: unknown) => string
  getOrigin: (event: unknown) => string | undefined
  getPath: (event: unknown) => string
  getRequestOrigin: (event: unknown) => string
  getSessionToken: (event: unknown) => string | undefined
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const csrfProtectedPaths = new Set([
  '/api/student/logout',
  '/api/student/password/change',
])

const forbidden = (): never => {
  throw new Error('STUDENT_REQUEST_FORBIDDEN')
}

export const createStudentRequestSecurityMiddleware = (
  dependencies: StudentRequestSecurityDependencies,
) => async (event: unknown): Promise<void> => {
  const method = dependencies.getMethod(event).toUpperCase()
  const path = dependencies.getPath(event)
  if (!path.startsWith('/api/student/') || safeMethods.has(method)) return

  const origin = dependencies.getOrigin(event)
  if (!origin || origin !== dependencies.getRequestOrigin(event)) forbidden()
  if (!csrfProtectedPaths.has(path)) return

  const sessionToken = dependencies.getSessionToken(event)
  const csrf = dependencies.getCsrf(event)
  if (!sessionToken || !csrf || !await verifyStudentCsrfToken(sessionToken, csrf)) forbidden()
}

export default defineEventHandler(async (event) => {
  try {
    await createStudentRequestSecurityMiddleware({
      getCsrf: requestEvent => getHeader(requestEvent as never, studentCsrfHeader),
      getMethod: requestEvent => (requestEvent as { method?: string }).method ?? '',
      getOrigin: requestEvent => getHeader(requestEvent as never, 'origin'),
      getPath: requestEvent => getRequestURL(requestEvent as never).pathname,
      getRequestOrigin: requestEvent => getRequestURL(requestEvent as never).origin,
      getSessionToken: requestEvent => getCookie(requestEvent as never, studentSessionCookie),
    })(event)
  }
  catch {
    throw createError({ statusCode: 403, statusMessage: 'REQUEST_FORBIDDEN' })
  }
})
