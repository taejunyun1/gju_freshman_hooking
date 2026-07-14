import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestEvent = {
  csrf?: string
  method: string
  origin?: string
  path: string
  requestOrigin: string
  sessionToken?: string
}

describe('student browser mutation security', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  })

  it('derives one fixed-format domain-separated token bound to the opaque session', async () => {
    const { deriveStudentCsrfToken, verifyStudentCsrfToken } = await import('../../server/utils/student-request-security')
    const first = await deriveStudentCsrfToken('opaque-session-one')
    const repeated = await deriveStudentCsrfToken('opaque-session-one')
    const second = await deriveStudentCsrfToken('opaque-session-two')

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(repeated).toBe(first)
    expect(second).not.toBe(first)
    await expect(verifyStudentCsrfToken('opaque-session-one', first)).resolves.toBe(true)
    await expect(verifyStudentCsrfToken('opaque-session-two', first)).resolves.toBe(false)
    await expect(verifyStudentCsrfToken('opaque-session-one', `${first}x`)).resolves.toBe(false)
  })

  it('allows same-origin anonymous mutations without requiring session CSRF', async () => {
    const { createStudentRequestSecurityMiddleware } = await import('../../server/middleware/20-student-request-security')
    const middleware = createStudentRequestSecurityMiddleware({
      getCsrf: event => (event as TestEvent).csrf,
      getMethod: event => (event as TestEvent).method,
      getOrigin: event => (event as TestEvent).origin,
      getPath: event => (event as TestEvent).path,
      getRequestOrigin: event => (event as TestEvent).requestOrigin,
      getSessionToken: event => (event as TestEvent).sessionToken,
    })

    await expect(middleware({
      csrf: 'wrong-but-irrelevant-for-anonymous-route',
      method: 'POST',
      origin: 'https://photo-next.example',
      path: '/api/student/password/recovery/request',
      requestOrigin: 'https://photo-next.example',
    })).resolves.toBeUndefined()
  })

  it.each([undefined, 'https://cross-origin.example'])(
    'rejects missing or cross-origin browser mutations before route handling: %s',
    async (origin) => {
      const { createStudentRequestSecurityMiddleware } = await import('../../server/middleware/20-student-request-security')
      const middleware = createStudentRequestSecurityMiddleware({
        getCsrf: event => (event as TestEvent).csrf,
        getMethod: event => (event as TestEvent).method,
        getOrigin: event => (event as TestEvent).origin,
        getPath: event => (event as TestEvent).path,
        getRequestOrigin: event => (event as TestEvent).requestOrigin,
        getSessionToken: event => (event as TestEvent).sessionToken,
      })

      await expect(middleware({
        method: 'POST',
        origin,
        path: '/api/student/register',
        requestOrigin: 'https://photo-next.example',
      })).rejects.toThrow('STUDENT_REQUEST_FORBIDDEN')
    },
  )

  it('rejects missing and wrong session CSRF but accepts the bound token for logout', async () => {
    const { createStudentRequestSecurityMiddleware } = await import('../../server/middleware/20-student-request-security')
    const { deriveStudentCsrfToken } = await import('../../server/utils/student-request-security')
    const sessionToken = 'opaque-session-token'
    const csrf = await deriveStudentCsrfToken(sessionToken)
    const middleware = createStudentRequestSecurityMiddleware({
      getCsrf: event => (event as TestEvent).csrf,
      getMethod: event => (event as TestEvent).method,
      getOrigin: event => (event as TestEvent).origin,
      getPath: event => (event as TestEvent).path,
      getRequestOrigin: event => (event as TestEvent).requestOrigin,
      getSessionToken: event => (event as TestEvent).sessionToken,
    })
    const base = {
      method: 'POST',
      origin: 'https://photo-next.example',
      path: '/api/student/logout',
      requestOrigin: 'https://photo-next.example',
      sessionToken,
    }

    await expect(middleware(base)).rejects.toThrow('STUDENT_REQUEST_FORBIDDEN')
    await expect(middleware({ ...base, csrf: 'A'.repeat(43) })).rejects.toThrow('STUDENT_REQUEST_FORBIDDEN')
    await expect(middleware({ ...base, csrf })).resolves.toBeUndefined()
  })

  it.each([
    '/api/student/logout/',
    '/api/student/password/change///',
    '/api/student//logout',
  ])('requires session CSRF after canonicalizing a protected path: %s', async (path) => {
    const { createStudentRequestSecurityMiddleware } = await import('../../server/middleware/20-student-request-security')
    const middleware = createStudentRequestSecurityMiddleware({
      getCsrf: event => (event as TestEvent).csrf,
      getMethod: event => (event as TestEvent).method,
      getOrigin: event => (event as TestEvent).origin,
      getPath: event => (event as TestEvent).path,
      getRequestOrigin: event => (event as TestEvent).requestOrigin,
      getSessionToken: event => (event as TestEvent).sessionToken,
    })

    await expect(middleware({
      method: 'POST',
      origin: 'https://photo-next.example',
      path,
      requestOrigin: 'https://photo-next.example',
      sessionToken: 'opaque-session-token',
    })).rejects.toThrow('STUDENT_REQUEST_FORBIDDEN')
  })

  it('rejects percent-encoded student mutation paths before route dispatch', async () => {
    const { createStudentRequestSecurityMiddleware } = await import('../../server/middleware/20-student-request-security')
    const middleware = createStudentRequestSecurityMiddleware({
      getCsrf: () => undefined,
      getMethod: event => (event as TestEvent).method,
      getOrigin: event => (event as TestEvent).origin,
      getPath: event => (event as TestEvent).path,
      getRequestOrigin: event => (event as TestEvent).requestOrigin,
      getSessionToken: () => undefined,
    })

    await expect(middleware({
      method: 'POST',
      origin: 'https://photo-next.example',
      path: '/api/student/%6Cogout',
      requestOrigin: 'https://photo-next.example',
    })).rejects.toThrow('STUDENT_REQUEST_FORBIDDEN')
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'does not apply mutation path rejection to a safe encoded request: %s',
    async (method) => {
      const { createStudentRequestSecurityMiddleware } = await import('../../server/middleware/20-student-request-security')
      const middleware = createStudentRequestSecurityMiddleware({
        getCsrf: () => undefined,
        getMethod: () => method,
        getOrigin: () => undefined,
        getPath: () => '/api/student/%73ession',
        getRequestOrigin: () => 'https://photo-next.example',
        getSessionToken: () => undefined,
      })

      await expect(middleware({})).resolves.toBeUndefined()
    },
  )

  it('does not apply browser mutation checks to the read-only session endpoint', async () => {
    const { createStudentRequestSecurityMiddleware } = await import('../../server/middleware/20-student-request-security')
    const middleware = createStudentRequestSecurityMiddleware({
      getCsrf: () => undefined,
      getMethod: event => (event as TestEvent).method,
      getOrigin: () => undefined,
      getPath: event => (event as TestEvent).path,
      getRequestOrigin: event => (event as TestEvent).requestOrigin,
      getSessionToken: () => undefined,
    })

    await expect(middleware({
      method: 'GET',
      path: '/api/student/session',
      requestOrigin: 'https://photo-next.example',
    })).resolves.toBeUndefined()
  })
})
