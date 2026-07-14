import { decryptAesGcm, encryptAesGcm, hmacSha256, utf8, type EncryptedValue } from '../../utils/web-crypto'

export type ProtectedPhone = EncryptedValue & {
  hmac: Uint8Array
}

export const normalizeKoreanPhone = (phone: string): string => {
  const normalized = phone.replaceAll(' ', '').replaceAll('-', '')
  if (!/^010\d{8}$/u.test(normalized)) throw new Error('PHONE_INVALID')

  return normalized
}

export const protectPhone = async (
  phone: string,
  hmacKey: Uint8Array,
  encryptionKey: Uint8Array,
): Promise<ProtectedPhone> => {
  const normalized = normalizeKoreanPhone(phone)
  const bytes = utf8(normalized)
  const [hmac, encrypted] = await Promise.all([
    hmacSha256(bytes, hmacKey),
    encryptAesGcm(bytes, encryptionKey),
  ])

  return { hmac, ...encrypted }
}

export const revealPhone = async (protectedPhone: EncryptedValue, encryptionKey: Uint8Array): Promise<string> => {
  const plaintext = await decryptAesGcm(protectedPhone, encryptionKey)
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
}
