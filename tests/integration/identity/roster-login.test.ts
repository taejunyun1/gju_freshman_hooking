import { describe, expect, it, vi } from 'vitest'

import { derivePasswordDigest } from '../../../server/modules/identity/roster-credentials'

describe('roster student login adapter', () => {
  it('authenticates through one atomic roster RPC and returns a 12-hour session', async () => {
    const { createRosterAuthService } = await import('../../../server/modules/identity/roster-auth')
    const calls: Array<{ name: string, args: Record<string, unknown> }> = []
    const service = createRosterAuthService({
      keyring: {
        phoneHmacKey: new Uint8Array(32).fill(1),
        nameHmacKey: new Uint8Array(32).fill(2),
        piiEncryptionKey: new Uint8Array(32).fill(3),
        currentPassword: { version: 7, pepper: new Uint8Array(32).fill(4) },
        previousPassword: { version: 6, pepper: new Uint8Array(32).fill(5) },
      },
      now: () => new Date('2026-07-17T00:00:00.000Z'),
      random: () => new Uint8Array(32).fill(9),
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return {
          data: {
            kind: 'authenticated',
            prospectId: 42,
            nickname: '지원자',
            expiresAt: '2026-07-17T12:00:00.000Z',
          },
          error: null,
        }
      }),
      writeEvent: async () => undefined,
    })

    const result = await service.loginStudent({
      phone: '010-4225-9442',
      password: '9442AB',
    }, {
      anonymousId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ip: '203.0.113.10',
      requestId: '11111111-1111-4111-8111-111111111111',
    })

    expect(result).toMatchObject({
      kind: 'authenticated',
      sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      expiresAt: '2026-07-17T12:00:00.000Z',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe('login_roster_student_v1')
    expect(calls[0]?.args).toMatchObject({
      p_current_version: 7,
      p_previous_version: 6,
      p_expires_at: '2026-07-17T12:00:00.000Z',
    })
    expect(JSON.stringify(calls[0]?.args)).not.toContain('9442AB')
  })

  it('sends current and previous password digests without plaintext password storage', async () => {
    const { createRosterAuthService } = await import('../../../server/modules/identity/roster-auth')
    let rpcArgs: Record<string, unknown> | null = null
    const currentPepper = new Uint8Array(32).fill(4)
    const previousPepper = new Uint8Array(32).fill(5)
    const service = createRosterAuthService({
      keyring: {
        phoneHmacKey: new Uint8Array(32).fill(1),
        nameHmacKey: new Uint8Array(32).fill(2),
        piiEncryptionKey: new Uint8Array(32).fill(3),
        currentPassword: { version: 7, pepper: currentPepper },
        previousPassword: { version: 6, pepper: previousPepper },
      },
      now: () => new Date('2026-07-17T00:00:00.000Z'),
      random: () => new Uint8Array(32).fill(8),
      rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
        rpcArgs = args
        return { data: { kind: 'failed' }, error: null }
      }),
      writeEvent: async () => undefined,
    })

    await service.loginStudent({
      phone: '01042259442',
      password: '9442AB',
    }, {
      anonymousId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ip: '203.0.113.11',
      requestId: '22222222-2222-4222-8222-222222222222',
    })

    expect(rpcArgs).toMatchObject({
      p_current_digest: expect.any(String),
      p_previous_digest: expect.any(String),
      p_current_version: 7,
      p_previous_version: 6,
    })
    expect(rpcArgs?.p_current_digest).not.toBe(rpcArgs?.p_previous_digest)
    expect(rpcArgs?.p_current_digest).toContain(Buffer.from(await derivePasswordDigest('9442AB', currentPepper)).toString('hex'))
    expect(rpcArgs?.p_previous_digest).toContain(Buffer.from(await derivePasswordDigest('9442AB', previousPepper)).toString('hex'))
  })
})
