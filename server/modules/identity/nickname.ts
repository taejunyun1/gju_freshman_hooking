import { randomBytes, type RandomBytes } from '../../utils/web-crypto'
import { nicknameAdjectives, nicknameNouns } from './nickname-words'

export type NicknameIsAvailable = (nickname: string) => Promise<boolean>

const candidateFromBytes = (bytes: Uint8Array): string => {
  if (bytes.length < 3) throw new Error('NICKNAME_RANDOM_INVALID')

  const adjective = nicknameAdjectives[bytes[0]! % nicknameAdjectives.length]
  const noun = nicknameNouns[bytes[1]! % nicknameNouns.length]
  const number = String(bytes[2]! % 100).padStart(2, '0')
  return `${adjective}${noun}${number}`
}

export const generateNickname = async (
  isAvailable: NicknameIsAvailable,
  byteSource: RandomBytes = randomBytes,
): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = candidateFromBytes(byteSource(3))
    if (await isAvailable(candidate)) return candidate
  }

  throw new Error('NICKNAME_GENERATION_FAILED')
}
