import { normalizeKoreanPhone } from '../../../shared/utils/applicant-normalization'
import { hmacSha256, utf8 } from '../../utils/web-crypto'

const PASSWORD_GENERATION_MAXIMUM = 2_147_483_647
const PASSWORD_GENERATION_SEARCH_LIMIT = 32
const UNBIASED_UPPERCASE_BYTE_LIMIT = 234

const passwordVerifyDomain = utf8('password-verify-v1\0')
const passwordIssueDomain = utf8('password-issue-v1\0')

export type RosterKeyring = {
  phoneHmacKey: Uint8Array
  nameHmacKey: Uint8Array
  piiEncryptionKey: Uint8Array
  currentPassword: { version: number, pepper: Uint8Array }
  previousPassword?: { version: number, pepper: Uint8Array }
}

export type InitialPasswordInput = {
  cycleId: string
  phone: string
  generation: number
  pepper: Uint8Array
}

export type NextPasswordInput = Omit<InitialPasswordInput, 'generation'> & {
  currentGeneration: number
}

export type IssuedPassword = {
  generation: number
  password: string
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
  requireExactPepper(input.pepper)
  requireGeneration(input.generation)
  const phone = normalizeKoreanPhone(input.phone)
  const issueInput = utf8(`${input.cycleId}\0${phone}\0${input.generation}`)
  const digest = await hmacSha256(domainValue(passwordIssueDomain, issueInput), input.pepper)
  const letterBytes: number[] = []

  for (const byte of digest) {
    if (byte < UNBIASED_UPPERCASE_BYTE_LIMIT) letterBytes.push(byte)
    if (letterBytes.length === 2) break
  }
  if (letterBytes.length !== 2) throw new Error('PASSWORD_ISSUANCE_FAILED')

  const letters = letterBytes.map(byte => String.fromCharCode(65 + (byte % 26))).join('')
  return `${phone.slice(-4)}${letters}`
}

export const findNextPasswordGeneration = async (input: NextPasswordInput): Promise<IssuedPassword> => {
  if (!Number.isInteger(input.currentGeneration) || input.currentGeneration < 1) {
    throw new Error('PASSWORD_GENERATION_INVALID')
  }
  if (input.currentGeneration > PASSWORD_GENERATION_MAXIMUM - PASSWORD_GENERATION_SEARCH_LIMIT) {
    throw new Error('PASSWORD_GENERATION_EXHAUSTED')
  }

  const current = await deriveInitialPassword({ ...input, generation: input.currentGeneration })
  for (let offset = 1; offset <= PASSWORD_GENERATION_SEARCH_LIMIT; offset += 1) {
    const generation = input.currentGeneration + offset
    const password = await deriveInitialPassword({ ...input, generation })
    if (password !== current) return { generation, password }
  }
  throw new Error('PASSWORD_GENERATION_EXHAUSTED')
}
