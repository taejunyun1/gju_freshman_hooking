# 신규 학생 간단 등록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 명단에 없는 학생이 이름·휴대전화·출신고교·학년을 등록하면 안전하게 현재 입시 주기에 추가되고 바로 설문을 시작할 수 있게 한다.

**Architecture:** 신규 등록은 기존 명단 보호·초기 PIN 파생·학생 세션 방식을 재사용한다. Worker 전용 서비스가 PII와 PIN digest를 만들고, 제한된 Supabase RPC가 현재 주기 확인·rate limit·중복 확인·학생/세션 삽입을 하나의 트랜잭션으로 처리한다. UI는 로그인에서 별도 등록 화면으로 연결되며 PIN은 표시하지 않는다.

**Tech Stack:** Nuxt 4/Vue 3, Nitro server routes, Zod, Vitest, Playwright, Supabase PostgreSQL/pgTAP, Cloudflare Workers Web Crypto.

## Global Constraints

- 현재 입시 주기와 PIN 규칙은 서버·DB가 결정한다. 클라이언트가 cycle ID, 입학연도 또는 PIN을 보낼 수 없다.
- 이름·전화번호·PIN 평문은 Supabase에 저장하거나 API 성공 응답으로 반환하지 않는다.
- 기존 명단, 관리자 명단 작업, 기존 학생 로그인 및 PIN 재발급 흐름을 변경하지 않는다.
- 공개 등록은 DB에서 IP·전화번호·전역 rate limit을 원자적으로 적용한다. 새로운 외부 서비스나 비용은 추가하지 않는다.
- 신규 등록 입력은 기존 `applicantRosterRowSchema`의 이름·전화·출신고교·학년 정규화 및 허용값을 그대로 사용한다.
- self-registration 학생은 이후 CSV 갱신에서 빠져도 유지한다. 같은 전화번호가 CSV에 포함되면 일반 명단 학생으로 전환하고, 이후에는 기존 CSV 비활성화 규칙을 적용한다.

---

### Task 1: 원자적 self-registration 데이터베이스 RPC

**Files:**
- Create: `supabase/migrations/202607220030_student_self_registration.sql`
- Create: `supabase/tests/student_self_registration.test.sql`
- Modify: `supabase/tests/admission_roster_operations.test.sql`

**Interfaces:**
- Consumes: 보호된 `phoneHmac`, `phoneCiphertext`, `phoneIv`, `nameHmac`, `nameCiphertext`, `nameIv`, `passwordDigest`, `passwordKeyVersion`, `ipHmac`, `tokenHash`, `expiresAt`, `schoolName`, `applicantStage`.
- Produces: `register_roster_student_v1(...) -> { kind: 'created', prospectId, expiresAt } | { kind: 'existing' } | { kind: 'rate_limited' } | { kind: 'validation_error' }`.

- [ ] **Step 1: Write failing pgTAP tests**

Create fixtures for one current admission cycle and protected test values. Assert that the RPC creates one non-test active prospect flagged `self_registered`, one bcrypt credential, and one student session; returns `existing` for the same phone without changing the first record; rejects malformed byte lengths and invalid grade; applies bounded global, IP, and phone rate buckets; and exposes execution only to `service_role`. Extend the existing roster apply test so a self-registered student absent from the CSV remains active, then becomes non-self-registered when the CSV includes its phone.

- [ ] **Step 2: Run the DB test to verify it fails**

Run: `corepack pnpm exec supabase test db --local supabase/tests/student_self_registration.test.sql`

Expected: FAIL because `register_roster_student_v1` does not exist.

- [ ] **Step 3: Add the migration**

Add `prospects.is_self_registered boolean not null default false`. Create `public.register_roster_student_v1` as a `security definer` function. It must:

```sql
-- Inputs are protected by the Worker. The database validates their shape only.
-- Never accept p_cycle_id or an administrator id.
select id, year, password_key_version
into v_cycle
from public.admission_cycles
where status = 'current'
for update;

if not public.consume_rate_limit('roster-register-global:' || v_rate_shard, 'roster-register-global', 64, interval '10 minutes')
   or not public.consume_rate_limit(encode(p_ip_hmac, 'hex'), 'roster-register-ip', 8, interval '10 minutes')
   or not public.consume_rate_limit(encode(p_phone_hmac, 'hex'), 'roster-register-phone', 3, interval '24 hours') then
  return jsonb_build_object('kind', 'rate_limited');
end if;
```

Validate all bytea lengths, `p_password_key_version = v_cycle.password_key_version`, `p_expires_at` is in the next 12 hours and applicant stage is one of the existing six stage values. Lock/check the current-cycle phone hash before inserting the protected prospect with `region = 'other'` and `is_self_registered = true`, bcrypt only `p_password_digest`, and insert the opaque student session in the same transaction. Map a unique violation to `{ kind: 'existing' }`. Amend `apply_applicant_roster_v1` to exclude `is_self_registered` students from its missing-row deactivation and to set `is_self_registered = false` for a matching CSV row. Revoke public/anon/authenticated access and grant only `service_role`.

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `corepack pnpm exec supabase db reset --local && corepack pnpm exec supabase test db --local supabase/tests/student_self_registration.test.sql && corepack pnpm exec supabase test db --local supabase/tests/admission_roster_operations.test.sql`

Expected: PASS; the existing admin RPC permission tests include the new RPC permission contract where applicable.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607220030_student_self_registration.sql supabase/tests/student_self_registration.test.sql supabase/tests/admission_roster_operations.test.sql
git commit -m "feat: 2026-07-22 신규 학생 등록 RPC 추가"
```

### Task 2: Worker self-registration service

**Files:**
- Create: `server/modules/identity/student-self-registration.ts`
- Create: `tests/integration/identity/student-self-registration.test.ts`
- Modify: `shared/types/api.ts`

**Interfaces:**
- Consumes: parsed `applicantRosterRowSchema` fields and `RosterIdentityRequestContext`.
- Produces: `createStudentSelfRegistrationService(...).registerStudent(input, context)` returning either `{ kind: 'created', sessionToken, expiresAt }`, `{ kind: 'existing' }`, or `{ kind: 'rate_limited' }`.

- [ ] **Step 1: Write failing service tests**

Test that valid input calls exactly one registration RPC with hex/bytea protection values, the current cycle year is read only through `list_admission_cycles_v1`, and the RPC arguments contain no plaintext name, plaintext phone, or initial PIN. Test that a created result returns an opaque session token but never the PIN or prospect ID; an existing or rate-limited result creates no browser session; and invalid RPC payloads fail closed.

- [ ] **Step 2: Run the service test to verify it fails**

Run: `pnpm test -- tests/integration/identity/student-self-registration.test.ts`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the service and secure schemas**

Use `ApplicantRosterRow` directly from `shared/schemas/admission-roster`; do not duplicate its validation or introduce a schema import cycle through `shared/schemas/identity.ts`. Update the unused registration API types so they never describe an `initialPassword` response. In `student-self-registration.ts`, resolve exactly one current cycle through `list_admission_cycles_v1`, call `protectPhone`, `protectApplicantName`, `deriveInitialPassword({ admissionYear: cycle.year, phone })`, `derivePasswordDigest`, and `createSessionToken`. Call `register_roster_student_v1` with only protected values, password key version, IP HMAC, token hash, and 12-hour expiry. Use registration metrics best-effort: `registration_started` before the RPC and `registration_completed` only after a created result.

- [ ] **Step 4: Run the service test to verify it passes**

Run: `pnpm test -- tests/integration/identity/student-self-registration.test.ts tests/integration/identity/roster-login.test.ts`

Expected: PASS; existing login tests remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add server/modules/identity/student-self-registration.ts shared/types/api.ts tests/integration/identity/student-self-registration.test.ts
git commit -m "feat: 2026-07-22 신규 학생 등록 서비스 추가"
```

### Task 3: POST 등록 API와 요청 보안

**Files:**
- Create: `server/api/student/register.post.ts`
- Create: `tests/integration/identity/student-self-registration-api.test.ts`
- Modify: `server/middleware/20-student-request-security.ts`
- Modify: `tests/integration/student-request-security.test.ts`

**Interfaces:**
- Consumes: `POST /api/student/register` body `{ name, phone, highSchool, grade }` and anonymous request context.
- Produces: `ApiSuccess<{ kind: 'created', expiresAt } | { kind: 'existing' | 'rate_limited' }>`; session cookie only for `created`.

- [ ] **Step 1: Write failing route and middleware tests**

Test valid create sets `photo_next_session` with the existing secure cookie options and response JSON has no `password`, `pin`, `name`, `phone`, `prospectId`, HMAC, or ciphertext key. Test an existing number and rate limit return a normal safe result with no cookie. Test invalid JSON receives `VALIDATION_FAILED`. Test cross-origin mutation requests to `/api/student/register` receive 403, while same-origin registration does not require a pre-existing session CSRF token.

- [ ] **Step 2: Run the API tests to verify they fail**

Run: `pnpm test -- tests/integration/identity/student-self-registration-api.test.ts tests/integration/student-request-security.test.ts`

Expected: FAIL because the route and its origin-protection entry do not exist.

- [ ] **Step 3: Implement the route**

Mirror `server/api/student/login.post.ts`: derive the anonymous ID, trusted IP, and request ID; parse `applicantRosterRowSchema`; call `getServerStudentSelfRegistrationService`; set `studentSessionCookie` only for `created`; return generic existing/rate-limited states; convert malformed input to `VALIDATION_FAILED`; and map unavailable stores to the existing generic internal failure. Add `/api/student/register` to origin validation but not to the session-CSRF list because a new visitor has no session.

- [ ] **Step 4: Run the API tests to verify they pass**

Run: `pnpm test -- tests/integration/identity/student-self-registration-api.test.ts tests/integration/student-request-security.test.ts tests/integration/security/request-body-bounds.test.ts`

Expected: PASS, including existing body-size protections.

- [ ] **Step 5: Commit**

```bash
git add server/api/student/register.post.ts server/middleware/20-student-request-security.ts tests/integration/identity/student-self-registration-api.test.ts tests/integration/student-request-security.test.ts
git commit -m "feat: 2026-07-22 신규 학생 등록 API 추가"
```

### Task 4: 로그인 연결과 간단 등록 화면

**Files:**
- Create: `app/pages/register.vue`
- Modify: `app/pages/login.vue`
- Modify: `tests/unit/pages/StudentAccountPages.test.ts`

**Interfaces:**
- Consumes: `POST /api/student/register` safe result and existing `formatStudentPhoneInput`, `studentPhoneDigits` utilities.
- Produces: a newly registered, signed-in visitor at `/assessment`; an existing-number visitor sees a login link.

- [ ] **Step 1: Write failing page tests**

Add tests asserting login links to `/register`; registration has four required controls named `name`, `phone`, `highSchool`, and `grade`; the phone control uses numeric tel input and inserts hyphens; submission calls `/api/student/register` with digits-only phone; successful creation navigates to `/assessment`; and neither SSR nor client text contains an initial PIN value. Assert the visible notice says `PIN은 자동 생성되며, 다음 로그인부터 사용합니다.`.

- [ ] **Step 2: Run the page test to verify it fails**

Run: `pnpm test -- tests/unit/pages/StudentAccountPages.test.ts`

Expected: FAIL because `/register` and the login link do not exist.

- [ ] **Step 3: Implement the page**

Follow the existing account-page panel, blue palette, rounded controls, responsive layout, phone paste/caret handling, and SSR-disabled fieldset pattern. Add a modest secondary login-page link, not a competing primary action. The register page should describe the four fields, display the automatic-PIN notice, submit once, navigate immediately on `created`, and show a clear `이미 등록된 번호입니다. 로그인으로 이동해 주세요.` state with a `/login` link for `existing`. A rate-limit or service failure must only show retry guidance.

- [ ] **Step 4: Run the page tests to verify they pass**

Run: `pnpm test -- tests/unit/pages/StudentAccountPages.test.ts && pnpm lint && pnpm typecheck`

Expected: PASS with no new lint or type errors.

- [ ] **Step 5: Commit**

```bash
git add app/pages/login.vue app/pages/register.vue tests/unit/pages/StudentAccountPages.test.ts
git commit -m "feat: 2026-07-22 신규 학생 간단 등록 화면 추가"
```

### Task 5: 브라우저 흐름 및 전체 검증

**Files:**
- Create: `tests/e2e/student-self-registration.spec.ts`
- Modify: `tests/e2e/support/student.ts`

**Interfaces:**
- Consumes: local Supabase migration state and student self-registration route.
- Produces: browser-level confirmation that a new student begins the assessment without seeing a PIN.

- [ ] **Step 1: Write failing browser test**

Add an isolated phone number fixture. Visit `/login`, follow the new registration link, fill the four fields, submit, and assert navigation to `/assessment`. Confirm no response body or visible text exposes the generated PIN; return to login after logout and verify the documented numeric initial PIN can authenticate the same fixture.

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `pnpm exec playwright test tests/e2e/student-self-registration.spec.ts`

Expected: FAIL before the integrated registration flow is complete.

- [ ] **Step 3: Add only the support helpers needed for deterministic local execution**

Use the existing local student fixture support. Do not add production-only seed accounts or network mocks; keep the test phone distinct from administrator and static test fixtures.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
corepack pnpm exec supabase db reset --local
corepack pnpm exec supabase test db --local supabase/tests/student_self_registration.test.sql
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm exec playwright test tests/e2e/student-self-registration.spec.ts
```

Expected: every command exits 0.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/student-self-registration.spec.ts tests/e2e/support/student.ts
git commit -m "test: 2026-07-22 신규 학생 등록 흐름 검증"
```
