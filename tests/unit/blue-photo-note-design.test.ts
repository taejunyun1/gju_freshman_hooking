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
const applicationCssFiles = readdirSync('app/assets/css', { recursive: true })
  .filter((file) => file.endsWith('.css'))
  .map((file) => `app/assets/css/${file}`)
const applicationStyles = applicationVueFiles
  .flatMap((file) => [...read(file).matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gu)])
  .map(([, css]) => css)
  .join('\n')
const allApplicationStyles = [
  ...applicationCssFiles.map(read),
  applicationStyles,
].join('\n')
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

  it('keeps every administrator h1 declaration at or below 2rem', () => {
    const adminPages = [
      'app/pages/admin/campaigns.vue',
      'app/pages/admin/counseling.vue',
      'app/pages/admin/export.vue',
      'app/pages/admin/faculty/[id].vue',
      'app/pages/admin/faculty/index.vue',
      'app/pages/admin/index.vue',
      'app/pages/admin/login.vue',
      'app/pages/admin/narrative-reports.vue',
      'app/pages/admin/resources/[id].vue',
      'app/pages/admin/resources/index.vue',
      'app/pages/admin/students/[id].vue',
      'app/pages/admin/students/index.vue',
      'app/pages/admin/students/roster.vue',
    ]
    for (const path of adminPages) {
      const blocks = [...read(path).matchAll(/h1[^{}]*\{(?<body>[^}]*)\}/gu)]
      for (const block of blocks) {
        const declaration = block.groups?.body.match(/font-size:\s*(?<value>[^;]+)/u)?.groups?.value
        if (!declaration) continue
        const remValues = [...declaration.matchAll(/(?<value>\d+(?:\.\d+)?)rem/gu)]
          .map(match => Number(match.groups?.value))
        expect(Math.max(...remValues)).toBeLessThanOrEqual(2)
      }
    }
  })

  it('uses the shared rounded tokens in student entry and assessment surfaces', () => {
    expect(read('app/pages/index.vue')).toContain('border-radius: var(--radius-panel)')
    expect(read('app/pages/login.vue')).toContain('border-radius: var(--radius-panel)')
    expect(read('app/components/assessment/OptionCard.vue')).toContain('border-radius: var(--radius-card)')
  })

  it('uses primary and supporting card geometry in the result experience', () => {
    expect(read('app/components/result/LearningPath.vue')).toContain('border-radius: var(--radius-panel)')
    expect(read('app/components/result/FacultyRecommendation.vue')).toContain('border-radius: var(--radius-panel)')
    expect(read('app/components/result/CapabilityEvidence.vue')).toContain('border-radius: var(--radius-card)')
  })

  it('uses the blue system in the administrator shell and shared panels', () => {
    expect(read('app/layouts/admin.vue')).toContain('background: var(--color-primary-strong)')
    expect(read('app/layouts/admin.vue')).toContain('border-radius: var(--radius-control)')
    expect(read('app/components/admin/DataTable.vue')).toContain('border-radius: var(--radius-panel)')
    expect(read('app/components/admin/RosterImportPanel.vue')).toContain('border-radius: var(--radius-panel)')
  })

  it('keeps directly styled administrator controls visibly focused', () => {
    for (const path of [
      'app/components/admin/RosterImportPanel.vue',
      'app/components/admin/RosterStudentForm.vue',
      'app/components/admin/PasswordReissueDialog.vue',
      'app/components/admin/RosterPreviewTable.vue',
    ]) {
      const source = read(path)
      expect(source).toContain(':focus-visible')
      expect(source).toContain('outline: 3px solid var(--color-primary)')
      expect(source).toContain('outline-offset: 2px')
    }
  })

  it('uses direct approved palette tokens across the student entry journey', () => {
    const studentStyles = [
      'app/pages/index.vue',
      'app/pages/login.vue',
      'app/pages/assessment.vue',
      'app/components/assessment/AssessmentProgress.vue',
      'app/components/assessment/AssessmentStep.vue',
      'app/components/assessment/OptionCard.vue',
    ].map(read).join('\n')

    expect(studentStyles).not.toMatch(/var\(--color-(?:ink|sequence|resource|signal)\)/u)
  })

  it('uses the approved clamp for every page, component, and layout h1 declaration', () => {
    const h1FontSizes: string[] = []
    for (const rule of applicationStyles.matchAll(/(?<selector>[^{}]*\bh1\b[^{}]*)\{(?<declarations>[^{}]*)\}/gu)) {
      const fontSize = rule.groups?.declarations.match(/font-size:\s*(?<value>[^;]+);/u)?.groups?.value
      if (fontSize) h1FontSizes.push(fontSize)
    }

    expect(h1FontSizes).not.toHaveLength(0)
    for (const fontSize of h1FontSizes) expect(fontSize).toBe('clamp(1.75rem, 4vw, 2rem)')
  })

  it('removes square and undersized border radii from application styles', () => {
    expect(allApplicationStyles).not.toMatch(/border-radius:\s*(?:0\.125rem|0\.25rem|0\.375rem|0\.5rem|[1-9]px|0)(?:\s|;)/u)
  })

  it('removes the named non-semantic lavender and teal accents', () => {
    for (const value of ['#C9B7EC', '#BCA7E4', '#8BC6BC', '#A9DDD4', '#CDBBEF']) {
      expect(legacyAccentCss.toUpperCase()).not.toContain(value)
    }
  })
})
