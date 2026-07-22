import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestContext = {
  anonymousId: 'anonymous-id',
  ip: '203.0.113.24',
  requestId: 'request-id',
}

const registrationBody = {
  name: ' 홍  길동 ',
  phone: '010-1234-5678',
  highSchool: ' 사진고 ',
  grade: '고1',
}

describe('student self-registration API handler', () => {
  it('creates a session with the secure cookie and exposes only the safe created result', async () => {
    const { createStudentSelfRegistrationHandler } = await import('../../../server/api/student/register.post')
    const registerStudent = vi.fn(async () => ({
      kind: 'created' as const,
      sessionToken: 'opaque-registration-session',
      expiresAt: '2026-07-22T12:00:00.000Z',
    }))
    const setCookie = vi.fn()
    const handler = createStudentSelfRegistrationHandler({
      getContext: () => requestContext,
      identity: { registerStudent },
      readBody: async () => registrationBody,
      setCookie,
      setStatus: vi.fn(),
    })

    const response = await handler({})

    expect(registerStudent).toHaveBeenCalledWith({
      name: '홍 길동',
      phone: '01012345678',
      highSchool: '사진고',
      grade: 'high1',
    }, requestContext)
    expect(response).toEqual({
      data: { kind: 'created', expiresAt: '2026-07-22T12:00:00.000Z' },
      requestId: 'request-id',
    })
    expect(setCookie).toHaveBeenCalledWith({}, 'photo_next_session', 'opaque-registration-session', expect.objectContaining({
      httpOnly: true,
      maxAge: 12 * 60 * 60,
      path: '/',
      sameSite: 'lax',
      secure: true,
    }))
    const serialized = JSON.stringify(response).toLowerCase()
    for (const forbidden of ['password', 'pin', '홍 길동', '01012345678', 'prospectid', 'hmac', 'cipher']) {
      expect(serialized).not.toContain(forbidden.toLowerCase())
    }
  })

  it.each(['existing', 'rate_limited'] as const)(
    'returns a generic %s result without issuing a session cookie',
    async (kind) => {
      const { createStudentSelfRegistrationHandler } = await import('../../../server/api/student/register.post')
      const setCookie = vi.fn()
      const handler = createStudentSelfRegistrationHandler({
        getContext: () => requestContext,
        identity: { registerStudent: vi.fn(async () => ({ kind })) },
        readBody: async () => registrationBody,
        setCookie,
        setStatus: vi.fn(),
      })

      await expect(handler({})).resolves.toEqual({ data: { kind }, requestId: 'request-id' })
      expect(setCookie).not.toHaveBeenCalled()
    },
  )

  it('rejects malformed registration input as VALIDATION_FAILED before calling the service', async () => {
    const { createStudentSelfRegistrationHandler } = await import('../../../server/api/student/register.post')
    const registerStudent = vi.fn()
    const setStatus = vi.fn()
    const handler = createStudentSelfRegistrationHandler({
      getContext: () => requestContext,
      identity: { registerStudent },
      readBody: async () => ({ ...registrationBody, phone: 'not-a-phone' }),
      setCookie: vi.fn(),
      setStatus,
    })

    await expect(handler({})).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
      requestId: 'request-id',
    })
    expect(setStatus).toHaveBeenCalledWith({}, 400)
    expect(registerStudent).not.toHaveBeenCalled()
  })

  it('maps an unavailable registration store to the generic internal failure', async () => {
    const { createStudentSelfRegistrationHandler } = await import('../../../server/api/student/register.post')
    const setStatus = vi.fn()
    const handler = createStudentSelfRegistrationHandler({
      getContext: () => requestContext,
      identity: { registerStudent: vi.fn(async () => { throw new Error('IDENTITY_STORE_UNAVAILABLE') }) },
      readBody: async () => registrationBody,
      setCookie: vi.fn(),
      setStatus,
    })

    await expect(handler({})).resolves.toMatchObject({
      error: { code: 'INTERNAL_ERROR' },
      requestId: 'request-id',
    })
    expect(setStatus).toHaveBeenCalledWith({}, 500)
  })
})
