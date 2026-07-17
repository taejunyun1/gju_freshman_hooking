import { decryptAesGcm, encryptAesGcm, hmacSha256, utf8, type EncryptedValue } from '../../utils/web-crypto'
import { normalizeKoreanPhone } from '../../../shared/utils/applicant-normalization'

export { normalizeKoreanPhone } from '../../../shared/utils/applicant-normalization'

const phoneLookupDomain = utf8('phone-lookup-v1\0')

export type ProtectedPhone = EncryptedValue & {
  hmac: Uint8Array
}

const requireExactHmacKey = (key: Uint8Array): void => {
  if (key.byteLength !== 32) throw new Error('CRYPTO_SECRET_INVALID')
}

const phoneLookupValue = (phone: string): Uint8Array => {
  const value = utf8(normalizeKoreanPhone(phone))
  const combined = new Uint8Array(phoneLookupDomain.byteLength + value.byteLength)
  combined.set(phoneLookupDomain)
  combined.set(value, phoneLookupDomain.byteLength)
  return combined
}

export const derivePhoneHmac = async (phone: string, hmacKey: Uint8Array): Promise<Uint8Array> => {
  requireExactHmacKey(hmacKey)
  return hmacSha256(phoneLookupValue(phone), hmacKey)
}

export const protectPhone = async (
  phone: string,
  hmacKey: Uint8Array,
  encryptionKey: Uint8Array,
): Promise<ProtectedPhone> => {
  requireExactHmacKey(hmacKey)
  const normalized = normalizeKoreanPhone(phone)
  const bytes = utf8(normalized)
  const [hmac, encrypted] = await Promise.all([
    hmacSha256(phoneLookupValue(normalized), hmacKey),
    encryptAesGcm(bytes, encryptionKey),
  ])

  return { hmac, ...encrypted }
}

export const revealPhone = async (protectedPhone: EncryptedValue, encryptionKey: Uint8Array): Promise<string> => {
  const plaintext = await decryptAesGcm(protectedPhone, encryptionKey)
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
}
