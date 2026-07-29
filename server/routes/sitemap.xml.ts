import { PUBLIC_SITE_URL } from '../../shared/content/public-seo'

export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${PUBLIC_SITE_URL}/</loc></url>
</urlset>
`

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return SITEMAP_XML
})
