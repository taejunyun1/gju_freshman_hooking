import { describe, expect, it } from 'vitest'
import { generateInitialPassword, hashPassword, verifyPassword } from '../../../server/modules/identity/password'

const pepper = new Uint8Array(32).fill(33)
const salt = new Uint8Array(16).fill(44)

describe('password identity domain', () => {
  it('generates the specified deterministic initial password', () => {
    expect(generateInitialPassword('01012345678', new Uint8Array([0, 25]))).toBe('AZ-5678')
  })

  it('verifies a PBKDF2 password hash with the matching pepper', async () => {
    const passwordHash = await hashPassword('AB-5678', salt, pepper)

    await expect(verifyPassword('AB-5678', passwordHash, pepper)).resolves.toBe(true)
  })

  it('rejects a different password or pepper', async () => {
    const passwordHash = await hashPassword('AB-5678', salt, pepper)

    await expect(verifyPassword('AB-5679', passwordHash, pepper)).resolves.toBe(false)
    await expect(verifyPassword('AB-5678', passwordHash, new Uint8Array(32).fill(34))).resolves.toBe(false)
  })
})
