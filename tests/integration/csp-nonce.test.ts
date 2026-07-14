import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

const trustedOpenTags = (chunks: string[]): string[] => chunks
  .join('')
  .match(/<(?:script|style)(?=[\s>])(?:"[^"]*"|'[^']*'|[^'"<>])*>/giu) ?? []

describe('SSR content security policy nonce', () => {
  it('normalizes every trusted Nuxt script and style to the request nonce', async () => {
    const { applyCspNonce } = await import('../../server/plugins/csp-nonce')
    const html = {
      body: ['<main><script nonce="application-nonce">untrusted()</script><style>main{color:red}</style></main>'],
      bodyAppend: ['<script nonce="old-payload" type="application/json">{"route":"/start"}</script><style nonce=old-style>.late{display:block}</style>'],
      bodyAttrs: [],
      bodyPrepend: ['<script data-description=" nonce=quoted-decoy" nonce="old-entry" src="/_nuxt/entry.js"></script>'],
      head: ['<style nonce="old-head">.app{color:blue}</style><script nonce="old-script">window.__NUXT__={}</script>'],
      htmlAttrs: [],
    }

    applyCspNonce(html, 'trusted-request-nonce')

    const tags = trustedOpenTags([...html.head, ...html.bodyPrepend, ...html.bodyAppend])
    expect(tags).toHaveLength(5)
    expect(tags.every(tag => tag.includes('nonce="trusted-request-nonce"'))).toBe(true)
    expect(tags.join('')).not.toMatch(/old-(?:head|script|entry|payload|style)/u)
    expect(html.bodyPrepend[0]).toContain('data-description=" nonce=quoted-decoy"')
  })

  it('adds the Vite nonce signal and does not trust application body markup', async () => {
    const { applyCspNonce } = await import('../../server/plugins/csp-nonce')
    const applicationMarkup = '<main><script nonce="application-nonce">untrusted()</script><style>main{color:red}</style></main>'
    const html = {
      body: [applicationMarkup],
      bodyAppend: ['<script>window.__NUXT__={}</script>'],
      bodyAttrs: [],
      bodyPrepend: [],
      head: ['<meta property="csp-nonce" nonce="stale-meta"><meta charset="utf-8">'],
      htmlAttrs: [],
    }

    applyCspNonce(html, 'current-request-nonce')

    expect(html.body).toEqual([applicationMarkup])
    expect(html.head.join('')).toContain('<meta property="csp-nonce" nonce="current-request-nonce">')
    expect(html.head.join('').match(/property="csp-nonce"/gu)).toHaveLength(1)
    expect(html.head.join('')).not.toContain('stale-meta')
  })
})
