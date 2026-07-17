import { readFileSync } from 'node:fs'
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
})
