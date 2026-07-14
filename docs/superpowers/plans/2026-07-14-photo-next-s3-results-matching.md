# PHOTO:NEXT S3 Results and Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평가 응답을 실제 2026 커리큘럼과 교수진에 매칭해 연결 근거 타임라인을 생성하고 학생별 최근 결과 3개를 안전하게 제공한다.

**Architecture:** 순수 MatchingModule이 자원·교수 태그 점수와 다양성 규칙을 계산하고, `complete_assessment` PostgreSQL RPC가 응답·가중치·결과 스냅샷·최근 3개 회전을 원자적으로 저장한다. 결과 UI는 스냅샷만 읽어 과거 결과가 운영 데이터 변경으로 달라지지 않게 한다.

**Tech Stack:** Nuxt 4, Vue 3, Supabase PostgreSQL/RPC/Storage, Zod, Vitest, pgTAP, Playwright

## Global Constraints

- 교과 결과는 최대 5, 장비·시설 4, 비교과·프로젝트 3, 작품 3, 진로 4다.
- 자원은 `active|next_year_confirmed`와 학생 공개 가능 상태만 후보가 된다.
- 정렬은 적합도, 관리자 우선순위, source_date, ID 순이고 동일 주 태그는 범주당 최대 2개다.
- 교육환경 점수는 교과 35%, 장비·시설 20%, 비교과·프로젝트 15%, 교수 15%, 진로·포트폴리오 15%다.
- 교수 추천은 전임 총괄 1명, 전임 예비 1명, 전문 연계 0–2명이며 실제 배정이 아니다.
- 결과 공개 ID는 UUID이고 서버가 학생 소유권을 검증한다.
- 결과 화면은 점수보다 선택 관심사와 연결 근거를 먼저 보여준다.
- 네 번째 완료 결과는 가장 오래된 상세만 삭제하고 익명 이벤트는 유지한다.

---

### Task 1: Assessment, resource, and faculty database

**Files:**
- Create: `supabase/migrations/202607140004_results_matching.sql`
- Create: `supabase/tests/results_matching_schema.test.sql`
- Create: `shared/types/result.ts`
- Create: `shared/schemas/result.ts`

**Interfaces:**
- Produces: `assessments`, `assessment_responses`, `resources`, `resource_tags`, `faculty`, `faculty_tags`, `faculty_specialist_links`; RPC `complete_assessment(jsonb)`
- Consumes: prospects, options, events from S1–S2

- [ ] **Step 1: Write failing schema and RLS tests**

```sql
begin;
select plan(5);
select has_table('public','assessments');
select has_table('public','resources');
select has_table('public','faculty');
select col_is_unique('public','assessments',array['public_id']);
select policies_are('public','assessments',array[]::text[],'browser roles have no policy');
select * from finish();
rollback;
```

- [ ] **Step 2: Run and verify missing schema**

Run: `supabase test db`

Expected: FAIL because S3 tables do not exist.

- [ ] **Step 3: Create constrained tables and indexes**

```sql
create table public.assessments (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  prospect_id bigint not null references public.prospects(id) on delete cascade,
  campaign_id bigint,
  idempotency_key uuid not null,
  status text not null check (status in ('completed')),
  track_scores jsonb not null,
  environment_score numeric(5,2) not null check (environment_score between 0 and 100),
  result_snapshot jsonb not null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (prospect_id, idempotency_key)
);
create index assessments_recent_idx on public.assessments(prospect_id, completed_at desc) where status = 'completed';
```

Create response snapshots with question group, option key/label, weight snapshot, nullable `free_text`, and timestamp; a check permits free text only for `career.explore` and limits it to 30 characters. Create all resource types and statuses, 0–3 tag checks, faculty employment/consultation roles, contact visibility JSON, normalized faculty tags, and specialist links. `faculty_specialist_links.primary_faculty_id` is nullable; null means the specialist may accompany any active full-time primary consultant. Enforce link uniqueness with `unique nulls not distinct (primary_faculty_id,specialist_faculty_id,tag_key)`. Enable default-deny RLS on every table and index every FK and lookup listed in the design spec.

- [ ] **Step 4: Define result snapshot contract**

```ts
export type ResultSnapshot = {
  completedAt: string
  selectedInterests: Array<{ group: QuestionGroup; key: string; label: string }>
  trackScores: Record<TrackKey, number>
  rankedTracks: TrackKey[]
  environmentScore: number
  learningPath: Array<{ gradeYear: 1 | 2 | 3 | 4; resources: ResultResource[] }>
  resources: Record<ResourceType, ResultResource[]>
  faculty: { primary: FacultyResult; backup: FacultyResult; specialists: FacultyResult[] }
}
```

`ResultResource` contains ID, type, title, summary, source date, affinity, primary tag, and a fully rendered connection reason. `FacultyResult` contains the displayed role, ID, name, title, expertise, reason, and public contact fields only.

- [ ] **Step 5: Reset and verify schema**

Run: `supabase db reset && supabase test db`

Expected: all S1–S3 migrations apply and schema assertions pass.

- [ ] **Step 6: Commit matching schema**

```bash
git add supabase/migrations/202607140004_results_matching.sql supabase/tests/results_matching_schema.test.sql shared/types/result.ts shared/schemas/result.ts
git commit -m "feat: add result matching schema"
```

### Task 2: Verified curriculum and faculty seed

**Files:**
- Create: `supabase/seed/curriculum-2026.json`
- Create: `supabase/seed/faculty-2026.json`
- Create: `scripts/seed-content.ts`
- Create: `tests/unit/content/content-seed.test.ts`

**Interfaces:**
- Produces: 41 draft course resources; 6 draft faculty profiles; normalized faculty tags and specialist links
- Consumes: `resource/curri-data.pdf` as internal source and `docs/content/faculty-directory-guide.md` as committed source

- [ ] **Step 1: Write failing source-count and identity tests**

```ts
expect(curriculum).toHaveLength(41)
expect(new Set(curriculum.map(course => course.title)).size).toBe(41)
expect(faculty.map(person => person.name)).toEqual(['조대연','윤태준','김사라','박재웅','정철호','곽동욱'])
expect(faculty.filter(person => person.employmentType === 'full_time')).toHaveLength(3)
expect(faculty.filter(person => person.consultationRole === 'specialist')).toHaveLength(3)
```

Assert every course has academic year 2026, grade year, term, credits, course goal, source date, and at least one tag. Assert every faculty profile contains the guide’s expertise summary, profile, education, careers, teaching fields, projects, tags, status `draft`, and contact visibility `admin_only`.

- [ ] **Step 2: Run and verify missing seed files**

Run: `pnpm vitest run tests/unit/content/content-seed.test.ts`

Expected: FAIL because the seed JSON files do not exist.

- [ ] **Step 3: Transcribe the complete 2026 curriculum**

The 41 titles must contain exactly these ordered groups:

```text
1학년: 흑백사진과 암실, 사진영상학개론, 기초사진실기, 영상 에세이 메이킹,
       영상 프레임과 컷, 라이팅과 스튜디오, 이미지와사회, 디지털 포토 에디팅, AI와 이미지 메이킹
2학년: 디지털 이미지 제작과 프린트, 사진사, 영상드론기초, 내러티브 영상촬영, 응용 디지털 촬영,
       사진커뮤니케이션, 영상 컬러와 포스트 프로덕션, 리서치와 레퍼런스 이미지 제작,
       비주얼 스토리 메이킹, 다큐멘터리 메이킹&쇼케이스, 사진교과교육론
3학년: 사진교수학습방법, 커머셜 포토그라피 기초 워크숍, 포토 스토리 워크숍,
       영상 인터뷰 내러티브 워크숍, 사물,데이터,이미지 워크숍, 커머셜 포토그라피 심화 워크숍,
       포토에세이 워크숍, 영상 드론 콘텐츠 워크숍, 사진과 장소 그리고 콘텍스트 워크숍,
       캡스톤 디자인1, 영상 콘텐츠 크리에이터 워크숍
4학년: 현장실습1, 현장실습2, 커머셜 포토그라피 세미나, 예술창작 프로젝트 세미나,
       다큐멘터리 세미나, 캡스톤 디자인 2, 현장실습 4, 커머셜 포토그라피 랩,
       예술창작 프로젝트 랩, 포스트 다큐멘터리 랩
```

Preserve original goal text in `metadata.source_goal` and store a proofread student-facing summary separately. Map the five interest-path groups from the design spec to tags. Keep every course `draft` until admin review.

- [ ] **Step 4: Transcribe the six faculty profiles and links**

Copy every structured field from `docs/content/faculty-directory-guide.md`. Generate weights by its locked rules: platform tags 3, teaching-only activity tags 2, project result tags 2, career tags 3, adjunct specialist tags 3. Create 윤태준–박재웅 links for video/drone/VR/360, 윤태준–정철호 links for exhibition/curating/art theory, and null-primary–곽동욱 links for commercial/fashion/product/beauty/brand/studio/lighting. All contact fields start `admin_only`.

- [ ] **Step 5: Validate, seed, and verify counts**

Run:

```bash
pnpm vitest run tests/unit/content/content-seed.test.ts
pnpm tsx scripts/seed-content.ts
```

Expected: PASS; script prints `courses=41 faculty=6` and no validation errors.

- [ ] **Step 6: Commit verified content seed**

```bash
git add supabase/seed/curriculum-2026.json supabase/seed/faculty-2026.json scripts/seed-content.ts tests/unit/content/content-seed.test.ts
git commit -m "feat: seed curriculum and faculty content"
```

### Task 3: Resource matching and learning path

**Files:**
- Create: `server/modules/matching/resources.ts`
- Create: `server/modules/matching/learning-path.ts`
- Create: `server/modules/matching/reasons.ts`
- Create: `tests/unit/matching/resources.test.ts`
- Create: `tests/unit/matching/learning-path.test.ts`

**Interfaces:**
- Produces: `rankResources(input): RankedResources`; `buildLearningPath(courses): LearningPath`; `computeEnvironmentScore`; `renderConnectionReason`
- Consumes: S2 `interestVector`, active resources and tags

- [ ] **Step 1: Write failing ranking and diversity tests**

```ts
it('orders by affinity, priority, source date, then id', () => {
  expect(rankResources(input).course.map(item => item.id)).toEqual([7, 3, 9])
})
it('allows no more than two resources with one primary tag', () => {
  expect(rankResources(repeatedDocumentary).course.filter(x => x.primaryTag === 'documentary')).toHaveLength(2)
})
it('returns fewer than the cap instead of unrelated filler', () => {
  expect(rankResources(oneRelevantCourse).course).toHaveLength(1)
})
it('keeps support programs out of the environment score', () => {
  expect(computeEnvironmentScore({ course: 80, equipmentFacility: 70, extracurricularProject: 60, faculty: 90, careerPortfolio: 50, support: 100 })).toBe(72.0)
})
```

- [ ] **Step 2: Run and verify missing matching module**

Run: `pnpm vitest run tests/unit/matching/resources.test.ts tests/unit/matching/learning-path.test.ts`

Expected: FAIL because matching exports do not exist.

- [ ] **Step 3: Implement resource affinity and category scores**

```ts
const affinity = (student: Record<string, number>, tags: ResourceTag[]) => {
  const denominator = tags.reduce((sum, tag) => sum + tag.weight, 0)
  return denominator === 0 ? 0 : tags.reduce((sum, tag) => sum + (student[tag.key] ?? 0) * tag.weight, 0) / denominator * 100
}
```

Filter inactive/private rows first. Sort with the locked four keys, apply category caps and primary-tag diversity, then compute each category fit as the weighted average of displayed affinity. Compute environment score as `course*.35 + equipmentFacility*.20 + extracurricularProject*.15 + faculty*.15 + careerPortfolio*.15`; a missing verified category is 0 and support is never included. Build grade-year buckets 1–4 from selected courses. A missing year remains an explicit empty state; do not move a course to a false year.

- [ ] **Step 4: Implement evidence sentences**

`renderConnectionReason` receives selected labels, resource title, matched tags, and course goal. Output one Korean sentence with this structure: “선택한 ‘{interest}’ 관심이 {goalSummary} ‘{title}’과 연결됩니다.” Reject templates that omit either the selected interest or resource title.

- [ ] **Step 5: Verify and commit matching**

Run: `pnpm vitest run tests/unit/matching`

Expected: deterministic ordering, caps, diversity, four-year path, and sentence tests pass.

```bash
git add server/modules/matching tests/unit/matching
git commit -m "feat: match interests to department resources"
```

### Task 4: Full-time primary and specialist faculty recommendation

**Files:**
- Create: `server/modules/matching/faculty.ts`
- Create: `tests/unit/matching/faculty.test.ts`

**Interfaces:**
- Produces: `recommendFaculty(input): { primary; backup; specialists; facultyFit }`
- Consumes: faculty guide seed, track scores, activity/result/career tags, open assignment counts

- [ ] **Step 1: Write failing role-specific scenarios**

```ts
it('maps social photo-story documentary to 조대연 with 김사라 backup', () => {
  expect(recommendFaculty(socialStoryStudent).primary.name).toBe('조대연')
})
it('maps archive and field research documentary to 김사라', () => {
  expect(recommendFaculty(archiveStudent).primary.name).toBe('김사라')
})
it('maps video art plus drone to 윤태준 and 박재웅', () => {
  const result = recommendFaculty(videoDroneStudent)
  expect(result.primary.name).toBe('윤태준')
  expect(result.specialists.map(x => x.name)).toContain('박재웅')
})
it('always links 곽동욱 for high commercial-fashion interest', () => {
  expect(recommendFaculty(fashionStudent).specialists[0].name).toBe('곽동욱')
})
it('fails closed when fewer than two full-time consultants are available', () => {
  expect(() => recommendFaculty(oneAvailablePrimary)).toThrowError('FACULTY_CONTENT_NOT_READY')
})
```

- [ ] **Step 2: Run and verify missing recommender**

Run: `pnpm vitest run tests/unit/matching/faculty.test.ts`

Expected: FAIL because `recommendFaculty` does not exist.

- [ ] **Step 3: Implement primary and specialist formulas**

```ts
const primaryScore = track * .40 + activity * .25 + result * .15 + career * .15 + load * .05
const specialistScore = specialistTags * .50 + projects * .30 + careers * .20
```

Only active `full_time/primary` faculty with capacity above zero enter primary and backup. Fewer than two candidates returns `FACULTY_CONTENT_NOT_READY` instead of fabricating a backup. Only active `adjunct|practitioner/specialist` faculty linked to the chosen primary or a null-primary rule enter specialist ranking. Keep specialists scoring at least 50 and cap at two. Tie-break primary by open assignment count, priority, ID; specialist by priority, ID. Return Korean reason snapshots naming selected interest tags. Compute `facultyFit = min(100, (track*.40 + activity*.25 + result*.15 + career*.15) / .95)` before load adjustment and feed it to the environment score.

- [ ] **Step 4: Verify all faculty-guide scenarios and commit**

Run: `pnpm vitest run tests/unit/matching/faculty.test.ts`

Expected: all four named scenarios, capacity-zero exclusion, tie, threshold, and two-specialist cap pass.

```bash
git add server/modules/matching/faculty.ts tests/unit/matching/faculty.test.ts
git commit -m "feat: recommend primary and specialist faculty"
```

### Task 5: Atomic assessment completion and ownership APIs

**Files:**
- Modify: `supabase/migrations/202607140004_results_matching.sql`
- Create: `supabase/tests/complete_assessment.test.sql`
- Create: `server/modules/assessment/completion.ts`
- Create: `server/api/assessment/submit.post.ts`
- Create: `server/api/assessment/history.get.ts`
- Create: `server/api/result/[publicId].get.ts`
- Modify: `server/modules/metrics/events.ts`
- Modify: `app/pages/assessment.vue`
- Modify: `app/stores/assessment.ts`
- Create: `tests/integration/result/completion.test.ts`
- Create: `tests/integration/result/ownership.test.ts`

**Interfaces:**
- Produces: idempotent submit returning `{ publicId }`; owned result/history APIs
- Consumes: S2 selections and S3 resource/faculty matching

- [ ] **Step 1: Write failing idempotency, rotation, and ownership tests**

```ts
expect((await Promise.all([submit(key), submit(key)])).map(x => x.publicId).every(id => id === firstId)).toBe(true)
for (let i = 0; i < 4; i++) await submit(randomKey())
expect(await completedAssessmentCount(prospectId)).toBe(3)
expect((await getResultAs(otherStudent, publicId)).status).toBe(404)
```

- [ ] **Step 2: Run and verify incomplete RPC/API**

Run: `pnpm vitest run tests/integration/result`

Expected: FAIL because completion and result routes do not exist.

- [ ] **Step 3: Implement short completion transaction**

Server validates and scores selections, loads candidates, computes resource/faculty recommendations, and passes the complete snapshot plus response snapshots to `complete_assessment`. The RPC locks the prospect, returns an existing `(prospect_id,idempotency_key)` result, inserts assessment/responses, deletes rows older than the newest three, updates `last_active_at`, and returns public ID. Use the fixed lock order prospect → assessment → responses and `search_path = ''`.

The RPC returns `created` with the public ID. Record `assessment_completed` only when `created = true`; retries do not increment metrics. Owned result GET records `result_viewed` with assessment ID, campaign ID, and top track but no selected free text.

Replace the S2 validation-only final action with `POST /api/assessment/submit`, reuse one UUID idempotency key across network retries, route successful completion to `/result/{publicId}`, then clear `photo_next_assessment_v1`. A failed request keeps selections and key so retry cannot create another assessment.

- [ ] **Step 4: Implement private result and cursor history**

Result handler requires student session and filters by both `public_id` and `prospect_id`; missing or foreign rows both return `RESULT_NOT_FOUND` with HTTP 404. History returns newest first with a maximum of three and no raw weights or phone data.

- [ ] **Step 5: Verify SQL and integration behavior**

Run: `supabase test db && pnpm vitest run tests/integration/result`

Expected: same idempotency key returns one ID, four submissions retain three, foreign result is indistinguishable from missing.

- [ ] **Step 6: Commit completion flow**

```bash
git add supabase/migrations/202607140004_results_matching.sql supabase/tests/complete_assessment.test.sql server/modules/assessment/completion.ts server/modules/metrics/events.ts server/api/assessment server/api/result app/pages/assessment.vue app/stores/assessment.ts tests/integration/result
git commit -m "feat: complete and retain assessment results"
```

### Task 6: Edit Timeline result and history UI

**Files:**
- Create: `app/components/result/InterestClip.vue`
- Create: `app/components/result/TimelineLane.vue`
- Create: `app/components/result/LearningPath.vue`
- Create: `app/components/result/ConnectionReason.vue`
- Create: `app/components/result/ResourceCard.vue`
- Create: `app/components/result/TrackScore.vue`
- Create: `app/components/result/FacultyRecommendation.vue`
- Create: `app/pages/result/[publicId].vue`
- Create: `app/pages/history.vue`
- Modify: `server/api/events.post.ts`
- Create: `tests/unit/components/ResultTimeline.test.ts`

**Interfaces:**
- Produces: mobile vertical and desktop horizontal evidence timeline
- Consumes: immutable `ResultSnapshot`

- [ ] **Step 1: Write failing content-order and role-label tests**

```ts
expect(wrapper.findAll('[data-result-section]').map(x => x.attributes('data-result-section'))).toEqual([
  'summary','interests','timeline','evidence','scores','outcomes','faculty','counseling',
])
expect(wrapper.text()).toContain('추천 총괄교수')
expect(wrapper.text()).toContain('함께 연결되는 전문분야')
expect(wrapper.text()).not.toContain('배정 완료')
```

- [ ] **Step 2: Run and verify missing timeline components**

Run: `pnpm vitest run tests/unit/components/ResultTimeline.test.ts`

Expected: FAIL because result components do not exist.

- [ ] **Step 3: Implement the evidence-first responsive result**

Render interest clips, V1 curriculum with four grade-year groups, V2 equipment/facilities, V3 extracurricular/projects, and OUT works/careers. Mobile uses vertical lanes; 1024px and above uses horizontal lanes. Each resource displays its reason and source date. Empty categories say “확인된 학과 데이터를 준비 중입니다” without inventing recommendations.

Animate one playhead and reveal for no more than 500ms; card transitions are 160ms. Under `prefers-reduced-motion: reduce`, render the final state immediately. Faculty cards use “추천 총괄교수”, “예비 상담교수”, and “함께 연결되는 전문분야”. Public contacts render only when the snapshot field is public.

Resource links call the allow-listed `resource_opened` event with resource ID/type and assessment ID only; never send the rendered reason, faculty contacts, or careerOther text.

- [ ] **Step 4: Implement history cards and loading/error states**

History shows completed date, top track, environment score, and selected interest summary for at most three results. Result 404 uses the same message for missing and foreign IDs. Skeletons preserve final layout dimensions.

- [ ] **Step 5: Verify components and commit**

Run: `pnpm vitest run tests/unit/components/ResultTimeline.test.ts && pnpm nuxi typecheck`

Expected: section order, faculty labels, reduced motion, empty state, and type checks pass.

```bash
git add app/components/result app/pages/result app/pages/history.vue server/api/events.post.ts tests/unit/components/ResultTimeline.test.ts
git commit -m "feat: add evidence timeline results"
```

### Task 7: S3 full-flow gate

**Files:**
- Create: `tests/e2e/results.spec.ts`

**Interfaces:**
- Consumes: S1–S3 complete student flow
- Produces: result, ownership, idempotency, and recent-three browser coverage

- [ ] **Step 1: Write full result E2E**

In the E2E setup, promote only the named commercial curriculum fixtures and all six faculty fixtures from draft to active, assign positive weekly capacity to the three full-time faculty, and keep every contact `admin_only`.

```ts
test('commercial student sees curriculum and 곽동욱 specialist evidence', async ({ page }) => {
  await completeCommercialAssessment(page)
  await expect(page.getByText('커머셜 포토그라피 기초 워크숍')).toBeVisible()
  await expect(page.getByText('곽동욱')).toBeVisible()
  await expect(page.getByText('추천 총괄교수')).toBeVisible()
})
```

Add this rotation scenario:

```ts
test('four completions retain exactly the latest three result cards', async ({ page }) => {
  await loginSeedStudent(page)
  for (let attempt = 0; attempt < 4; attempt++) await completeValidAssessment(page, attempt)
  await page.goto('/history')
  await expect(page.getByTestId('history-card')).toHaveCount(3)
})
```

- [ ] **Step 2: Run S3 quality gate**

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:sql
pnpm playwright test tests/e2e/results.spec.ts --project=chromium
```

Expected: all commands exit 0; commercial evidence and three-result rotation are visible.

- [ ] **Step 3: Commit S3 coverage**

```bash
git add tests/e2e/results.spec.ts
git commit -m "test: verify result matching vertical slice"
```
