import { describe, expect, it, vi } from 'vitest'
import {
  RequestBodyLimitError,
  readBoundedRequestBody,
} from '../../../server/utils/bounded-request-body'
import { createBodyGuardWorker } from '../../../cloudflare/request-body-guard.mjs'

const guardedUrl = 'https://photo-next.example/api/events'
const defaultMaxRequestBodyBytes = 65_536
const importMaxRequestBodyBytes = 512 * 1024
const imageMaxRequestBodyBytes = 8 * 1024 * 1024 + 64 * 1024

const streamRequest = (
  chunks: Uint8Array[],
  onCancel: () => void,
  url = guardedUrl,
  headers: Record<string, string> = {},
) => {
  let index = 0
  return new Request(url, {
    body: new ReadableStream<Uint8Array>({
      cancel: onCancel,
      pull(controller) {
        const chunk = chunks[index]
        index += 1
        if (chunk) controller.enqueue(chunk)
        else controller.close()
      },
    }, { highWaterMark: 0 }),
    duplex: 'half',
    headers: {
      'content-type': 'application/json',
      origin: 'https://photo-next.example',
      ...headers,
    },
    method: 'POST',
  } as RequestInit)
}

describe('bounded request bodies', () => {
  it('rejects a known oversized Node/Nitro body without reading it', async () => {
    const read = vi.fn()
    const event = {
      node: {
        req: {
          headers: { 'content-length': '8193' },
          [Symbol.asyncIterator]: read,
        },
      },
    }

    await expect(readBoundedRequestBody(event)).rejects.toBeInstanceOf(RequestBodyLimitError)
    expect(read).not.toHaveBeenCalled()
  })

  it('stops a chunked Node/Nitro body at byte 8193 and releases the iterator', async () => {
    const returned = vi.fn().mockResolvedValue({ done: true, value: undefined })
    const chunks = [new Uint8Array(4_096), new Uint8Array(4_096), new Uint8Array(2_048)]
    let index = 0
    const iterator = {
      next: vi.fn(async () => {
        const value = chunks[index]
        index += 1
        return value ? { done: false as const, value } : { done: true as const, value: undefined }
      }),
      return: returned,
    }
    const event = {
      node: {
        req: {
          headers: { 'transfer-encoding': 'chunked' },
          [Symbol.asyncIterator]: () => iterator,
        },
      },
    }

    await expect(readBoundedRequestBody(event)).rejects.toBeInstanceOf(RequestBodyLimitError)
    expect(iterator.next).toHaveBeenCalledTimes(3)
    expect(returned).toHaveBeenCalledOnce()
  })

  it('accepts exact and empty Node/Nitro bodies without an off-by-one rejection', async () => {
    const exact = new Uint8Array(8_192).fill(97)

    await expect(readBoundedRequestBody({
      node: { req: { body: exact, headers: { 'content-length': '8192' } } },
    })).resolves.toHaveLength(8_192)
    await expect(readBoundedRequestBody({
      node: { req: { body: new Uint8Array(), headers: { 'content-length': '0' } } },
    })).resolves.toBeUndefined()
  })

  it('fails closed instead of falling back to an unbounded Nitro body read', async () => {
    const unboundedRead = vi.fn().mockResolvedValue(new Uint8Array([123, 125]))
    vi.stubGlobal('readRawBody', unboundedRead)

    await expect(readBoundedRequestBody({
      node: { req: { headers: { 'content-length': '2' } } },
    })).resolves.toBeUndefined()
    expect(unboundedRead).not.toHaveBeenCalled()
  })

  it.each([
    '/api/events',
    '/api/events/',
    '/api/%65vents',
    '/api/events%2F',
    '/api/student/assessment/validate',
    '/api/student/assessment/validate/',
    '/api/student/assessment/%76alidate',
    '/api/student/assessment/validate%2F',
  ])('does not read a known oversized Cloudflare %s request before forwarding an overflow marker', async (path) => {
    let pulls = 0
    let cancellations = 0
    const request = new Request(new URL(path, guardedUrl), {
      body: new ReadableStream<Uint8Array>({
        cancel() { cancellations += 1 },
        pull(controller) {
          pulls += 1
          controller.enqueue(new Uint8Array(16_384))
          controller.close()
        },
      }, { highWaterMark: 0 }),
      duplex: 'half',
      headers: {
        'content-length': '8193',
        'content-type': 'application/json',
        cookie: 'photo_next_session=opaque-session',
        origin: 'https://photo-next.example',
        'x-photo-next-csrf': 'opaque-csrf',
      },
      method: 'POST',
    } as RequestInit)
    const received: Array<{
      bytes: number
      cookie: string | null
      csrf: string | null
      marker: string | null
      origin: string | null
    }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          cookie: forwarded.headers.get('cookie'),
          csrf: forwarded.headers.get('x-photo-next-csrf'),
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
          origin: forwarded.headers.get('origin'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(pulls).toBe(0)
    expect(cancellations).toBe(1)
    expect(received).toEqual([{
      bytes: 2,
      cookie: 'photo_next_session=opaque-session',
      csrf: 'opaque-csrf',
      marker: '1',
      origin: 'https://photo-next.example',
    }])
  })

  it.each([
    '/not-found',
    '/api/events/subpath',
    '/api/student/login',
  ])('bounds a known million-byte Cloudflare %s body before Nitro routing', async (path) => {
    let pulls = 0
    const cancelled = vi.fn()
    const request = new Request(new URL(path, guardedUrl), {
      body: new ReadableStream<Uint8Array>({
        cancel: cancelled,
        pull(controller) {
          pulls += 1
          controller.enqueue(new Uint8Array(1_000_000))
          controller.close()
        },
      }, { highWaterMark: 0 }),
      duplex: 'half',
      headers: {
        'content-length': '1000000',
        'content-type': 'application/json',
      },
      method: 'POST',
    } as RequestInit)
    const received: Array<{ bytes: number, marker: string | null, url: string }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
          url: forwarded.url,
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(pulls).toBe(0)
    expect(cancelled).toHaveBeenCalledOnce()
    expect(received).toEqual([{
      bytes: 2,
      marker: '1',
      url: new URL(path, guardedUrl).href,
    }])
  })

  it('enforces the default bound when Content-Length understates the body', async () => {
    const cancelled = vi.fn()
    const request = streamRequest([
      new Uint8Array(defaultMaxRequestBodyBytes),
      new Uint8Array(defaultMaxRequestBodyBytes),
    ], cancelled, 'https://photo-next.example/not-found', { 'content-length': '1' })
    const received: Array<{ bytes: number, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(cancelled).toHaveBeenCalledOnce()
    expect(received).toEqual([{ bytes: 2, marker: '1' }])
  })

  it('enforces the default bound for an unknown-length chunked login body', async () => {
    const cancelled = vi.fn()
    const request = streamRequest([
      new Uint8Array(32_768),
      new Uint8Array(32_768),
      new Uint8Array(32_768),
    ], cancelled, 'https://photo-next.example/api/student/login')
    const received: Array<{ bytes: number, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(cancelled).toHaveBeenCalledOnce()
    expect(received).toEqual([{ bytes: 2, marker: '1' }])
  })

  it('forwards an exact default-limit body on a non-overridden path unchanged', async () => {
    const cancelled = vi.fn()
    const url = 'https://photo-next.example/api/events/subpath?source=limit-test'
    const request = streamRequest([
      new Uint8Array(defaultMaxRequestBodyBytes),
    ], cancelled, url)
    const received: Array<{ bytes: number, marker: string | null, url: string }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
          url: forwarded.url,
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(cancelled).not.toHaveBeenCalled()
    expect(received).toEqual([{ bytes: defaultMaxRequestBodyBytes, marker: null, url }])
  })

  it('clears a client-spoofed overflow marker on a default-limit path', async () => {
    const request = new Request('https://photo-next.example/api/student/login', {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        'x-photo-next-body-overflow': '1',
      },
      method: 'POST',
    })
    const received: Array<{ body: string, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          body: await forwarded.text(),
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(received).toEqual([{ body: '{}', marker: null }])
  })

  it.each(['PUT', 'PATCH', 'OUTPUT'])(
    'bounds an oversized Cloudflare %s method before Nitro can reject the route method',
    async (method) => {
      const request = new Request(guardedUrl, {
        body: new Uint8Array(16_384),
        duplex: 'half',
        headers: {
          'content-length': '16384',
          'content-type': 'application/json',
        },
        method,
      } as RequestInit)
      const received: Array<{ bytes: number, marker: string | null }> = []
      const worker = createBodyGuardWorker({
        async fetch(forwarded: Request) {
          received.push({
            bytes: (await forwarded.arrayBuffer()).byteLength,
            marker: forwarded.headers.get('x-photo-next-body-overflow'),
          })
          return new Response('ok')
        },
      })

      await worker.fetch(request, {}, {})

      expect(received).toEqual([{ bytes: 2, marker: '1' }])
    },
  )

  it('cancels a chunked Cloudflare request after byte 8193 and keeps Nitro bounded', async () => {
    const cancelled = vi.fn()
    const request = streamRequest([
      new Uint8Array(4_096),
      new Uint8Array(4_096),
      new Uint8Array(2_048),
      new Uint8Array(2_048),
    ], cancelled)
    const received: Array<{ bytes: number, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(cancelled).toHaveBeenCalledOnce()
    expect(received).toEqual([{ bytes: 2, marker: '1' }])
  })

  it('forwards an exact 8192-byte Cloudflare body without an overflow marker', async () => {
    const cancelled = vi.fn()
    const request = streamRequest([new Uint8Array(8_192)], cancelled)
    const received: Array<{ bytes: number, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(cancelled).not.toHaveBeenCalled()
    expect(received).toEqual([{ bytes: 8_192, marker: null }])
  })

  it('clears a client-spoofed overflow marker from an in-bounds request', async () => {
    const request = new Request(guardedUrl, {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        'x-photo-next-body-overflow': '1',
      },
      method: 'POST',
    })
    const received: Array<{ body: string, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          body: await forwarded.text(),
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(received).toEqual([{ body: '{}', marker: null }])
  })

  it('forwards an empty Cloudflare body without an overflow marker', async () => {
    const request = new Request(guardedUrl, {
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const received: Array<{ bytes: number, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, {}, {})

    expect(received).toEqual([{ bytes: 0, marker: null }])
  })

  it('preserves Cloudflare request metadata, bindings, and execution context', async () => {
    const cf = { colo: 'ICN', requestPriority: 'weight=192' }
    const env = { ASSETS: { fetch: vi.fn() } }
    const context = { waitUntil: vi.fn() }
    const request = new Request(`${guardedUrl}?source=metadata-test`, {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    Object.defineProperty(request, 'cf', { configurable: true, value: cf })
    const received: unknown[] = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request, forwardedEnv: unknown, forwardedContext: unknown) {
        received.push({
          cf: (forwarded as Request & { cf?: unknown }).cf,
          context: forwardedContext,
          env: forwardedEnv,
          method: forwarded.method,
          url: forwarded.url,
        })
        return new Response('ok')
      },
    })

    await worker.fetch(request, env, context)

    expect(received).toEqual([{
      cf,
      context,
      env,
      method: 'POST',
      url: `${guardedUrl}?source=metadata-test`,
    }])
  })

  it.each([
    ['/api/admin/resources/equipment/import/validate', 70 * 1024],
    ['/api/admin/resources/42/image', 100 * 1024],
    ['/api/admin/resources/%34%32/image/', 100 * 1024],
  ])('forwards a legitimate route-specific %s body before Nitro parsing', async (path, size) => {
    const received: Array<{ bytes: number, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })

    await worker.fetch(new Request(new URL(path, guardedUrl), {
      body: new Uint8Array(size),
      duplex: 'half',
      headers: { 'content-length': String(size) },
      method: 'POST',
    } as RequestInit), {}, {})

    expect(received).toEqual([{ bytes: size, marker: null }])
  })

  it.each([
    ['/api/admin/resources/equipment/import/validate', importMaxRequestBodyBytes],
    ['/api/admin/resources/42/image', imageMaxRequestBodyBytes],
  ])('accepts the exact %s route body limit and rejects one byte more', async (path, maximum) => {
    const received: Array<{ bytes: number, marker: string | null }> = []
    const worker = createBodyGuardWorker({
      async fetch(forwarded: Request) {
        received.push({
          bytes: (await forwarded.arrayBuffer()).byteLength,
          marker: forwarded.headers.get('x-photo-next-body-overflow'),
        })
        return new Response('ok')
      },
    })
    for (const size of [maximum, maximum + 1]) {
      await worker.fetch(new Request(new URL(path, guardedUrl), {
        body: new Uint8Array(size),
        duplex: 'half',
        headers: { 'content-length': String(size) },
        method: 'POST',
      } as RequestInit), {}, {})
    }

    expect(received).toEqual([
      { bytes: maximum, marker: null },
      { bytes: 2, marker: '1' },
    ])
  })
})
