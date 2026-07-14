const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: false })

export const MAX_REQUEST_BODY_BYTES = 8_192
export const requestBodyOverflowHeader = 'x-photo-next-body-overflow'

export class RequestBodyLimitError extends Error {
  constructor() {
    super('REQUEST_BODY_TOO_LARGE')
    this.name = 'RequestBodyLimitError'
  }
}

type BodyChunk = string | Uint8Array
type BodyIterator = AsyncIterator<BodyChunk, unknown, unknown>

type RequestLike = {
  _requestBody?: unknown
  node?: {
    req?: {
      body?: unknown
      headers?: Record<string, string | string[] | undefined>
      rawBody?: unknown
      [Symbol.asyncIterator]?: () => BodyIterator
    }
  }
  web?: {
    request?: {
      body?: ReadableStream<Uint8Array> | null
      headers?: Headers
    }
  }
}

const byteChunk = (value: BodyChunk) => typeof value === 'string' ? encoder.encode(value) : value

const parseContentLength = (value: string | undefined) => {
  if (!value || !/^\d+$/u.test(value.trim())) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY
}

const nodeHeader = (event: RequestLike, name: string) => {
  const value = event.node?.req?.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

const requestHeader = (event: RequestLike, name: string) => (
  event.web?.request?.headers?.get(name) ?? nodeHeader(event, name)
)

const streamIterator = (stream: ReadableStream<Uint8Array>): BodyIterator => {
  const reader = stream.getReader()
  return {
    next: () => reader.read(),
    return: async () => {
      await reader.cancel()
      return { done: true, value: undefined }
    },
  }
}

const toCachedChunk = (value: unknown): BodyChunk | undefined => {
  if (typeof value === 'string' || value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return undefined
}

const readBoundedIterator = async (iterator: BodyIterator): Promise<string | undefined> => {
  const body = new Uint8Array(MAX_REQUEST_BODY_BYTES + 1)
  let retainedBytes = 0

  while (true) {
    const result = await iterator.next()
    if (result.done) break

    const chunk = byteChunk(result.value)
    const remaining = MAX_REQUEST_BODY_BYTES + 1 - retainedBytes
    if (remaining > 0) {
      const retainedLength = Math.min(chunk.byteLength, remaining)
      body.set(chunk.subarray(0, retainedLength), retainedBytes)
      retainedBytes += retainedLength
    }

    if (retainedBytes > MAX_REQUEST_BODY_BYTES) {
      try {
        await iterator.return?.()
      }
      catch {
        // Cancellation is best-effort; the bounded validation result remains stable.
      }
      throw new RequestBodyLimitError()
    }
  }

  if (retainedBytes === 0) return undefined
  return decoder.decode(body.subarray(0, retainedBytes))
}

const readCachedBody = (value: unknown) => {
  const chunk = toCachedChunk(value)
  if (chunk === undefined) return undefined
  const bytes = byteChunk(chunk)
  if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) throw new RequestBodyLimitError()
  return bytes.byteLength === 0 ? undefined : decoder.decode(bytes)
}

export const readBoundedRequestBody = async (input: unknown): Promise<string | undefined> => {
  const event = input as RequestLike
  if (requestHeader(event, requestBodyOverflowHeader) === '1') {
    throw new RequestBodyLimitError()
  }
  if ((parseContentLength(requestHeader(event, 'content-length')) ?? 0) > MAX_REQUEST_BODY_BYTES) {
    throw new RequestBodyLimitError()
  }

  const webBody = event.web?.request?.body
  if (webBody) return readBoundedIterator(streamIterator(webBody))

  const cachedBody = event._requestBody
    ?? event.node?.req?.rawBody
    ?? event.node?.req?.body
  if (cachedBody !== undefined) return readCachedBody(cachedBody)

  const iteratorFactory = event.node?.req?.[Symbol.asyncIterator]
  if (iteratorFactory) return readBoundedIterator(iteratorFactory.call(event.node?.req))

  return undefined
}
