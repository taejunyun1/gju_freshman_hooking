import { normalizeKoreanPhone } from '../../../shared/utils/applicant-normalization'
import { hmacSha256, utf8 } from '../../utils/web-crypto'

const PASSWORD_GENERATION_MAXIMUM = 2_147_483_647

const passwordVerifyDomain = utf8('password-verify-v1\0')

export type RosterKeyring = {
  phoneHmacKey: Uint8Array
  nameHmacKey: Uint8Array
  piiEncryptionKey: Uint8Array
  currentPassword: { version: number, pepper: Uint8Array }
  previousPassword?: { version: number, pepper: Uint8Array }
}

export type InitialPasswordInput = {
  admissionYear: number
  phone: string
}

const requireExactPepper = (pepper: Uint8Array): void => {
  if (pepper.byteLength !== 32) throw new Error('CRYPTO_SECRET_INVALID')
}

const domainValue = (domain: Uint8Array, value: Uint8Array): Uint8Array => {
  const combined = new Uint8Array(domain.byteLength + value.byteLength)
  combined.set(domain)
  combined.set(value, domain.byteLength)
  return combined
}

const requireGeneration = (generation: number): void => {
  if (!Number.isInteger(generation) || generation < 1 || generation > PASSWORD_GENERATION_MAXIMUM) {
    throw new Error('PASSWORD_GENERATION_INVALID')
  }
}

export const derivePasswordDigest = async (password: string, pepper: Uint8Array): Promise<Uint8Array> => {
  requireExactPepper(pepper)
  return hmacSha256(domainValue(passwordVerifyDomain, utf8(password)), pepper)
}

export const deriveInitialPassword = async (input: InitialPasswordInput): Promise<string> => {
  if (!Number.isInteger(input.admissionYear) || input.admissionYear < 2000 || input.admissionYear > 9999) {
    throw new Error('ADMISSION_YEAR_INVALID')
  }
  const phone = normalizeKoreanPhone(input.phone)
  return `${String(input.admissionYear).slice(-2)}${phone.slice(-4)}`
}

export const nextPasswordGeneration = (currentGeneration: number): number => {
  requireGeneration(currentGeneration)
  if (currentGeneration >= PASSWORD_GENERATION_MAXIMUM) {
    throw new Error('PASSWORD_GENERATION_EXHAUSTED')
  }
  return currentGeneration + 1
}
