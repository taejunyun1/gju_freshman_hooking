import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

describe('student PIN API handlers', () => {
  it('sets a replacement secure cookie after a validated PIN change without exposing a PIN', async () => {
    const { createStudentPinChangeHandler } = await import('../../../server/api/student/pin.post')
    const setCookie = vi.fn()
    const setStatus = vi.fn()
    const handler = createStudentPinChangeHandler({
      getCookie: () => 'existing-session',
      getRequestId: () => 'request-id',
      pin: { changePin: vi.fn(async () => ({ sessionToken: 'replacement-session', expiresAt: '2026-07-20T12:00:00.000Z' })) },
      readBody: async () => ({ currentPin: '269442', nextPin: '123456', nextPinConfirm: '123456' }),
      setCookie,
      setStatus,
    })

    const response = await handler({})

    expect(response).toEqual({ data: { kind: 'authenticated', expiresAt: '2026-07-20T12:00:00.000Z' }, requestId: 'request-id' })
    expect(JSON.stringify(response)).not.toContain('123456')
    expect(setCookie).toHaveBeenCalledWith({}, 'photo_next_session', 'replacement-session', expect.objectContaining({
      httpOnly: true, path: '/', sameSite: 'lax', secure: true,
    }))
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('rejects mismatched replacement PIN confirmation before the mutation', async () => {
    const { createStudentPinChangeHandler } = await import('../../../server/api/student/pin.post')
    const changePin = vi.fn()
    const setStatus = vi.fn()
    const response = await createStudentPinChangeHandler({
      getCookie: () => 'existing-session',
      getRequestId: () => 'request-id',
      pin: { changePin },
      readBody: async () => ({ currentPin: '269442', nextPin: '123456', nextPinConfirm: '654321' }),
      setCookie: vi.fn(),
      setStatus,
    })({})

    expect(response).toMatchObject({ error: { code: 'AUTH_FAILED' }, requestId: 'request-id' })
    expect(setStatus).toHaveBeenCalledWith({}, 401)
    expect(changePin).not.toHaveBeenCalled()
  })

  it('resets the known roster phone only after destructive confirmation and starts a new session', async () => {
    const { createStudentPinResetHandler } = await import('../../../server/api/student/pin/reset.post')
    const resetForgottenPin = vi.fn(async () => ({ sessionToken: 'replacement-session', expiresAt: '2026-07-20T12:00:00.000Z' }))
    const setCookie = vi.fn()
    const handler = createStudentPinResetHandler({
      getRequestId: () => 'request-id',
      pin: { resetForgottenPin },
      readBody: async () => ({ phone: '010-4225-9442', deleteInterestHistory: true }),
      setCookie,
      setStatus: vi.fn(),
    })

    const response = await handler({})

    expect(resetForgottenPin).toHaveBeenCalledWith({ phone: '01042259442' })
    expect(response).toEqual({ data: { kind: 'authenticated', expiresAt: '2026-07-20T12:00:00.000Z' }, requestId: 'request-id' })
    expect(setCookie).toHaveBeenCalledWith({}, 'photo_next_session', 'replacement-session', expect.any(Object))
  })
})
