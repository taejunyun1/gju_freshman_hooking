import { describe, expect, it } from 'vitest'

import { protectApplicantName, revealApplicantName } from '../../../server/modules/identity/applicant-name'
import { protectPhone } from '../../../server/modules/identity/phone'
import { hmacSha256, utf8 } from '../../../server/utils/web-crypto'

const phoneHmacKey = new Uint8Array(32).fill(11)
const nameHmacKey = new Uint8Array(32).fill(17)
const encryptionKey = new Uint8Array(32).fill(22)

describe('applicant PII protection', () => {
  it('protects the normalized name with the exact name-comparison domain', async () => {
    const protectedName = await protectApplicantName('  윤\u00a0 태준 ', nameHmacKey, encryptionKey)
    const expectedHmac = await hmacSha256(utf8('name-compare-v1\0윤 태준'), nameHmacKey)

    expect(protectedName.hmac).toEqual(expectedHmac)
    expect(protectedName.iv).toHaveLength(12)
    await expect(revealApplicantName(protectedName, encryptionKey)).resolves.toBe('윤 태준')
  })

  it('uses a dedicated phone lookup domain and does not reuse the name key', async () => {
    const protectedPhone = await protectPhone('010-1234-4225', phoneHmacKey, encryptionKey)
    const expectedPhoneHmac = await hmacSha256(utf8('phone-lookup-v1\0' + '01012344225'), phoneHmacKey)
    const wrongNameKeyHmac = await hmacSha256(utf8('phone-lookup-v1\0' + '01012344225'), nameHmacKey)

    expect(protectedPhone.hmac).toEqual(expectedPhoneHmac)
    expect(protectedPhone.hmac).not.toEqual(wrongNameKeyHmac)
  })

  it('rejects HMAC keys that are not exactly 32 bytes', async () => {
    await expect(protectApplicantName('윤태준', new Uint8Array(31), encryptionKey))
      .rejects.toThrowError('CRYPTO_SECRET_INVALID')
    await expect(protectPhone('01012344225', new Uint8Array(33), encryptionKey))
      .rejects.toThrowError('CRYPTO_SECRET_INVALID')
  })
})
