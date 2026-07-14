import { describe, expect, it, vi } from 'vitest'

type ErrorHook = (error: Error & Record<string, unknown>, context: { event?: { context: Record<string, unknown> } }) => void

describe('global request error sanitizer', () => {
  it('preserves the deliberate generic student security rejection status', async () => {
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    const { sanitizeUnhandledError } = await import('../../server/plugins/error-sanitizer')
    const error = Object.assign(new Error('REQUEST_FORBIDDEN'), {
      statusCode: 403,
      statusMessage: 'REQUEST_FORBIDDEN',
    })

    sanitizeUnhandledError(error, { context: { requestId: '88888888-8888-4888-8888-888888888888' } })

    expect(error.statusCode).toBe(403)
    expect(error.statusMessage).toBe('REQUEST_FORBIDDEN')
    expect(error.message).toBe('REQUEST_FORBIDDEN')
  })

  it('scrubs an unhandled error before response serialization or logging while preserving its request ID', async () => {
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    const { installUnhandledErrorSanitizer } = await import('../../server/plugins/error-sanitizer')
    let errorHook: ErrorHook | undefined
    installUnhandledErrorSanitizer({
      hooks: {
        hook: (name: string, handler: ErrorHook) => {
          expect(name).toBe('error')
          errorHook = handler
        },
      },
    })

    const error = Object.assign(new Error('phone=01012345678 password=WRONG99'), {
      cause: new Error('session-token=secret-session-token'),
      data: { authorization: 'Bearer sensitive-token', phone: '01012345678' },
      stack: 'sensitive-stack-trace',
    })
    const event = { context: { requestId: '77777777-7777-4777-8777-777777777777' } }

    errorHook?.(error, { event })

    const serializedResponse = JSON.stringify({
      data: error.data,
      message: error.message,
      requestId: event.context.requestId,
      stack: error.stack,
    })
    const serializedLog = JSON.stringify({
      cause: error.cause instanceof Error ? error.cause.message : error.cause,
      data: error.data,
      message: error.message,
      stack: error.stack,
    })

    expect(error.statusCode).toBe(500)
    expect(error.statusMessage).toBe('Internal Server Error')
    expect(event.context.requestId).toBe('77777777-7777-4777-8777-777777777777')
    expect(serializedResponse).not.toContain('01012345678')
    expect(serializedResponse).not.toContain('WRONG99')
    expect(serializedLog).not.toContain('sensitive-token')
    expect(serializedLog).not.toContain('secret-session-token')
    expect(serializedLog).not.toContain('sensitive-stack-trace')
  })
})
