import { describe, expect, it, vi } from 'vitest'
import { createMemoryBackend } from './support'

describe('POST /api/student/login', () => {
  it('locks the account for 15 minutes after five failures', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const { createRegisterHandler } = await import('../../../server/api/student/register.post')
    const { createLoginHandler } = await import('../../../server/api/student/login.post')
    const backend = createMemoryBackend()
    const identity = createIdentityService(backend.dependencies)
    const getContext = () => ({ ip: '203.0.113.4', requestId: '22222222-2222-4222-8222-222222222222' })
    const register = createRegisterHandler({
      identity,
      getContext,
      readBody: async (event: { body: unknown }) => event.body,
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })
    const login = createLoginHandler({
      identity,
      getContext,
      readBody: async (event: { body: unknown }) => event.body,
      setCookie: () => undefined,
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })

    await register({
      body: { phone: '01012345678', schoolName: '광주고등학교', applicantStage: 'high3', region: 'gwangju' },
    })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const event: { body: unknown, status?: number } = { body: { phone: '01012345678', password: 'WRONG99' } }
      const response = await login(event)
      expect(event.status).toBe(401)
      expect(response.error.code).toBe('AUTH_FAILED')
    }

    expect(backend.readCredential()?.lockedUntil).toEqual(new Date('2026-07-14T10:15:00.000Z'))
  })

  it('uses the same AUTH_FAILED response for unknown, wrong, and locked credentials', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const { createRegisterHandler } = await import('../../../server/api/student/register.post')
    const { createLoginHandler } = await import('../../../server/api/student/login.post')
    const backend = createMemoryBackend()
    const identity = createIdentityService(backend.dependencies)
    const getContext = () => ({ ip: '203.0.113.4', requestId: '33333333-3333-4333-8333-333333333333' })
    const register = createRegisterHandler({
      identity,
      getContext,
      readBody: async (event: { body: unknown }) => event.body,
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })
    const cookies: Array<{ name: string, value: string, options: Record<string, unknown> }> = []
    const login = createLoginHandler({
      identity,
      getContext,
      readBody: async (event: { body: unknown }) => event.body,
      setCookie: (_event: unknown, name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options })
      },
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })

    const unknown = await login({ body: { phone: '01099999999', password: 'WRONG99' } })
    const registration = await register({
      body: { phone: '01012345678', schoolName: '광주고등학교', applicantStage: 'high3', region: 'gwangju' },
    })
    const wrong = await login({ body: { phone: '01012345678', password: 'WRONG99' } })
    for (let attempt = 0; attempt < 4; attempt += 1) await login({ body: { phone: '01012345678', password: 'WRONG99' } })
    const locked = await login({ body: { phone: '01012345678', password: 'WRONG99' } })

    expect(unknown).toEqual(wrong)
    expect(wrong).toEqual(locked)
    expect(unknown.error).toEqual({ code: 'AUTH_FAILED', message: '입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.' })

    const successful = await login({ body: { phone: '01012345678', password: registration.data.initialPassword } })
    expect(successful.error.code).toBe('AUTH_FAILED')
    expect(cookies).toHaveLength(0)
  })

  it('sets an HttpOnly, Secure, SameSite=Lax session cookie after a successful login', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const { createRegisterHandler } = await import('../../../server/api/student/register.post')
    const { createLoginHandler, studentSessionCookie } = await import('../../../server/api/student/login.post')
    const backend = createMemoryBackend()
    const identity = createIdentityService(backend.dependencies)
    const getContext = () => ({ ip: '203.0.113.4', requestId: '44444444-4444-4444-8444-444444444444' })
    const register = createRegisterHandler({
      identity,
      getContext,
      readBody: async (event: { body: unknown }) => event.body,
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })
    const cookies: Array<{ name: string, value: string, options: Record<string, unknown> }> = []
    const login = createLoginHandler({
      identity,
      getContext,
      readBody: async (event: { body: unknown }) => event.body,
      setCookie: (_event: unknown, name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options })
      },
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })

    const registration = await register({
      body: { phone: '01012345678', schoolName: '광주고등학교', applicantStage: 'high3', region: 'gwangju' },
    })
    const response = await login({ body: { phone: '01012345678', password: registration.data.initialPassword } })

    expect(response.data.kind).toBe('authenticated')
    expect(cookies).toEqual([{
      name: studentSessionCookie,
      value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      options: expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: true }),
    }])
  })
})
