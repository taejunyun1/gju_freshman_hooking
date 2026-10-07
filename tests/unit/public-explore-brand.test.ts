import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('department homepage branding for the public survey', () => {
  it('uses the original department logo and favicon without altering the artwork', () => {
    const assets = {
      'dpim-logo-light.svg': '88fdf4abf4c5efc3c31c2b01a6e30f9579df49add0022813085a879bfa76d054',
      'favicon.svg': '5e7bc05df05367e45a3185385eb7325a25b4776fe9a08438e9591949ddaa541a',
    }
    for (const [name, hash] of Object.entries(assets)) {
      expect(createHash('sha256').update(readFileSync(`public/brand/gjuphoto/${name}`)).digest('hex')).toBe(hash)
    }
    const page = read('app/pages/explore.vue')
    expect(page.match(/src="\/brand\/gjuphoto\/dpim-logo-light.svg"/gu)).toHaveLength(2)
    expect(page).toContain('alt="dpim 광주대학교 사진영상미디어학과"')
    expect(page).toContain("href: '/brand/gjuphoto/favicon.svg'")
    expect(page).not.toContain('PHOTO:<span>NEXT</span>')
  })

  it('isolates the monochrome palette from student and administrator pages', () => {
    const theme = read('app/assets/css/public-explore.css')
    expect(theme).toContain('body.department-explore-page')
    expect(theme).toContain('.public-explore {')
    expect(theme).not.toContain(':root')
    for (const color of ['#070709', '#0f0f14', '#1f1f28', '#b8b8c8', '#f4f4f8']) expect(theme).toContain(color)
    expect(read('app/assets/css/tokens.css')).toContain('--color-primary: #2563EB')
    expect(read('app/pages/explore.vue')).toContain("bodyAttrs: { class: 'department-explore-page' }")
  })

  it('keeps the contact form and selected options in the same accessible theme', () => {
    const form = read('app/components/counseling/PublicCounselingForm.vue')
    expect(form).not.toContain('background: white')
    expect(form).not.toContain('color: white')
    expect(form).toContain('color: var(--color-canvas)')
    expect(read('app/assets/css/public-explore.css')).toContain(':focus-visible')
    expect(read('app/assets/css/public-explore.css')).toContain('color-scheme: dark')
    expect(read('app/pages/explore.vue')).toContain('color: var(--color-canvas)')
  })
})
