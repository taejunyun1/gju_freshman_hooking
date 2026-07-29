import { describe, expect, it, vi } from 'vitest'

type TestEvent = { headers: Record<string, string> }

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('setResponseHeader', (event: TestEvent, name: string, value: string) => {
  event.headers[name] = value
})
vi.stubGlobal('defineNuxtConfig', <Config>(config: Config) => config)

const getEvent = (): TestEvent => ({ headers: {} })

describe('public crawler routes', () => {
  it('publishes the root-only crawler policy and sitemap', async () => {
    const [{ default: robotsHandler }, { default: sitemapHandler }] = await Promise.all([
      import('../../server/routes/robots.txt'),
      import('../../server/routes/sitemap.xml'),
    ])
    const robotsEvent = getEvent()
    const sitemapEvent = getEvent()

    const robots = await robotsHandler(robotsEvent as never)
    const sitemap = await sitemapHandler(sitemapEvent as never)

    expect(robotsEvent.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(robots).toContain('Sitemap: https://photo-next-mvp.taejunyun.workers.dev/sitemap.xml')
    expect(robots).toContain('Disallow: /admin/')
    expect(robots).toContain('Disallow: /api/')
    expect(sitemapEvent.headers['content-type']).toBe('application/xml; charset=utf-8')
    expect(sitemap).toContain('<loc>https://photo-next-mvp.taejunyun.workers.dev/</loc>')
    expect(sitemap).not.toContain('<lastmod>')
  })

  it('adds noindex headers to every private path rule while preserving the root', async () => {
    const [{ default: nuxtConfig }, { PRIVATE_CRAWLER_PATHS }] = await Promise.all([
      import('../../nuxt.config'),
      import('../../shared/content/public-seo'),
    ])
    const routeRules = nuxtConfig.routeRules

    expect(routeRules['/']).toBeUndefined()
    for (const path of PRIVATE_CRAWLER_PATHS) {
      const rule = routeRules[`${path.endsWith('/') ? path.slice(0, -1) : path}/**`]

      expect(rule.headers['X-Robots-Tag']).toBe('noindex, nofollow, noarchive')
    }
  })
})
