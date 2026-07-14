# PHOTO:NEXT S4 Counseling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생이 결과 근거를 바탕으로 상담을 신청하고 관리자가 추천 교수 확인, 최종 배정, 연락, 완료까지 안전하게 처리하도록 한다.

**Architecture:** CounselingModule이 결과 스냅샷의 총괄·예비·전문 연계를 상담 추천 스냅샷으로 복사하고 서버 상태 머신으로 전이를 제한한다. 학생은 자신의 열린 요청만 보고, 관리자는 MFA 세션으로 큐·복호화 연락처·전달 요약을 사용한다.

**Tech Stack:** Nuxt 4, Vue 3, Zod, Supabase PostgreSQL/RPC, Vitest, Playwright, pgTAP

## Global Constraints

- 상담 방식은 전화, 문자, 방문 중 하나다.
- 연락 가능 시간은 평일 오전, 평일 오후, 평일 저녁, 주말 중 하나다.
- 문의 내용은 선택이며 최대 200자다.
- 학생 정보와 결과를 담당교수에게 전달하는 동의가 필수다.
- 열린 상담은 학생당 하나만 허용하고 중복 신청은 기존 요청을 반환한다.
- 상태는 `new -> assigned -> contacted -> completed`와 각 활성 상태에서 `closed`만 허용한다.
- 완료·종료를 다시 열 때는 관리자 사유와 감사 이벤트가 필요하다.
- 교수 로그인, 일정 자동 예약, SMS·문자 자동 발송은 만들지 않는다.
- 추천과 실제 배정을 UI 문구와 데이터에서 구분한다.

---

### Task 1: Counseling schema, recommendation snapshot, and state machine

**Files:**
- Create: `supabase/migrations/202607140005_counseling.sql`
- Create: `supabase/tests/counseling.test.sql`
- Create: `shared/schemas/counseling.ts`
- Create: `server/modules/counseling/state-machine.ts`
- Create: `tests/unit/counseling/state-machine.test.ts`

**Interfaces:**
- Produces: `counseling_requests`, `counseling_faculty_recommendations`; RPCs `create_counseling_request` and `transition_counseling_request`
- Produces: `assertTransition(from, to, reopenReason?): void`

- [ ] **Step 1: Write failing transition and uniqueness tests**

```ts
expect(() => assertTransition('new','assigned')).not.toThrow()
expect(() => assertTransition('assigned','completed')).toThrowError('COUNSELING_TRANSITION_INVALID')
expect(() => assertTransition('closed','new')).toThrowError('COUNSELING_REOPEN_REASON_REQUIRED')
expect(() => assertTransition('closed','new','학생 재요청')).not.toThrow()
```

```sql
select throws_ok(
  $$insert into public.counseling_requests(prospect_id,assessment_id,status,contact_method,availability,consent_given)
    values (1,1,'new','phone','weekday_morning',true), (1,1,'new','text','weekend',true)$$,
  '23505'
);
```

- [ ] **Step 2: Run and verify failures**

Run: `pnpm vitest run tests/unit/counseling && supabase test db`

Expected: FAIL because module and tables do not exist.

- [ ] **Step 3: Create the constrained counseling model**

`counseling_requests` stores prospect, assessment, status, method, availability, inquiry, consent timestamp, assigned faculty, contact/completion/close timestamps, admin note, optimistic `version`, and timestamps. Check inquiry length ≤200 and consent true. Create a unique partial index on prospect where status is `new|assigned|contacted`.

`counseling_faculty_recommendations` stores primary rank 1, backup rank 1, specialists rank 1–2 with score and reason snapshot. `create_counseling_request` locks the prospect, returns an existing open request, verifies owned assessment, inserts the request and recommendations from result snapshot. `transition_counseling_request` checks expected version and allowed transition, then increments version and records timestamps.

- [ ] **Step 4: Implement the pure state machine**

```ts
const allowed = {
  new: ['assigned','closed'], assigned: ['contacted','closed'],
  contacted: ['completed','closed'], completed: [], closed: [],
} as const
```

Reopen is a separate admin RPC requiring nonblank reason and returning to `new`; it never enters the normal `allowed` map.

- [ ] **Step 5: Verify and commit counseling domain**

Run: `pnpm vitest run tests/unit/counseling && supabase test db`

Expected: state tests pass, duplicate open request fails, valid recommendation roles persist.

```bash
git add supabase/migrations/202607140005_counseling.sql supabase/tests/counseling.test.sql shared/schemas/counseling.ts server/modules/counseling/state-machine.ts tests/unit/counseling
git commit -m "feat: add counseling state model"
```

### Task 2: Student counseling application and status API

**Files:**
- Create: `server/modules/counseling/service.ts`
- Create: `server/api/counseling/index.post.ts`
- Create: `server/api/counseling/index.get.ts`
- Create: `tests/integration/counseling/student.test.ts`

**Interfaces:**
- Produces: `POST /api/counseling`; `GET /api/counseling`
- Consumes: owned result ID and S3 faculty recommendation snapshot

- [ ] **Step 1: Write failing request contract tests**

```ts
it('returns the existing open request on duplicate submit', async () => {
  const first = await requestCounseling(validInput)
  const second = await requestCounseling(validInput)
  expect(second.data.id).toBe(first.data.id)
})
it('rejects a request without transfer consent', async () => {
  expect((await requestCounseling({ ...validInput, consent: false })).status).toBe(422)
})
```

- [ ] **Step 2: Run and verify route failures**

Run: `pnpm vitest run tests/integration/counseling/student.test.ts`

Expected: FAIL because routes are missing.

- [ ] **Step 3: Implement student APIs**

Validate:

```ts
z.object({
  assessmentPublicId: z.string().uuid(),
  contactMethod: z.enum(['phone','text','visit']),
  availability: z.enum(['weekday_morning','weekday_afternoon','weekday_evening','weekend']),
  inquiry: z.string().trim().max(200).nullable(),
  consent: z.literal(true),
})
```

Resolve the assessment by both public ID and session prospect ID, call the create RPC, emit `counseling_requested` only when newly inserted, and return the existing open request otherwise. GET returns public faculty names/roles, assigned faculty after assignment, and status timestamps; it excludes admin note and full phone.

- [ ] **Step 4: Verify and commit student API**

Run: `pnpm vitest run tests/integration/counseling/student.test.ts`

Expected: consent enforced, foreign result 404, duplicate returns one request, student response omits admin note.

```bash
git add server/modules/counseling/service.ts server/api/counseling tests/integration/counseling/student.test.ts
git commit -m "feat: add student counseling API"
```

### Task 3: Student CTA, application form, and status page

**Files:**
- Create: `app/components/counseling/CounselingCTA.vue`
- Create: `app/components/counseling/CounselingForm.vue`
- Create: `app/components/counseling/CounselingStatus.vue`
- Create: `app/pages/counseling.vue`
- Modify: `app/pages/result/[publicId].vue`
- Create: `tests/unit/components/CounselingForm.test.ts`

**Interfaces:**
- Produces: result CTA linking assessment ID to form; student status timeline
- Consumes: S4 student APIs

- [ ] **Step 1: Write failing consent and copy tests**

```ts
expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
await wrapper.get('input[name="consent"]').setValue(true)
expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
expect(wrapper.text()).toContain('추천 총괄교수')
expect(wrapper.text()).not.toContain('자동 배정')
```

- [ ] **Step 2: Run and verify missing components**

Run: `pnpm vitest run tests/unit/components/CounselingForm.test.ts`

Expected: FAIL because counseling components do not exist.

- [ ] **Step 3: Implement CTA and form**

CTA copy is “이 로드맵의 실제 수업, 장비, 포트폴리오와 입학 준비가 궁금하다면 관심 분야 담당교수와 상담해보세요.” The form uses radio groups for method and availability, a 200-character textarea counter, required transfer-consent checkbox, pending state, and retry without clearing entries.

- [ ] **Step 4: Implement student status**

Show current state with labels 신청 접수, 교수 배정, 연락 완료, 상담 완료, 종료. Display assigned faculty only after the admin assigns one. Before assignment keep recommendation wording. Empty, loading, error, and unauthenticated states use shared components.

- [ ] **Step 5: Verify and commit student UI**

Run: `pnpm vitest run tests/unit/components/CounselingForm.test.ts && pnpm nuxi typecheck`

Expected: consent, 200-character limit, retry preservation, and copy tests pass.

```bash
git add app/components/counseling app/pages/counseling.vue app/pages/result/[publicId].vue tests/unit/components/CounselingForm.test.ts
git commit -m "feat: add counseling application experience"
```

### Task 4: Administrator queue, assignment, transition, and transfer summary

**Files:**
- Create: `server/api/admin/counseling/index.get.ts`
- Create: `server/api/admin/counseling/[id]/assign.post.ts`
- Create: `server/api/admin/counseling/[id]/transition.post.ts`
- Create: `server/api/admin/counseling/[id]/reveal-phone.post.ts`
- Create: `server/api/admin/counseling/[id]/summary.get.ts`
- Create: `app/pages/admin/counseling.vue`
- Create: `app/components/admin/CounselingQueue.vue`
- Create: `tests/integration/counseling/admin.test.ts`

**Interfaces:**
- Produces: filtered cursor queue; optimistic transition API; recent-MFA phone reveal; copyable professor summary
- Consumes: `requireAdmin`, phone decryption, state RPC

- [ ] **Step 1: Write failing admin authorization and conflict tests**

```ts
expect((await revealPhone(aal1Admin, id)).status).toBe(403)
expect((await transition(id, { from: 'assigned', to: 'completed', version: 1 })).status).toBe(409)
expect((await transition(id, { from: 'assigned', to: 'contacted', version: 1 })).status).toBe(200)
```

- [ ] **Step 2: Run and verify missing admin routes**

Run: `pnpm vitest run tests/integration/counseling/admin.test.ts`

Expected: FAIL with route-not-found responses.

- [ ] **Step 3: Implement secure administrator operations**

Queue filters status, primary track, campaign, assigned faculty, and date with `(created_at,id)` cursor. Assign validates an active faculty ID, sets status `assigned`, and records audit. Transition sends expected version; stale or invalid transitions return 409 with current row. Phone reveal requires AAL2 within 15 minutes, responds `Cache-Control: private, no-store`, and records `admin_phone_revealed`.

Summary returns plain text containing nickname, revealed phone, school, applicant stage, region, top two tracks, selected work/career, contact method, availability, inquiry, recommended faculty, and assigned faculty. It records an audit event and never writes the summary into logs.

- [ ] **Step 4: Implement the queue UI**

Render filters, cursor pagination, masked phone by default, recommendation roles, explicit assignment select, allowed next-state buttons, stale-version refresh, phone reauthentication dialog, and copy-summary button. Do not include professor login or schedule controls.

- [ ] **Step 5: Verify and commit admin counseling**

Run: `pnpm vitest run tests/integration/counseling/admin.test.ts && pnpm nuxi typecheck`

Expected: authorization, transition, masking, audit, cursor, and summary tests pass.

```bash
git add server/api/admin/counseling app/pages/admin/counseling.vue app/components/admin/CounselingQueue.vue tests/integration/counseling/admin.test.ts
git commit -m "feat: add administrator counseling workflow"
```

### Task 5: S4 end-to-end gate

**Files:**
- Create: `tests/e2e/counseling.spec.ts`

**Interfaces:**
- Consumes: complete student and admin counseling flow
- Produces: browser proof of request → assign → contact → complete

- [ ] **Step 1: Write counseling E2E**

```ts
test('student request becomes a completed assigned counseling case', async ({ page, browser }) => {
  await requestCounselingFromResult(page)
  const admin = await browser.newPage()
  await loginMfaAdmin(admin)
  await admin.goto('/admin/counseling')
  await admin.getByRole('row', { name: /신규/ }).getByLabel('담당 교수').selectOption({ label: '윤태준' })
  await admin.getByRole('button', { name: '배정' }).click()
  await admin.getByRole('button', { name: '연락 완료' }).click()
  await admin.getByRole('button', { name: '상담 완료' }).click()
  await page.reload()
  await expect(page.getByText('상담 완료')).toBeVisible()
  await expect(page.getByText('윤태준')).toBeVisible()
})
```

- [ ] **Step 2: Run S4 quality gate**

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:sql
pnpm playwright test tests/e2e/counseling.spec.ts --project=chromium
```

Expected: all commands exit 0 and student sees the administrator-assigned completed case.

- [ ] **Step 3: Commit S4 coverage**

```bash
git add tests/e2e/counseling.spec.ts
git commit -m "test: verify counseling vertical slice"
```

