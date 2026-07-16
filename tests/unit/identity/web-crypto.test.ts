import { describe, expect, it } from 'vitest'

import { hmacSha256, utf8, verifyHmacSha256 } from '../../../server/utils/web-crypto'

describe('WebCrypto HMAC verification', () => {
  it('uses the platform verifier for an exact signature and rejects same-length tampering', async () => {
    const key = new Uint8Array(32).fill(23)
    const value = utf8('PHOTO:NEXT/campaign-cookie/v1\n7\n1780000000')
    const signature = await hmacSha256(value, key)
    const tampered = signature.slice()
    tampered[17] = tampered[17]! ^ 1

    await expect(verifyHmacSha256(value, signature, key)).resolves.toBe(true)
    await expect(verifyHmacSha256(value, tampered, key)).resolves.toBe(false)
  })
})
