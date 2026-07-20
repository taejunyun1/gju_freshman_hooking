export const studentSessionCookieOptions = {
  httpOnly: true,
  maxAge: 12 * 60 * 60,
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
}
