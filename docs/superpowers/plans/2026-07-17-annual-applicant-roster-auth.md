# Annual Applicant Roster Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace public student registration and recovery with a once-per-year, administrator-managed applicant roster for about 200 students, while reducing each login or roster mutation to one Supabase RPC and preserving prior-year results.

**Architecture:** Nuxt remains the only browser and Worker application, and Supabase PostgreSQL remains the only database. The Worker normalizes and encrypts PII, HMACs passwords before PostgreSQL, and calls focused `security definer` RPCs; PostgreSQL performs bcrypt cost-10 storage/verification and atomic mutations. Deployment is explicitly staged as expand migration, Worker switch and smoke, then contract migration.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript 6, Zod 4, Supabase/PostgreSQL with pgcrypto and pgTAP, Cloudflare Workers, ExcelJS 4, Vitest 4, Playwright 1.61.

## Global Constraints

- Real operating load is about 200 applicants once per year; upload safety maximum is 500 rows.
- Accepted files are one-sheet visible `.xlsx` or UTF-8 `.csv`, at most 2 MiB; normalized JSON is at most 512 KiB.
- Applicant fields are exactly name, phone, high school and grade. Grade values map to `high1`, `high2`, `high3`, `graduate`, `ged`, `other`.
- Name normalization is NFKC, trim, collapse Unicode whitespace to one ASCII space, reject controls, and allow 1–40 Unicode code points.
- Only the current admission cycle may authenticate. Archived cycles and their assessments/counseling remain readable to administrators.
- Every current cycle starts with exactly five `is_test = true` accounts; tests are excluded from statistics, counseling operations and ordinary exports.
- Student passwords are phone last four digits plus two uppercase letters, for example `4225AB`.
- The Worker sends only a 32-byte password HMAC to PostgreSQL; PostgreSQL stores and verifies a 60-character `$2a$`/`$2b$` bcrypt cost-10 hash.
- Password reissue and phone change search at most 32 later generations for a plaintext different from the current password and fail closed at integer bounds.
- No public registration, student password change, recovery request, recovery code or administrator recovery queue remains.
- Administrator auth is email/password only, without TOTP. The generated administrator password is exactly 10 characters and includes upper, lower, digit and symbol classes.
- Successful login, roster apply, cycle start, individual add/update/status change and password reissue each perform one Worker-to-Supabase mutation RPC.
- No Hyperdrive, D1, KV, queue, cache or additional paid service is introduced.
- Existing unrelated dirty-worktree changes are preserved. Every task stages only its own paths.
- Remote rollout order is `Expand DB → staging Worker → staging smoke → production Worker → production smoke → Contract DB → final smoke`.

---

### Task 1: Finish password-only administrator authentication and reuse middleware context

**Files:**
- Modify: `app/pages/admin/login.vue`
- Modify: `app/utils/admin-supabase.ts`
- Modify: `server/modules/identity/admin-auth.ts`
- Create: `server/utils/admin-context.ts`
- Modify: `server/middleware/10-admin-auth.ts`
- Modify: `server/api/admin/students/index.get.ts`
- Modify: `server/api/admin/students/[id].get.ts`
- Modify: `server/api/admin/students/[id]/reveal-phone.post.ts`
- Modify: `supabase/config.toml`
- Test: `tests/integration/identity/admin-auth.test.ts`
- Test: `tests/integration/request-context.test.ts`
- Test: `tests/unit/admin/AdminSupabase.test.ts`
- Test: `tests/unit/admin/AdminShell.test.ts`

**Interfaces:**
- Consumes: `event.context.admin` written by `server/middleware/10-admin-auth.ts`.
- Produces: `getAdminContext(event): AdminContext` and `requireRecentAdminContext(event, minutes, now?): AdminContext`.

- [ ] **Step 1: Write failing context-reuse and password-only tests**

```ts
it('reuses the middleware administrator without a second auth lookup', async () => {
  const admin = { userId: crypto.randomUUID(), role: 'admin', aal: 'aal1', authenticatedAt: new Date() } as const
  expect(getAdminContext({ context: { admin } })).toEqual(admin)
})

it('requires only a password session at aal1', async () => {
  await expect(requireAdmin({})).resolves.toMatchObject({ aal: 'aal1', role: 'admin' })
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run --project integration tests/integration/identity/admin-auth.test.ts tests/integration/request-context.test.ts && pnpm exec vitest run --project unit tests/unit/admin/AdminSupabase.test.ts tests/unit/admin/AdminShell.test.ts`

Expected: FAIL because `server/utils/admin-context.ts` does not exist and handlers still invoke `getServerRequireAdmin()` twice.

- [ ] **Step 3: Implement the context helper and retain the approved password-only UI**

```ts
export const getAdminContext = (event: unknown): AdminContext => {
  const admin = (event as { context?: { admin?: unknown } }).context?.admin
  if (!isAdminContext(admin)) throw new AppError('ADMIN_REQUIRED')
  return admin
}

export const requireRecentAdminContext = (event: unknown, minutes: number, now = new Date()): AdminContext => {
  const admin = getAdminContext(event)
  const age = now.getTime() - admin.authenticatedAt.getTime()
  if (!Number.isFinite(age) || age < 0 || age > minutes * 60_000) throw new AppError('REAUTH_REQUIRED')
  return admin
}
```

Replace per-handler `getServerRequireAdmin()` dependencies with these helpers. Keep `aal1 | aal2` accepted, `auth.mfa.totp.enroll_enabled = false`, and `auth.mfa.totp.verify_enabled = false`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run --project integration tests/integration/identity/admin-auth.test.ts tests/integration/request-context.test.ts && pnpm exec vitest run --project unit tests/unit/admin/AdminSupabase.test.ts tests/unit/admin/AdminShell.test.ts`

Expected: PASS; protected administrator handlers perform one middleware auth lookup per request.

- [ ] **Step 5: Commit the administrator baseline**

```bash
git add app/pages/admin/login.vue app/utils/admin-supabase.ts server/modules/identity/admin-auth.ts server/utils/admin-context.ts server/middleware/10-admin-auth.ts server/api/admin/students supabase/config.toml tests/integration/identity/admin-auth.test.ts tests/integration/request-context.test.ts tests/unit/admin/AdminSupabase.test.ts tests/unit/admin/AdminShell.test.ts
git commit -m "feat: 2026-07-17 simplify administrator authentication"
```

### Task 2: Add applicant normalization, roster DTOs and credential primitives

**Files:**
- Create: `shared/utils/applicant-normalization.ts`
- Create: `shared/schemas/admission-roster.ts`
- Modify: `shared/schemas/identity.ts`
- Modify: `shared/types/api.ts`
- Create: `server/modules/identity/applicant-name.ts`
- Create: `server/modules/identity/roster-credentials.ts`
- Modify: `server/modules/identity/phone.ts`
- Modify: `nuxt.config.ts`
- Modify: `.env.example`
- Modify: `scripts/verify-env.mjs`
- Test: `tests/unit/identity/applicant-normalization.test.ts`
- Test: `tests/unit/identity/applicant-name.test.ts`
- Test: `tests/unit/identity/roster-credentials.test.ts`
- Test: `tests/unit/scripts/VerifyEnv.test.ts`

**Interfaces:**
- Produces: `normalizeApplicantName`, `normalizeKoreanPhone`, `normalizeApplicantStage`, `protectApplicantName`, `derivePasswordDigest`, `deriveInitialPassword`, `findNextPasswordGeneration`.
- Produces: `AdmissionCycle`, `ApplicantRosterRow`, `RosterPreviewRequest`, `RosterPreviewResult`, `RosterApplyRequest`, `RosterApplyResult`, `RosterCredential` Zod schemas and inferred types.

- [ ] **Step 1: Write failing normalization and credential tests**

```ts
expect(normalizeApplicantName('  윤\u00a0  태준  ')).toBe('윤 태준')
expect(() => normalizeApplicantName('윤\u0000태준')).toThrow('APPLICANT_NAME_INVALID')
expect(normalizeApplicantStage('고3')).toBe('high3')

const issued = await deriveInitialPassword({ cycleId, phone: '01012344225', generation: 1, pepper })
expect(issued).toMatch(/^4225[A-Z]{2}$/u)
const next = await findNextPasswordGeneration({ cycleId, phone: '01012344225', currentGeneration: 1, pepper })
expect(next.password).not.toBe(issued)
expect(next.generation).toBeGreaterThan(1)
```

- [ ] **Step 2: Run the focused unit tests and verify RED**

Run: `pnpm exec vitest run --project unit tests/unit/identity/applicant-normalization.test.ts tests/unit/identity/applicant-name.test.ts tests/unit/identity/roster-credentials.test.ts tests/unit/scripts/VerifyEnv.test.ts`

Expected: FAIL with missing modules and missing environment contracts.

- [ ] **Step 3: Implement exact DTO and crypto contracts**

```ts
export type RosterKeyring = {
  phoneHmacKey: Uint8Array
  nameHmacKey: Uint8Array
  piiEncryptionKey: Uint8Array
  currentPassword: { version: number, pepper: Uint8Array }
  previousPassword?: { version: number, pepper: Uint8Array }
}

export const normalizeApplicantName = (input: string): string => {
  const value = input.normalize('NFKC').trim().replace(/\p{White_Space}+/gu, ' ')
  if ([...value].length < 1 || [...value].length > 40 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error('APPLICANT_NAME_INVALID')
  }
  return value
}
```

Use domain bytes `phone-lookup-v1\0`, `name-compare-v1\0`, `password-verify-v1\0`, and `password-issue-v1\0`. Add required `NUXT_NAME_HMAC_KEY` and positive `NUXT_PASSWORD_PEPPER_VERSION`; previous pepper and version must be both present or both absent and must differ from current. Every secret must decode to exactly 32 bytes.

- [ ] **Step 4: Implement generation safety and six-character login schema**

```ts
export const rosterPasswordSchema = z.string().regex(/^\d{4}[A-Z]{2}$/u)

export const findNextPasswordGeneration = async (input: NextPasswordInput): Promise<IssuedPassword> => {
  if (input.currentGeneration > 2_147_483_615) throw new Error('PASSWORD_GENERATION_EXHAUSTED')
  const current = await deriveInitialPassword({ ...input, generation: input.currentGeneration })
  for (let offset = 1; offset <= 32; offset += 1) {
    const generation = input.currentGeneration + offset
    const password = await deriveInitialPassword({ ...input, generation })
    if (password !== current) return { generation, password }
  }
  throw new Error('PASSWORD_GENERATION_EXHAUSTED')
}
```

- [ ] **Step 5: Run unit tests and typecheck**

Run: `pnpm exec vitest run --project unit tests/unit/identity/applicant-normalization.test.ts tests/unit/identity/applicant-name.test.ts tests/unit/identity/roster-credentials.test.ts tests/unit/scripts/VerifyEnv.test.ts && pnpm typecheck`

Expected: PASS with no PBKDF2 call in the new credential module.

- [ ] **Step 6: Commit the shared contracts**

```bash
git add shared server/modules/identity/applicant-name.ts server/modules/identity/roster-credentials.ts server/modules/identity/phone.ts nuxt.config.ts .env.example scripts/verify-env.mjs tests/unit/identity tests/unit/scripts/VerifyEnv.test.ts
git commit -m "feat: 2026-07-17 add roster credential primitives"
```

### Task 3: Add the expand-only admission-cycle schema

**Files:**
- Create: `supabase/migrations/202607170022_admission_roster_expand.sql`
- Create: `supabase/tests/admission_roster_schema.test.sql`
- Modify: `supabase/seed.sql`

**Interfaces:**
- Produces nullable bridge columns and final constraints used by all v1 roster RPCs.
- Preserves existing PBKDF2 columns, recovery tables, old RPCs and global phone unique until contract rollout.

- [ ] **Step 1: Write failing pgTAP schema tests**

```sql
select has_table('public', 'admission_cycles');
select col_is_null('public', 'prospects', 'admission_cycle_id');
select col_is_null('public', 'student_credentials', 'password_bcrypt');
select lives_ok($$insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
  values (extensions.gen_random_uuid(), 2026, 'archived', 0, 1)$$);
select throws_ok($$insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
  values (extensions.gen_random_uuid(), 2027, 'current', 0, 0)$$, '23514');
```

- [ ] **Step 2: Run reset/test and verify RED**

Run: `pnpm exec supabase db reset --local && pnpm exec supabase test db --local supabase/tests/admission_roster_schema.test.sql`

Expected: FAIL because `admission_cycles` and bridge columns do not exist.

- [ ] **Step 3: Implement the expand migration**

```sql
create table public.admission_cycles (
  id uuid primary key,
  year integer not null unique check (year between 2020 and 2200),
  status text not null check (status in ('current', 'archived')),
  roster_version integer not null default 0 check (roster_version >= 0),
  password_key_version integer not null check (password_key_version > 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  archived_at timestamptz
);
create unique index admission_cycles_one_current_idx on public.admission_cycles ((status)) where status = 'current';

alter table public.prospects
  add column admission_cycle_id uuid references public.admission_cycles(id),
  add column name_hmac bytea check (name_hmac is null or octet_length(name_hmac) = 32),
  add column name_ciphertext bytea check (name_ciphertext is null or octet_length(name_ciphertext) >= 16),
  add column name_iv bytea check (name_iv is null or octet_length(name_iv) = 12),
  add column is_test boolean not null default false;

alter table public.student_credentials
  add column password_bcrypt text check (
    password_bcrypt is null or password_bcrypt ~ '^\$2[ab]\$10\$[./A-Za-z0-9]{53}$'
  ),
  add column password_generation integer check (password_generation is null or password_generation between 1 and 2147483647);
```

Backfill every existing prospect into one archived legacy cycle and revoke existing sessions. Extend `prospects.status` to `active|inactive|deleted`. Do not create a current cycle or secret-dependent test credential in SQL.

- [ ] **Step 4: Run all pgTAP tests**

Run: `pnpm exec supabase db reset --local && pnpm exec supabase test db --local`

Expected: PASS, including all pre-existing FK tests and the new bridge schema tests.

- [ ] **Step 5: Commit only expand artifacts**

```bash
git add supabase/migrations/202607170022_admission_roster_expand.sql supabase/tests/admission_roster_schema.test.sql supabase/seed.sql
git commit -m "feat: 2026-07-17 expand annual applicant schema"
```

### Task 4: Add atomic cycle, roster and individual-student PostgreSQL RPCs

**Files:**
- Create: `supabase/migrations/202607170023_admission_roster_rpcs.sql`
- Create: `supabase/tests/admission_roster_operations.test.sql`
- Create: `supabase/tests/admission_roster_concurrency.test.sql`

**Interfaces:**
- Produces: `start_admission_cycle_v1`, `list_admission_cycles_v1`, `preview_applicant_roster_v1`, `apply_applicant_roster_v1`, `list_roster_students_v1`, `read_roster_student_v1`, `read_current_roster_credentials_v1`, `add_roster_student_v1`, `update_roster_student_profile_v1`, `change_roster_student_phone_v1`, `set_roster_student_status_v1`, `reissue_roster_student_password_v1`.

- [ ] **Step 1: Write failing pgTAP operation and concurrency tests**

Test exact behaviors: one current cycle; five tests; read-only preview; 500-row maximum; same-cycle phone conflict; other-cycle phone allowance after contract fixture; whole-batch rollback; roster version CAS; same key/same digest replay; same key/different digest conflict; dblink concurrent replay; all session revocation; bcrypt format/cost; no raw digest storage.

```sql
select function_returns('public', 'apply_applicant_roster_v1', array['uuid','integer','uuid','bytea','uuid','jsonb'], 'jsonb');
select is((public.preview_applicant_roster_v1(v_cycle, v_rows)->>'rosterVersion')::integer, 0);
select is((select count(*) from public.prospects where is_test), 5::bigint);
```

- [ ] **Step 2: Run the new pgTAP tests and verify RED**

Run: `pnpm exec supabase test db --local supabase/tests/admission_roster_operations.test.sql supabase/tests/admission_roster_concurrency.test.sql`

Expected: FAIL because v1 RPCs do not exist.

- [ ] **Step 3: Implement RPC validation and grants**

Every function must use:

```sql
language plpgsql
security definer
set search_path = ''
```

Revoke from `public`, `anon`, and `authenticated`; grant only to `service_role`. Validate byte lengths before mutations. `apply_applicant_roster_v1` sets `statement_timeout = '60s'`, takes `pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0))`, reads an existing audit before locking the cycle, and inserts audit metadata with digest hex and before/after versions.

- [ ] **Step 4: Implement bcrypt and compare-and-swap mutations**

```sql
extensions.crypt(pg_catalog.encode(v_password_digest, 'hex'), extensions.gen_salt('bf', 10))
```

The add/apply/change-phone/reissue functions receive only a 32-byte digest. Phone change and reissue require `p_expected_generation` and store `p_next_generation`; stale generation returns a structured conflict without changing rows. Deactivate/archive revokes every non-revoked session.

Every roster-created prospect stores `region = 'other'` to satisfy the existing non-null column without exposing region as an applicant field. A test-account phone HMAC that conflicts with the bridge-era global unique aborts the whole cycle start so the Worker can generate a new synthetic set.

- [ ] **Step 5: Run operation, concurrency and full pgTAP suites**

Run: `pnpm exec supabase test db --local supabase/tests/admission_roster_operations.test.sql supabase/tests/admission_roster_concurrency.test.sql && pnpm exec supabase test db --local`

Expected: PASS; concurrent same-key calls both return the same success payload.

- [ ] **Step 6: Commit RPCs separately from contract cleanup**

```bash
git add supabase/migrations/202607170023_admission_roster_rpcs.sql supabase/tests/admission_roster_operations.test.sql supabase/tests/admission_roster_concurrency.test.sql
git commit -m "feat: 2026-07-17 add atomic applicant roster operations"
```

### Task 5: Add roster server services, routes and exact request bounds

**Files:**
- Create: `server/modules/admin/applicant-roster.ts`
- Create: `server/modules/admin/roster-student-commands.ts`
- Create: `server/api/admin/admission-cycles/index.get.ts`
- Create: `server/api/admin/admission-cycles/start.post.ts`
- Create: `server/api/admin/students/roster/preview.post.ts`
- Create: `server/api/admin/students/roster/apply.post.ts`
- Create: `server/api/admin/students/credentials.get.ts`
- Modify: `cloudflare/request-body-guard.mjs`
- Modify: `cloudflare/request-body-guard.d.mts`
- Modify: `server/utils/bounded-request-body.ts`
- Modify: `shared/types/api.ts`
- Modify: `server/utils/app-error.ts`
- Test: `tests/integration/admin/roster.test.ts`
- Test: `tests/integration/security/request-body-bounds.test.ts`

**Interfaces:**
- Consumes Task 2 keyring/DTOs and Task 4 RPCs.
- Produces HTTP endpoints for cycle list/start, preview/apply and current credentials.

- [ ] **Step 1: Write failing route and body-bound tests**

```ts
const forwardedBody = async (path: string, bytes: number) => {
  const received: Array<{ bytes: number, overflow: string | null }> = []
  const worker = createBodyGuardWorker({
    async fetch(request: Request) {
      received.push({
        bytes: (await request.arrayBuffer()).byteLength,
        overflow: request.headers.get('x-photo-next-body-overflow'),
      })
      return new Response('ok')
    },
  })
  await worker.fetch(new Request(`https://photo-next.example${path}`, {
    body: new Uint8Array(bytes), method: 'POST', duplex: 'half',
  } as RequestInit), {}, {})
  return received[0]
}

it.each(['/api/admin/students/roster/preview', '/api/admin/students/roster/apply'])(
  'accepts exactly 512 KiB and rejects 512 KiB plus one on %s', async (path) => {
    expect(await forwardedBody(path, 512 * 1024)).toEqual({ bytes: 512 * 1024, overflow: null })
    expect(await forwardedBody(path, 512 * 1024 + 1)).toEqual({ bytes: 2, overflow: '1' })
  },
)

expect(rpc).toHaveBeenCalledTimes(1)
expect(rpc).toHaveBeenCalledWith('apply_applicant_roster_v1', expect.objectContaining({ p_expected_version: 4 }))
```

- [ ] **Step 2: Run integration tests and verify RED**

Run: `pnpm exec vitest run --project integration tests/integration/admin/roster.test.ts tests/integration/security/request-body-bounds.test.ts`

Expected: FAIL because routes and both guard overrides are missing.

- [ ] **Step 3: Implement focused handlers**

```ts
const body = rosterApplyRequestSchema.parse(JSON.parse(
  await readBoundedRequestBody(event, RESOURCE_IMPORT_MAX_REQUEST_BODY_BYTES) ?? '',
))
const admin = requireRecentAdminContext(event, 15)
return { data: await roster.apply(body, { adminUserId: admin.userId, requestId }), requestId }
```

The service canonicalizes normalized rows, hashes `cycleId + expectedVersion + rows` for `requestDigest`, encrypts PII, derives only new credentials, and performs exactly one RPC per command. Current credentials read performs one read-only RPC and reconstructs plaintext in Worker memory only.

- [ ] **Step 4: Add only the two 512-KiB outer overrides**

```js
requestBodyLimitOverrides.set('/api/admin/students/roster/preview', RESOURCE_IMPORT_MAX_REQUEST_BODY_BYTES)
requestBodyLimitOverrides.set('/api/admin/students/roster/apply', RESOURCE_IMPORT_MAX_REQUEST_BODY_BYTES)
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run --project integration tests/integration/admin/roster.test.ts tests/integration/security/request-body-bounds.test.ts && pnpm typecheck`

Expected: PASS; unrelated APIs retain 8-KiB inner and 64-KiB outer defaults.

- [ ] **Step 6: Commit server roster APIs**

```bash
git add server/modules/admin server/api/admin/admission-cycles server/api/admin/students cloudflare shared/types/api.ts server/utils tests/integration/admin/roster.test.ts tests/integration/security/request-body-bounds.test.ts
git commit -m "feat: 2026-07-17 add roster administration APIs"
```

### Task 6: Add safe CSV/XLSX parsing and credential workbooks

**Files:**
- Create: `app/utils/applicant-roster-file.ts`
- Create: `app/composables/useRosterWorkbook.ts`
- Test: `tests/unit/admin/ApplicantRosterFile.test.ts`
- Test: `tests/unit/admin/ApplicantRosterWorkbook.test.ts`

**Interfaces:**
- Produces: `parseApplicantRosterFile(file): Promise<ApplicantRosterRow[]>`, `createRosterTemplate`, `createCredentialWorkbook`, `downloadRosterWorkbook`.

- [ ] **Step 1: Write failing parser tests with real ExcelJS buffers**

Test exact headers `이름, 연락처, 출신고교, 학년`; one visible worksheet and no hidden extra worksheet; formulas rejected; empty rows ignored; duplicate normalized phones rejected; quoted comma/newline CSV accepted; 2-MiB and 500-row limits enforced.

```ts
await expect(parseApplicantRosterFile(twoSheetFile)).rejects.toThrow('ROSTER_FILE_INVALID')
await expect(parseApplicantRosterFile(hiddenExtraSheetFile)).rejects.toThrow('ROSTER_FILE_INVALID')
expect(await parseApplicantRosterFile(csvWithQuotedNewline)).toHaveLength(200)
```

- [ ] **Step 2: Run parser/workbook tests and verify RED**

Run: `pnpm exec vitest run --project unit tests/unit/admin/ApplicantRosterFile.test.ts tests/unit/admin/ApplicantRosterWorkbook.test.ts`

Expected: FAIL because parser/workbook modules do not exist.

- [ ] **Step 3: Implement dynamic ExcelJS parsing**

```ts
if (file.size > 2 * 1024 * 1024) throw new Error('ROSTER_FILE_TOO_LARGE')
const workbook = new Workbook()
await (file.name.toLowerCase().endsWith('.csv')
  ? workbook.csv.read(await file.text())
  : workbook.xlsx.load(await file.arrayBuffer()))
if (workbook.worksheets.length !== 1 || workbook.worksheets[0]?.state !== 'visible') {
  throw new Error('ROSTER_FILE_INVALID')
}
```

Reject any cell whose value is a formula object. Revalidate all normalized rows with the Task 2 schema.

- [ ] **Step 4: Implement workbook output and formula-injection escaping**

Prefix values starting with `=`, `+`, `-`, or `@` with an apostrophe. Template columns are exactly the four input fields. Credential columns are `이름`, `연락처`, `초기 비밀번호`. Never persist the source file or generated plaintext credential buffer.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run --project unit tests/unit/admin/ApplicantRosterFile.test.ts tests/unit/admin/ApplicantRosterWorkbook.test.ts`

Expected: PASS.

```bash
git add app/utils/applicant-roster-file.ts app/composables/useRosterWorkbook.ts tests/unit/admin/ApplicantRosterFile.test.ts tests/unit/admin/ApplicantRosterWorkbook.test.ts
git commit -m "feat: 2026-07-17 add safe roster workbooks"
```

### Task 7: Build the annual roster administration page

**Files:**
- Create: `app/pages/admin/students/roster.vue`
- Create: `app/components/admin/AdmissionCycleStrip.vue`
- Create: `app/components/admin/RosterImportPanel.vue`
- Create: `app/components/admin/RosterPreviewTable.vue`
- Modify: `app/pages/admin/students/index.vue`
- Modify: `app/layouts/admin.vue`
- Test: `tests/unit/pages/AdminRosterPage.test.ts`
- Test: `tests/unit/components/RosterImportPanel.test.ts`
- Test: `tests/e2e/roster-admin.spec.ts`

**Interfaces:**
- Consumes Task 5 APIs and Task 6 browser utilities.
- Produces accessible cycle start, template download, file preview, confirm, new credentials download and current credentials redownload flows.

- [ ] **Step 1: Invoke `frontend-design` and record the visual direction in the task notes**

Keep the existing PHOTO:NEXT editorial/film-contact-sheet language. Make the current cycle and import difference the primary hierarchy; equipment and facilities do not appear in this operations screen. Use existing tokens, display/mono fonts, square borders and purple sequence accent.

- [ ] **Step 2: Write failing component tests**

```ts
expect(wrapper.get('h1').text()).toBe('연간 지원자 명단')
expect(wrapper.get('[data-count="add"]').text()).toContain('신규 200')
expect(wrapper.get('[data-count="inactive"]').text()).toContain('비활성 0')
expect(wrapper.get('button[data-action="apply"]').attributes('disabled')).toBeDefined()
```

Test keyboard file selection, visible error summary, confirmation phrase, stale-version reload, response-loss retry with the same idempotency key, and mobile stacking.

- [ ] **Step 3: Run unit tests and verify RED**

Run: `pnpm exec vitest run --project unit tests/unit/pages/AdminRosterPage.test.ts tests/unit/components/RosterImportPanel.test.ts`

Expected: FAIL because page and components do not exist.

- [ ] **Step 4: Implement the page state machine**

```ts
type ImportPhase = 'idle' | 'parsing' | 'previewing' | 'ready' | 'applying' | 'completed' | 'failed'
```

Generate the idempotency UUID once when entering `ready`; reuse it for transport retries until rows change. Require recent-auth failures to redirect to `/admin/login?redirect=/admin/students/roster`. Download credentials only after a validated success envelope.

- [ ] **Step 5: Run unit and 200-row Playwright tests**

Run: `pnpm exec vitest run --project unit tests/unit/pages/AdminRosterPage.test.ts tests/unit/components/RosterImportPanel.test.ts && pnpm exec playwright test tests/e2e/roster-admin.spec.ts`

Expected: PASS for 200-row XLSX and CSV preview/apply and current credential redownload.

- [ ] **Step 6: Commit the roster UI**

```bash
git add app/pages/admin/students app/components/admin app/layouts/admin.vue tests/unit/pages/AdminRosterPage.test.ts tests/unit/components/RosterImportPanel.test.ts tests/e2e/roster-admin.spec.ts
git commit -m "feat: 2026-07-17 add annual roster interface"
```

### Task 8: Add individual applicant management and password reissue

**Files:**
- Create: `server/api/admin/students/index.post.ts`
- Create: `server/api/admin/students/[id].patch.ts`
- Create: `server/api/admin/students/[id]/status.post.ts`
- Create: `server/api/admin/students/[id]/password/reissue.post.ts`
- Modify: `server/modules/admin/roster-student-commands.ts`
- Modify: `shared/schemas/admin-students.ts`
- Modify: `server/modules/admin/students.ts`
- Modify: `app/pages/admin/students/index.vue`
- Modify: `app/pages/admin/students/[id].vue`
- Create: `app/components/admin/RosterStudentForm.vue`
- Create: `app/components/admin/PasswordReissueDialog.vue`
- Test: `tests/integration/admin/roster-students.test.ts`
- Test: `tests/unit/pages/AdminStudentsPage.test.ts`
- Test: `tests/unit/pages/AdminStudentDetailPage.test.ts`

**Interfaces:**
- Produces one-RPC add, profile edit, phone change, active/inactive toggle and password reissue commands.

- [ ] **Step 1: Write failing integration and page tests**

Test name/phone/school/grade add; duplicate current-cycle phone; profile edit preserving generation; phone change issuing a different password; stale generation conflict; deactivate session revocation; reactivation without automatic reset; password reissue one-time display.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run --project integration tests/integration/admin/roster-students.test.ts && pnpm exec vitest run --project unit tests/unit/pages/AdminStudentsPage.test.ts tests/unit/pages/AdminStudentDetailPage.test.ts`

Expected: FAIL because mutation routes and forms are absent.

- [ ] **Step 3: Implement command adapters and CAS**

```ts
const next = await findNextPasswordGeneration({
  cycleId: student.cycleId,
  phone: input.phone,
  currentGeneration: input.expectedGeneration,
  pepper: keyring.currentPassword.pepper,
})
return dependencies.reissue({
  studentId, expectedGeneration: input.expectedGeneration,
  nextGeneration: next.generation, passwordDigest: await derivePasswordDigest(next.password, keyring.currentPassword.pepper),
})
```

Return plaintext credentials only in the successful response and clear them when the dialog closes.

- [ ] **Step 4: Implement accessible forms and confirmations**

The list adds `학생 개별 등록`. Detail shows normalized name, masked phone, school, grade, cycle, status and test badge before assessment/counseling history. Destructive status changes require a clear confirmation sentence; password reissue requires recent auth but no recovery workflow.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run --project integration tests/integration/admin/roster-students.test.ts && pnpm exec vitest run --project unit tests/unit/pages/AdminStudentsPage.test.ts tests/unit/pages/AdminStudentDetailPage.test.ts && pnpm typecheck`

Expected: PASS.

```bash
git add server/api/admin/students server/modules/admin shared/schemas/admin-students.ts app/pages/admin/students app/components/admin tests/integration/admin/roster-students.test.ts tests/unit/pages/AdminStudentsPage.test.ts tests/unit/pages/AdminStudentDetailPage.test.ts
git commit -m "feat: 2026-07-17 add individual applicant operations"
```

### Task 9: Replace PBKDF2 login and session touch with atomic roster authentication

**Files:**
- Modify: `supabase/migrations/202607170023_admission_roster_rpcs.sql`
- Create: `supabase/tests/admission_roster_auth.test.sql`
- Create: `server/modules/identity/roster-auth.ts`
- Create: `server/modules/identity/student-session.ts`
- Modify: `server/modules/identity/service.ts`
- Modify: `server/api/student/login.post.ts`
- Modify: `server/api/student/session.get.ts`
- Modify: `server/api/student/logout.post.ts`
- Test: `tests/integration/identity/roster-login.test.ts`
- Test: `tests/integration/identity/roster-session.test.ts`
- Test: `tests/local/roster-postgrest-roundtrip.test.ts`

**Interfaces:**
- Produces: `login_roster_student_v1`, `read_roster_student_session_v1`, `revoke_roster_student_session_v1` and Worker adapters.
- Maintains existing `StudentSession` response shape for assessment consumers.

- [ ] **Step 1: Write failing SQL and integration tests**

Test current active success, archived/inactive/test success rules, unknown and wrong-password identical responses, 20 IP attempts/15 minutes, five phone failures/30 minutes, dummy and real cost-10 paths, session absolute 12 hours, no `last_seen_at` update, one RPC call on success/failure.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec supabase test db --local supabase/tests/admission_roster_auth.test.sql && pnpm exec vitest run --project integration tests/integration/identity/roster-login.test.ts tests/integration/identity/roster-session.test.ts`

Expected: FAIL because login/read/revoke v1 functions and adapters are absent.

- [ ] **Step 3: Implement the single login RPC**

Accept phone HMAC, current/previous versioned password digests, IP HMAC, session hash and expiry. Update both rate buckets before returning any structured failure. Select the digest matching `admission_cycles.password_key_version`. Use a fixed valid cost-10 dummy bcrypt for unknown/locked paths, reset failures and insert the session only on success, and write no plaintext or raw digest.

- [ ] **Step 4: Implement Worker adapters**

```ts
const session = await createSessionToken()
const candidates = await derivePasswordCandidates(input.password, keyring)
const result = await client.rpc('login_roster_student_v1', {
  p_phone_hmac: postgresByteaFromBytes(phoneHmac),
  p_current_digest: postgresByteaFromBytes(candidates.current.digest),
  p_current_version: candidates.current.version,
  p_previous_digest: candidates.previous ? postgresByteaFromBytes(candidates.previous.digest) : null,
  p_previous_version: candidates.previous?.version ?? null,
  p_ip_hmac: postgresByteaFromBytes(ipHmac),
  p_token_hash: postgresByteaFromBytes(session.hash),
  p_expires_at: expiresAt.toISOString(),
})
```

- [ ] **Step 5: Run SQL, integration and local roundtrip tests**

Run: `pnpm exec supabase test db --local supabase/tests/admission_roster_auth.test.sql && pnpm exec vitest run --project integration tests/integration/identity/roster-login.test.ts tests/integration/identity/roster-session.test.ts && pnpm exec vitest run --project local-integration tests/local/roster-postgrest-roundtrip.test.ts`

Expected: PASS with one Supabase RPC per login and read-only session lookup.

- [ ] **Step 6: Commit atomic roster authentication**

```bash
git add supabase/migrations/202607170023_admission_roster_rpcs.sql supabase/tests/admission_roster_auth.test.sql server/modules/identity server/api/student tests/integration/identity tests/local/roster-postgrest-roundtrip.test.ts
git commit -m "feat: 2026-07-17 replace student login with roster authentication"
```

### Task 10: Bind assessment, counseling and event operations to read-only current-cycle sessions

**Files:**
- Modify: `server/modules/assessment/service.ts`
- Modify: `server/modules/assessment/completion.ts`
- Modify: `server/modules/assessment/career-narrative-report.ts`
- Modify: `server/modules/counseling/service.ts`
- Modify: `server/api/events.post.ts`
- Modify: `supabase/migrations/202607170023_admission_roster_rpcs.sql`
- Test: `tests/integration/assessment/api.test.ts`
- Test: `tests/integration/counseling/student.test.ts`
- Test: `tests/integration/metrics/browser-events.test.ts`
- Test: `supabase/tests/complete_assessment.test.sql`
- Test: `supabase/tests/counseling.test.sql`

**Interfaces:**
- Consumes Task 9 token-hash session reader.
- Produces session-bound command RPCs that reject archived, inactive or revoked students inside the same transaction as the write.

- [ ] **Step 1: Write failing stale-session race tests**

Arrange a session read, archive/deactivate the student before the mutation, then assert assessment submit, counseling request and authenticated event do not write. Assert read-only GET calls never update session or prospect activity.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run --project integration tests/integration/assessment/api.test.ts tests/integration/counseling/student.test.ts tests/integration/metrics/browser-events.test.ts`

Expected: FAIL because consumers still trust a prior `prospectId` read or call `touch_student_session`.

- [ ] **Step 3: Pass token hashes to command RPCs**

Each mutation RPC resolves the current active prospect from the token hash after locking the session/cycle and performs its write in that transaction. Remove per-request `last_active_at` and `last_seen_at` updates; update activity only on actual assessment/counseling completion if retained for administrator display.

- [ ] **Step 4: Run integration and pgTAP suites**

Run: `pnpm exec vitest run --project integration tests/integration/assessment/api.test.ts tests/integration/counseling/student.test.ts tests/integration/metrics/browser-events.test.ts && pnpm exec supabase test db --local supabase/tests/complete_assessment.test.sql supabase/tests/counseling.test.sql`

Expected: PASS and stale sessions cannot race a mutation.

- [ ] **Step 5: Commit session consumer changes**

```bash
git add server/modules/assessment server/modules/counseling server/api/events.post.ts supabase/migrations/202607170023_admission_roster_rpcs.sql supabase/tests tests/integration/assessment tests/integration/counseling tests/integration/metrics
git commit -m "fix: 2026-07-17 bind student writes to current sessions"
```

### Task 11: Remove public account lifecycle and simplify student-facing pages

**Files:**
- Delete: `server/api/student/register.post.ts`
- Delete: `server/api/student/password/change.post.ts`
- Delete: `server/api/student/password/recovery/request.post.ts`
- Delete: `server/api/student/password/recovery/complete.post.ts`
- Delete: `server/modules/identity/password-recovery.ts`
- Delete: `app/components/admin/AdminRecovery.vue`
- Delete: `app/pages/admin/recovery.vue`
- Delete: `server/api/admin/recovery/index.get.ts`
- Delete: `server/api/admin/recovery/[id]/approve.post.ts`
- Delete: `server/api/admin/recovery/[id]/copy.post.ts`
- Modify: `app/pages/start.vue`
- Modify: `app/pages/credentials.vue`
- Modify: `app/pages/password/reset.vue`
- Modify: `app/pages/login.vue`
- Modify: `app/pages/index.vue`
- Modify: `app/stores/student-session.ts`
- Modify: `app/layouts/admin.vue`
- Modify: `server/modules/counseling/admin-service.ts`
- Test: `tests/unit/pages/StudentAccountPages.test.ts`
- Test: `tests/e2e/roster-login.spec.ts`
- Delete/replace: old registration/recovery/change-password unit, integration, local and E2E tests.

**Interfaces:**
- Keeps only phone/password login, session and logout for students.
- Redirects `/start`, `/credentials` and `/password/reset` to `/login` without preserving credential or recovery state.

- [ ] **Step 1: Write failing redirect/login tests**

```ts
await page.goto('/start')
await expect(page).toHaveURL('/login')
await expect(page.getByLabel('초기 비밀번호')).toBeVisible()
await expect(page.getByRole('link', { name: /복구|비밀번호 찾기/u })).toHaveCount(0)
```

Assert old API paths return 404/405 and no admin recovery link exists.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts tests/unit/admin/AdminShell.test.ts && pnpm exec playwright test tests/e2e/roster-login.spec.ts`

Expected: FAIL because public registration/recovery still exists.

- [ ] **Step 3: Delete lifecycle code and add fixed redirects**

Move `bytesFromPostgresBytea` consumers to `server/utils/postgres-bytea.ts` before deleting `password-recovery.ts`. Remove registration credentials from the Pinia store. Change the landing CTA directly to `/login`. Login copy explains that the department-issued phone and initial password are required.

- [ ] **Step 4: Run route, security and UI tests**

Run: `pnpm exec vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts tests/unit/admin/AdminShell.test.ts && pnpm exec vitest run --project integration tests/integration/student-request-security.test.ts tests/integration/trusted-client-ip.test.ts && pnpm exec playwright test tests/e2e/roster-login.spec.ts`

Expected: PASS with no recovery or signup endpoint in the built route manifest.

- [ ] **Step 5: Commit lifecycle removal**

```bash
git add -A server/api/student server/api/admin/recovery server/modules/identity app/pages app/components/admin app/stores app/layouts tests
git commit -m "refactor: 2026-07-17 remove public student account lifecycle"
```

### Task 12: Make cycle, archive and test-account filtering consistent in administrator data

**Files:**
- Modify: `shared/schemas/admin-students.ts`
- Modify: `app/components/admin/StudentFilters.vue`
- Modify: `app/components/admin/DataTable.vue`
- Modify: `server/modules/admin/students.ts`
- Modify: `shared/schemas/admin-export.ts`
- Modify: `server/modules/admin/export.ts`
- Modify: `server/modules/counseling/admin-service.ts`
- Modify: `supabase/migrations/202607170023_admission_roster_rpcs.sql`
- Test: `tests/integration/admin/students.test.ts`
- Test: `tests/integration/admin/export.test.ts`
- Test: `tests/integration/counseling/admin.test.ts`
- Test: `tests/unit/components/AdminStudents.test.ts`

**Interfaces:**
- Produces explicit `cycle`, `status`, and `test` filters for student administration.
- Ordinary counseling queues, aggregate counts and exports always add `is_test = false`; current/archived student administration may explicitly show tests.

- [ ] **Step 1: Write failing filter and exclusion tests**

Seed one current real applicant, five current test accounts and one archived applicant. Assert ordinary list/export/counseling counts are one; explicit administrator test filter returns five; archived filter returns only archived records and cannot mutate them.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run --project integration tests/integration/admin/students.test.ts tests/integration/admin/export.test.ts tests/integration/counseling/admin.test.ts && pnpm exec vitest run --project unit tests/unit/components/AdminStudents.test.ts`

Expected: FAIL because queries currently filter only `prospects.status = 'active'`.

- [ ] **Step 3: Route reads through cycle-aware RPCs**

Replace direct multi-query detail with `read_roster_student_v1`. Default list is current real active applicants. Add year/status/test filters and remove the legacy region filter from `StudentFilters.vue`; roster applicants always carry the internal compatibility value `other`. Archived detail remains readable, including assessment and counseling FKs, but all mutation buttons are absent.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm exec vitest run --project integration tests/integration/admin/students.test.ts tests/integration/admin/export.test.ts tests/integration/counseling/admin.test.ts && pnpm exec vitest run --project unit tests/unit/components/AdminStudents.test.ts`

Expected: PASS and test accounts never affect ordinary operating statistics.

```bash
git add shared/schemas app/components/admin server/modules/admin server/modules/counseling supabase/migrations/202607170023_admission_roster_rpcs.sql tests/integration/admin tests/integration/counseling tests/unit/components/AdminStudents.test.ts
git commit -m "fix: 2026-07-17 isolate annual and test applicant data"
```

### Task 13: Build the fail-closed expand/Worker release and pass both Worker smoke gates

**Files:**
- Modify: `scripts/deploy-photo-next-release.mjs`
- Modify: `scripts/deploy-photo-next-remote.mjs`
- Modify: `scripts/verify-env.mjs`
- Modify: `wrangler.jsonc`
- Modify: `playwright.config.ts`
- Modify: `tests/unit/scripts/DeploymentSafety.test.ts`
- Create: `tests/local/roster-load.test.ts`
- Create: `tests/e2e/support/roster.ts`
- Modify: `tests/e2e/global-setup.ts`
- Runtime-only 0600 result: `.superpowers/sdd/admin-deploy-result.json`

**Interfaces:**
- Produces the only authorized pre-contract remote sequence: secrets/preflight, migrations 022/023 push, staging deploy/smoke, production deploy/smoke, then a fail-closed `workers-smoked` state.
- Produces production URL, 10-character administrator credentials and five test applicant credentials in the existing mode-0600 result file only.

- [ ] **Step 1: Write failing release-safety tests**

Assert required secret names include name HMAC and current version; previous pepper/version are paired; the administrator generator returns exactly 10 characters with four classes; contract cannot run before both Worker commit markers and current test login smoke; result file mode is 0600; no plaintext secret enters build assets, logs, command arguments or Git.

The local load test inserts 500 all-new applicants through `apply_applicant_roster_v1`, measures the single RPC, and fails at 55 seconds. It must retain bcrypt cost 10; if the gate fails, lower the documented upload maximum to the largest measured safe batch before remote rollout.

```ts
expect(generateAdminPassword()).toMatch(/^(?=.{10}$)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).*$/u)
expect(releasePlan()).toEqual([
  'expand-db', 'staging-worker', 'staging-smoke', 'production-worker', 'production-smoke', 'wait-for-contract',
])
```

- [ ] **Step 2: Run deployment self-tests and verify RED**

Run: `pnpm exec vitest run --project unit tests/unit/scripts/DeploymentSafety.test.ts && node scripts/deploy-photo-next-release.mjs --self-check`

Expected: FAIL because the release runner does not know roster secrets, the pre-contract stop or 10-character passwords.

- [ ] **Step 3: Implement a CSPRNG 10-character administrator password**

Use rejection sampling over an explicit printable alphabet, shuffle with CSPRNG, force one upper/lower/digit/symbol, and never print it. Update the Supabase Auth admin user and verify a password login before writing the result file.

- [ ] **Step 4: Implement the staged DB/Worker gate**

The first remote run allows only migrations 022/023; if migration 024 exists, preflight stops before remote writes. Deploy staging and production with identical versioned roster secrets. Through recent-auth administrator APIs, start the current cycle and create exactly five test accounts. Run test login, read-only session, assessment submit, administrator reissue and current-cycle credential redownload. Because staging and production Workers share the same Supabase project, run the 500-row bcrypt apply/load gate locally and run only a 200-row read-only preview remotely; never insert a synthetic 200-person operating roster in production.

Persist `workers-smoked`, both Worker commit markers and smoke timestamps in the mode-0600 release state. Stop successfully without applying contract SQL.

- [ ] **Step 5: Run all local verification before remote writes**

Run: `pnpm test:sql && pnpm test && pnpm exec vitest run --project local-integration tests/local/roster-postgrest-roundtrip.test.ts tests/local/roster-load.test.ts && pnpm typecheck && pnpm lint && pnpm build && pnpm exec playwright test tests/e2e/roster-login.spec.ts tests/e2e/roster-admin.spec.ts && node scripts/deploy-photo-next-release.mjs --self-check`

Expected: every command exits 0 and the self-check reports zero network calls and zero remote writes.

- [ ] **Step 6: Commit and push the expand/Worker release candidate**

```bash
git add scripts wrangler.jsonc playwright.config.ts tests/unit/scripts/DeploymentSafety.test.ts tests/e2e tests/local/roster-load.test.ts
git commit -m "chore: 2026-07-17 stage annual roster deployment"
git push origin feature/photo-next-mvp
```

- [ ] **Step 7: Execute the authorized pre-contract release**

Run: `node scripts/deploy-photo-next-release.mjs`

Expected output: both Workers are on the release commit and smoke passes; contract is not applied; no credentials are printed; `.superpowers/sdd/admin-deploy-result.json` is a regular mode-0600 file containing production/staging URLs, administrator email/password and five test phone/password pairs.

### Task 14: Add the post-smoke contract migration, continue release and complete QA

**Files:**
- Create only after Task 13 reports `workers-smoked`: `supabase/migrations/202607170024_admission_roster_contract.sql`
- Create: `supabase/tests/admission_roster_contract.test.sql`
- Delete/replace: `supabase/tests/identity_service.test.sql`
- Delete: `supabase/tests/login_hardening.test.sql`
- Delete: `supabase/tests/change_password_service.test.sql`
- Delete: `supabase/tests/recovery_service.test.sql`
- Delete: `supabase/tests/recovery_hardening.test.sql`
- Modify: all remaining prospect fixtures listed by `rg -l "insert into public.prospects" supabase/tests`.
- Modify: `scripts/deploy-photo-next-release.mjs`
- Test: `tests/unit/scripts/DeploymentSafety.test.ts`

**Interfaces:**
- Removes PBKDF2/recovery/register/change-password/touch contracts only after the stored Worker smoke commit equals the current release commit.
- Makes cycle/name/bcrypt/generation fields final, changes phone uniqueness to `(admission_cycle_id, phone_hmac)`, and completes the existing release state.

- [ ] **Step 1: Write failing final-contract tests before creating the migration**

```sql
select is(pg_catalog.to_regprocedure('public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'), null);
select is(pg_catalog.to_regclass('public.credential_recovery_requests'), null);
select is((select count(*) from public.student_credentials where password_bcrypt is null), 0::bigint);
select is((select count(*) from public.assessments a left join public.prospects p on p.id = a.prospect_id where p.id is null), 0::bigint);
select is((select count(*) from public.counseling_requests c left join public.prospects p on p.id = c.prospect_id where p.id is null), 0::bigint);
```

- [ ] **Step 2: Confirm the contract test is intentionally RED on expand-only local DB**

Run: `pnpm exec supabase test db --local supabase/tests/admission_roster_contract.test.sql`

Expected: FAIL because legacy objects still exist. If Task 13 did not persist matching staging and production smoke markers, stop here.

- [ ] **Step 3: Implement the contract migration and continuation gate**

Drop old grants/functions, `credential_recovery_requests`, PBKDF2 hash/salt columns, idle-touch function and obsolete direct table privileges. Add final NOT NULL constraints and cycle-local phone unique. Preserve every prospect, assessment, counseling and narrative FK row. Verify there is no implemented student/result auto-deletion job; no retention deletion is added.

The release continuation refuses a changed commit or missing smoke marker, applies only migration 024, verifies the remote migration list, and then runs final smoke on both Worker URLs.

- [ ] **Step 4: Reset local DB and run every local gate**

Run: `pnpm test:sql && pnpm test && pnpm test:local-integration && pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e && node scripts/deploy-photo-next-release.mjs --self-check`

Expected: PASS; `rg "PBKDF2|credential_recovery|touch_student_session|register_student" server app shared` returns no runtime use.

- [ ] **Step 5: Commit and push the contract separately**

```bash
git add supabase/migrations/202607170024_admission_roster_contract.sql supabase/tests scripts/deploy-photo-next-release.mjs tests/unit/scripts/DeploymentSafety.test.ts
git commit -m "refactor: 2026-07-17 contract legacy student identity"
git push origin feature/photo-next-mvp
```

- [ ] **Step 6: Continue the authorized release and inspect final evidence**

Run: `node scripts/deploy-photo-next-release.mjs`

Expected final output: contract migration and both final smoke checks complete; zero orphan rows; no credentials printed; the mode-0600 result file still contains the final URLs, administrator credentials and five test credentials.

- [ ] **Step 7: Perform browser QA against production**

Verify: landing → roster login; all five tests; 200-row XLSX and CSV preview; current credentials redownload; individual add/edit/phone change/deactivate/reactivate/reissue; assessment completion; archived login rejection; prior assessment/counseling visibility; no signup/recovery/password-change/admin-recovery route; responsive 390px and desktop layouts; browser console has no uncaught error and no request returns 500.

---

## Final Verification Checklist

- [ ] `pnpm test:sql`
- [ ] `pnpm test`
- [ ] `pnpm test:local-integration`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm build`
- [ ] `pnpm test:e2e`
- [ ] `node scripts/deploy-photo-next-release.mjs --self-check`
- [ ] Staging and production smoke both pass before contract migration.
- [ ] Contract migration preserves zero orphan assessment/counseling/narrative rows.
- [ ] Production URL, administrator credentials and five test credentials exist only in the 0600 result file.
