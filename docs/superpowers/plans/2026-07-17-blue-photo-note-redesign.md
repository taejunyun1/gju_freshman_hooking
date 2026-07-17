# PHOTO:NEXT Blue Photo Note Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign every student and administrator screen with one blue, rounded visual system while keeping all semantic `h1` elements visually no larger than 2rem and preserving existing behavior.

**Architecture:** Introduce the approved palette, radii, shadows, and type scale as backward-compatible global tokens first. Apply those primitives to shared controls, then restyle the student journey, result/counseling surfaces, administrator shell/shared controls, and administrator feature pages in isolated groups. Behavior, API calls, component props, routes, and data contracts remain unchanged.

**Tech Stack:** Nuxt 4, Vue 3 scoped CSS, CSS custom properties and `color-mix()`, Vitest, Vue Test Utils, Playwright, Cloudflare Workers.

## Global Constraints

- Main blue is `#2563EB`; deep navy is `#14213D`; soft blue is `#EAF1FF`; canvas is `#F5F8FF`; surface is `#FFFFFF`; muted text is `#58677F`; semantic error is `#C53B3B`.
- Purple, teal, orange, and lavender brand accents are removed from application CSS.
- Every semantic `h1` remains in the markup for accessibility but renders at `clamp(1.75rem, 4vw, 2rem)` or smaller.
- Cards use 14–20px radii, controls use 12–14px radii, and tags alone use pill radii.
- Equipment and facilities stay supporting evidence, not the primary result content.
- Existing behavior, API calls, schemas, routes, authentication, and Korean copy meaning do not change.
- Keyboard focus, 44px touch targets, 320px layouts, reduced motion, and non-color status cues remain supported.

---

## File Structure

- `app/assets/css/tokens.css`: canonical palette, type, radius, shadow, and width tokens; legacy semantic names become blue aliases during migration.
- `app/assets/css/main.css`: global body, heading cap, focus, selection, form, and reduced-motion baseline.
- `app/components/common/*`: canonical button and state-panel appearance consumed by both student and administrator surfaces.
- `app/pages/index.vue`, `app/pages/login.vue`, `app/pages/assessment.vue`, `app/components/assessment/*`: student entry and selection journey.
- `app/pages/result/[publicId].vue`, `app/pages/history.vue`, `app/pages/counseling.vue`, `app/components/result/*`, `app/components/counseling/*`: result hierarchy, supporting evidence, history, and counseling.
- `app/layouts/admin.vue`, `app/pages/admin/login.vue`, `app/pages/admin/index.vue`, `app/components/admin/*`: administrator shell and shared operations UI.
- Remaining `app/pages/admin/**/*.vue`: dense administrator feature screens.
- `tests/unit/blue-photo-note-design.test.ts`: static design-contract regression coverage.
- Existing page/component tests: behavioral regression coverage.
- `tests/e2e/blue-photo-note-visual.spec.ts`: desktop/mobile overflow, heading cap, palette, and radius smoke coverage.

### Task 1: Global Blue Photo Note Foundation

**Files:**
- Create: `tests/unit/blue-photo-note-design.test.ts`
- Modify: `tests/unit/design-tokens.test.ts`
- Modify: `app/assets/css/tokens.css`
- Modify: `app/assets/css/main.css`
- Modify: `app/components/common/AppButton.vue`
- Modify: `app/components/common/AppState.vue`

**Interfaces:**
- Produces: CSS tokens `--color-primary`, `--color-primary-strong`, `--color-primary-soft`, `--color-muted`, `--radius-control`, `--radius-card`, `--radius-panel`, `--shadow-raised`.
- Produces: backward-compatible aliases `--color-ink`, `--color-sequence`, `--color-resource`, and `--color-signal`, all derived from the approved blue system.
- Consumes: existing font and width tokens.

- [ ] **Step 1: Write the failing design-contract test**

Create `tests/unit/blue-photo-note-design.test.ts` with the exact contract:

```ts
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
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/blue-photo-note-design.test.ts
```

Expected: three failing tests because the approved palette, radii, and heading cap do not exist yet.

- [ ] **Step 3: Replace tokens with the approved system**

Set `app/assets/css/tokens.css` to this complete token contract while retaining the existing font, content-width, and touch-target names:

```css
:root {
  --color-primary: #2563EB;
  --color-primary-strong: #14213D;
  --color-primary-soft: #EAF1FF;
  --color-canvas: #F5F8FF;
  --color-surface: #FFFFFF;
  --color-muted: #58677F;
  --color-error: #C53B3B;
  --color-ink: var(--color-primary-strong);
  --color-sequence: var(--color-primary);
  --color-resource: var(--color-primary);
  --color-signal: var(--color-primary);
  --font-display: 'Wanted Sans Variable', sans-serif;
  --font-body: 'Pretendard Variable', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
  --radius-control: 0.875rem;
  --radius-card: 1.125rem;
  --radius-panel: 1.25rem;
  --radius-pill: 999px;
  --shadow-raised: 0 0.875rem 2.25rem color-mix(in srgb, var(--color-primary-strong) 10%, transparent);
  --content: 720px;
  --timeline: 1120px;
  --admin: 1440px;
  --touch-target: 44px;
}
```

- [ ] **Step 4: Add the global heading, form, and focus baseline**

Append or merge these rules in `app/assets/css/main.css`, keeping the existing reset and reduced-motion block:

```css
body { color: var(--color-primary-strong); line-height: 1.55; }
h1 { font-size: clamp(1.75rem, 4vw, 2rem); line-height: 1.18; }
h2 { font-size: clamp(1.375rem, 3vw, 1.625rem); line-height: 1.25; }
h1, h2, h3 { color: var(--color-primary-strong); word-break: keep-all; }
:focus-visible { outline-color: var(--color-primary); }
input, textarea, select { border-radius: var(--radius-control); }
::selection { background: var(--color-primary-soft); color: var(--color-primary-strong); }
```

- [ ] **Step 5: Restyle shared controls**

In `AppButton.vue`, use `var(--radius-control)` for the button, blue primary, white secondary with blue border/text, the semantic red danger variant, and `var(--shadow-raised)` only on hover. In `AppState.vue`, add `border-radius: var(--radius-card)`, use soft blue for loading and empty states, and preserve red plus the `!` marker for errors.

- [ ] **Step 6: Update the old token assertions and verify GREEN**

Replace the legacy color list in `tests/unit/design-tokens.test.ts` with the seven approved colors. Update contrast calculations to use `#14213D`, `#F5F8FF`, `#2563EB`, and `#FFFFFF`; remove the separate orange clip case because signal aliases primary.

Run:

```bash
corepack pnpm exec vitest run tests/unit/blue-photo-note-design.test.ts tests/unit/design-tokens.test.ts
```

Expected: both test files pass.

- [ ] **Step 7: Commit the foundation**

```bash
git add app/assets/css/tokens.css app/assets/css/main.css app/components/common/AppButton.vue app/components/common/AppState.vue tests/unit/blue-photo-note-design.test.ts tests/unit/design-tokens.test.ts
git commit -m "style: 2026-07-17 블루 포토 노트 전역 디자인 토큰"
```

### Task 2: Student Entry and Assessment Journey

**Files:**
- Modify: `app/pages/index.vue`
- Modify: `app/pages/login.vue`
- Modify: `app/pages/assessment.vue`
- Modify: `app/components/assessment/AssessmentProgress.vue`
- Modify: `app/components/assessment/AssessmentStep.vue`
- Modify: `app/components/assessment/OptionCard.vue`
- Test: `tests/unit/components/AssessmentStep.test.ts`
- Test: `tests/unit/pages/StudentAssessmentPage.test.ts`
- Test: `tests/unit/blue-photo-note-design.test.ts`

**Interfaces:**
- Consumes: Task 1 color, radius, focus, and heading tokens.
- Produces: rounded landing sequence cards, compact student login card, and rounded assessment selection language.

- [ ] **Step 1: Extend the failing contract for student screens**

Add exact assertions to `tests/unit/blue-photo-note-design.test.ts`:

```ts
it('uses the shared rounded tokens in student entry and assessment surfaces', () => {
  expect(read('app/pages/index.vue')).toContain('border-radius: var(--radius-panel)')
  expect(read('app/pages/login.vue')).toContain('border-radius: var(--radius-panel)')
  expect(read('app/components/assessment/OptionCard.vue')).toContain('border-radius: var(--radius-card)')
})
```

- [ ] **Step 2: Verify the student contract fails**

Run:

```bash
corepack pnpm exec vitest run tests/unit/blue-photo-note-design.test.ts
```

Expected: the new student-surface test fails on the first missing radius token.

- [ ] **Step 3: Restyle the landing page**

Keep the current content and sequence order. Change `.landing__hero h1` to the global maximum, widen it to `22ch`, reduce hero vertical padding, round `.sequence__frame` with `var(--radius-panel)`, add `overflow: hidden`, replace hard offset shadow with `var(--shadow-raised)`, and make `.landing__cta` use `var(--radius-control)`. Use only primary, strong, soft, surface, canvas, muted, and error tokens.

- [ ] **Step 4: Restyle the student login page**

Wrap `.login-page__frame` in a white rounded panel with `border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent)`, `border-radius: var(--radius-panel)`, `box-shadow: var(--shadow-raised)`, and responsive padding. Remove its local oversized `h1` rule. Use `var(--radius-control)` for inputs and submit button. Preserve the blue path rail as the approved signature.

- [ ] **Step 5: Restyle assessment controls**

Use a white rounded top bar and rounded state panels in `assessment.vue`; use a soft-blue progress track in `AssessmentProgress.vue`; use `var(--radius-card)` for `OptionCard.vue`. Replace all decorative black shapes and hard offset shadows with one blue selection border, soft-blue background, and a subtle raised shadow. Preserve option icons, labels, checkbox semantics, and click behavior.

- [ ] **Step 6: Verify student behavior and design GREEN**

Run:

```bash
corepack pnpm exec vitest run tests/unit/blue-photo-note-design.test.ts tests/unit/components/AssessmentStep.test.ts tests/unit/pages/StudentAssessmentPage.test.ts
```

Expected: all tests pass without changing emitted events, navigation, or assessment payloads.

- [ ] **Step 7: Commit student entry surfaces**

```bash
git add app/pages/index.vue app/pages/login.vue app/pages/assessment.vue app/components/assessment tests/unit/blue-photo-note-design.test.ts
git commit -m "style: 2026-07-17 학생 진입과 진단 화면 재디자인"
```

### Task 3: Results, Supporting Evidence, History, and Counseling

**Files:**
- Modify: `app/pages/result/[publicId].vue`
- Modify: `app/pages/history.vue`
- Modify: `app/pages/counseling.vue`
- Modify: `app/components/result/CapabilityEvidence.vue`
- Modify: `app/components/result/CareerNarrative.vue`
- Modify: `app/components/result/CareerNarrativeReport.vue`
- Modify: `app/components/result/ConnectionReason.vue`
- Modify: `app/components/result/FacultyCard.vue`
- Modify: `app/components/result/FacultyRecommendation.vue`
- Modify: `app/components/result/InterestClip.vue`
- Modify: `app/components/result/LearningPath.vue`
- Modify: `app/components/result/ResourceCard.vue`
- Modify: `app/components/result/ResultTimeline.vue`
- Modify: `app/components/result/TrackScore.vue`
- Modify: `app/components/counseling/CounselingCTA.vue`
- Modify: `app/components/counseling/CounselingForm.vue`
- Modify: `app/components/counseling/CounselingStatus.vue`
- Test: `tests/unit/pages/ResultPage.test.ts`
- Test: `tests/unit/pages/HistoryPage.test.ts`
- Test: `tests/unit/pages/CounselingPage.test.ts`
- Test: `tests/unit/components/ResultTimeline.test.ts`
- Test: `tests/unit/components/CounselingForm.test.ts`

**Interfaces:**
- Consumes: Task 1 design tokens and Task 2 student shell language.
- Produces: one main result path with equipment/facilities visually subordinate.

- [ ] **Step 1: Add a failing result-hierarchy regression test**

In `tests/unit/pages/ResultPage.test.ts`, add a source-order assertion using the existing rendered wrapper or source fixture:

```ts
it('keeps learning, faculty, and career ahead of supporting resource evidence', () => {
  const source = readFileSync('app/pages/result/[publicId].vue', 'utf8')
  expect(source.indexOf('<LearningPath')).toBeLessThan(source.indexOf('<CapabilityEvidence'))
  expect(source.indexOf('<FacultyRecommendation')).toBeLessThan(source.indexOf('<CapabilityEvidence'))
  expect(source.indexOf('<CareerNarrative')).toBeLessThan(source.indexOf('<CapabilityEvidence'))
})
```

Also extend `tests/unit/blue-photo-note-design.test.ts` so the visual portion is guaranteed to start RED:

```ts
it('uses primary and supporting card geometry in the result experience', () => {
  expect(read('app/components/result/LearningPath.vue')).toContain('border-radius: var(--radius-panel)')
  expect(read('app/components/result/FacultyRecommendation.vue')).toContain('border-radius: var(--radius-panel)')
  expect(read('app/components/result/CapabilityEvidence.vue')).toContain('border-radius: var(--radius-card)')
})
```

- [ ] **Step 2: Run the focused result tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/pages/ResultPage.test.ts tests/unit/blue-photo-note-design.test.ts
```

Expected: the design-contract test fails because the result components do not yet use the approved radius tokens. The hierarchy assertion either passes as a preserved contract or exposes an ordering defect.

- [ ] **Step 3: Apply the visual hierarchy**

Keep or move blocks into this order: interest/track summary, learning path, faculty recommendation, career narrative, extracurricular guidance, supporting capability/equipment evidence, counseling CTA. Render the first four as full-width white cards with `var(--radius-panel)` and the supporting evidence/resources as smaller soft-blue cards with `var(--radius-card)`, smaller headings, and no dominant accent bar.

- [ ] **Step 4: Normalize every result component**

Replace 2–6px square corners and hard black dividers across `app/components/result/*.vue` with shared radii and blue-tinted 1px borders. Use the blue path line only in `LearningPath.vue` and `ResultTimeline.vue`. Use pill radii only for score/category tags. Remove teal/orange distinctions; communicate category names in text.

- [ ] **Step 5: Restyle history and counseling**

Use rounded list containers rather than isolated square rows, keep history dates/scores legible in muted/navy text, and make counseling form/status/CTA use white panels, soft-blue nested sections, blue primary actions, and semantic red errors. Remove all local oversized `h1` rules.

- [ ] **Step 6: Verify results and counseling**

Run:

```bash
corepack pnpm exec vitest run tests/unit/pages/ResultPage.test.ts tests/unit/pages/HistoryPage.test.ts tests/unit/pages/CounselingPage.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/components/CounselingForm.test.ts
```

Expected: all tests pass and no behavior snapshots or emitted payloads change.

- [ ] **Step 7: Commit result surfaces**

```bash
git add app/pages/result app/pages/history.vue app/pages/counseling.vue app/components/result app/components/counseling tests/unit/pages/ResultPage.test.ts
git commit -m "style: 2026-07-17 결과와 상담 화면 블루 경로 재구성"
```

### Task 4: Administrator Shell and Shared Controls

**Files:**
- Modify: `app/layouts/admin.vue`
- Modify: `app/pages/admin/login.vue`
- Modify: `app/pages/admin/index.vue`
- Modify: `app/components/admin/AdmissionCycleStrip.vue`
- Modify: `app/components/admin/CampaignAttributionStrip.vue`
- Modify: `app/components/admin/DataTable.vue`
- Modify: `app/components/admin/EquipmentInventoryTable.vue`
- Modify: `app/components/admin/PasswordReissueDialog.vue`
- Modify: `app/components/admin/PhoneRevealDialog.vue`
- Modify: `app/components/admin/RosterImportPanel.vue`
- Modify: `app/components/admin/RosterPreviewTable.vue`
- Modify: `app/components/admin/RosterStudentForm.vue`
- Modify: `app/components/admin/StudentFilters.vue`
- Test: `tests/unit/admin/AdminShell.test.ts`
- Test: `tests/unit/components/RosterImportPanel.test.ts`
- Test: `tests/unit/blue-photo-note-design.test.ts`

**Interfaces:**
- Consumes: Task 1 global tokens.
- Produces: deep-navy desktop rail, blue active route, rounded administrator panels, tables, forms, and dialogs.

- [ ] **Step 1: Add failing administrator shell assertions**

Extend `tests/unit/blue-photo-note-design.test.ts`:

```ts
it('uses the blue system in the administrator shell and shared panels', () => {
  expect(read('app/layouts/admin.vue')).toContain('background: var(--color-primary-strong)')
  expect(read('app/layouts/admin.vue')).toContain('border-radius: var(--radius-control)')
  expect(read('app/components/admin/DataTable.vue')).toContain('border-radius: var(--radius-panel)')
  expect(read('app/components/admin/RosterImportPanel.vue')).toContain('border-radius: var(--radius-panel)')
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/blue-photo-note-design.test.ts tests/unit/admin/AdminShell.test.ts
```

Expected: the visual contract fails while existing navigation behavior remains green.

- [ ] **Step 3: Restyle the administrator layout and login**

Set the rail to deep navy, active links to primary blue with `var(--radius-control)`, inactive links to transparent navy surfaces, and session controls to a subtle outlined state. Keep the current responsive rail behavior and link structure. Make the administrator login a centered white `var(--radius-panel)` card with a compact `h1`, blue action, and no MFA content.

- [ ] **Step 4: Restyle shared administrator controls**

Use one `var(--radius-panel)` container around each table, filter group, import panel, and inventory editor. Keep table rows flat inside the container, separated by light blue-gray rules. Use `var(--radius-control)` on inputs and buttons, `var(--radius-card)` on dialogs and nested forms, and semantic red only for destructive/error actions.

- [ ] **Step 5: Verify shell and shared controls GREEN**

Run:

```bash
corepack pnpm exec vitest run tests/unit/blue-photo-note-design.test.ts tests/unit/admin/AdminShell.test.ts tests/unit/components/RosterImportPanel.test.ts
```

Expected: all focused tests pass; navigation labels, login behavior, and roster actions are unchanged.

- [ ] **Step 6: Commit the administrator foundation**

```bash
git add app/layouts/admin.vue app/pages/admin/login.vue app/pages/admin/index.vue app/components/admin tests/unit/blue-photo-note-design.test.ts
git commit -m "style: 2026-07-17 관리자 셸과 공통 컨트롤 재디자인"
```

### Task 5: Administrator Feature Pages

**Files:**
- Modify: `app/pages/admin/campaigns.vue`
- Modify: `app/pages/admin/counseling.vue`
- Modify: `app/pages/admin/export.vue`
- Modify: `app/pages/admin/faculty/[id].vue`
- Modify: `app/pages/admin/faculty/index.vue`
- Modify: `app/pages/admin/narrative-reports.vue`
- Modify: `app/pages/admin/resources/[id].vue`
- Modify: `app/pages/admin/resources/index.vue`
- Modify: `app/pages/admin/students/[id].vue`
- Modify: `app/pages/admin/students/index.vue`
- Modify: `app/pages/admin/students/roster.vue`
- Modify: `app/components/admin/CounselingQueue.vue`
- Modify: `app/components/admin/FacultyEditor.vue`
- Modify: `app/components/admin/ResourceEditor.vue`
- Test: existing `tests/unit/pages/Admin*.test.ts` and `tests/unit/components/Admin*.test.ts`

**Interfaces:**
- Consumes: Task 4 shell and administrator primitives.
- Produces: consistent page headers, filter panels, editors, tables, and action groups across all administrator operations.

- [ ] **Step 1: Add a failing page-wide heading contract**

Extend `tests/unit/blue-photo-note-design.test.ts` with this exact test:

```ts
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
```

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/blue-photo-note-design.test.ts
```

Expected: at least one existing administrator page violates the heading or rounded-panel contract.

- [ ] **Step 3: Normalize page headers and action groups**

For every listed page, cap `h1`, set the page header to a compact grid/flex row, keep eyebrow labels blue/mono, and place primary actions in blue rounded controls. Use muted copy rather than extra accent colors.

- [ ] **Step 4: Normalize dense page surfaces**

Use white `var(--radius-panel)` containers for filters, tables, editors, and detail summaries. Use soft blue for selected/expanded/preview sections. Keep destructive actions red with text labels. Preserve every existing `data-*`, label, name, and ARIA hook used by tests.

- [ ] **Step 5: Run all administrator page/component tests**

Run:

```bash
corepack pnpm exec vitest run tests/unit/pages/AdminCampaignsPage.test.ts tests/unit/pages/AdminCounselingPage.test.ts tests/unit/pages/AdminExportPage.test.ts tests/unit/pages/AdminFacultyDetailPage.test.ts tests/unit/pages/AdminFacultyListPage.test.ts tests/unit/pages/AdminNarrativeReports.test.ts tests/unit/pages/AdminResourcesPages.test.ts tests/unit/pages/AdminRosterPage.test.ts tests/unit/pages/AdminStudentDetailPage.test.ts tests/unit/pages/AdminStudentsPage.test.ts tests/unit/components/AdminCampaigns.test.ts tests/unit/components/AdminFacultyEditor.test.ts tests/unit/components/AdminResources.test.ts tests/unit/components/AdminStudents.test.ts tests/unit/components/CounselingQueue.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit administrator feature pages**

```bash
git add app/pages/admin app/components/admin tests/unit/blue-photo-note-design.test.ts
git commit -m "style: 2026-07-17 관리자 기능 화면 블루 라운드 통일"
```

### Task 6: Responsive Visual QA and Release

**Files:**
- Create: `tests/e2e/blue-photo-note-visual.spec.ts`
- Modify only if a verified visual defect exists: files changed in Tasks 1–5
- Generate ignored evidence: `.superpowers/sdd/blue-photo-note-*.png`

**Interfaces:**
- Consumes: all redesigned surfaces.
- Produces: automated 320px/desktop heading, overflow, palette, and radius smoke coverage plus verified production deployment.

- [ ] **Step 1: Write visual smoke coverage before final fixes**

Create `tests/e2e/blue-photo-note-visual.spec.ts` with a public-route matrix and the same session-storage authorization pattern used by `tests/e2e/roster-admin.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

const assertVisualContract = async (page: Page) => {
  const heading = page.locator('h1').first()
  if (await heading.count()) {
    expect(Number.parseFloat(await heading.evaluate(node => getComputedStyle(node).fontSize))).toBeLessThanOrEqual(32)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 248, 255)')
}

for (const path of ['/', '/login', '/admin/login']) {
  test(`${path} keeps the Blue Photo Note contract on desktop and mobile`, async ({ page }) => {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 900 }]) {
      await page.setViewportSize(viewport)
      await page.goto(path)
      await assertVisualContract(page)
    }
  })
}

test('the administrator roster keeps the contract on desktop and mobile', async ({ page }) => {
  await page.route('**/api/admin/admission-cycles', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [], requestId: 'visual-cycles' }),
  }))
  await page.goto('/admin/login')
  await page.evaluate(() => sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
    accessToken: 'visual-session',
    authenticatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    userId: '00000000-0000-4000-8000-000000000001',
  })))
  for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 900 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/admin/students/roster')
    await assertVisualContract(page)
    expect(Number.parseFloat(await page.locator('.roster-page__start').evaluate(node => getComputedStyle(node).borderRadius))).toBeGreaterThanOrEqual(14)
  }
})
```

The public matrix checks the real landing and login surfaces; the intercepted roster test checks the authenticated administrator shell without using production credentials.

- [ ] **Step 2: Run the visual test and capture actual failures**

Run:

```bash
corepack pnpm exec playwright test tests/e2e/blue-photo-note-visual.spec.ts --project=chromium
```

Expected: any remaining local heading override, horizontal overflow, or square primary surface fails with a route-specific assertion.

- [ ] **Step 3: Fix each route-specific defect and rerun**

For a heading failure, remove or lower that route's scoped `h1` rule. For overflow, constrain the reported container with `min-width: 0`, wrapping, or responsive grid columns. For a radius failure, use the appropriate Task 1 token. Do not alter route behavior or data flow. Rerun the same command until it passes.

- [ ] **Step 4: Capture visual evidence**

Capture desktop and mobile screenshots for `/`, `/login`, one assessment state, one populated result fixture, `/admin/login`, `/admin/students`, and `/admin/students/roster`. Review them for blue-only accents, rounded consistency, compact headings, content hierarchy, focus visibility, and 320px overflow.

- [ ] **Step 5: Run the complete verification gate**

Run:

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm exec supabase test db --local
git diff --check
```

Expected: all commands exit 0 with no failing tests or type/lint errors.

- [ ] **Step 6: Commit visual QA**

```bash
git add tests/e2e/blue-photo-note-visual.spec.ts app
git commit -m "test: 2026-07-17 블루 포토 노트 반응형 시각 QA"
```

- [ ] **Step 7: Push and deploy**

Push `feature/photo-next-mvp`, deploy staging, run health and smoke checks, deploy production, and verify the deployed commit, student login, administrator login, landing page, assessment options, result fixture, and administrator student list. Never print secret values in deployment output.

## Execution Decision

The user previously selected **Subagent-Driven Development with review after each task**. Execute Tasks 1–6 with a fresh implementation subagent per task and two-stage review before advancing. The main agent owns skill compliance, final verification, deployment, and user communication.
