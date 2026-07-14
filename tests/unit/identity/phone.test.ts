import { describe, expect, it } from 'vitest'
import { normalizeKoreanPhone, protectPhone, revealPhone } from '../../../server/modules/identity/phone'
import { decodeBase64urlSecret } from '../../../server/utils/web-crypto'

const hmacKey = new Uint8Array(32).fill(11)
const encryptionKey = new Uint8Array(32).fill(22)

describe('phone identity domain', () => {
  it('normalizes only Korean 010 mobile numbers after removing spaces and hyphens', () => {
    expect(normalizeKoreanPhone('010-1234-5678')).toBe('01012345678')
    expect(normalizeKoreanPhone('010 1234 5678')).toBe('01012345678')
  })

  it('rejects unsupported or malformed phone numbers', () => {
    expect(() => normalizeKoreanPhone('02-123-4567')).toThrowError('PHONE_INVALID')
    expect(() => normalizeKoreanPhone('010-123-4567')).toThrowError('PHONE_INVALID')
    expect(() => normalizeKoreanPhone('010.1234.5678')).toThrowError('PHONE_INVALID')
  })

  it('HMACs and encrypts normalized phone values that can be recovered with the encryption key', async () => {
    const protectedPhone = await protectPhone('010-1234-5678', hmacKey, encryptionKey)
    const samePhone = await protectPhone('01012345678', hmacKey, encryptionKey)

    expect(protectedPhone.hmac).toEqual(samePhone.hmac)
    expect(protectedPhone.iv).toHaveLength(12)
    await expect(revealPhone(protectedPhone, encryptionKey)).resolves.toBe('01012345678')
  })

  it('rejects a 16-byte AES-128 key for phone protection and reveal', async () => {
    const aes128Key = new Uint8Array(16).fill(22)
    const protectedPhone = await protectPhone('01012345678', hmacKey, encryptionKey)

    await expect(protectPhone('01012345678', hmacKey, aes128Key)).rejects.toThrowError('CRYPTO_ENCRYPTION_KEY_INVALID')
    await expect(revealPhone(protectedPhone, aes128Key)).rejects.toThrowError('CRYPTO_ENCRYPTION_KEY_INVALID')
  })

  it('rejects a 33-byte key for phone protection and reveal', async () => {
    const oversizedKey = new Uint8Array(33).fill(22)
    const protectedPhone = await protectPhone('01012345678', hmacKey, encryptionKey)

    await expect(protectPhone('01012345678', hmacKey, oversizedKey)).rejects.toThrowError('CRYPTO_ENCRYPTION_KEY_INVALID')
    await expect(revealPhone(protectedPhone, oversizedKey)).rejects.toThrowError('CRYPTO_ENCRYPTION_KEY_INVALID')
  })

  it('rejects tampered encrypted phone values', async () => {
    const protectedPhone = await protectPhone('01012345678', hmacKey, encryptionKey)
    const tamperedCiphertext = new Uint8Array(protectedPhone.ciphertext)
    tamperedCiphertext[0] ^= 1

    await expect(revealPhone({ ...protectedPhone, ciphertext: tamperedCiphertext }, encryptionKey)).rejects.toThrow()
  })

  it('decodes only base64url secrets with at least 32 bytes', () => {
    expect(decodeBase64urlSecret('A'.repeat(43))).toHaveLength(32)
    expect(() => decodeBase64urlSecret('AA')).toThrowError('CRYPTO_SECRET_INVALID')
    expect(() => decodeBase64urlSecret('A'.repeat(42) + '=')).toThrowError('CRYPTO_SECRET_INVALID')
  })
})
