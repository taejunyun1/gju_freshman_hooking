import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

describe('SSR content security policy nonce', () => {
  it('adds the request nonce to every rendered Nuxt script', async () => {
    const { applyScriptNonce } = await import('../../server/plugins/csp-nonce')
    const html = {
      body: ['<main>PHOTO:NEXT</main>'],
      bodyAppend: ['<script type="application/json">{"route":"/start"}</script>'],
      bodyAttrs: [],
      bodyPrepend: ['<script src="/_nuxt/entry.js"></script>'],
      head: ['<meta charset="utf-8"><script>window.__NUXT__={}</script>'],
      htmlAttrs: [],
    }

    applyScriptNonce(html, 'trusted-request-nonce')

    expect(html.head[0]).toContain('<script nonce="trusted-request-nonce">')
    expect(html.bodyPrepend[0]).toContain('<script nonce="trusted-request-nonce" src=')
    expect(html.bodyAppend[0]).toContain('<script nonce="trusted-request-nonce" type=')
    expect(html.body[0]).toBe('<main>PHOTO:NEXT</main>')
  })
})
