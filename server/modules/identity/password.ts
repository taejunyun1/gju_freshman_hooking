import { utf8 } from '../../utils/web-crypto'
import { normalizeKoreanPhone } from './phone'

export const PASSWORD_PBKDF2_ITERATIONS = 600_000

const PASSWORD_HASH_BYTES = 32

export type PasswordHash = {
  hash: Uint8Array
  salt: Uint8Array
}

const mixSaltWithPepper = (salt: Uint8Array, pepper: Uint8Array): Uint8Array => {
  const mixed = new Uint8Array(salt.length + pepper.length)
  mixed.set(salt)
  mixed.set(pepper, salt.length)
  return mixed
}

const passwordHashesMatch = (calculatedHash: Uint8Array, storedHash: Uint8Array): boolean => {
  let difference = storedHash.length ^ PASSWORD_HASH_BYTES
  for (let index = 0; index < PASSWORD_HASH_BYTES; index += 1) {
    difference |= calculatedHash[index]! ^ (storedHash[index] ?? 0)
  }

  return difference === 0
}

export const hashPassword = async (password: string, salt: Uint8Array, pepper: Uint8Array): Promise<PasswordHash> => {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(utf8(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new Uint8Array(mixSaltWithPepper(salt, pepper)),
    iterations: PASSWORD_PBKDF2_ITERATIONS,
  }, key, 256)

  return { hash: new Uint8Array(bits), salt: new Uint8Array(salt) }
}

export const verifyPassword = async (password: string, passwordHash: PasswordHash, pepper: Uint8Array): Promise<boolean> => {
  const calculated = await hashPassword(password, passwordHash.salt, pepper)
  return passwordHashesMatch(calculated.hash, passwordHash.hash)
}

export const generateInitialPassword = (phone: string, random: Uint8Array): string => {
  if (random.length < 2) throw new Error('PASSWORD_RANDOM_INVALID')

  const normalizedPhone = normalizeKoreanPhone(phone)
  const letters = String.fromCharCode(65 + (random[0]! % 26), 65 + (random[1]! % 26))
  return `${letters}-${normalizedPhone.slice(-4)}`
}
