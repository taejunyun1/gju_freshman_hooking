import { base64urlEncode, randomBytes } from '../utils/web-crypto'

export default defineEventHandler((event) => {
  const requestId = crypto.randomUUID()
  const cspNonce = base64urlEncode(randomBytes(16))
  event.context.requestId = requestId
  event.context.cspNonce = cspNonce

  const isAdminLogin = getRequestURL(event).pathname === '/admin/login'
  const imageSources = isAdminLogin ? "img-src 'self' data:; " : ''
  const contentSecurityPolicy = `default-src 'self'; script-src 'self' 'nonce-${cspNonce}'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; ${imageSources}base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'`

  setResponseHeader(event, 'content-security-policy', contentSecurityPolicy)
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'x-request-id', requestId)
})
