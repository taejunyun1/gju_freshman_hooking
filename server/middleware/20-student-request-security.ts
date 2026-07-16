import { studentCsrfHeader, studentSessionCookie, verifyStudentCsrfToken } from '../utils/student-request-security'

// Browser mutation checks intentionally follow request metadata and administrator authentication.

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
  '/api/assessment/submit',
  '/api/career-narrative/report',
  '/api/student/logout',
  '/api/student/assessment/validate',
  '/api/student/password/change',
])

const forbidden = (): never => {
  throw new Error('STUDENT_REQUEST_FORBIDDEN')
}

const withoutTrailingSlash = (path: string): string => path.length > 1
  ? path.replace(/\/+$/u, '')
  : path

const canonicalStudentPath = (rawPath: string): string | null => {
  const collapsedPath = rawPath.replace(/\/{2,}/gu, '/')
  let decodedPath = collapsedPath
  try {
    decodedPath = decodeURIComponent(collapsedPath).replace(/\/{2,}/gu, '/')
  }
  catch {
    // Malformed encoding is rejected below when it targets the student API prefix.
  }
  const canonicalPath = withoutTrailingSlash(collapsedPath)
  const decodedCanonicalPath = withoutTrailingSlash(decodedPath)
  const targetsStudentApi = canonicalPath.startsWith('/api/student/')
    || decodedCanonicalPath.startsWith('/api/student/')
  const targetsAssessmentSubmit = canonicalPath === '/api/assessment/submit'
    || decodedCanonicalPath === '/api/assessment/submit'
  const targetsNarrativeReport = canonicalPath === '/api/career-narrative/report'
    || decodedCanonicalPath === '/api/career-narrative/report'
  if (!targetsStudentApi && !targetsAssessmentSubmit && !targetsNarrativeReport) return null
  if (rawPath.includes('%') || rawPath.includes('\\')) forbidden()
  return canonicalPath
}

export const createStudentRequestSecurityMiddleware = (
  dependencies: StudentRequestSecurityDependencies,
) => async (event: unknown): Promise<void> => {
  const method = dependencies.getMethod(event).toUpperCase()
  if (safeMethods.has(method)) return
  const path = canonicalStudentPath(dependencies.getPath(event))
  if (path === null) return

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
