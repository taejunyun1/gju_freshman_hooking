import { normalizeApplicantName } from '../../../shared/utils/applicant-normalization'
import { decryptAesGcm, encryptAesGcm, hmacSha256, utf8, type EncryptedValue } from '../../utils/web-crypto'

const nameCompareDomain = utf8('name-compare-v1\0')

export type ProtectedApplicantName = EncryptedValue & {
  hmac: Uint8Array
}

const requireExactHmacKey = (key: Uint8Array): void => {
  if (key.byteLength !== 32) throw new Error('CRYPTO_SECRET_INVALID')
}

const domainValue = (domain: Uint8Array, value: Uint8Array): Uint8Array => {
  const combined = new Uint8Array(domain.byteLength + value.byteLength)
  combined.set(domain)
  combined.set(value, domain.byteLength)
  return combined
}

export const deriveApplicantNameHmac = async (name: string, hmacKey: Uint8Array): Promise<Uint8Array> => {
  requireExactHmacKey(hmacKey)
  const normalized = normalizeApplicantName(name)
  return hmacSha256(domainValue(nameCompareDomain, utf8(normalized)), hmacKey)
}

export const protectApplicantName = async (
  name: string,
  hmacKey: Uint8Array,
  encryptionKey: Uint8Array,
): Promise<ProtectedApplicantName> => {
  requireExactHmacKey(hmacKey)
  const bytes = utf8(normalizeApplicantName(name))
  const [hmac, encrypted] = await Promise.all([
    hmacSha256(domainValue(nameCompareDomain, bytes), hmacKey),
    encryptAesGcm(bytes, encryptionKey),
  ])

  return { hmac, ...encrypted }
}

export const revealApplicantName = async (
  protectedName: EncryptedValue,
  encryptionKey: Uint8Array,
): Promise<string> => {
  const plaintext = await decryptAesGcm(protectedName, encryptionKey)
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
}
