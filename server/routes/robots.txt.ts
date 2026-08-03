import {
  PRIVATE_CRAWLER_PATHS,
  PUBLIC_NOINDEX_PATHS,
  PUBLIC_SITE_URL,
} from '../../shared/content/public-seo'

export const ROBOTS_TEXT = [
  'User-agent: *',
  'Allow: /',
  ...PRIVATE_CRAWLER_PATHS.map(path => `Disallow: ${path}`),
  ...PUBLIC_NOINDEX_PATHS.map(path => `Disallow: ${path}`),
  `Sitemap: ${PUBLIC_SITE_URL}/sitemap.xml`,
  '',
].join('\n')

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return ROBOTS_TEXT
})
