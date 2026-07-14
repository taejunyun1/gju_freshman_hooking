type ErrorRecord = Error & Record<string, unknown>

type RequestEvent = {
  context?: Record<string, unknown>
}

type ErrorHookContext = {
  event?: RequestEvent
}

type NitroAppWithErrorHook = {
  hooks: {
    hook: (name: 'error', handler: (error: ErrorRecord, context: ErrorHookContext) => void) => unknown
  }
}

const publicErrorMessage = 'Internal Server Error'
const deliberatePublic403Messages = new Set([
  'ADMIN_REQUIRED',
  'MFA_REQUIRED',
  'REAUTH_REQUIRED',
  'REQUEST_FORBIDDEN',
])

const isDeliberatePublicError = (error: ErrorRecord): boolean => (
  error.statusCode === 403
  && typeof error.statusMessage === 'string'
  && deliberatePublic403Messages.has(error.statusMessage)
  && error.message === error.statusMessage
)

const removeSensitiveErrorDetails = (error: ErrorRecord): void => {
  try { delete error.cause }
  catch { error.cause = undefined }
  try { delete error.data }
  catch { error.data = undefined }
  try { delete error.stack }
  catch { error.stack = undefined }
}

const removeSensitiveErrorProperties = (error: ErrorRecord): void => {
  error.message = publicErrorMessage
  error.statusCode = 500
  error.statusMessage = publicErrorMessage
  removeSensitiveErrorDetails(error)
}

export const sanitizeUnhandledError = (error: ErrorRecord, event?: RequestEvent): string => {
  const context = event ? (event.context ??= {}) : undefined
  const requestId = typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  if (context) context.requestId = requestId
  if (isDeliberatePublicError(error)) {
    removeSensitiveErrorDetails(error)
    return requestId
  }
  removeSensitiveErrorProperties(error)
  return requestId
}

export const installUnhandledErrorSanitizer = (nitroApp: NitroAppWithErrorHook): void => {
  nitroApp.hooks.hook('error', (error, context) => {
    sanitizeUnhandledError(error, context.event)
  })
}

export default defineNitroPlugin((nitroApp) => {
  installUnhandledErrorSanitizer(nitroApp as unknown as NitroAppWithErrorHook)
})
