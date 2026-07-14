import { describe, expect, it, vi } from 'vitest'
import { createMemoryBackend } from './support'

const registerInput = {
  phone: '01012345678',
  schoolName: '광주고등학교',
  applicantStage: 'high3',
  region: 'gwangju',
}

describe('POST /api/student/register', () => {
  it('returns existing without creating a second prospect', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createIdentityService } = await import('../../../server/modules/identity/service')
    const { createRegisterHandler } = await import('../../../server/api/student/register.post')
    const backend = createMemoryBackend()
    const identity = createIdentityService(backend.dependencies)
    const register = createRegisterHandler({
      identity,
      getContext: () => ({ ip: '203.0.113.4', requestId: '11111111-1111-4111-8111-111111111111' }),
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
})
