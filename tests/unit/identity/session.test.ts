import { describe, expect, it } from 'vitest'
import { createSessionToken } from '../../../server/modules/identity/session'

describe('session identity domain', () => {
  it('creates a 32-byte base64url token and SHA-256 database hash', async () => {
    const token = await createSessionToken()
    const expectedHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.raw)))

    expect(token.raw).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(token.hash).toHaveLength(32)
    expect(token.hash).toEqual(expectedHash)
  })
})
