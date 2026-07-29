import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  LANDING_DISCOVERY_COPY,
  PUBLIC_DEPARTMENT_JSON_LD,
  PUBLIC_SEO,
  PUBLIC_SITE_URL,
  PUBLIC_WEB_SITE_JSON_LD,
} from '../../../shared/content/public-seo'

describe('public SEO content', () => {
  it('keeps landing metadata out of the global application head', () => {
    const appSource = readFileSync('app/app.vue', 'utf8')

    expect(appSource).toContain("title: 'PHOTO:NEXT'")
    expect(appSource).not.toContain('PUBLIC_SEO')
    expect(appSource).not.toContain(PUBLIC_SEO.description)
    expect(appSource).not.toContain("name: 'description'")
    expect(appSource).not.toMatch(/canonical|og(?:Title|Description|Url|Image|Type)|twitter/i)
  })

  it('defines the approved public landing identity', () => {
    expect(PUBLIC_SITE_URL).toBe('https://photo-next-mvp.taejunyun.workers.dev')
    expect(PUBLIC_SEO.title).toBe('광주대학교 사진영상미디어학과 | 사진·영상·편집 진로·입시 안내')
    expect(PUBLIC_SEO.description).toContain('광주·전남·전북')
  })

  it('provides Korean WebSite and department JSON-LD records', () => {
    expect(PUBLIC_DEPARTMENT_JSON_LD['@type']).toBe('CollegeOrUniversity')
    expect(PUBLIC_WEB_SITE_JSON_LD.inLanguage).toBe('ko-KR')
    expect(LANDING_DISCOVERY_COPY.body).toContain('영상촬영·편집')
  })
})
