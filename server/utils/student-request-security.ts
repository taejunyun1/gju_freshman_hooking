import { base64urlEncode, constantTimeEqual, hmacSha256, utf8 } from './web-crypto'

export const studentCsrfHeader = 'x-photo-next-csrf'
export const studentSessionCookie = 'photo_next_session'

const csrfDomain = utf8('PHOTO:NEXT/student-session-csrf/v1')
const fixedCsrfFormat = /^[A-Za-z0-9_-]{43}$/u

export const deriveStudentCsrfToken = async (sessionToken: string): Promise<string> => (
  base64urlEncode(await hmacSha256(csrfDomain, utf8(sessionToken)))
)

export const verifyStudentCsrfToken = async (sessionToken: string, candidate: string): Promise<boolean> => {
  if (!fixedCsrfFormat.test(candidate)) return false
  const expected = await deriveStudentCsrfToken(sessionToken)
  return constantTimeEqual(utf8(candidate), utf8(expected))
}
