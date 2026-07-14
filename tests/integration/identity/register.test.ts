import { describe, expect, it, vi } from 'vitest'
import { createMemoryBackend } from './support'

const registerInput = {
  phone: '01012345678',
  schoolName: '광주고등학교',
  applicantStage: 'high3',
  region: 'gwangju',
}

const anonymousId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('POST /api/student/register', () => {
  it('returns existing without creating a second prospect', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const { createRegisterHandler } = await import('../../../server/api/student/register.post')
    const backend = createMemoryBackend()
    const identity = createIdentityService(backend.dependencies)
    const register = createRegisterHandler({
      identity,
      getContext: () => ({ anonymousId, ip: '203.0.113.4', requestId: '11111111-1111-4111-8111-111111111111' }),
      readBody: async (event: { body: unknown }) => event.body,
      setStatus: (event: { status?: number }, status: number) => { event.status = status },
    })

    await register({ body: registerInput })
    const second = await register({
      body: {
        phone: '010-1234-5678',
        schoolName: '다른학교',
        applicantStage: 'graduate',
        region: 'capital',
      },
    })

    expect(second.data.kind).toBe('existing')
    expect(backend.countProspects()).toBe(1)
  })

  it('correlates stable anonymous registration events and attributes only completion', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const { createRegisterHandler } = await import('../../../server/api/student/register.post')
    const backend = createMemoryBackend()
    const events: Array<Record<string, unknown>> = []
    backend.dependencies.writeEvent = async event => { events.push(event as unknown as Record<string, unknown>) }
    const identity = createIdentityService(backend.dependencies)
    const register = createRegisterHandler({
      identity,
      getContext: () => ({ anonymousId, ip: '203.0.113.4', requestId: '12111111-1111-4111-8111-111111111111' }),
      readBody: async (event: { body: unknown }) => event.body,
      setStatus: () => undefined,
    })

    const response = await register({ body: registerInput })

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(expect.objectContaining({
      anonymousId,
      eventName: 'registration_started',
      path: '/api/student/register',
    }))
    expect(events[0]).not.toHaveProperty('prospectId')
    expect(events[1]).toEqual(expect.objectContaining({
      anonymousId,
      eventName: 'registration_completed',
      path: '/api/student/register',
      prospectId: 1,
    }))
    expect(JSON.stringify(response)).not.toContain(anonymousId)
    expect(response).not.toHaveProperty('prospectId')
  })
})
