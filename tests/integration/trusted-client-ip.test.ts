import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type TestEvent = {
  cloudflare: boolean
  directIp?: string
  headers: Record<string, string | undefined>
}

const dependencies = {
  getDirectIp: (event: unknown) => (event as TestEvent).directIp,
  getHeader: (event: unknown, name: string) => (event as TestEvent).headers[name.toLowerCase()],
  isCloudflare: (event: unknown) => (event as TestEvent).cloudflare,
}

describe('trusted client IP', () => {
  it('uses one validated Cloudflare address regardless of spoofed X-Forwarded-For values', async () => {
    const { createTrustedClientIpReader } = await import('../../server/utils/trusted-client-ip')
    const readIp = createTrustedClientIpReader(dependencies)
    const first = readIp({
      cloudflare: true,
      directIp: '127.0.0.1',
      headers: { 'cf-connecting-ip': '203.0.113.19', 'x-forwarded-for': '198.51.100.1' },
    })
    const second = readIp({
      cloudflare: true,
      directIp: '127.0.0.1',
      headers: { 'cf-connecting-ip': '203.0.113.19', 'x-forwarded-for': '192.0.2.77' },
    })

    expect(first).toBe('203.0.113.19')
    expect(second).toBe(first)
  })

  it('never treats X-Forwarded-For as the fallback bucket key', async () => {
    const { createTrustedClientIpReader } = await import('../../server/utils/trusted-client-ip')
    const readIp = createTrustedClientIpReader(dependencies)

    expect(readIp({
      cloudflare: false,
      directIp: '192.0.2.10',
      headers: { 'x-forwarded-for': '198.51.100.200' },
    })).toBe('192.0.2.10')
    expect(readIp({
      cloudflare: false,
      headers: { 'x-forwarded-for': '198.51.100.200' },
    })).toBe('unknown')
  })

  it.each(['203.0.113.8', '2001:db8::8', '::ffff:192.0.2.3'])(
    'accepts a single Worker-compatible IPv4 or IPv6 value: %s',
    async (address) => {
      const { createTrustedClientIpReader } = await import('../../server/utils/trusted-client-ip')
      const readIp = createTrustedClientIpReader(dependencies)

      expect(readIp({
        cloudflare: true,
        directIp: '127.0.0.1',
        headers: { 'cf-connecting-ip': address },
      })).toBe(address)
    },
  )

  it.each([
    '203.0.113.8, 198.51.100.4',
    '203.0.113.8 ',
    '203.0.113.999',
    '[2001:db8::8]',
    '2001:db8::8%eth0',
    'not-an-ip',
  ])('rejects invalid or multi-value Cloudflare headers and uses the direct address: %s', async (address) => {
    const { createTrustedClientIpReader } = await import('../../server/utils/trusted-client-ip')
    const readIp = createTrustedClientIpReader(dependencies)

    expect(readIp({
      cloudflare: true,
      directIp: '127.0.0.1',
      headers: { 'cf-connecting-ip': address },
    })).toBe('127.0.0.1')
  })

  it('wires every identity rate-limit route through the trusted reader without forwarded trust', () => {
    const routeFiles = [
      'server/api/student/register.post.ts',
      'server/api/student/login.post.ts',
      'server/api/student/password/recovery/request.post.ts',
      'server/api/student/password/recovery/complete.post.ts',
    ]

    for (const routeFile of routeFiles) {
      const source = readFileSync(resolve(process.cwd(), routeFile), 'utf8')
      expect(source, routeFile).toContain('getTrustedClientIp')
      expect(source, routeFile).not.toContain('xForwardedFor')
    }
  })
})
