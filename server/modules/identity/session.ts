import { base64urlEncode, randomBytes, sha256, utf8, type RandomBytes } from '../../utils/web-crypto'

export type SessionToken = {
  raw: string
  hash: Uint8Array
}

export const createSessionToken = async (byteSource: RandomBytes = randomBytes): Promise<SessionToken> => {
  const bytes = byteSource(32)
  if (bytes.length !== 32) throw new Error('SESSION_TOKEN_RANDOM_INVALID')

  const raw = base64urlEncode(bytes)
  return { raw, hash: await sha256(utf8(raw)) }
}
