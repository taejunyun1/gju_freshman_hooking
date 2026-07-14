export const MAX_REQUEST_BODY_BYTES = 8_192
export const requestBodyOverflowHeader = 'x-photo-next-body-overflow'

const guardedRoutes = new Set([
  '/api/events',
  '/api/student/assessment/validate',
])

const normalizeGuardedPath = (pathname) => {
  let decodedPath = pathname
  try {
    decodedPath = decodeURIComponent(pathname)
  }
  catch {
    // Malformed encodings cannot match a Nitro route; keep the original path.
  }
  return decodedPath.replace(/\/+$/u, '') || '/'
}

// Mirror Nitro's Cloudflare requestHasBody check so method mismatches cannot bypass the bound.
const nitroBuffersRequestBody = request => /post|put|patch/iu.test(request.method)

const isGuardedRequest = request => nitroBuffersRequestBody(request)
  && guardedRoutes.has(normalizeGuardedPath(new URL(request.url).pathname))

const parseContentLength = (value) => {
  if (!value || !/^\d+$/u.test(value.trim())) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY
}

const replaceRequestBody = (request, body, overflow) => {
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  headers.delete(requestBodyOverflowHeader)
  if (overflow) headers.set(requestBodyOverflowHeader, '1')
  const forwarded = new Request(request, {
    body,
    duplex: 'half',
    headers,
  })
  if ('cf' in request && !('cf' in forwarded)) {
    Object.defineProperty(forwarded, 'cf', {
      configurable: true,
      enumerable: true,
      value: request.cf,
    })
  }
  return forwarded
}

const overflowRequest = request => replaceRequestBody(request, '{}', true)

const readBoundedRequest = async (request) => {
  const contentLength = parseContentLength(request.headers.get('content-length'))
  if ((contentLength ?? 0) > MAX_REQUEST_BODY_BYTES) return overflowRequest(request)
  if (!request.body) return replaceRequestBody(request, new Uint8Array(), false)

  const reader = request.body.getReader()
  const body = new Uint8Array(MAX_REQUEST_BODY_BYTES + 1)
  let retainedBytes = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break

    const remaining = MAX_REQUEST_BODY_BYTES + 1 - retainedBytes
    if (remaining > 0) {
      const retainedLength = Math.min(result.value.byteLength, remaining)
      body.set(result.value.subarray(0, retainedLength), retainedBytes)
      retainedBytes += retainedLength
    }
    if (retainedBytes > MAX_REQUEST_BODY_BYTES) {
      try {
        await reader.cancel()
      }
      catch {
        // The request is already classified as oversized; cancellation is best-effort.
      }
      return overflowRequest(request)
    }
  }

  return replaceRequestBody(request, body.subarray(0, retainedBytes), false)
}

export const createBodyGuardWorker = worker => ({
  ...worker,
  async fetch(request, env, context) {
    const guarded = isGuardedRequest(request) ? await readBoundedRequest(request) : request
    return worker.fetch(guarded, env, context)
  },
})
