export type RandomBytes = (length: number) => Uint8Array

export type EncryptedValue = {
  ciphertext: Uint8Array
  iv: Uint8Array
}

const encoder = new TextEncoder()

const toCryptoBytes = (value: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy
}

const cryptoSecretInvalid = (): never => {
  throw new Error('CRYPTO_SECRET_INVALID')
}

const encryptionKeyInvalid = (): never => {
  throw new Error('CRYPTO_ENCRYPTION_KEY_INVALID')
}

const requireAes256Key = (keyBytes: Uint8Array): void => {
  if (keyBytes.byteLength !== 32) encryptionKeyInvalid()
}

export const randomBytes: RandomBytes = (length) => {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

export const base64urlEncode = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export const decodeBase64urlSecret = (encoded: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length % 4 === 1) cryptoSecretInvalid()

  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/')
    + '='.repeat((4 - (encoded.length % 4)) % 4)

  let binary = ''
  try {
    binary = atob(padded)
  }
  catch {
    cryptoSecretInvalid()
  }

  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (decoded.length < 32 || base64urlEncode(decoded) !== encoded) cryptoSecretInvalid()

  return decoded
}

export const hmacSha256 = async (value: Uint8Array, keyBytes: Uint8Array): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey('raw', toCryptoBytes(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, toCryptoBytes(value))
  return new Uint8Array(signature)
}

export const verifyHmacSha256 = async (
  value: Uint8Array,
  signature: Uint8Array,
  keyBytes: Uint8Array,
): Promise<boolean> => {
  const key = await crypto.subtle.importKey('raw', toCryptoBytes(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, toCryptoBytes(signature), toCryptoBytes(value))
}

export const encryptAesGcm = async (value: Uint8Array, keyBytes: Uint8Array): Promise<EncryptedValue> => {
  requireAes256Key(keyBytes)
  const iv = toCryptoBytes(randomBytes(12))
  const key = await crypto.subtle.importKey('raw', toCryptoBytes(keyBytes), { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, toCryptoBytes(value))

  return { ciphertext: new Uint8Array(ciphertext), iv }
}

export const decryptAesGcm = async ({ ciphertext, iv }: EncryptedValue, keyBytes: Uint8Array): Promise<Uint8Array> => {
  requireAes256Key(keyBytes)
  const key = await crypto.subtle.importKey('raw', toCryptoBytes(keyBytes), { name: 'AES-GCM' }, false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toCryptoBytes(iv) }, key, toCryptoBytes(ciphertext))
  return new Uint8Array(plaintext)
}

export const constantTimeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false

  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!

  return difference === 0
}

export const sha256 = async (value: Uint8Array): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest('SHA-256', toCryptoBytes(value))
  return new Uint8Array(digest)
}

export const utf8 = (value: string): Uint8Array => encoder.encode(value)
