import { describe, expect, it, vi } from 'vitest'
import { createMemoryBackend } from './support'

const requestId = '66666666-6666-4666-8666-666666666666'
const requestContext = {
  anonymousId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ip: '203.0.113.7',
  requestId,
}
const genericFailure = {
  error: { code: 'AUTH_FAILED', message: '입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.' },
  requestId,
}

describe('identity rate limits', () => {
  it('consumes registration at 5 requests per IP per hour on the registration route', async () => {
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const backend = createMemoryBackend()
    const calls: unknown[] = []
    const identity = createIdentityService({
      ...backend.dependencies,
      consumeRateLimit: async (input) => {
        calls.push(input)
        return true
      },
    })

    await identity.registerStudent({
      phone: '01012345678',
      schoolName: '광주고등학교',
      applicantStage: 'high3',
      region: 'gwangju',
    }, requestContext)

    expect(calls).toEqual([{
      key: requestContext.ip,
      limit: 5,
      route: '/api/student/register',
      window: '1 hour',
    }])
  })

  it('consumes login at 10 requests per IP and 5 per protected phone in five-minute buckets', async () => {
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const backend = createMemoryBackend()
    const calls: unknown[] = []
    const identity = createIdentityService({
      ...backend.dependencies,
      consumeRateLimit: async (input) => {
        calls.push(input)
        return true
      },
    })

    await identity.loginStudent({ phone: '01012345678', password: 'WRONG99' }, requestContext)

    expect(calls).toEqual([
      {
        key: requestContext.ip,
        limit: 10,
        route: '/api/student/login',
        window: '5 minutes',
      },
      {
        key: expect.stringMatching(/^[A-Za-z0-9+/]{43}=$/),
        limit: 5,
        route: '/api/student/login',
        window: '5 minutes',
      },
    ])
  })

  it('returns generic AUTH_FAILED when the login IP bucket is exhausted', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const { createLoginHandler } = await import('../../../server/api/student/login.post')
    const backend = createMemoryBackend()
    const identity = createIdentityService({
      ...backend.dependencies,
      consumeRateLimit: async () => false,
    })
    const login = createLoginHandler({
      identity,
      getContext: () => requestContext,
      readBody: async (event: { body: unknown }) => event.body,
      setCookie: () => undefined,
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })
    const event: { body: unknown, status?: number } = { body: { phone: '01012345678', password: 'WRONG99' } }

    expect(await login(event)).toEqual(genericFailure)
    expect(event.status).toBe(401)
  })

  it('returns generic AUTH_FAILED when the login phone bucket is exhausted', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const { createLoginHandler } = await import('../../../server/api/student/login.post')
    const backend = createMemoryBackend()
    let buckets = 0
    const identity = createIdentityService({
      ...backend.dependencies,
      consumeRateLimit: async () => {
        buckets += 1
        return buckets === 1
      },
    })
    const login = createLoginHandler({
      identity,
      getContext: () => requestContext,
      readBody: async (event: { body: unknown }) => event.body,
      setCookie: () => undefined,
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })
    const event: { body: unknown, status?: number } = { body: { phone: '01012345678', password: 'WRONG99' } }

    expect(await login(event)).toEqual(genericFailure)
    expect(event.status).toBe(401)
    expect(buckets).toBe(2)
  })
})
