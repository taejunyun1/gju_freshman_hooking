export const anonymousVisitorCookie = 'photo_next_anon_v1'

const anonymousCookieOptions = {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 365,
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
}

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

type AnonymousVisitorDependencies = {
  getCookie: (event: unknown, name: string) => string | undefined
  randomUUID: () => string
  setCookie: (
    event: unknown,
    name: string,
    value: string,
    options: typeof anonymousCookieOptions,
  ) => void
}

export const createAnonymousVisitorResolver = (
  dependencies: AnonymousVisitorDependencies,
) => (event: unknown): string => {
  const stored = dependencies.getCookie(event, anonymousVisitorCookie)
  if (stored && canonicalUuid.test(stored)) {
    return stored
  }

  const generated = dependencies.randomUUID()
  if (!canonicalUuid.test(generated)) {
    throw new Error('ANONYMOUS_VISITOR_ID_INVALID')
  }
  dependencies.setCookie(event, anonymousVisitorCookie, generated, anonymousCookieOptions)
  return generated
}

export const getAnonymousVisitorId = createAnonymousVisitorResolver({
  getCookie: (event, name) => getCookie(event as never, name),
  randomUUID: () => crypto.randomUUID(),
  setCookie: (event, name, value, options) => setCookie(event as never, name, value, options),
})
