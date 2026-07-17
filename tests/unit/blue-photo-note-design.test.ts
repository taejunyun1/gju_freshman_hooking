import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const applicationCss = [
  'app/assets/css/tokens.css',
  'app/assets/css/main.css',
  'app/layouts/admin.vue',
  'app/pages/index.vue',
  'app/pages/login.vue',
  'app/pages/assessment.vue',
  'app/pages/history.vue',
  'app/pages/counseling.vue',
  'app/pages/admin/login.vue',
].map(read).join('\n')
const applicationVueFiles = ['app/pages', 'app/components', 'app/layouts']
  .flatMap((directory) => readdirSync(directory, { recursive: true })
    .filter((file) => file.endsWith('.vue'))
    .map((file) => `${directory}/${file}`))
const applicationStyles = applicationVueFiles
  .flatMap((file) => [...read(file).matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gu)])
  .map(([, css]) => css)
  .join('\n')
const legacyAccentCss = [
  'app/pages/admin/export.vue',
  'app/components/admin/CampaignAttributionStrip.vue',
].map(read).join('\n')

describe('Blue Photo Note visual contract', () => {
  it('defines the approved blue palette and rounded geometry', () => {
    const tokens = read('app/assets/css/tokens.css')
    for (const value of ['#2563EB', '#14213D', '#EAF1FF', '#F5F8FF', '#FFFFFF', '#58677F', '#C53B3B']) {
      expect(tokens).toContain(value)
    }
    for (const token of ['--radius-control: 0.875rem', '--radius-card: 1.125rem', '--radius-panel: 1.25rem']) {
      expect(tokens).toContain(token)
    }
  })

  it('removes the previous multicolor brand accents', () => {
    for (const value of ['#6B43B5', '#2E7773', '#C27628', '#A98AE0']) {
      expect(applicationCss.toUpperCase()).not.toContain(value)
    }
  })

  it('caps the global h1 visual scale at the approved h2 size', () => {
    const main = read('app/assets/css/main.css')
    expect(main).toMatch(/h1\s*\{[\s\S]*?font-size:\s*clamp\(1\.75rem,\s*4vw,\s*2rem\)/u)
  })

  it('caps every page, component, and layout h1 declaration at 2rem', () => {
    const h1FontSizes: string[] = []
    for (const rule of applicationStyles.matchAll(/(?<selector>[^{}]*\bh1\b[^{}]*)\{(?<declarations>[^{}]*)\}/gu)) {
      const fontSize = rule.groups?.declarations.match(/font-size:\s*(?<value>[^;]+);/u)?.groups?.value
      if (fontSize) h1FontSizes.push(fontSize)
    }

    expect(h1FontSizes).not.toHaveLength(0)
    for (const fontSize of h1FontSizes) {
      const remValues = [...fontSize.matchAll(/(\d+(?:\.\d+)?)rem/gu)].map(([, value]) => Number(value))
      if (remValues.length > 0) expect(Math.max(...remValues)).toBeLessThanOrEqual(2)
    }
  })

  it('removes the named non-semantic lavender and teal accents', () => {
    for (const value of ['#C9B7EC', '#BCA7E4', '#8BC6BC', '#A9DDD4', '#CDBBEF']) {
      expect(legacyAccentCss.toUpperCase()).not.toContain(value)
    }
  })
})
