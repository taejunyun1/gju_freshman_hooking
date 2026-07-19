# PHOTO:NEXT 프로젝트 연도 우선순위 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a master XLSX with 2026 programmes first and make the live service recommend current programmes before compact historical experience cards.

**Architecture:** Keep the existing `resources` and `resource_tags` tables. Each project receives lightweight JSON metadata (`projectYear`, `displayTier`, `periodLabel`, `statusLabel`, `programGroup`); the server reads it in its existing single resource query, separates current projects from experience projects in memory, and stores both groups in the result snapshot. The Vue result lane renders current 2026 cards prominently and exactly up to three compact experience cards below it.

**Tech Stack:** Nuxt 3/Vue, TypeScript, Zod, Vitest, Supabase PostgreSQL migrations/pgTAP, Cloudflare Workers, Codex bundled spreadsheet runtime

## Global Constraints

- The user-provided input workbook remains unchanged; the master workbook is a new file.
- `사진단오제(남구청)` is absent from the master workbook, seed migration, and every result screen.
- The 2026 current-program pool contains exactly 13 normalized K-컬처리딩센터 programmes.
- The 2025 source rows are `recent`; 2024 and earlier source rows are `experience`.
- Only `resources` and `resource_tags` are used; no new database table, API endpoint, or database read is added.
- Main projects contain only `current` 2026 items, maximum 3; compact experience contains 2025/earlier items, maximum 3.
- Existing result snapshots with an empty project `displayMetadata` remain readable.
- 2026 items are labelled as planned/current by their source evidence and never falsely labelled complete.
- Use the existing blue, rounded visual system; do not increase the global type scale or add new accent colours.
- Run focused tests and one production smoke flow; do not run unrelated exhaustive suites.

---

### Task 1: Canonical project catalog and master workbook

**Files:**
- Create: `scripts/project-catalog.ts`
- Create: `scripts/build-project-master-workbook.mjs`
- Create: `supabase/seed/project-catalog-2026.json`
- Create: `outputs/2026-07-20-project-master/photo-next-project-master_2026-current_2025-recent_legacy.xlsx`
- Test: `tests/unit/project-catalog.test.ts`

**Interfaces:**
- Consumes: the 30 completed input rows from the user workbook and the 13 normalized 2026 rows listed in `docs/superpowers/specs/2026-07-19-project-era-priority-workbook-design.md`.
- Produces: `projectCatalogSchema`, `normalizeProjectCatalog(rows)`, and `projectDisplayTierOf(row)` from `scripts/project-catalog.ts`; a 43-row JSON catalog; and a five-column-extended XLSX master workbook.

- [ ] **Step 1: Write the failing classification and cancellation test**

```ts
import { normalizeProjectCatalog, projectDisplayTierOf } from '../../scripts/project-catalog'

test('classifies 2026, 2025, and legacy projects without retaining cancelled rows', () => {
  const catalog = normalizeProjectCatalog([
    { key: 'current', year: 2026, title: 'AI 생성 동아리', cancelled: false },
    { key: 'recent', year: 2025, title: '드론 운용 동아리', cancelled: false },
    { key: 'legacy', year: 2024, title: '스마트 드론 활용', cancelled: false },
    { key: 'cancelled', year: 2026, title: '사진단오제(남구청)', cancelled: true },
  ])

  expect(catalog.map(row => row.key)).toEqual(['current', 'recent', 'legacy'])
  expect(projectDisplayTierOf(catalog[0]!)).toBe('current')
  expect(projectDisplayTierOf(catalog[1]!)).toBe('experience')
  expect(projectDisplayTierOf(catalog[2]!)).toBe('experience')
})
```

- [ ] **Step 2: Run the focused test and confirm it fails because the catalog module is missing**

Run: `corepack pnpm vitest run tests/unit/project-catalog.test.ts`

Expected: FAIL with a missing module/export error.

- [ ] **Step 3: Implement the canonical catalog and generated workbook**

Create `scripts/project-catalog.ts` with a narrow `ProjectCatalogRow` schema. Convert the 30 user-input rows into canonical records, append exactly these 13 current records, and reject all cancelled records before any output is produced:

```ts
export const projectDisplayTierOf = (row: Pick<ProjectCatalogRow, 'year'>) => (
  row.year === 2026 ? 'current' : 'experience'
)

export const normalizeProjectCatalog = (rows: readonly ProjectCatalogRow[]) => rows
  .filter(row => !row.cancelled)
  .map(row => ({
    ...row,
    displayTier: projectDisplayTierOf(row),
    displayKind: row.year === 2026 ? '메인프로젝트' : row.year === 2025 ? '최근사례' : '짧은경험',
  }))
```

Use the same source to write `supabase/seed/project-catalog-2026.json`. Its 43 rows must have unique keys, one primary track, public-safe summaries, source notes, and `current`/`experience` display tiers.

Build a separate XLSX from the input workbook. Rename its input sheet to `프로젝트_통합`, preserve columns A:U, append `사업연도`, `노출단계`, `사업그룹`, `운영학기`, and `표시분류` in V:Z, add a compact `노출_요약` sheet, and retain `작성_가이드` and `태그_목록`. Do not create an exclusion sheet and do not include any cancelled row.

- [ ] **Step 4: Re-run the focused test and inspect the JSON count**

Run: `corepack pnpm vitest run tests/unit/project-catalog.test.ts && jq 'length' supabase/seed/project-catalog-2026.json`

Expected: PASS and `43`.

- [ ] **Step 5: Render and reload the workbook**

Run the workbook builder with the bundled Node runtime, reload the output through `SpreadsheetFile.importXlsx`, verify `프로젝트_통합` has 43 data rows, and render `프로젝트_통합` plus `노출_요약` to PNG for visual inspection.

- [ ] **Step 6: Commit the catalog and workbook**

```bash
git add scripts/project-catalog.ts scripts/build-project-master-workbook.mjs supabase/seed/project-catalog-2026.json tests/unit/project-catalog.test.ts
git add -f outputs/2026-07-20-project-master/photo-next-project-master_2026-current_2025-recent_legacy.xlsx
git commit -m "feat: 2026-07-20 프로젝트 통합 카탈로그"
```

### Task 2: Project-tier snapshot contract and deterministic selection

**Files:**
- Modify: `shared/types/result.ts`
- Modify: `shared/schemas/result.ts`
- Modify: `server/modules/assessment/completion.ts`
- Modify: `server/modules/matching/resources.ts`
- Test: `tests/unit/matching/resources.test.ts`
- Test: `tests/unit/result/result-schema.test.ts`

**Interfaces:**
- Consumes: resource metadata keys `projectYear`, `displayTier`, `periodLabel`, `statusLabel`, and `programGroup` from Task 1 and the existing `rankResources(input)` interface.
- Produces: `ProjectDisplayMetadata`, `resources.project` with at most six items, where first group is current projects and the second group is compact experience projects.

- [ ] **Step 1: Write failing ranking tests for tier partitioning**

```ts
test('keeps current projects in the main three and appends no more than three experience projects', () => {
  const ranked = rankResources({
    interestVector: { video: 1, documentary: 1 },
    selectedInterests: selected(['video']),
    candidates: projectCandidates([
      ['current-a', 'current', 2026], ['current-b', 'current', 2026], ['current-c', 'current', 2026],
      ['recent-a', 'experience', 2025], ['legacy-a', 'experience', 2024],
    ]),
  })

  expect(ranked.project.map(item => item.displayMetadata.displayTier)).toEqual([
    'current', 'current', 'current', 'experience', 'experience',
  ])
})
```

Add a schema test that accepts legacy `{}` project metadata and a new metadata object, but rejects an invalid `displayTier` or a non-2026 `current` project.

- [ ] **Step 2: Run matching and schema tests to confirm the new expectations fail**

Run: `corepack pnpm vitest run tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts`

Expected: FAIL because project display metadata is empty and project results are capped at three.

- [ ] **Step 3: Implement a backward-compatible project display contract**

Add this metadata shape in `shared/types/result.ts` and its corresponding Zod schema:

```ts
export interface ProjectDisplayMetadata {
  readonly displayTier?: 'current' | 'experience'
  readonly projectYear?: number
  readonly periodLabel?: string
  readonly statusLabel?: string
  readonly programGroup?: string
}
```

`displayMetadata: {}` must remain valid for stored legacy snapshots. New objects must require `projectYear === 2026` when `displayTier === 'current'`.

In `server/modules/assessment/completion.ts`, map camelCase and snake_case project metadata unchanged into `ResourceCandidate`. In `server/modules/matching/resources.ts`, render new project display metadata, split ranked project candidates into `current` and `experience`, apply `selectDiverse(..., 3)` independently to each group, and concatenate current then experience. Keep extracurricular resources out of this project-only split.

- [ ] **Step 4: Re-run focused matching and result-schema tests**

Run: `corepack pnpm vitest run tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the snapshot contract and selection**

```bash
git add shared/types/result.ts shared/schemas/result.ts server/modules/assessment/completion.ts server/modules/matching/resources.ts tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts
git commit -m "feat: 2026-07-20 프로젝트 우선 추천"
```

### Task 3: Two-level project lane in the result screen

**Files:**
- Modify: `app/components/result/LearningPath.vue`
- Modify: `app/components/result/ResourceCard.vue`
- Create: `tests/unit/components/LearningPath.test.ts`
- Test: `tests/unit/pages/ResultPage.test.ts`

**Interfaces:**
- Consumes: the ordered `snapshot.resources.project` list from Task 2.
- Produces: a main `2026 진행·예정 프로그램` area with up to three project cards and a compact `학과가 축적한 경험` area with up to three smaller cards.

- [ ] **Step 1: Write a failing component test for the two project headings**

```ts
it('renders current programmes separately from compact experience cards', () => {
  const wrapper = mount(LearningPath, {
    props: { years, projects: [currentProject, experienceProject], extracurricular: [] },
  })

  expect(wrapper.get('[data-current-projects]').text()).toContain('2026 진행·예정 프로그램')
  expect(wrapper.get('[data-project-experience]').text()).toContain('학과가 축적한 경험')
  expect(wrapper.findAll('[data-project-experience] .resource-card')).toHaveLength(1)
})
```

- [ ] **Step 2: Run the component test and confirm it fails because the tiered regions do not exist**

Run: `corepack pnpm vitest run tests/unit/components/LearningPath.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/pages/ResultPage.test.ts`

Expected: FAIL with missing tiered project regions.

- [ ] **Step 3: Implement the tiered project layout**

In `LearningPath.vue`, compute `currentProjects` where `displayMetadata.displayTier === 'current'`; all remaining project resources become `experienceProjects`. Keep the current card grid for the first group, change its heading to `2026 진행·예정 프로그램`, and render the second group below it using a compact single-column list with heading `학과가 축적한 경험` and a short explanation that these are prior completed examples.

In `ResourceCard.vue`, show `periodLabel` and `statusLabel` only when the project metadata supplies them. Keep the existing blue palette, rounded border, and current maximum heading size. The experience block uses reduced padding and no additional accent colour.

- [ ] **Step 4: Re-run the two component/page test files**

Run: `corepack pnpm vitest run tests/unit/components/LearningPath.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/pages/ResultPage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the result screen**

```bash
git add app/components/result/LearningPath.vue app/components/result/ResourceCard.vue tests/unit/components/LearningPath.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/pages/ResultPage.test.ts
git commit -m "feat: 2026-07-20 프로젝트 경험 레인"
```

### Task 4: Safe project seed migration and database proof

**Files:**
- Create: `supabase/migrations/202607200027_project_catalog_era_priority.sql`
- Create: `supabase/tests/project_catalog_era_priority.test.sql`
- Modify: `shared/schemas/admin-resources.ts`
- Test: `tests/integration/admin/resources.test.ts`

**Interfaces:**
- Consumes: the 43-row canonical JSON catalog from Task 1.
- Produces: 43 active, public project resources with complete tier metadata and tags; direct service reads need no new query.

- [ ] **Step 1: Write the failing database test**

```sql
select is(
  (select count(*)::integer from public.resources where metadata ->> 'catalogKey' like 'photo_next_20%'),
  43,
  'all current, recent, and experience catalog projects are seeded'
);
select is(
  (select count(*)::integer from public.resources where metadata ->> 'catalogKey' = 'photo_next_2026_sajik_danoje'),
  0,
  'cancelled Sajik Danoje is absent'
);
select is(
  (select count(*)::integer from public.resources where metadata ->> 'displayTier' = 'current' and metadata ->> 'projectYear' = '2026'),
  13,
  'current 2026 programmes are distinct from experience data'
);
```

- [ ] **Step 2: Run the database test after local reset and confirm it fails because the migration is absent**

Run: `corepack pnpm exec supabase db reset --local && corepack pnpm exec supabase test db --local supabase/tests/project_catalog_era_priority.test.sql`

Expected: FAIL with missing catalog resources.

- [ ] **Step 3: Add the idempotent data migration and metadata validation**

Generate the migration from `project-catalog-2026.json`. It must update matching `metadata.seedKey` records first, insert only missing rows, replace their tags transactionally, and set `type = 'project'`, `status = 'active'`, and `visibility = 'public'`.

Every metadata object contains:

```json
{
  "seedKey": "project:photo_next_2026_ai_generation_club",
  "catalogKey": "photo_next_2026_ai_generation_club",
  "projectYear": 2026,
  "displayTier": "current",
  "periodLabel": "2026년 2학기",
  "statusLabel": "2026 운영 예정",
  "programGroup": "K-컬처리딩센터"
}
```

For 2025 and earlier, use `displayTier: "experience"` and a truthful status label such as `2025년 완료 사례` or `이전 운영 경험`.

Extend `archiveActivityAdminResourceMetadataSchema` only with optional project display keys so an administrator can read and update these catalog resources without stripping the keys. Do not require a URL that was not supplied by the user.

- [ ] **Step 4: Re-run the focused database and admin integration tests**

Run: `corepack pnpm exec supabase db reset --local && corepack pnpm exec supabase test db --local supabase/tests/project_catalog_era_priority.test.sql && corepack pnpm vitest run tests/integration/admin/resources.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the migration and database tests**

```bash
git add supabase/migrations/202607200027_project_catalog_era_priority.sql supabase/tests/project_catalog_era_priority.test.sql shared/schemas/admin-resources.ts tests/integration/admin/resources.test.ts
git commit -m "feat: 2026-07-20 프로젝트 카탈로그 반영"
```

### Task 5: Focused verification and production deployment

**Files:**
- Modify: `docs/superpowers/specs/2026-07-19-project-era-priority-workbook-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-project-era-priority-delivery.md`

**Interfaces:**
- Consumes: Tasks 1–4 commits and existing Cloudflare deployment scripts.
- Produces: local evidence, pushed migration, deployed Worker, and a real result page that contains both project tiers.

- [ ] **Step 1: Verify the focused project change set**

Run:

```bash
corepack pnpm vitest run tests/unit/project-catalog.test.ts tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts tests/unit/components/LearningPath.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/pages/ResultPage.test.ts tests/integration/admin/resources.test.ts
corepack pnpm exec supabase test db --local supabase/tests/project_catalog_era_priority.test.sql
corepack pnpm build
```

Expected: all targeted tests pass and the build completes.

- [ ] **Step 2: Push only the new database migration and deploy the existing Worker**

Run the repository’s established deployment flow so secrets remain in the Worker environment. Confirm the remote database migration is applied before deploying the Worker artifact.

- [ ] **Step 3: Smoke test a real assessment result**

Use a preloaded test student or a non-production-safe test path to complete one assessment with `video` interest. Confirm the published page contains `2026 진행·예정 프로그램`, `학과가 축적한 경험`, one 2026 current project, and no `사진단오제` text.

- [ ] **Step 4: Commit final documentation and publish the branch**

```bash
git add docs/superpowers/specs/2026-07-19-project-era-priority-workbook-design.md docs/superpowers/plans/2026-07-20-project-era-priority-delivery.md
git commit -m "docs: 2026-07-20 프로젝트 반영 검증 기록"
git push origin feature/photo-next-mvp
```
