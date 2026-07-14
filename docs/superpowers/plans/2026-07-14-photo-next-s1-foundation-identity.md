# PHOTO:NEXT S1 Foundation and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Workers에 배포 가능한 Nuxt 앱 셸과 안전한 학생 계정·세션·복구, 관리자 MFA 셸을 완성한다.

**Architecture:** Nuxt UI는 같은 origin의 Nitro API만 호출한다. IdentityModule이 Web Crypto와 Supabase Data API/RPC를 사용하며, PostgreSQL은 전화번호 HMAC unique와 계정 잠금·세션 무효화를 강제한다.

**Tech Stack:** pnpm, Nuxt 4, Vue 3, TypeScript, Pinia, Zod, Supabase, Cloudflare Workers, Vitest, Vue Test Utils, Playwright, pgTAP

## Global Constraints

- 학생 브라우저는 Supabase를 직접 호출하지 않는다.
- 휴대전화는 HMAC-SHA-256과 AES-256-GCM으로 저장하고 원문을 로그·URL·Storage에 쓰지 않는다.
- 비밀번호는 PBKDF2-HMAC-SHA-256 600,000회, salt와 pepper를 사용한다.
- 세션은 256-bit 토큰의 SHA-256 해시만 DB에 저장하며 30분 유휴, 12시간 절대 만료다.
- 신규 비밀번호 형식은 영문 대문자 2자 + `-` + 전화번호 마지막 4자리다.
- 실패 5회는 15분 계정 잠금, IP 10회/5분, 번호 5회/5분, 가입 5회/IP/1시간이다.
- 관리자 Supabase Auth는 TOTP MFA를 요구하고 세션은 최대 8시간이다.
- 모바일 UI는 WCAG 2.2 AA와 44×44px 터치 영역을 만족한다.

---

### Task 1: Nuxt Worker scaffold and design foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `nuxt.config.ts`
- Create: `wrangler.jsonc`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `eslint.config.mjs`
- Create: `README.md`
- Create: `app/app.vue`
- Create: `app/pages/index.vue`
- Create: `server/api/health.get.ts`
- Create: `app/assets/css/tokens.css`
- Create: `app/assets/css/main.css`
- Create: `app/components/common/AppButton.vue`
- Create: `app/components/common/AppState.vue`
- Create: `tests/unit/design-tokens.test.ts`
- Create: `tests/unit/components/AppButton.test.ts`
- Create: `tests/unit/pages/LandingPage.test.ts`
- Create: `tests/integration/health.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `AppButton` props `{ variant: 'primary' | 'secondary' | 'danger'; loading?: boolean }`; CSS tokens `--color-canvas`, `--color-surface`, `--color-ink`, `--color-sequence`, `--color-resource`, `--color-signal`, `--color-error`

- [ ] **Step 1: Scaffold and install the locked toolchain**

Run:

```bash
pnpm dlx nuxi@latest init . --packageManager pnpm --gitInit false
pnpm add @pinia/nuxt @supabase/supabase-js zod
pnpm add -D vitest @vue/test-utils happy-dom @playwright/test @nuxt/eslint eslint typescript vue-tsc supabase wrangler tsx
```

Expected: Nuxt scaffold exists, dependencies install, and `pnpm-lock.yaml` pins resolved versions.

- [ ] **Step 2: Write the failing foundation behavior tests**

```ts
// tests/unit/design-tokens.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('design tokens', () => {
  it('contains the six approved brand colors and semantic error color', () => {
    const css = readFileSync('app/assets/css/tokens.css', 'utf8')
    for (const color of ['#FFFFFF', '#EEF1F6', '#151A22', '#6B43B5', '#2E7773', '#C27628', '#B8423E']) {
      expect(css).toContain(color)
    }
  })
})
```

Also write tests before implementation that mount `AppButton` and assert a native disabled state, `aria-busy="true"` while loading, a minimum 44px token/class contract, and a safe default `type="button"`. Mount the landing page with `NuxtLink` stubbed and assert the main heading, the four-stage order `관심 선택 → 4년 학습경로 → 작품·진로 → 교수 상담`, and the `/start` CTA. Add an integration test for `/api/health` that expects exactly the public keys `ok` and `commit` and verifies that no runtime secret key name or value appears in the serialized response.

- [ ] **Step 3: Run the tests and verify the missing foundation failures**

Run: `pnpm vitest run tests/unit/design-tokens.test.ts tests/unit/components/AppButton.test.ts tests/unit/pages/LandingPage.test.ts tests/integration/health.test.ts`

Expected: FAIL because the design tokens, components, landing page contract, and health handler do not exist yet.

- [ ] **Step 4: Configure Nuxt, Worker output, tokens, and base components**

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  compatibilityDate: '2026-07-14',
  modules: ['@pinia/nuxt'],
  css: ['~/assets/css/tokens.css', '~/assets/css/main.css'],
  runtimeConfig: {
    supabaseSecretKey: '', phoneHmacKey: '', phoneEncryptionKey: '', passwordPepper: '',
    public: { supabaseUrl: '' },
  },
  nitro: { preset: 'cloudflare-module' },
  typescript: { strict: true, typeCheck: true },
})
```

```css
/* app/assets/css/tokens.css */
:root {
  --color-surface: #FFFFFF; --color-canvas: #EEF1F6; --color-ink: #151A22;
  --color-sequence: #6B43B5; --color-resource: #2E7773; --color-signal: #C27628;
  --color-error: #B8423E; --font-display: 'Wanted Sans Variable', sans-serif;
  --font-body: 'Pretendard Variable', sans-serif; --font-mono: 'IBM Plex Mono', monospace;
  --content: 720px; --timeline: 1120px; --admin: 1440px;
}
```

Set `wrangler.jsonc` main to `.output/server/index.mjs`, assets directory to `.output/public`, `nodejs_compat`, and observability enabled. Implement `AppButton` with native `disabled`, `aria-busy`, a visible focus ring, and minimum 44px height. Implement `AppState` variants `loading`, `empty`, `error` with an `aria-live="polite"` message.

Configure Vitest for `tests/unit/**/*.test.ts` in happy-dom and `tests/integration/**/*.test.ts` in node, Playwright base URL `http://127.0.0.1:3000` with Chromium, and Nuxt ESLint flat config from `.nuxt/eslint.config.mjs`. README commands are `pnpm install`, `supabase start`, `supabase db reset`, `pnpm dev`, `pnpm test:unit`, and `pnpm build`; link the design spec and implementation index and state that internal DOCX/PDF and secrets must not be committed.

Implement `/` as a mobile-first PHOTO:NEXT landing page with the copy “하고 싶은 사진·영상 작업이 학과의 수업과 어떻게 이어지는지 확인해보세요”, the four-step explanation 관심 선택 → 4년 학습경로 → 작품·진로 → 교수 상담, and one primary “나의 연결 경로 찾기” link to `/start`. The landing page may mention equipment and facilities only as a short supporting proof that the learning path can be carried out, not as a primary step or hero statistic. Add `/api/health` returning `{ ok: true, commit: runtimeVersion }` without database or secret values.

- [ ] **Step 5: Verify foundation**

Run:

```bash
pnpm vitest run tests/unit/design-tokens.test.ts tests/unit/components/AppButton.test.ts tests/unit/pages/LandingPage.test.ts tests/integration/health.test.ts
pnpm nuxi typecheck
pnpm nuxt build
```

Expected: PASS, type errors 0, `.output/server/index.mjs` exists.

- [ ] **Step 6: Commit foundation**

```bash
git add package.json pnpm-lock.yaml nuxt.config.ts wrangler.jsonc vitest.config.ts playwright.config.ts eslint.config.mjs README.md app server/api/health.get.ts tests/unit/design-tokens.test.ts tests/unit/components/AppButton.test.ts tests/unit/pages/LandingPage.test.ts tests/integration/health.test.ts
git commit -m "chore: scaffold Nuxt Worker application"
```

### Task 2: Identity database and default-deny policies

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202607140001_identity.sql`
- Create: `supabase/tests/identity_rls.test.sql`
- Create: `.env.example`

**Interfaces:**
- Consumes: server-only environment keys from Task 1
- Produces: tables `prospects`, `student_credentials`, `student_sessions`, `credential_recovery_requests`, `admin_users`, `rate_limit_buckets`, `audit_events`, `events`; RPC `consume_rate_limit(text,text,int,interval)`

- [ ] **Step 1: Write the failing pgTAP policy test**

```sql
-- supabase/tests/identity_rls.test.sql
begin;
select plan(4);
select has_table('public', 'prospects');
select has_table('public', 'student_sessions');
select policies_are('public', 'prospects', array[]::text[], 'anon has no prospect policy');
select policies_are('public', 'student_sessions', array[]::text[], 'anon has no session policy');
select * from finish();
rollback;
```

- [ ] **Step 2: Run the SQL test and verify missing tables**

Run: `supabase start && supabase test db`

Expected: FAIL because identity tables do not exist.

- [ ] **Step 3: Create constrained identity tables and rate-limit RPC**

The migration must create `pgcrypto`, lowercase enums, bigint identity PKs, `timestamptz` timestamps, and these non-negotiable constraints:

```sql
create table public.prospects (
  id bigint generated always as identity primary key,
  nickname text not null unique,
  phone_hmac bytea not null unique,
  phone_ciphertext bytea not null,
  phone_iv bytea not null check (octet_length(phone_iv) = 12),
  school_name text not null check (char_length(school_name) between 1 and 40),
  applicant_stage text not null check (applicant_stage in ('high1','high2','high3','graduate','ged','other')),
  region text not null check (region in ('gwangju','jeonbuk','capital','chungcheong','gyeongsang','gangwon_jeju','overseas','other')),
  status text not null default 'active' check (status in ('active','deleted')),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_credentials (
  prospect_id bigint primary key references public.prospects(id) on delete cascade,
  password_hash bytea not null, password_salt bytea not null,
  failed_attempts smallint not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz, password_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_sessions (
  id bigint generated always as identity primary key,
  prospect_id bigint not null references public.prospects(id) on delete cascade,
  token_hash bytea not null, expires_at timestamptz not null,
  idle_expires_at timestamptz not null, last_seen_at timestamptz not null default now(),
  revoked_at timestamptz, created_at timestamptz not null default now()
);
create unique index student_sessions_active_token_idx on public.student_sessions(token_hash) where revoked_at is null;
create index student_sessions_prospect_expiry_idx on public.student_sessions(prospect_id, expires_at) where revoked_at is null;
```

Create `credential_recovery_requests` with identity PK, prospect FK cascade, status check `requested|verified|consumed|expired`, nullable 32-byte `code_hash`, request/verification/expiry timestamps, verifying admin UUID, and an index on `(prospect_id,requested_at desc)`. Create `admin_users` keyed by Supabase Auth UUID with role check `admin`, active flag and timestamps. Create `rate_limit_buckets` with 32-byte HMAC key, route, window start, count, expiry, unique `(key_hash,route,window_started_at)`, and expiry index. Create `audit_events` with admin UUID, action, target type/ID, sanitized metadata, request ID and timestamp; index `(admin_user_id,created_at desc)` and `(action,created_at desc)`.

`consume_rate_limit` performs one `insert ... on conflict ... do update` and returns whether the count is at or under the limit. Set `search_path = ''`, revoke execute from public, grant only the server database role. Enable RLS on every table and create no anon/authenticated policies.

Create `events` with optional prospect ID `on delete set null`, anonymous UUID, nullable campaign ID, allow-listed event name, path, sanitized properties JSON, and `created_at`; index `(event_name,created_at desc)` and `(campaign_id,created_at desc)`. The server inserts events, while browser roles have no table policy.

- [ ] **Step 4: Add environment contract**

```dotenv
# .env.example
NUXT_PUBLIC_SUPABASE_URL=
NUXT_SUPABASE_SECRET_KEY=
NUXT_PHONE_HMAC_KEY=
NUXT_PHONE_ENCRYPTION_KEY=
NUXT_PASSWORD_PEPPER=
```

- [ ] **Step 5: Reset and verify database**

Run:

```bash
supabase db reset
supabase test db
```

Expected: schema applies and all 4 pgTAP assertions pass.

- [ ] **Step 6: Commit database foundation**

```bash
git add .env.example supabase/config.toml supabase/migrations/202607140001_identity.sql supabase/tests/identity_rls.test.sql
git commit -m "feat: add identity database foundation"
```

### Task 3: Phone, password, nickname, and session domain

**Files:**
- Create: `server/utils/web-crypto.ts`
- Create: `server/modules/identity/phone.ts`
- Create: `server/modules/identity/password.ts`
- Create: `server/modules/identity/nickname.ts`
- Create: `server/modules/identity/nickname-words.ts`
- Create: `server/modules/identity/session.ts`
- Create: `tests/unit/identity/phone.test.ts`
- Create: `tests/unit/identity/password.test.ts`
- Create: `tests/unit/identity/nickname.test.ts`
- Create: `tests/unit/identity/session.test.ts`

**Interfaces:**
- Produces: `normalizeKoreanPhone`, `protectPhone`, `revealPhone`, `hashPassword`, `verifyPassword`, `generateInitialPassword`, `generateNickname`, `createSessionToken`
- Consumes: raw secret bytes obtained from Nuxt runtime config only in API composition code

- [ ] **Step 1: Write failing deterministic domain tests**

```ts
expect(normalizeKoreanPhone('010-1234-5678')).toBe('01012345678')
expect(() => normalizeKoreanPhone('02-123-4567')).toThrowError('PHONE_INVALID')
expect(generateInitialPassword('01012345678', new Uint8Array([0, 25]))).toBe('AZ-5678')
expect(await verifyPassword('AB-5678', await hashPassword('AB-5678', salt, pepper), pepper)).toBe(true)
expect((await createSessionToken()).raw).toMatch(/^[A-Za-z0-9_-]{43}$/)
```

Add a nickname test with an injected byte source that first collides and then returns `고요한프레임27`.

- [ ] **Step 2: Run and verify missing exports**

Run: `pnpm vitest run tests/unit/identity`

Expected: FAIL with module-not-found or missing export errors.

- [ ] **Step 3: Implement Web Crypto primitives**

```ts
export async function hashPassword(password: string, salt: Uint8Array, pepper: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const mixedSalt = new Uint8Array([...salt, ...pepper])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: mixedSalt, iterations: 600_000 }, key, 256)
  return { hash: new Uint8Array(bits), salt }
}
```

Implement HMAC-SHA-256 with `crypto.subtle.sign`, AES-GCM with a fresh 12-byte IV, constant-time byte comparison, and 32-byte session tokens encoded as base64url. `normalizeKoreanPhone` accepts only `010` plus eight digits after removing spaces and hyphens. Nicknames use an injected uniqueness callback and at most 20 attempts.

Decode all crypto secrets from base64url once at server startup and reject HMAC, encryption, or pepper keys shorter than 32 bytes. Use adjective words `선명한, 고요한, 따뜻한, 빛나는, 깊은, 자유로운, 새로운, 다정한, 반짝이는, 섬세한` and photo/video nouns `프레임, 렌즈, 장면, 필름, 셔터, 포커스, 시퀀스, 컷, 이미지, 빛`; append a zero-padded number 00–99.

- [ ] **Step 4: Run identity unit tests**

Run: `pnpm vitest run tests/unit/identity`

Expected: all phone, password, nickname, session tests pass.

- [ ] **Step 5: Commit identity domain**

```bash
git add server/utils/web-crypto.ts server/modules/identity tests/unit/identity
git commit -m "feat: add student identity cryptography"
```

### Task 4: Registration, login, session middleware, and student pages

**Files:**
- Create: `shared/schemas/identity.ts`
- Create: `shared/types/api.ts`
- Create: `server/utils/supabase.ts`
- Create: `server/utils/app-error.ts`
- Create: `supabase/migrations/202607140002_identity_service.sql`
- Create: `supabase/tests/identity_service.test.sql`
- Create: `server/modules/identity/service.ts`
- Create: `server/modules/metrics/events.ts`
- Create: `server/middleware/request-context.ts`
- Create: `server/api/student/register.post.ts`
- Create: `server/api/student/login.post.ts`
- Create: `server/api/student/logout.post.ts`
- Create: `server/api/student/session.get.ts`
- Create: `app/stores/student-session.ts`
- Create: `app/pages/start.vue`
- Create: `app/pages/credentials.vue`
- Create: `app/pages/login.vue`
- Create: `tests/integration/identity/register.test.ts`
- Create: `tests/integration/identity/login.test.ts`

**Interfaces:**
- Produces: `registerStudent(input): Promise<RegistrationResult>` and `loginStudent(input): Promise<LoginResult>`
- `RegistrationResult`: `{ kind: 'created'; nickname: string; initialPassword: string } | { kind: 'existing' }`
- `RegistrationInput`: `{ phone: string; schoolName: string; applicantStage: ApplicantStage; region: Region }`
- `LoginInput`: `{ phone: string; password: string }`
- Student cookie name: `photo_next_session`

- [ ] **Step 1: Write failing duplicate and lock integration tests**

```ts
it('returns existing without creating a second prospect', async () => {
  await register({ phone: '01012345678', schoolName: '광주고등학교', applicantStage: 'high3', region: 'gwangju' })
  const second = await register({ phone: '010-1234-5678', schoolName: '다른학교', applicantStage: 'graduate', region: 'capital' })
  expect(second.body.data.kind).toBe('existing')
  expect(await countProspects()).toBe(1)
})

it('locks the account for 15 minutes after five failures', async () => {
  for (let i = 0; i < 5; i++) await login('01012345678', 'WRONG')
  expect((await readCredential()).locked_until).not.toBeNull()
})
```

- [ ] **Step 2: Run and verify API failures**

Run: `pnpm vitest run tests/integration/identity/register.test.ts tests/integration/identity/login.test.ts`

Expected: FAIL because API handlers and service do not exist.

- [ ] **Step 3: Implement server identity composition**

Validate bodies with:

```ts
export const phoneSchema = z.string().transform(normalizeKoreanPhone)
export const applicantStageSchema = z.enum(['high1', 'high2', 'high3', 'graduate', 'ged', 'other'])
export const regionSchema = z.enum(['gwangju', 'jeonbuk', 'capital', 'chungcheong', 'gyeongsang', 'gangwon_jeju', 'overseas', 'other'])
export type ApplicantStage = z.infer<typeof applicantStageSchema>
export type Region = z.infer<typeof regionSchema>
export const registerSchema = z.object({
  phone: phoneSchema,
  schoolName: z.string().trim().min(1).max(40),
  applicantStage: applicantStageSchema,
  region: regionSchema,
})
export const loginSchema = z.object({ phone: phoneSchema, password: z.string().min(7).max(128) })
```

Before implementing the service, write a failing pgTAP contract for a new `register_student` RPC. Add `202607140002_identity_service.sql`: its security-definer RPC receives the already normalized/encrypted phone and credential material, performs the `prospects` and `student_credentials` insert in one transaction, and returns a created-or-existing result without exposing database details. It must use `set search_path = ''`, be executable only by `service_role`, and tolerate a duplicate `phone_hmac` race without creating a second prospect. Do not read or hash plaintext phone/password inside SQL. Run `pnpm exec supabase db reset && pnpm exec supabase test db` to demonstrate the contract failure before the migration and its pass after the migration.

`registerStudent` consumes the IP bucket, checks `phone_hmac`, generates nickname/password, encrypts phone, and inserts prospect+credential through the `register_student` RPC. `loginStudent` returns the same `AUTH_FAILED` response for unknown, wrong, or locked credentials; updates failure count atomically; on success resets failures and inserts a session with 30-minute idle and 12-hour absolute expiry. Set the cookie only in the API handler.

Record `registration_started`, `registration_completed`, `login_succeeded`, and `login_failed` through the server event writer with campaign ID and request ID only; do not include phone, HMAC, nickname, password, IP, or session identifiers in event properties.

Request middleware creates a UUID request ID, sets CSP and no-sniff headers, removes sensitive error data, and attaches no user data to logs. Session GET returns only prospect ID, nickname, and expiry.

- [ ] **Step 4: Implement mobile account pages**

`/start` submits phone, school name, applicant stage, and region. Applicant labels are 고1, 고2, 고3, 고교 졸업생, 검정고시 준비·합격, 기타. Region labels are 광주광역시, 전북, 수도권, 충청권, 경상권, 강원·제주, 해외, 기타. Existing users go to `/login`; new users go to `/credentials`. `/credentials` obtains the created nickname and password from an in-memory Pinia store, displays them once, never writes them to storage, and replaces history when leaving. `/login` asks for phone and password, uses autocomplete values `tel` and `current-password`, and shows the generic error copy “입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.”

- [ ] **Step 5: Verify integration and component behavior**

Run:

```bash
pnpm vitest run tests/integration/identity
pnpm nuxi typecheck
```

Expected: duplicate registration keeps one row, five failures lock, success emits secure cookie, type errors 0.

- [ ] **Step 6: Commit account flow**

```bash
git add shared server supabase/migrations/202607140002_identity_service.sql supabase/tests/identity_service.test.sql app/stores/student-session.ts app/pages/start.vue app/pages/credentials.vue app/pages/login.vue tests/integration/identity
git commit -m "feat: add student registration and login"
```

### Task 5: Administrator Auth and secure password recovery

**Files:**
- Create: `server/modules/identity/admin-auth.ts`
- Create: `server/middleware/admin-auth.ts`
- Create: `supabase/migrations/202607140004_recovery_service.sql`
- Create: `supabase/tests/recovery_service.test.sql`
- Create: `server/api/admin/session.get.ts`
- Create: `server/api/student/password/change.post.ts`
- Create: `server/api/student/password/recovery/request.post.ts`
- Create: `server/api/student/password/recovery/complete.post.ts`
- Create: `server/api/admin/recovery/[id]/approve.post.ts`
- Create: `app/pages/password/reset.vue`
- Create: `tests/integration/identity/admin-auth.test.ts`
- Create: `tests/integration/identity/recovery.test.ts`

**Interfaces:**
- Produces: `requireAdmin(event, { recentAuthMinutes?: number }): AdminContext`; recovery states `requested`, `verified`, `consumed`, `expired`; 128-bit one-time code valid 15 minutes
- `AdminContext`: `{ userId: string; role: 'admin'; aal: 'aal2'; authenticatedAt: Date }`
- Consumes: active student session for change and Supabase Auth claims for approval

- [ ] **Step 1: Write failing MFA and recovery security tests**

```ts
it('rejects aal1 sessions', async () => {
  await expect(requireAdmin(eventWithClaims({ aal: 'aal1' }))).rejects.toMatchObject({ statusCode: 403, code: 'MFA_REQUIRED' })
})
it('requires auth within 15 minutes for sensitive actions', async () => {
  await expect(requireAdmin(oldAal2Event, { recentAuthMinutes: 15 })).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
})
it('returns identical request responses for matching and unknown identities', async () => {
  expect(await requestRecovery('01012345678', '빛의기록27', 'gwangju')).toEqual(
    await requestRecovery('01099999999', '없는닉네임00', 'capital'),
  )
})

it('revokes every session after recovery', async () => {
  const code = await approveRecoveryAsMfaAdmin(requestId)
  await completeRecovery(code, '새비밀번호-88')
  expect(await activeSessionCount(prospectId)).toBe(0)
})
```

- [ ] **Step 2: Run and verify missing guard and recovery endpoints**

Run: `pnpm vitest run tests/integration/identity/admin-auth.test.ts tests/integration/identity/recovery.test.ts`

Expected: FAIL because `requireAdmin` and recovery endpoints do not exist.

- [ ] **Step 3: Implement Supabase Auth verification and admin allow-list**

Verify the Supabase access token server-side, require `aal2`, check active `admin_users`, and cap `authenticatedAt + 8h`. Never trust a client-supplied role. `recentAuthMinutes` compares the verified authentication timestamp. The middleware protects `/api/admin/**` except session bootstrap.

- [ ] **Step 4: Implement change and recovery transaction**

Before implementing the endpoint, write a failing pgTAP contract and add `202607140004_recovery_service.sql`. Its `complete_credential_recovery` security-definer RPC receives only a recovery code hash and already-derived password material, locks the matching request with `select ... for update`, rejects used/expired/unverified requests, updates the credential, marks the request consumed, and revokes every active session in one transaction. It must use `set search_path = ''` and be executable only by `service_role`. Run `pnpm exec supabase db reset && pnpm exec supabase test db` before and after this migration.

The authenticated change endpoint verifies the current password, hashes the new password, updates the credential, and revokes other sessions. The anonymous request endpoint always returns HTTP 202 with `{ accepted: true }`. Admin approval generates 16 random bytes, stores only SHA-256, returns raw code once, and records an audit event. Complete consumes the code through `complete_credential_recovery`; it rejects used/expired codes, updates the password, marks consumed, and revokes all sessions atomically.

- [ ] **Step 5: Implement reset page states**

The page renders `change` when logged in and `request` when logged out. It never claims that a text message was sent. Anonymous success copy is “요청을 접수했습니다. 학과 확인 절차가 필요한 경우 안내받은 연락 방식으로 복구 코드를 전달합니다.”

- [ ] **Step 6: Verify and commit Auth and recovery**

Run: `pnpm vitest run tests/integration/identity/admin-auth.test.ts tests/integration/identity/recovery.test.ts && pnpm nuxi typecheck`

Expected: AAL1 rejected, stale sensitive auth rejected, recovery tests pass, type errors 0.

```bash
git add server/modules/identity/admin-auth.ts server/middleware/admin-auth.ts server/api/admin/session.get.ts server/api/student/password server/api/admin/recovery supabase/migrations/202607140004_recovery_service.sql supabase/tests/recovery_service.test.sql app/pages/password/reset.vue tests/integration/identity/admin-auth.test.ts tests/integration/identity/recovery.test.ts
git commit -m "feat: add administrator auth and recovery"
```

### Task 6: Administrator shell and recovery queue

**Files:**
- Create: `server/api/admin/recovery/index.get.ts`
- Create: `app/middleware/admin.ts`
- Create: `app/layouts/admin.vue`
- Create: `app/pages/admin/login.vue`
- Create: `app/pages/admin/index.vue`
- Create: `app/pages/admin/recovery.vue`
- Create: `app/components/admin/AdminRecovery.vue`
- Create: `scripts/bootstrap-local-admin.ts`
- Create: `docs/operations/admin-bootstrap.md`
- Create: `tests/unit/components/AdminRecovery.test.ts`

**Interfaces:**
- Produces: administrator login/TOTP shell and pending recovery queue
- Consumes: Task 5 `requireAdmin` and recovery approval API

- [ ] **Step 1: Write failing recovery queue UI test**

```ts
it('reveals a one-time code only after explicit approval', async () => {
  const wrapper = mount(AdminRecovery, { props: { request: pendingRequest } })
  expect(wrapper.text()).not.toContain('복구 코드:')
  await wrapper.get('button[data-action="approve"]').trigger('click')
  expect(wrapper.emitted('approve')).toHaveLength(1)
})
```

- [ ] **Step 2: Run and verify missing shell components**

Run: `pnpm vitest run tests/unit/components/AdminRecovery.test.ts`

Expected: FAIL because the administrator recovery component does not exist.

- [ ] **Step 3: Implement admin login and layout**

Login performs email/password then TOTP challenge through Supabase Auth. The admin layout shows navigation and session expiry. The empty dashboard uses `AppState` and does not fabricate metrics.

- [ ] **Step 4: Implement recovery queue**

List only pending nonexpired recovery requests with masked phone, nickname, region, request age, and verification state. Approval requires explicit confirmation and recent AAL2, displays the raw one-time code once, offers a copy button, then removes it from component state after 60 seconds. Record approval and copy actions in audit events; never place the code in a URL or log.

`bootstrap-local-admin.ts` creates only the documented local test email from environment input, enrolls a deterministic test TOTP fixture, and upserts its Auth UUID into `admin_users`; it aborts unless the Supabase URL is localhost. The runbook directs a production operator to create the real Auth user in Supabase Dashboard, enroll TOTP on first login, copy only the Auth UUID into `admin_users`, and disable public admin signup. No password or TOTP secret is written to the repository.

- [ ] **Step 5: Verify and commit admin shell**

Run: `pnpm vitest run tests/unit/components/AdminRecovery.test.ts && pnpm nuxi typecheck`

Expected: hidden-before-approval, explicit approval, timed clear, and type checks pass.

```bash
git add server/api/admin/recovery/index.get.ts app/middleware/admin.ts app/layouts/admin.vue app/pages/admin app/components/admin/AdminRecovery.vue scripts/bootstrap-local-admin.ts docs/operations/admin-bootstrap.md tests/unit/components/AdminRecovery.test.ts
git commit -m "feat: add administrator recovery shell"
```

### Task 7: S1 end-to-end and Worker preview gate

**Files:**
- Create: `tests/e2e/identity.spec.ts`
- Create: `scripts/verify-env.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: complete S1 student and admin flows
- Produces: repeatable local and Cloudflare preview verification commands

- [ ] **Step 1: Write the failing identity E2E**

```ts
test('new student can register, save credentials, log in, and log out', async ({ page }) => {
  await page.goto('/start')
  await page.getByLabel('휴대전화 번호').fill('01012345678')
  await page.getByLabel('학교명').fill('광주고등학교')
  await page.getByLabel('현재 상태').selectOption('high3')
  await page.getByLabel('지역').selectOption('gwangju')
  await page.getByRole('button', { name: '시작하기' }).click()
  await expect(page).toHaveURL('/credentials')
  const nickname = await page.getByTestId('nickname').textContent()
  const password = await page.getByTestId('initial-password').textContent()
  await page.getByRole('link', { name: '로그인' }).click()
  await page.getByLabel('휴대전화 번호').fill('01012345678')
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByText(`${nickname}님`)).toBeVisible()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page).toHaveURL('/login')
})
```

- [ ] **Step 2: Run the completed identity E2E**

Run: `pnpm playwright test tests/e2e/identity.spec.ts --project=chromium`

Expected: PASS with registration, one-time credentials, phone login, authenticated greeting, and logout.

- [ ] **Step 3: Add environment verifier**

`scripts/verify-env.mjs` must exit nonzero when any required variable is absent, reject a PostgreSQL URI in Worker variables, and print variable names only. Add scripts `lint`, `typecheck`, `test:unit`, `test:integration`, `test:sql`, `test:e2e`, `build`, and `deploy:preview` to `package.json`.

- [ ] **Step 4: Run the S1 gate and preview**

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:sql
pnpm test:e2e --project=chromium
pnpm build
pnpm wrangler deploy --env staging --dry-run
```

Expected: all commands exit 0; dry run lists Worker bundle and assets without publishing.

- [ ] **Step 5: Commit S1 verification**

```bash
git add tests/e2e/identity.spec.ts scripts/verify-env.mjs package.json
git commit -m "test: verify identity vertical slice"
```
