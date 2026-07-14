# PHOTO:NEXT S2 Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생이 1–2분 안에 네 단계 관심사를 선택하고 서버에서 재현 가능한 네 트랙 점수와 관심 태그 벡터를 얻도록 한다.

**Architecture:** 평가 선택지는 PostgreSQL의 게시된 데이터에서 읽고 응답 스냅샷은 S3 완료 트랜잭션에서 저장한다. S2에서는 Pinia가 비민감 선택 상태를 보존하고 AssessmentModule이 활성 옵션·선택 제한·점수 산식을 검증한다.

**Tech Stack:** Nuxt 4, Vue 3, Pinia, Zod, Supabase PostgreSQL, Vitest, Vue Test Utils, Playwright, pgTAP

> **2026-07-15 amendment:** S1 is complete through migration `202607140007_login_hardening.sql`. This plan therefore starts at `202607140008`; later S3–S6 migration filenames in older plans are placeholders and must be assigned from the then-current HEAD instead of reusing their stale literals. S1's API envelope remains `{ data, requestId }` on success and `{ error, requestId }` on failure.

## Global Constraints

- 질문 그룹과 비중은 작업 40%, 결과물 30%, 진로 20%, 작업 방식 10%다.
- 선택 제한은 작업 1–4, 결과물 1–3, 작업 방식 1–2, 진로 1–2다.
- 선택지의 트랙 가중치는 다큐멘터리·예술사진·광고사진·영상 각각 0–3이다.
- 진로 “가능성 탐색”만 30자 이내 선택 텍스트를 허용한다.
- 점수는 선택 수로 정규화하고 한 자리 소수로 표시한다.
- 관심 태그 벡터는 고정된 그룹 비중과 선택 비율로 계산하고 키 순서와 6자리 정밀도까지 재현 가능해야 한다.
- 평가 UI는 이미지 카드형 모바일 흐름이며 선택 상태를 색만으로 전달하지 않는다.
- 새로고침 전 네트워크 실패에는 선택을 유지하되 전화번호·토큰은 저장하지 않는다.
- 인증된 평가 변경 요청은 S1의 exact-Origin 및 세션 결합 CSRF 경계를 통과해야 한다.

---

### Task 1: Assessment option schema and verified seed

**Files:**
- Create: `supabase/migrations/202607140008_assessment_options.sql`
- Create: `supabase/seed/assessment-options.json`
- Create: `scripts/seed-assessment-options.ts`
- Create: `supabase/seed/assessment-options.sql`
- Create: `supabase/seed.sql`
- Create: `supabase/tests/assessment_options.test.sql`
- Create: `tests/unit/assessment/assessment-seed.test.ts`
- Create: `shared/types/domain.ts`
- Create: `shared/schemas/assessment.ts`

**Interfaces:**
- Produces: table `assessment_options`; `TrackKey`, `QuestionGroup`, `AssessmentOption`, `AssessmentSelections`; `assessmentSubmissionSchema`; deterministic catalog revision
- Consumes: default-deny RLS and server Supabase client from S1

- [ ] **Step 1: Write the failing option constraint test**

```sql
begin;
select plan(7);
select has_table('public', 'assessment_options');
select col_is_unique('public', 'assessment_options', array['question_group','option_key']);
select col_is_unique('public', 'assessment_options', array['question_group','sort_order']);
select policies_are('public','assessment_options',array[]::text[],'browser roles have no policy');
select table_privs_are('service_role','public','assessment_options',array['SELECT'],'service role can only read the catalog');
select throws_ok(
  $$insert into public.assessment_options(question_group, option_key, label, visual_key, track_weights, interest_tags, status, sort_order)
    values ('work','bad','bad','contact_sheet','{"video":4}'::jsonb,'[]'::jsonb,'active',1)$$,
  '23514'
);
select throws_ok(
  $$insert into public.assessment_options(question_group, option_key, label, visual_key, track_weights, interest_tags, status, sort_order)
    values ('work','result.bad','bad','contact_sheet','{"documentary":1,"art_photo":1,"commercial":1,"video":1}'::jsonb,'["bad tag"]'::jsonb,'active',2)$$,
  '23514'
);
select * from finish();
rollback;
```

- [ ] **Step 2: Run and verify missing table**

Run: `pnpm exec supabase test db --local supabase/tests/assessment_options.test.sql`

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

The SQL table stores an internal bigint identity ID, `question_group`, fully prefixed `option_key`, Korean `label`, optional `description`, public non-sensitive `visual_key`, `track_weights jsonb`, `interest_tags jsonb`, `status`, `sort_order`, and timestamps. Enforce unique `(question_group, option_key)` and `(question_group, sort_order)`.

The checks require `option_key` to start with its exact group prefix, `track_weights` to contain exactly the four track keys with integer values `0..3` and a positive total, and `interest_tags` to contain `1..8` unique strings matching `^[a-z][a-z0-9_]*$`. Status is `draft|active|archived`; `visual_key` is an allow-listed presentation key and contains no URL or licensed asset reference. Enable RLS with no policy. Grant `service_role` `SELECT` only, including no sequence or catalog write privilege; generated seed SQL runs as the database owner.

Define `trackLabels` beside the fixed identifiers so the UI maps `commercial` to `광고사진` without ad hoc strings. `assessmentSubmissionSchema` accepts only fully prefixed option keys, trims `careerOther`, permits it only with `career.explore`, and rejects it when it contains phone-number patterns, email patterns, or control characters.

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

Assign these exact public `visualKey` values in the same canonical JSON:

```text
work.photo_everyday       photo_frame
work.video_scene          video_frame
work.video_post           edit_timeline
work.commercial_image     studio_still
work.interview_life       interview_strip
work.brand_region         location_board
work.exhibition_install   gallery_grid
work.music_shortform      music_cuts
work.photobook            photobook_spread
work.project_plan         project_board
result.photo_portfolio    photo_frame
result.exhibit_photobook  gallery_grid
result.commercial_fashion studio_still
result.documentary        interview_strip
result.brand_video        video_frame
result.shortform_mv       music_cuts
result.video_showreel     edit_timeline
result.project_proposal   project_board
style.solo                photobook_spread
style.team                project_board
style.field               location_board
style.studio              studio_still
style.interview           interview_strip
style.post                edit_timeline
career.photo              photo_frame
career.video              video_frame
career.planning           project_board
career.explore            contact_sheet
```

The JSON is the canonical catalog and includes `visualKey` for every option. `scripts/seed-assessment-options.ts` is a strict validator and deterministic generator, not a browser/runtime seeder. It must:

- reject unknown JSON keys, duplicate option keys, duplicate group sort positions, invalid tag/weight manifests, and counts other than `10/8/6/4`;
- preserve the exact group and option order above and compute a stable catalog revision from canonical content;
- support a local write mode that generates `supabase/seed/assessment-options.sql` and a `--check` mode that fails when the checked-in SQL differs from the JSON;
- never print weights, tags, environment values, or database secrets.

`supabase/seed.sql` contains only the psql include `\ir seed/assessment-options.sql`. The generated seed starts one transaction, takes a transaction-scoped advisory lock, and compares the complete active database manifest with the generated manifest. An identical active catalog is an idempotent no-op. Any changed, missing, extra, or stale active row aborts the transaction instead of silently rewriting live content. The empty-catalog path inserts the exact 28-row manifest as database owner. There is no implicit deletion or update of active options.

- [ ] **Step 5: Reset, seed, and verify**

Run:

```bash
pnpm exec tsx scripts/seed-assessment-options.ts --write
pnpm exec tsx scripts/seed-assessment-options.ts --check
pnpm exec vitest run --project unit tests/unit/assessment/assessment-seed.test.ts
pnpm test:sql
pnpm test:sql
```

Expected: generated SQL matches canonical JSON; two consecutive reset/seed runs pass with the same revision; exactly 28 active options exist in `10/8/6/4` order; service-role writes fail; a fixture with a changed live active row aborts without partial mutation.

- [ ] **Step 6: Commit options**

```bash
git add supabase/migrations/202607140008_assessment_options.sql supabase/seed/assessment-options.json supabase/seed/assessment-options.sql supabase/seed.sql scripts/seed-assessment-options.ts supabase/tests/assessment_options.test.sql tests/unit/assessment/assessment-seed.test.ts shared/types/domain.ts shared/schemas/assessment.ts
git commit -m "feat: 2026-07-15 add verified assessment catalog"
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
    work: ['work.commercial_image'], result: ['result.commercial_fashion'], style: ['style.studio'], career: ['career.photo'], careerOther: null,
  })
  expect(scored.trackScores.commercial).toBe(100.0)
  expect(scored.rankedTracks[0]).toBe('commercial')
})

it('breaks ties by work, result, career, then fixed track order', () => {
  expect(scoreAssessment(tieOptions, validSelections).rankedTracks).toEqual(['documentary','art_photo','commercial','video'])
})
```

- [ ] **Step 2: Run and verify missing scorer**

Run: `pnpm exec vitest run --project unit tests/unit/assessment/scoring.test.ts`

Expected: FAIL because `scoreAssessment` is missing.

- [ ] **Step 3: Implement the pure scorer**

```ts
const groupScore = (weights: number[]) => weights.reduce((a, b) => a + b, 0) / (weights.length * 3) * 100
const round1 = (value: number) => Math.round(value * 10) / 10
```

For each track compute the raw four group scores and apply `0.40/0.30/0.10/0.20`. Return track scores rounded to one decimal, but rank by rounded total descending, then raw work score, raw result score, raw career score, then fixed `['documentary','art_photo','commercial','video']` order. Do not use style as an additional tie breaker.

For every tag and group calculate `groupTag = selected options containing the tag / selected option count in that group`. Then calculate `interestVector[tag] = Σ(groupWeight × groupTag)`, round to six decimal places, and return keys in lexical order. This preserves each group's fixed influence when a student chooses several options. Reject inactive, unknown, wrong-prefix, or duplicate full option keys and selection counts outside the locked limits.

- [ ] **Step 4: Verify property boundaries**

Add tests asserting every generated track score is `0..100`, tag values are `0..1`, repeated tags across groups follow the exact formula, selecting more options does not increase a group's total influence, interest keys are sorted, inputs are unchanged, and `careerOther` is rejected unless `career.explore` is selected. Assert email, phone-like text, and control characters are rejected even when length is at most 30.

Run: `pnpm exec vitest run --project unit tests/unit/assessment/scoring.test.ts`

Expected: all scoring tests pass.

- [ ] **Step 5: Commit scorer**

```bash
git add server/modules/assessment tests/unit/assessment
git commit -m "feat: 2026-07-15 add deterministic assessment scoring"
```

### Task 3: Options, validation, and assessment event API

**Files:**
- Modify: `shared/types/api.ts`
- Modify: `server/utils/app-error.ts`
- Modify: `server/modules/metrics/events.ts`
- Modify: `server/modules/identity/service.ts`
- Modify: `server/api/student/register.post.ts`
- Modify: `server/api/student/login.post.ts`
- Modify: `server/middleware/20-student-request-security.ts`
- Create: `server/utils/anonymous-visitor.ts`
- Create: `server/modules/assessment/service.ts`
- Create: `server/api/assessment/options.get.ts`
- Create: `server/api/student/assessment/validate.post.ts`
- Create: `server/api/events.post.ts`
- Modify: `app/pages/index.vue`
- Create: `tests/integration/assessment/api.test.ts`
- Create: `tests/integration/metrics/browser-events.test.ts`
- Modify: `tests/integration/identity/register.test.ts`
- Modify: `tests/integration/identity/login.test.ts`
- Modify: `tests/integration/student-request-security.test.ts`
- Create: `supabase/tests/assessment_events.test.sql`

**Interfaces:**
- Produces: `GET /api/assessment/options`; `POST /api/student/assessment/validate`; allow-listed browser event writer
- Consumes: S1 student session/CSRF/origin boundary, trusted client IP, rate-limit RPC, events table, and a stable anonymous UUID cookie

- [ ] **Step 1: Write failing API contract tests**

```ts
it('returns active options grouped and sorted', async () => {
  const response = await getOptions()
  expect(Object.keys(response.data)).toEqual(['catalogRevision','groups','limits'])
  expect(response.data.groups.map(g => [g.key, g.options.length])).toEqual([
    ['work',10], ['result',8], ['style',6], ['career',4],
  ])
})
it('rejects five work choices', async () => {
  expect((await validate({ ...valid, work: fiveKeys })).status).toBe(422)
})
it('rejects a stale catalog without scoring', async () => {
  expect((await validate({ ...valid, catalogRevision: 'stale' })).status).toBe(409)
})
```

- [ ] **Step 2: Run and verify route failures**

Run: `pnpm exec vitest run --project integration tests/integration/assessment/api.test.ts tests/integration/metrics/browser-events.test.ts tests/integration/student-request-security.test.ts`

Expected: FAIL because the handler factories and browser event contracts do not exist.

- [ ] **Step 3: Implement safe APIs and event storage**

`GET /api/assessment/options` returns exactly grouped active option keys, labels, descriptions, `visualKey`, selection limits, and `catalogRevision`, sorted by group then `sort_order, option_key`. It never serializes weights, interest tags, draft rows, or internal IDs. The revision is derived from the same canonical active manifest used by the seed.

`POST /api/student/assessment/validate` accepts a strict body no larger than 8 KiB containing selections and `catalogRevision`. Add this exact path to S1's CSRF-protected student mutation set. The request must have an active student session, exact Origin, the session-derived CSRF header, private no-store response headers, and a trusted client IP. Consume an exact `20/prospect/5 minutes` bucket before loading the catalog. A stale revision fails before scoring with `ASSESSMENT_CATALOG_STALE` and HTTP 409; invalid selections fail with `ASSESSMENT_INVALID` and HTTP 422. Scores and normalized tags are intended response data, but raw option weights and source tags must never be serialized, logged, or placed in an error.

Keep the current API envelope: success is `{ data, requestId }`; failure is `{ error, requestId }`. Extend `shared/types/api.ts` and `server/utils/app-error.ts` only with `ASSESSMENT_INVALID` 422 and `ASSESSMENT_CATALOG_STALE` 409; do not add `ok` or `fieldErrors`.

`POST /api/events` accepts `application/json` only, limits the full body to 8 KiB and event properties to 4 KiB, and uses a strict discriminated union with no unknown fields:

- `{ eventName: 'landing_viewed' }`;
- `{ eventName: 'assessment_started', catalogRevision }`;
- `{ eventName: 'assessment_step_completed', catalogRevision, group, selectedCount }`.

The server derives the canonical request path, request ID, optional authenticated prospect subject, and anonymous subject; callers cannot submit a path, prospect ID, anonymous ID, campaign ID, or arbitrary properties. Require exact Origin, then consume `60/IP/1 minute` followed by `30/anonymous-ID/1 minute` before insert. Campaign remains null until a validated campaign table exists.

Create a stable UUID cookie helper used by the event, registration, and login handlers. The cookie is `HttpOnly; Secure; SameSite=Lax`, is validated as a canonical UUID before reuse, and is never exposed to client JavaScript. The database already has the required `anonymous_id` and nullable `prospect_id` columns and S2 event-name checks, so no S2 schema migration is required for this change. Modify the existing identity event writer to insert the stable anonymous ID on all identity events, and attach the prospect ID to `registration_completed` and `login_succeeded`. Registration may re-read the newly created prospect by its protected phone HMAC; do not expose or log it. pgTAP locks the existing event column/name/grant contract, while integration tests prove stable anonymous correlation and successful identity attribution.

On the landing page, send one non-blocking `landing_viewed` event per page lifecycle with no client-provided path or campaign data. Event failure must not block navigation or reveal upstream detail.

- [ ] **Step 4: Verify API contracts and commit**

Run:

```bash
pnpm exec vitest run --project integration tests/integration/assessment/api.test.ts tests/integration/metrics/browser-events.test.ts tests/integration/identity/register.test.ts tests/integration/identity/login.test.ts tests/integration/student-request-security.test.ts
pnpm exec supabase test db --local supabase/tests/assessment_events.test.sql
```

Expected: sorted public catalog without weights/tags, invalid/unknown choices 422, stale revision 409, missing Origin/CSRF/session 403 or 401 before scoring, fixed rate-limit order, strict event bodies, stable anonymous UUIDs, successful identity event attribution, and no sensitive event properties.

```bash
git add shared/types/api.ts server/utils/app-error.ts server/utils/anonymous-visitor.ts server/modules/metrics/events.ts server/modules/identity/service.ts server/modules/assessment/service.ts server/api/student/register.post.ts server/api/student/login.post.ts server/api/assessment/options.get.ts server/api/student/assessment/validate.post.ts server/api/events.post.ts server/middleware/20-student-request-security.ts app/pages/index.vue tests/integration/assessment tests/integration/metrics tests/integration/identity/register.test.ts tests/integration/identity/login.test.ts tests/integration/student-request-security.test.ts supabase/tests/assessment_events.test.sql
git commit -m "feat: 2026-07-15 expose secure assessment APIs"
```

### Task 4: Four-step mobile assessment UI

**Files:**
- Create: `app/stores/assessment.ts`
- Create: `app/components/assessment/AssessmentProgress.vue`
- Create: `app/components/assessment/OptionCard.vue`
- Create: `app/components/assessment/AssessmentStep.vue`
- Modify: `app/pages/assessment.vue`
- Create: `tests/unit/components/AssessmentStep.test.ts`
- Create: `tests/unit/stores/AssessmentStore.test.ts`
- Modify: `tests/unit/pages/StudentAssessmentPage.test.ts`

**Interfaces:**
- Produces: store actions `loadOptions`, `toggleOption`, `next`, `previous`, `validate`, `clear`; current step, selected keys, optional text, and revision persist in `sessionStorage` under `photo_next_assessment_v1`
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

Run: `pnpm exec vitest run --project unit tests/unit/components/AssessmentStep.test.ts`

Expected: FAIL because assessment components do not exist.

- [ ] **Step 3: Implement store and accessible cards**

Preserve the existing S1 session bootstrap, unauthenticated redirect, logout action, and CSRF header in `app/pages/assessment.vue`; replace only its honest S2 placeholder with the assessment experience. Load the session before enabling the flow and keep its CSRF token in memory only.

Use a `fieldset` and `legend` for every group and real checkbox inputs inside label cards. Each card exposes selected state with a check icon, explicit selected text, border, and background; color is never the only signal. Every interactive target is at least 44×44px, focus is plainly visible, limit/error changes use a polite `aria-live` region, reduced-motion disables nonessential transitions, and the contact-sheet layout remains usable from narrow mobile through desktop.

Render CSS-only editorial film/contact-sheet visuals selected from the server's allow-listed `visualKey`. Do not fetch stock photography, hotlink an image, or introduce an unlicensed asset. Progress displays “02 / 04” and the Korean group label. Next is disabled below minimum; exceeding maximum leaves state unchanged and announces the exact limit.

`career.explore` reveals a labeled 30-character input with counter and a privacy hint. The UI warns immediately and the schema rejects phone-like text, email-like text, and control characters. Deselecting `career.explore` clears the optional text synchronously.

Model explicit `loading`, `empty`, `error`, `unauthenticated`, `retry`, `validating`, and `validated` states. A network failure during options load or validation preserves safe selections and exposes a retry action. A stale catalog response reloads options, explains that choices must be reviewed, and never silently scores against another revision.

Persist only `{ step, selections, careerOther, catalogRevision }` to `sessionStorage`; validate its shape and revision before restore. Never persist CSRF, session data, track scores, ranked tracks, or interest vectors. Store the latest validated result in memory only. Clear persisted assessment state on successful logout and, in S3, successful completion.

- [ ] **Step 4: Verify component and type checks**

Run:

```bash
pnpm exec vitest run --project unit tests/unit/components/AssessmentStep.test.ts tests/unit/stores/AssessmentStore.test.ts tests/unit/pages/StudentAssessmentPage.test.ts
pnpm typecheck
```

Expected: selection limits, keyboard/native checkbox semantics, privacy text rejection, explore cleanup, previous/next, revision-safe restore, retry states, S1 logout/redirect regressions, and memory-only result/CSRF assertions pass; type errors 0.

- [ ] **Step 5: Commit assessment UI**

```bash
git add app/stores/assessment.ts app/components/assessment app/pages/assessment.vue tests/unit/components/AssessmentStep.test.ts tests/unit/stores/AssessmentStore.test.ts tests/unit/pages/StudentAssessmentPage.test.ts
git commit -m "feat: 2026-07-15 add four-step assessment experience"
```

### Task 5: S2 end-to-end gate

**Files:**
- Create: `tests/e2e/assessment.spec.ts`
- Create: `tests/e2e/support/student.ts`
- Modify: `app/pages/assessment.vue`

**Interfaces:**
- Consumes: complete S2 flow
- Produces: stable Playwright coverage for commercial-primary completion, refresh restore, validation retry, and S1 identity regression

- [ ] **Step 1: Write the assessment E2E**

```ts
test('student completes four steps with commercial as the primary track', async ({ page }) => {
  await registerAndLoginStudent(page, uniqueAssessmentPhone())
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

Use a real local registration/login helper with a unique phone per test; no `loginSeedStudent` helper exists in S1. The helper must exercise the browser flow or same-origin endpoints, must not write credentials to disk/logs, and must not bypass session cookies, Origin, or CSRF.

Add two independent tests in the same file:

- select at least one option, advance, reload, and assert the current step and selections restore from the matching catalog revision while CSRF and scores are absent from storage;
- intercept the first validate request with a network failure, assert all four groups remain selected and a retry action is announced, then retry and assert the commercial primary result appears once.

Run the S1 identity E2E beside the new assessment tests. The existing Playwright global setup resets local Supabase before the run; Task 1's checked-in `supabase/seed.sql` must therefore recreate the exact 28-option catalog automatically. Do not add an out-of-band manual seed step to E2E.

- [ ] **Step 2: Run the S2 gate**

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:sql
pnpm test:local-integration
pnpm exec playwright test tests/e2e/identity.spec.ts tests/e2e/assessment.spec.ts --project=chromium
pnpm build
git diff --check
```

Expected: all commands exit 0; identity registration/login/logout remains intact; commercial-primary completion, revision-safe refresh restore, and network retry pass; build succeeds with no whitespace error.

- [ ] **Step 3: Commit E2E coverage**

```bash
git add tests/e2e/assessment.spec.ts tests/e2e/support/student.ts app/pages/assessment.vue
git commit -m "test: 2026-07-15 verify assessment vertical slice"
```
