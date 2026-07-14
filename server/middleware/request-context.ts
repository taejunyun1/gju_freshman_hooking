import { base64urlEncode, randomBytes } from '../utils/web-crypto'

const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost'])

export const validatedSupabaseOrigin = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error('SUPABASE_URL_INVALID')

  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('SUPABASE_URL_INVALID')
  }

  if (url.username || url.password) throw new Error('SUPABASE_URL_INVALID')
  if (url.protocol === 'https:') return url.origin
  if (url.protocol === 'http:' && loopbackHosts.has(url.hostname)) return url.origin
  throw new Error('SUPABASE_URL_INVALID')
}

export default defineEventHandler((event) => {
  const requestId = crypto.randomUUID()
  const cspNonce = base64urlEncode(randomBytes(16))
  event.context.requestId = requestId
  event.context.cspNonce = cspNonce

  const pathname = getRequestURL(event).pathname
  const isAdminDocument = pathname === '/admin' || pathname.startsWith('/admin/')
  const isAdminLogin = pathname === '/admin/login'
  const imageSources = isAdminLogin ? "img-src 'self' data:; " : ''
  const connectSources = isAdminDocument
    ? `connect-src 'self' ${validatedSupabaseOrigin(useRuntimeConfig(event).public.supabaseUrl)}; `
    : ''
  const contentSecurityPolicy = `default-src 'self'; script-src 'self' 'nonce-${cspNonce}'; script-src-attr 'none'; style-src 'self' 'nonce-${cspNonce}'; style-src-attr 'none'; ${imageSources}${connectSources}base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'`

  setResponseHeader(event, 'content-security-policy', contentSecurityPolicy)
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  setResponseHeader(event, 'x-request-id', requestId)
})
