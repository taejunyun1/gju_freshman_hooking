# PHOTO:NEXT S2 Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생이 1–2분 안에 네 단계 관심사를 선택하고 서버에서 재현 가능한 네 트랙 점수와 관심 태그 벡터를 얻도록 한다.

**Architecture:** 평가 선택지는 PostgreSQL의 게시된 데이터에서 읽고 응답 스냅샷은 S3 완료 트랜잭션에서 저장한다. S2에서는 Pinia가 비민감 선택 상태를 보존하고 AssessmentModule이 활성 옵션·선택 제한·점수 산식을 검증한다.

**Tech Stack:** Nuxt 4, Vue 3, Pinia, Zod, Supabase PostgreSQL, Vitest, Vue Test Utils, Playwright, pgTAP

## Global Constraints

- 질문 그룹과 비중은 작업 40%, 결과물 30%, 진로 20%, 작업 방식 10%다.
- 선택 제한은 작업 1–4, 결과물 1–3, 작업 방식 1–2, 진로 1–2다.
- 선택지의 트랙 가중치는 다큐멘터리·예술사진·광고사진·영상 각각 0–3이다.
- 진로 “가능성 탐색”만 30자 이내 선택 텍스트를 허용한다.
- 점수는 선택 수로 정규화하고 한 자리 소수로 표시한다.
- 평가 UI는 이미지 카드형 모바일 흐름이며 선택 상태를 색만으로 전달하지 않는다.
- 새로고침 전 네트워크 실패에는 선택을 유지하되 전화번호·토큰은 저장하지 않는다.

---

### Task 1: Assessment option schema and verified seed

**Files:**
- Create: `supabase/migrations/202607140002_assessment_options.sql`
- Create: `supabase/seed/assessment-options.json`
- Create: `scripts/seed-assessment-options.ts`
- Create: `supabase/tests/assessment_options.test.sql`
- Create: `shared/types/domain.ts`
- Create: `shared/schemas/assessment.ts`

**Interfaces:**
- Produces: table `assessment_options`; `TrackKey`, `QuestionGroup`, `AssessmentOption`, `AssessmentSelections`; `assessmentSubmissionSchema`
- Consumes: default-deny RLS and server Supabase client from S1

- [ ] **Step 1: Write the failing option constraint test**

```sql
begin;
select plan(3);
select has_table('public', 'assessment_options');
select col_is_unique('public', 'assessment_options', array['question_group','option_key']);
select throws_ok(
  $$insert into public.assessment_options(question_group, option_key, label, track_weights, interest_tags, status, sort_order)
    values ('work','bad','bad','{"video":4}'::jsonb,'[]'::jsonb,'active',1)$$,
  '23514'
);
select * from finish();
rollback;
```

- [ ] **Step 2: Run and verify missing table**

Run: `supabase test db`

Expected: FAIL on `has_table('assessment_options')`.

- [ ] **Step 3: Create the option table and exact shared schemas**

```ts
export const trackKeys = ['documentary', 'art_photo', 'commercial', 'video'] as const
export const questionGroups = ['work', 'result', 'style', 'career'] as const
export const selectionLimits = {
  work: { min: 1, max: 4, weight: 0.40 },
  result: { min: 1, max: 3, weight: 0.30 },
  style: { min: 1, max: 2, weight: 0.10 },
  career: { min: 1, max: 2, weight: 0.20 },
} as const
```

The SQL table stores `question_group`, `option_key`, Korean `label`, optional `description`, `track_weights jsonb`, `interest_tags jsonb`, `status`, `sort_order`, timestamps, and a unique `(question_group, option_key)`. A check function verifies all four track keys exist, every weight is integer 0–3, tags are nonempty strings, and status is `draft|active|archived`. Enable RLS with no public policy.

- [ ] **Step 4: Add the complete 28-option seed**

Use these keys, labels, and track-weight vectors in `[documentary, art_photo, commercial, video]` order:

```text
work.photo_everyday       인물·풍경·일상을 사진으로 촬영하기       [2,3,1,0]
work.video_scene          카메라로 영상 장면 촬영하기             [1,1,1,3]
work.video_post           촬영한 영상을 편집하고 색보정하기        [1,1,2,3]
work.commercial_image     제품·패션·광고 이미지 만들기            [0,1,3,1]
work.interview_life       사람을 인터뷰하고 삶을 기록하기          [3,1,0,2]
work.brand_region         브랜드·지역을 위한 콘텐츠 만들기         [2,1,3,2]
work.exhibition_install   사진전이나 설치작업 만들기               [1,3,0,1]
work.music_shortform      뮤직비디오·숏폼 영상 만들기              [0,1,2,3]
work.photobook            사진집·포토북 만들기                    [2,3,1,0]
work.project_plan         콘텐츠와 프로젝트를 기획하기             [2,2,2,2]
result.photo_portfolio    사진 포트폴리오                         [1,3,2,0]
result.exhibit_photobook  사진전·포토북                           [2,3,0,0]
result.commercial_fashion 광고·패션 이미지                        [0,1,3,0]
result.documentary        다큐멘터리 사진·영상                     [3,1,0,2]
result.brand_video        브랜드 홍보영상                         [1,0,3,3]
result.shortform_mv       숏폼·뮤직비디오                         [0,1,2,3]
result.video_showreel     영상 촬영·편집 쇼릴                      [0,1,2,3]
result.project_proposal   콘텐츠·프로젝트 기획안                    [2,2,2,2]
style.solo                혼자 집중해서 작업                      [1,3,1,1]
style.team                팀으로 제작                            [1,1,2,3]
style.field               현장에서 촬영                          [3,1,1,2]
style.studio              스튜디오에서 촬영                        [0,2,3,2]
style.interview           사람을 만나고 인터뷰                     [3,1,0,2]
style.post                컴퓨터로 편집·후반작업                    [1,2,2,3]
career.photo              사진을 직접 촬영하고 보정해 작품·광고·포트폴리오로 완성하고 싶어요. [1,3,3,0]
career.video              영상을 직접 촬영하고 편집해 숏폼·다큐멘터리·브랜드 콘텐츠로 완성하고 싶어요. [1,1,2,3]
career.planning           사진·영상 프로젝트를 기획하고 사람·지역·브랜드를 연결하는 일을 하고 싶어요. [2,2,3,2]
career.explore            아직 구체적인 진로를 정하지 않았거나 사진·영상과 연결된 다른 가능성을 탐색하고 싶어요. [1,1,1,1]
```

Assign these exact interest tag arrays:

```text
work.photo_everyday       [photography,portrait,landscape,daily_life,field]
work.video_scene          [video,camera,cinematography,scene]
work.video_post           [video,editing,color_grading,post_production]
work.commercial_image     [commercial,fashion,product,studio,lighting,brand]
work.interview_life       [documentary,interview,people,field,storytelling]
work.brand_region         [brand,local_culture,content,planning,public_content]
work.exhibition_install   [art_photo,exhibition,installation,media_art]
work.music_shortform      [video,music_video,shortform,editing]
work.photobook            [photobook,editing,sequencing,portfolio]
work.project_plan         [planning,project,content,cultural_planning]
result.photo_portfolio    [photography,portfolio,editing]
result.exhibit_photobook  [exhibition,photobook,art_photo,sequencing]
result.commercial_fashion [commercial,fashion,brand,studio]
result.documentary        [documentary,storytelling,interview,field]
result.brand_video        [brand,video,commercial,promotion]
result.shortform_mv       [shortform,music_video,video,editing]
result.video_showreel     [video,cinematography,editing,showreel]
result.project_proposal   [planning,project,proposal,cultural_planning]
style.solo                [solo,art_photo,research]
style.team                [team,collaboration,video,production]
style.field               [field,documentary,local_culture]
style.studio              [studio,lighting,commercial,portrait]
style.interview           [interview,people,documentary,oral_history]
style.post                [editing,post_production,color_grading,digital_image]
career.photo              [photography,art_photo,commercial,portfolio,freelance]
career.video              [video,shortform,documentary,brand,showreel]
career.planning           [planning,project,brand,local_culture,cultural_planning]
career.explore            [exploration,photography,video,planning]
```

The seed script validates the JSON with Zod before upsert and never deletes active options implicitly.

- [ ] **Step 5: Reset, seed, and verify**

Run:

```bash
supabase db reset
pnpm tsx scripts/seed-assessment-options.ts
supabase test db
```

Expected: 28 active options, each group count `10/8/6/4`, pgTAP passes.

- [ ] **Step 6: Commit options**

```bash
git add supabase/migrations/202607140002_assessment_options.sql supabase/seed/assessment-options.json scripts/seed-assessment-options.ts supabase/tests/assessment_options.test.sql shared
git commit -m "feat: add assessment option catalog"
```

### Task 2: Deterministic track and interest-vector scoring

**Files:**
- Create: `server/modules/assessment/scoring.ts`
- Create: `server/modules/assessment/types.ts`
- Create: `tests/unit/assessment/scoring.test.ts`

**Interfaces:**
- Produces: `scoreAssessment(options, selections): ScoredAssessment`
- `ScoredAssessment`: `{ trackScores: Record<TrackKey, number>; rankedTracks: TrackKey[]; interestVector: Record<string, number> }`

- [ ] **Step 1: Write failing normalization and tie tests**

```ts
it('applies group weights and returns one-decimal scores', () => {
  const scored = scoreAssessment(options, {
    work: ['commercial_image'], result: ['commercial_fashion'], style: ['studio'], career: ['photo'], careerOther: null,
  })
  expect(scored.trackScores.commercial).toBe(100.0)
  expect(scored.rankedTracks[0]).toBe('commercial')
})

it('breaks ties by work, result, career, then fixed track order', () => {
  expect(scoreAssessment(tieOptions, validSelections).rankedTracks).toEqual(['documentary','art_photo','commercial','video'])
})
```

- [ ] **Step 2: Run and verify missing scorer**

Run: `pnpm vitest run tests/unit/assessment/scoring.test.ts`

Expected: FAIL because `scoreAssessment` is missing.

- [ ] **Step 3: Implement the pure scorer**

```ts
const groupScore = (weights: number[]) => weights.reduce((a, b) => a + b, 0) / (weights.length * 3) * 100
const round1 = (value: number) => Math.round(value * 10) / 10
```

For each track compute the four group scores and apply `0.40/0.30/0.10/0.20`. Rank with work score, result score, career score, then `['documentary','art_photo','commercial','video']`. Build each interest tag as the weighted mean of selected option tag strengths and clamp to 0–1. Reject inactive/unknown/duplicate options and selection counts outside the locked limits.

- [ ] **Step 4: Verify property boundaries**

Add tests asserting every generated track score is 0–100, tag values are 0–1, input objects are unchanged, and careerOther is rejected unless `career.explore` is selected.

Run: `pnpm vitest run tests/unit/assessment/scoring.test.ts`

Expected: all scoring tests pass.

- [ ] **Step 5: Commit scorer**

```bash
git add server/modules/assessment tests/unit/assessment
git commit -m "feat: add deterministic assessment scoring"
```

### Task 3: Options, validation, and assessment event API

**Files:**
- Modify: `server/modules/metrics/events.ts`
- Create: `server/modules/assessment/service.ts`
- Create: `server/api/assessment/options.get.ts`
- Create: `server/api/assessment/validate.post.ts`
- Create: `server/api/events.post.ts`
- Modify: `app/pages/index.vue`
- Create: `tests/integration/assessment/api.test.ts`

**Interfaces:**
- Produces: `GET /api/assessment/options`; `POST /api/assessment/validate`; allow-listed `recordEvent`
- Consumes: authenticated student session for validate; S1 events table and anonymous UUID cookie for pre-login events

- [ ] **Step 1: Write failing API contract tests**

```ts
it('returns active options grouped and sorted', async () => {
  const response = await getOptions()
  expect(response.data.groups.map(g => [g.key, g.options.length])).toEqual([
    ['work',10], ['result',8], ['style',6], ['career',4],
  ])
})
it('rejects five work choices', async () => {
  expect((await validate({ ...valid, work: fiveKeys })).status).toBe(422)
})
```

- [ ] **Step 2: Run and verify route failures**

Run: `pnpm vitest run tests/integration/assessment/api.test.ts`

Expected: FAIL with route-not-found responses.

- [ ] **Step 3: Implement safe APIs and event storage**

Options returns only active keys, labels, descriptions, tags needed for UI imagery, and selection limits; it never returns numeric weights. Validate loads active weights server-side and returns scored tracks plus normalized tags. Event API accepts only the explicit browser names `landing_viewed`, `assessment_started`, and `assessment_step_completed` in S2, strips keys matching `/phone|password|token|cookie|authorization|secret/i`, and limits properties to 4KB. Add a one-time `landing_viewed` call on the landing page with path and campaign context only.

- [ ] **Step 4: Verify API contracts and commit**

Run: `pnpm vitest run tests/integration/assessment/api.test.ts`

Expected: sorted options, invalid count 422, unknown keys 422, no weights leaked.

```bash
git add server/modules/metrics server/modules/assessment/service.ts server/api/assessment server/api/events.post.ts app/pages/index.vue tests/integration/assessment/api.test.ts
git commit -m "feat: expose validated assessment API"
```

### Task 4: Four-step mobile assessment UI

**Files:**
- Create: `app/stores/assessment.ts`
- Create: `app/components/assessment/AssessmentProgress.vue`
- Create: `app/components/assessment/OptionCard.vue`
- Create: `app/components/assessment/AssessmentStep.vue`
- Create: `app/pages/assessment.vue`
- Create: `tests/unit/components/AssessmentStep.test.ts`

**Interfaces:**
- Produces: store actions `loadOptions`, `toggleOption`, `next`, `previous`, `validate`; selected keys persist in `sessionStorage` under `photo_next_assessment_v1`
- Consumes: S2 options and validate APIs; active student session from S1

- [ ] **Step 1: Write failing selection-limit component tests**

```ts
it('announces and blocks a fifth selection', async () => {
  const wrapper = mount(AssessmentStep, { props: { group: workGroup, modelValue: fourKeys } })
  await wrapper.get('[data-key="work.photobook"]').trigger('click')
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  expect(wrapper.get('[role="status"]').text()).toContain('최대 4개')
})
```

- [ ] **Step 2: Run and verify component failure**

Run: `pnpm vitest run tests/unit/components/AssessmentStep.test.ts`

Expected: FAIL because assessment components do not exist.

- [ ] **Step 3: Implement store and accessible cards**

Use actual checkbox inputs inside label cards. Each card exposes selected state with check icon, `aria-checked`, border, and background. Progress displays “02 / 04” and a text label. Next is disabled below minimum; exceeding maximum leaves state unchanged and announces the limit. `career.explore` reveals a labeled 30-character input and counter.

Store only option keys and `careerOther` in sessionStorage; clear them after S3 completion or logout. On validate network error preserve selections and show retry. Do not store scores as authority; always use server response.

- [ ] **Step 4: Verify component and type checks**

Run: `pnpm vitest run tests/unit/components/AssessmentStep.test.ts && pnpm nuxi typecheck`

Expected: limit, keyboard, other-text, previous/next tests pass; type errors 0.

- [ ] **Step 5: Commit assessment UI**

```bash
git add app/stores/assessment.ts app/components/assessment app/pages/assessment.vue tests/unit/components/AssessmentStep.test.ts
git commit -m "feat: add four-step assessment experience"
```

### Task 5: S2 end-to-end gate

**Files:**
- Create: `tests/e2e/assessment.spec.ts`
- Modify: `app/pages/assessment.vue`

**Interfaces:**
- Consumes: complete S2 flow
- Produces: stable Playwright coverage for selection, refresh restore, validation retry

- [ ] **Step 1: Write the assessment E2E**

```ts
test('student completes four assessment steps', async ({ page }) => {
  await loginSeedStudent(page)
  await page.goto('/assessment')
  await page.getByText('제품·패션·광고 이미지 만들기').click()
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByText('광고·패션 이미지').click()
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByText('스튜디오에서 촬영').click()
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByText(/사진을 직접 촬영/).click()
  await page.getByRole('button', { name: '결과 계산' }).click()
  await expect(page.getByTestId('validated-primary-track')).toHaveText('광고사진')
})
```

- [ ] **Step 2: Run the S2 gate**

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:sql
pnpm playwright test tests/e2e/assessment.spec.ts --project=chromium
```

Expected: all commands exit 0 and the primary track is 광고사진.

- [ ] **Step 3: Commit E2E coverage**

```bash
git add tests/e2e/assessment.spec.ts app/pages/assessment.vue
git commit -m "test: verify assessment vertical slice"
```
