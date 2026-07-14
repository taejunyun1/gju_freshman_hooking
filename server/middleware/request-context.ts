export default defineEventHandler((event) => {
  const requestId = crypto.randomUUID()
  event.context.requestId = requestId

  const isAdminLogin = getRequestURL(event).pathname === '/admin/login'
  const contentSecurityPolicy = isAdminLogin
    ? "default-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'"
    : "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'"

  setResponseHeader(event, 'content-security-policy', contentSecurityPolicy)
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'x-request-id', requestId)
})
