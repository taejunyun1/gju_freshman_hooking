# Supporting Instructors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four supplied time instructors as evidence-matched supporting faculty without changing full-time counseling recommendations.

**Architecture:** Keep the established `practitioner` + `specialist` data path; the public `title` is `시간강사`, while only `full_time` + `primary` records remain eligible for primary/backup selection. Regenerate the checked-in SQL seed from the canonical JSON and render the existing specialist cards with a compact presentation variant.

**Tech Stack:** Nuxt 4, Vue 3 scoped CSS, TypeScript, Vitest, existing JSON-to-SQL content seed generator, Supabase PostgreSQL seed.

## Global Constraints

- The primary and backup recommendation must remain active `full_time` + `primary` faculty only.
- The four supplied instructors use `employmentType: "practitioner"`, `consultationRole: "specialist"`, public title `시간강사`, and `weeklyCapacity: 0`.
- Do not invent contact details; only supplied public artist/studio websites may be published.
- Keep result specialist output capped at two; it is a supporting connection, not a staff directory.
- Preserve the blue rounded PHOTO:NEXT design; compact cards must retain readable name, role, expertise, and connection reason.
- Never hand-edit `supabase/seed/content-2026.sql`; regenerate it with `corepack pnpm tsx scripts/seed-content.ts`.

---

### Task 1: Seed the time instructors and their evidence-matched specialist links

**Files:**
- Modify: `supabase/seed/faculty-2026.json`
- Regenerate: `supabase/seed/content-2026.sql`
- Modify: `tests/unit/content/content-seed.test.ts`
- Modify: `tests/unit/matching/faculty-balance.test.ts`
- Modify: `supabase/tests/content_seed.test.sql`

**Interfaces:**
- Consumes: `FacultySeed` parsed by `scripts/seed-content.ts`; `FacultySpecialistLink` in `server/modules/matching/faculty.ts`.
- Produces: Four active seedable `practitioner` specialists and tag links that `recommendFaculty()` can rank only after a full-time primary is selected.

- [ ] **Step 1: Write failing content/matching expectations**

```ts
expect(faculty.filter(person => person.title === '시간강사').map(person => person.name))
  .toEqual(['정한결', '유별남', '김태현', '김명우'])

expect(result.primary.title).toBe('교수')
expect(result.backup.title).toBe('교수')
expect(result.specialists.map(person => person.name)).toContain('정한결')
```

Add equivalent focused recommendations for `유별남` on documentary evidence, `김태현` on documentary/video/art-photo evidence, and `김명우` on AI/media-art evidence. Assert that none appears in `primary` or `backup`.

In `supabase/tests/content_seed.test.sql`, update the exact faculty/structured-profile/tag/link totals produced by the generator and add a direct count for four `practitioner` + `specialist` rows with title `시간강사`.

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `corepack pnpm exec vitest run --project unit tests/unit/content/content-seed.test.ts tests/unit/matching/faculty-balance.test.ts`

Expected: FAIL because the four records and their links do not yet exist.

- [ ] **Step 3: Add canonical source records and specialist links**

Append four `faculty` objects to `supabase/seed/faculty-2026.json` with this shape:

```json
{
  "name": "정한결",
  "title": "시간강사",
  "employmentType": "practitioner",
  "consultationRole": "specialist",
  "recommendationRole": "윤태준 교수 총괄 아래 예술사진·AI 기반 창작 연계",
  "office": null,
  "phone": null,
  "email": null,
  "website": null,
  "contactVisibility": {"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"},
  "expertiseSummary": "예술사진·AI·기술적 이미지·미디어아트",
  "status": "draft",
  "weeklyCapacity": 0,
  "priority": 0,
  "sourceDate": "2026-07-20",
  "lastVerifiedAt": null
}
```

Use supplied factual profile/education/career text. Add tag links: 정한결→윤태준 (`art_photo`, `ai`, `media_art`, `installation`), 유별남→조대연·김사라 (`documentary`, `record`, `photo_story`), 김태현→조대연·김사라·윤태준 (`documentary`, `video`, `art_photo`), 김명우→윤태준 (`ai`, `video`, `media_art`, `installation`). Use the existing explanation-template pattern, stating the full-time faculty leads the overall path and the time instructor supports relevant practice.

- [ ] **Step 4: Regenerate the SQL seed**

Run: `corepack pnpm tsx scripts/seed-content.ts`

Expected: `supabase/seed/content-2026.sql` changes only through the generator and its content revision hash updates.

- [ ] **Step 5: Run focused tests to verify green**

Run: `corepack pnpm exec vitest run --project unit tests/unit/content/content-seed.test.ts tests/unit/matching/faculty-balance.test.ts`

Expected: PASS, including the exact four time-instructor identities and full-time primary/backup invariant.

- [ ] **Step 6: Commit the data task**

```bash
git add supabase/seed/faculty-2026.json supabase/seed/content-2026.sql \
  tests/unit/content/content-seed.test.ts tests/unit/matching/faculty-balance.test.ts
git commit -m "feat: 2026-07-20 시간강사 전문 연계"
```

### Task 2: Render compact supporting-instructor cards in result faculty section

**Files:**
- Modify: `app/components/result/FacultyCard.vue`
- Modify: `app/components/result/FacultyRecommendation.vue`
- Create: `tests/unit/components/FacultyRecommendation.test.ts`
- Modify: `tests/e2e/results.spec.ts`

**Interfaces:**
- Consumes: unchanged `ResultFaculty`, where `specialists` are `FacultyResult<'specialist'>[]`.
- Produces: `FacultyCard` prop `compact?: boolean`; `FacultyRecommendation` passes `compact` only to specialist cards.

- [ ] **Step 1: Write failing presentation tests**

```ts
expect(wrapper.get('[data-faculty-role]').text()).toBe('함께 연결되는 실무·창작 강사')
expect(wrapper.get('[data-faculty-person="4"]').classes()).toContain('faculty-card--compact')
expect(wrapper.get('[data-faculty-person="1"]').classes()).not.toContain('faculty-card--compact')
```

In the E2E result fixture, assert the specialist section heading and the compact class for `곽동욱 겸임교수`; retain the existing main-card assertions.

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `corepack pnpm exec vitest run --project unit tests/unit/components/FacultyRecommendation.test.ts && corepack pnpm exec playwright test tests/e2e/results.spec.ts --grep "commercial"`

Expected: FAIL because the compact prop, new label, and CSS modifier do not yet exist.

- [ ] **Step 3: Implement the compact card variant**

In `FacultyCard.vue`, add `compact?: boolean` with a false default and bind `faculty-card--compact`. In the scoped CSS reduce compact heading to `1rem`, expertise to `0.8125rem`, reason to `0.75rem`, and padding to `0.8rem`; do not hide content or change keyboard-focus/contact behavior.

In `FacultyRecommendation.vue`, change the specialist group heading to `함께 연결되는 실무·창작 강사` and render `:compact="true"` only in its `v-for` card. Keep the group and `ResultExampleGrid` behavior unchanged if no specialist is returned.

- [ ] **Step 4: Run focused tests to verify green**

Run: `corepack pnpm exec vitest run --project unit tests/unit/components/FacultyRecommendation.test.ts && corepack pnpm exec playwright test tests/e2e/results.spec.ts --grep "commercial"`

Expected: PASS with no layout overflow at the existing 1440px/390px checks.

- [ ] **Step 5: Commit the presentation task**

```bash
git add app/components/result/FacultyCard.vue app/components/result/FacultyRecommendation.vue \
  tests/unit/components/FacultyRecommendation.test.ts tests/e2e/results.spec.ts
git commit -m "feat: 2026-07-20 강사 연계 카드 표시"
```

### Task 3: Verify, publish seed data, and release without key rotation

**Files:**
- Verify: `supabase/seed/content-2026.sql`
- Verify: `scripts/deploy-photo-next-release.mjs`

**Interfaces:**
- Consumes: generated seed update and compiled Nuxt application.
- Produces: remote content update and staging/production Worker release while retaining existing Worker secrets and accounts.

- [ ] **Step 1: Run local verification**

Run:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec supabase db reset --local
corepack pnpm exec supabase test db --local supabase/tests/content_seed.test.sql
corepack pnpm test
```

Expected: all commands exit zero; the content seed includes the four `시간강사` records.

- [ ] **Step 2: Inspect the final diff and obtain a focused review**

Run: `git diff --check && git diff --stat HEAD~2..HEAD`

Expected: no whitespace errors and no change to full-time faculty role semantics.

- [ ] **Step 3: Push and apply the generated seed remotely**

Run:

```bash
git push origin feature/photo-next-mvp
corepack pnpm exec supabase db push --linked --include-all --include-seed --yes --agent no
```

Expected: the new `content-2026.sql` hash applies without a schema migration and does not modify student or counseling rows.

- [ ] **Step 4: Use the additive release runner**

Run: `node scripts/deploy-photo-next-release.mjs`

Expected: staging then production smoke tests pass. Do not run the first-install `deploy-photo-next-remote.mjs`, which rotates identity secrets.

- [ ] **Step 5: Verify production and report**

Run: `curl --fail --silent "https://photo-next-mvp.taejunyun.workers.dev/api/health?release=$(git rev-parse --short HEAD)"`

Expected: `ok: true` and the current commit. Report the public and admin URLs; do not print or rotate administrator credentials.
