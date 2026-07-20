# Student PIN Self-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give roster students a predictable six-digit initial PIN, a signed-in PIN-change flow, and a destructive reset-and-restart flow that preserves counseling requests.

**Architecture:** The Worker continues to convert every PIN into an HMAC digest before Supabase receives it, and PostgreSQL continues to bcrypt that digest. A focused student-PIN service creates a replacement opaque session for both successful PIN changes and reset-and-restart operations. Two `security definer` RPCs own the transactional database mutations: one changes a known PIN, and one resets a roster student's PIN while deleting only interest/assessment history.

**Tech Stack:** Nuxt 4/Vue 3, TypeScript, Zod, Vitest, Supabase PostgreSQL + pgTAP, Cloudflare Workers.

## Global Constraints

- The initial PIN is exactly `YY` + the normalized Korean phone number's last four digits; 2026 and `010-4225-9442` produces `269442`.
- PINs are exactly six ASCII digits; no new SMS, MFA, email, OpenAI call, database, queue, or third-party service is introduced.
- Plaintext PINs must never be persisted, logged, returned by student APIs, or sent to PostgreSQL; Worker HMAC preprocessing plus PostgreSQL bcrypt remains mandatory.
- The PIN reset route deletes assessment/interest/result/narrative data only. It preserves roster identity, counseling requests, counseling status, and every counseling request's content.
- The reset route is same-origin only; changing a PIN additionally requires the current session-bound CSRF token.
- The service is designed for one yearly admission cohort of about 200 students and must keep normal login and assessment request counts unchanged.
- Existing legacy `ddddAA` credentials remain log-in compatible until reissued/reset; new roster credentials and self-service resets use the six-digit numeric PIN.
- Student-facing copy identifies the service as `광주대학교 사진영상미디어학과 · PHOTO:NEXT`; UI uses the existing blue rounded-panel system and a restrained heading scale.

---

## File Structure

- `shared/schemas/identity.ts` — shared six-digit PIN request schemas.
- `server/modules/identity/roster-credentials.ts` — deterministic initial PIN generation and HMAC digest primitive.
- `server/modules/identity/student-pin.ts` — Worker-side, testable orchestration for current-PIN changes and forget/reset operations.
- `server/modules/identity/session.ts` — shared opaque session-token creation used by login and PIN flows.
- `server/modules/admin/applicant-roster.ts` and `server/modules/admin/roster-student-commands.ts` — issue/reissue numeric PINs when the roster is created or administered.
- `server/api/student/pin.post.ts` and `server/api/student/pin/reset.post.ts` — public HTTP handlers that validate, set the secure cookie, and return no PIN.
- `server/middleware/20-student-request-security.ts` — adds CSRF protection to the authenticated PIN-change endpoint.
- `supabase/migrations/202607200029_student_pin_self_service.sql` — transactional RPCs and least-privilege grants.
- `supabase/tests/student_pin_self_service.test.sql` — pgTAP coverage for mutation boundaries and counseling preservation.
- `app/pages/login.vue`, `app/pages/password/reset.vue`, `app/pages/history.vue`, `app/pages/pin.vue` — numeric login, reset confirmation, and signed-in PIN management UI.
- `tests/unit/identity/roster-credentials.test.ts`, `tests/integration/identity/student-pin.test.ts`, `tests/integration/student-request-security.test.ts`, `tests/integration/identity/student-pin-api.test.ts`, and `tests/unit/pages/StudentAccountPages.test.ts` — automated behavior and presentation coverage.

### Task 1: Six-digit PIN primitives and roster issuance

**Files:**
- Modify: `shared/schemas/identity.ts`
- Modify: `server/modules/identity/roster-credentials.ts`
- Modify: `server/modules/admin/applicant-roster.ts`
- Modify: `server/modules/admin/roster-student-commands.ts`
- Modify: `shared/schemas/admission-roster.ts`
- Modify: `tests/unit/identity/roster-credentials.test.ts`
- Modify: `tests/integration/identity/roster-login.test.ts`

**Interfaces:**
- Consumes: `normalizeKoreanPhone(phone: string): string` and `derivePasswordDigest(pin, pepper): Promise<Uint8Array>`.
- Produces: `deriveInitialPassword({ admissionYear: number, phone: string }): string` and `nextPasswordGeneration(currentGeneration: number): number`; new initial values are six-digit PINs, while `rosterPasswordSchema` temporarily accepts `^(?:\\d{6}|\\d{4}[A-Z]{2})$` for existing issued credentials.

- [ ] **Step 1: Write the failing PIN primitive and schema tests**

```ts
it('issues a six-digit PIN from admission year and normalized phone', async () => {
  await expect(deriveInitialPassword({ admissionYear: 2026, phone: '010-4225-9442' }))
    .resolves.toBe('269442')
})

expect(rosterPasswordSchema.safeParse('269442').success).toBe(true)
expect(rosterPasswordSchema.safeParse('9442AB').success).toBe(true)
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `corepack pnpm vitest run --project unit tests/unit/identity/roster-credentials.test.ts tests/integration/identity/roster-login.test.ts`

Expected: FAIL because `admissionYear` is not accepted and the six-digit format is not yet accepted.

- [ ] **Step 3: Implement the smallest numeric-PIN change**

```ts
export type InitialPasswordInput = { admissionYear: number; phone: string }

export const deriveInitialPassword = async ({ admissionYear, phone }: InitialPasswordInput): Promise<string> => {
  if (!Number.isInteger(admissionYear) || admissionYear < 2000 || admissionYear > 9999) {
    throw new Error('ADMISSION_YEAR_INVALID')
  }
  return `${String(admissionYear).slice(-2)}${normalizeKoreanPhone(phone).slice(-4)}`
}

export const rosterPasswordSchema = z.string().regex(/^(?:\d{6}|\d{4}[A-Z]{2})$/u)
```

Replace `findNextPasswordGeneration` with `nextPasswordGeneration(currentGeneration)`, which increments a valid revision without changing the predictable initial PIN. Update roster command inputs to resolve the selected/current cycle's `year` alongside `id`; derive credentials from that year. Keep `passwordGeneration` as a revision counter, but do not vary the predictable initial PIN by generation.

- [ ] **Step 4: Run the focused tests and verify green**

Run: `corepack pnpm vitest run --project unit tests/unit/identity/roster-credentials.test.ts tests/integration/identity/roster-login.test.ts`

Expected: PASS with login RPC arguments containing only bytea digests, never `269442`.

- [ ] **Step 5: Commit the independently verified credential change**

```bash
git add shared/schemas/identity.ts shared/schemas/admission-roster.ts server/modules/identity/roster-credentials.ts server/modules/admin/applicant-roster.ts server/modules/admin/roster-student-commands.ts tests/unit/identity/roster-credentials.test.ts tests/integration/identity/roster-login.test.ts
git commit -m "feat: 2026-07-20 숫자 초기 PIN 발급"
```

### Task 2: Transactional database RPCs for change and destructive reset

**Files:**
- Create: `supabase/migrations/202607200029_student_pin_self_service.sql`
- Create: `supabase/tests/student_pin_self_service.test.sql`
- Modify: `supabase/tests/admission_roster_auth.test.sql`

**Interfaces:**
- Consumes: `change_roster_student_pin_self_v1(bytea,bytea,integer,bytea,bytea,timestamptz)` and `reset_roster_student_pin_and_assessment_v1(bytea,bytea,integer,bytea,timestamptz)` parameterized only with HMAC phone/PIN digests and opaque session-token hashes.
- Produces: JSON `{kind:'authenticated', prospectId:number, expiresAt:string}` or `{kind:'failed'}`; successful calls invalidate old student sessions and write the supplied new session.

- [ ] **Step 1: Write the failing pgTAP contract**

```sql
select isnt(
  pg_catalog.to_regprocedure('public.change_roster_student_pin_self_v1(bytea,bytea,integer,bytea,bytea,timestamptz)'),
  null,
  'signed-in student PIN-change RPC exists'
);

select isnt(
  pg_catalog.to_regprocedure('public.reset_roster_student_pin_and_assessment_v1(bytea,bytea,integer,bytea,timestamptz)'),
  null,
  'forgot-PIN reset RPC exists'
);
```

In the same test fixture, create one current-cycle prospect with an assessment, result/narrative rows, one counseling request linked to that assessment, and one login event. Assert reset deletes the assessment/history rows, leaves the counseling request with `assessment_id is null`, leaves the roster row, replaces the bcrypt credential, revokes old sessions, creates exactly one replacement session, and keeps the login event.

- [ ] **Step 2: Run the database test and verify red**

Run: `corepack pnpm exec supabase db reset --local && corepack pnpm exec supabase test db --local supabase/tests/student_pin_self_service.test.sql`

Expected: FAIL because both self-service RPC procedures do not exist.

- [ ] **Step 3: Add the migration with bounded atomic mutations**

```sql
create function public.change_roster_student_pin_self_v1(
  p_session_token_hash bytea, p_current_digest bytea, p_current_key_version integer,
  p_next_digest bytea, p_next_token_hash bytea, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
-- locate the active current-cycle session FOR UPDATE; bcrypt-verify p_current_digest;
-- bcrypt-replace with p_next_digest; reset failed attempts; revoke every active session;
-- insert p_next_token_hash and return its authenticated JSON envelope.
$$;

create function public.reset_roster_student_pin_and_assessment_v1(
  p_phone_hmac bytea, p_initial_digest bytea, p_current_key_version integer,
  p_next_token_hash bytea, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
-- locate active current-cycle prospect FOR UPDATE; delete assessments for that prospect;
-- delete only assessment/result interest events; never delete counseling_requests;
-- bcrypt-replace the credential, revoke sessions, create p_next_token_hash, and return generic failure when no active roster record exists.
$$;

revoke all on function public.change_roster_student_pin_self_v1(bytea,bytea,integer,bytea,bytea,timestamptz), public.reset_roster_student_pin_and_assessment_v1(bytea,bytea,integer,bytea,bytea,timestamptz) from public, anon, authenticated;
grant execute on function public.change_roster_student_pin_self_v1(bytea,bytea,integer,bytea,bytea,timestamptz), public.reset_roster_student_pin_and_assessment_v1(bytea,bytea,integer,bytea,bytea,timestamptz) to service_role;
```

Use the declared six-argument change and five-argument reset signatures consistently in the migration and tests. Validate every bytea argument is 32 bytes; validate version and expiry window; use `extensions.crypt(encode(digest,'hex'), gen_salt('bf',10))`; return a generic `failed` response for unknown/reset-ineligible phone values.

- [ ] **Step 4: Run the database test and verify green**

Run: `corepack pnpm exec supabase db reset --local && corepack pnpm exec supabase test db --local supabase/tests/student_pin_self_service.test.sql && corepack pnpm exec supabase test db --local supabase/tests/admission_roster_auth.test.sql`

Expected: PASS; no non-service role has RPC execute permission and counseling rows survive reset.

- [ ] **Step 5: Commit the independently verified database contract**

```bash
git add supabase/migrations/202607200029_student_pin_self_service.sql supabase/tests/student_pin_self_service.test.sql supabase/tests/admission_roster_auth.test.sql
git commit -m "feat: 2026-07-20 학생 PIN 초기화 RPC"
```

### Task 3: Worker PIN service, API handlers, and request security

**Files:**
- Create: `server/modules/identity/student-pin.ts`
- Create: `server/api/student/pin.post.ts`
- Create: `server/api/student/pin/reset.post.ts`
- Modify: `server/modules/identity/session.ts`
- Modify: `server/middleware/20-student-request-security.ts`
- Modify: `tests/integration/student-request-security.test.ts`
- Create: `tests/integration/identity/student-pin.test.ts`
- Create: `tests/integration/identity/student-pin-api.test.ts`

**Interfaces:**
- Consumes: `createSessionToken(random)`; `getStudentSession(rawToken)`; `derivePasswordDigest(pin, pepper)`; `derivePhoneHmac(phone, phoneHmacKey)`.
- Produces: `createStudentPinService(...).changePin({sessionToken,currentPin,nextPin})` and `.resetForgottenPin({phone})`, each returning `{sessionToken, expiresAt}` or `null`.

- [ ] **Step 1: Write failing Worker service tests**

```ts
const result = await service.changePin({
  sessionToken: 'current-session', currentPin: '269442', nextPin: '123456',
})
expect(result?.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
expect(rpc).toHaveBeenCalledWith('change_roster_student_pin_self_v1', expect.objectContaining({
  p_current_digest: expect.any(String), p_next_digest: expect.any(String), p_next_token_hash: expect.any(String),
}))
expect(JSON.stringify(rpc.mock.calls)).not.toContain('123456')
```

Also test: no authenticated session returns `null`; reset derives `269442` from current-cycle year and normalized phone; reset calls only the reset RPC; a database error throws `IDENTITY_STORE_UNAVAILABLE`; API handlers never expose either PIN and set a twelve-hour secure, httpOnly cookie only on authentication.

- [ ] **Step 2: Run the focused service/API tests and verify red**

Run: `corepack pnpm vitest run --project integration tests/integration/identity/student-pin.test.ts tests/integration/identity/student-pin-api.test.ts tests/integration/student-request-security.test.ts`

Expected: FAIL because the service, two handlers, and PIN-change CSRF route do not exist.

- [ ] **Step 3: Implement the minimal service and handlers**

```ts
export const createStudentPinService = (dependencies: StudentPinDependencies) => ({
  async changePin(input: { sessionToken: string; currentPin: string; nextPin: string }) {
    const current = await dependencies.sessions.getStudentSession(input.sessionToken)
    if (!current) return null
    return updateWithRpc('change_roster_student_pin_self_v1', {
      p_session_token_hash: await hashBytea(input.sessionToken),
      p_current_digest: await digestBytea(input.currentPin),
      p_current_key_version: dependencies.keyring.currentPassword.version,
      p_next_digest: await digestBytea(input.nextPin),
      ...await nextSessionArguments(),
    })
  },
  async resetForgottenPin(input: { phone: string }) {
    const cycle = await dependencies.currentCycle()
    return updateWithRpc('reset_roster_student_pin_and_assessment_v1', {
      p_phone_hmac: await phoneHmacBytea(input.phone),
      p_initial_digest: await digestBytea(await deriveInitialPassword({ admissionYear: cycle.year, phone: input.phone })),
      p_current_key_version: dependencies.keyring.currentPassword.version,
      ...await nextSessionArguments(),
    })
  },
})
```

Validate handler bodies with shared Zod schemas before calling the service. `POST /api/student/pin` receives `{currentPin,nextPin,nextPinConfirm}` and returns only `{kind:'authenticated', expiresAt}`. `POST /api/student/pin/reset` receives `{phone,deleteInterestHistory:true}` and returns only `{kind:'authenticated', expiresAt}`. Add `/api/student/pin` to `csrfProtectedPaths`; leave reset anonymous but same-origin protected by existing middleware.

- [ ] **Step 4: Run the focused service/API/security tests and verify green**

Run: `corepack pnpm vitest run --project integration tests/integration/identity/student-pin.test.ts tests/integration/identity/student-pin-api.test.ts tests/integration/student-request-security.test.ts`

Expected: PASS, including rejection of a missing or wrong CSRF token for `/api/student/pin` and no CSRF requirement for same-origin reset.

- [ ] **Step 5: Commit the independently verified Worker boundary**

```bash
git add server/modules/identity/session.ts server/modules/identity/student-pin.ts server/api/student/pin.post.ts server/api/student/pin/reset.post.ts server/middleware/20-student-request-security.ts tests/integration/identity/student-pin.test.ts tests/integration/identity/student-pin-api.test.ts tests/integration/student-request-security.test.ts
git commit -m "feat: 2026-07-20 학생 PIN 자가관리 API"
```

### Task 4: Student-facing numeric PIN, change, and reset pages

**Files:**
- Modify: `app/pages/login.vue`
- Modify: `app/pages/password/reset.vue`
- Modify: `app/pages/history.vue`
- Create: `app/pages/pin.vue`
- Modify: `tests/unit/pages/StudentAccountPages.test.ts`

**Interfaces:**
- Consumes: `POST /api/student/login`, `GET /api/student/session`, `POST /api/student/pin`, and `POST /api/student/pin/reset`.
- Produces: `/login` numeric PIN sign-in; `/pin` signed-in PIN management; `/password/reset` destructive history reset followed by assessment restart.

- [ ] **Step 1: Write failing page tests**

```ts
expect(wrapper.get('input[name="password"]').attributes('inputmode')).toBe('numeric')
expect(wrapper.get('input[name="password"]').attributes('pattern')).toBe('\\d{6}')
expect(wrapper.text()).toContain('초기 PIN을 잊으셨나요?')

expect(resetWrapper.text()).toContain('관심사와 결과 기록은 삭제됩니다')
expect(resetWrapper.text()).toContain('상담신청 내용과 처리 상태는 유지됩니다')
expect(pinWrapper.find('input[name="nextPinConfirm"]').exists()).toBe(true)
```

- [ ] **Step 2: Run the page test and verify red**

Run: `corepack pnpm vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts`

Expected: FAIL because login still describes an `임시 비밀번호`, reset redirects to login, and `/pin` does not exist.

- [ ] **Step 3: Implement the compact rounded-panel UI**

```vue
<input
  v-model="form.password"
  name="password"
  type="password"
  inputmode="numeric"
  pattern="\\d{6}"
  minlength="6"
  maxlength="6"
  autocomplete="current-password"
  required
>
<NuxtLink to="/password/reset">초기 PIN을 잊으셨나요?</NuxtLink>
```

On `/pin`, load `/api/student/session` to obtain the memory-only CSRF token, show current/new/confirm six-digit numeric controls, and after success route to `/assessment`. On `/password/reset`, require the phone and an explicit checked confirmation; state clearly that assessment interests/results are deleted, counseling requests remain, and success immediately routes to `/assessment`. Add one small `PIN / ACCOUNT` link to the history masthead. Keep one blue primary action per panel, a thin red destructive notice, 44px-or-larger controls, and no oversized heading.

- [ ] **Step 4: Run the page test and verify green**

Run: `corepack pnpm vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts && corepack pnpm lint -- app/pages/login.vue app/pages/password/reset.vue app/pages/pin.vue app/pages/history.vue`

Expected: PASS; the rendered pages expose numeric keyboard hints, confirmation copy, and no legacy reset redirect.

- [ ] **Step 5: Commit the independently verified student UI**

```bash
git add app/pages/login.vue app/pages/password/reset.vue app/pages/history.vue app/pages/pin.vue tests/unit/pages/StudentAccountPages.test.ts
git commit -m "feat: 2026-07-20 학생 PIN 변경 화면"
```

### Task 5: End-to-end verification, remote migration, and production deployment

**Files:**
- Modify only if a test exposes a verified issue; otherwise no source changes.

**Interfaces:**
- Consumes: all previous task interfaces and the established `scripts/deploy-photo-next-release.mjs` release runner.
- Produces: migrated Supabase database, staged and production Worker deployment, and verified public routes.

- [ ] **Step 1: Run all local checks**

Run: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm build && corepack pnpm exec supabase db reset --local && corepack pnpm exec supabase test db --local`

Expected: each command exits `0`; test failures are fixed before any remote change.

- [ ] **Step 2: Push the reviewed feature branch**

```bash
git status --short
git push origin feature/photo-next-mvp
```

Expected: only known untracked local inspection artifacts remain; tracked source is committed and remote branch points to the current commit.

- [ ] **Step 3: Apply the linked Supabase migration**

Run: `corepack pnpm exec supabase db push --linked --include-all --yes --agent no`

Expected: migration `202607200029_student_pin_self_service.sql` is applied exactly once.

- [ ] **Step 4: Run release preflight and deploy**

Run: `node scripts/deploy-photo-next-release.mjs --check && node scripts/deploy-photo-next-release.mjs --self-check && node scripts/deploy-photo-next-release.mjs`

Expected: staging and production deploy successfully without printing secrets.

- [ ] **Step 5: Smoke-test deployed behavior and record final evidence**

Run: `curl --fail --silent --show-error https://photo-next-mvp.taejunyun.workers.dev/api/health && curl --fail --silent --show-error https://photo-next-mvp.taejunyun.workers.dev/login >/dev/null`

Expected: health returns the newly deployed commit and `/login` returns `200`. Do not print or rotate any admin credential or secret.

## Self-Review

1. **Spec coverage:** Task 1 covers `YY + last4` issuance and six-digit validation; Task 2 covers atomic bcrypt/session changes plus deletion/preservation boundaries; Task 3 covers Worker HMAC, cookie, origin, and CSRF controls; Task 4 covers the user-visible change/reset paths and copy; Task 5 covers local tests, linked migration, deployment, and smoke checks. No requirement is unassigned.
2. **Placeholder scan:** This plan contains no `TBD`, `TODO`, `implement later`, or unbound error-handling placeholders. The migration pseudocode names every mutation boundary and requires exact argument validation.
3. **Type consistency:** The change RPC uses six arguments (current session hash, current digest/version, replacement digest, replacement session hash, expiry); the reset RPC uses five (phone HMAC, initial digest/version, replacement session hash, expiry). The Worker service passes the same names (`p_next_token_hash`, `p_expires_at`) used by the migration and tests. PIN schema fields are consistently `currentPin`, `nextPin`, and `nextPinConfirm`.

## Execution Handoff

The plan is saved at `docs/superpowers/plans/2026-07-20-student-pin-self-service.md`. The user has already selected inline implementation, so execute it in this session with `superpowers:executing-plans` and review after each task.
