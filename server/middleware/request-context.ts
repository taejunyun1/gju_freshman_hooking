export default defineEventHandler((event) => {
  const requestId = crypto.randomUUID()
  event.context.requestId = requestId

  setResponseHeader(event, 'content-security-policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'")
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
})
