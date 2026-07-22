# Self-registration release fixes report

Date: 2026-07-22

## Delivered

- Added a server-originated expected-cycle compare-and-swap contract to
  `register_roster_student_v1`: both cycle UUID and year must match the locked
  current cycle before rate limits or writes occur.
- Added one bounded service retry for `cycle_changed`. The retry re-reads the
  current cycle and re-derives the year-based PIN digest and opaque session; a
  second cycle change fails closed as `IDENTITY_STORE_INVALID`.
- Replaced the global `prospects.phone_hmac` unique constraint with per-cycle
  `(admission_cycle_id, phone_hmac)` uniqueness. Same-current-cycle registration
  remains `existing`; an archived-cycle identity can be created in the current
  cycle. Roster import claim/preservation and diagnostic behavior remains
  covered.
- Corrected the live pgTAP bcrypt pattern for PostgreSQL
  `standard_conforming_strings`.
- Aligned the registration name limit with the shared 40-character rule and
  validated name, phone, high school, and grade through the canonical shared
  roster schema before fetch. Exact `010` plus eight digits is required;
  overlength input remains visible and cannot be submitted as a truncated
  number. Field errors are linked with `aria-invalid` and `aria-describedby`.

The browser still sends only `{ name, phone, highSchool, grade }`. Expected
cycle values are derived by the server service, and no PIN, plaintext PII,
cycle selector, or protected value was added to a public response.

## TDD evidence

### RED

1. Baseline live SQL reproduction:

   `corepack pnpm exec supabase test db --local supabase/tests/student_self_registration.test.sql`

   Result: exit 1; 22/23 passed and test 4 failed exactly at the double-escaped
   bcrypt pattern.

2. Service regressions before implementation:

   `pnpm exec vitest run --project integration tests/integration/identity/student-self-registration.test.ts`

   Result: exit 1; 4/7 passed and 3/7 failed for missing expected-cycle
   arguments, missing rollover retry, and missing second-change fail-closed
   behavior.

3. Page regressions before implementation:

   `pnpm exec vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts`

   Result: exit 1; 12/13 passed and the new validation test failed because the
   page exposed `maxlength="30"` instead of `40`.

4. Database contract before implementation:

   `corepack pnpm exec supabase test db --local supabase/tests/student_self_registration.test.sql`

   Result: exit 1 during setup because the expected-cycle RPC signature did
   not exist; planned 31 tests, 0 ran.

5. Full-suite compatibility check caught an overly broad first implementation
   of phone overflow preservation:

   `pnpm test`

   Result: exit 1; 106/107 files and 1,361/1,362 tests passed. The existing
   shared formatter truncation contract failed. Overflow preservation was then
   narrowed to the registration page, and the shared login formatter contract
   was restored.

### GREEN / release verification

- Focused service:
  `pnpm exec vitest run --project integration tests/integration/identity/student-self-registration.test.ts`
  - exit 0; 1 file, 7 tests passed.
- Focused API/security:
  `pnpm exec vitest run --project integration tests/integration/identity/student-self-registration.test.ts tests/integration/identity/student-self-registration-api.test.ts tests/integration/student-request-security.test.ts tests/integration/security/request-body-bounds.test.ts`
  - exit 0; 4 files, 72 tests passed.
- Focused page/shared normalization:
  `pnpm exec vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts tests/unit/identity/applicant-normalization.test.ts`
  - exit 0; 2 files, 18 tests passed.
- Formatter/page compatibility:
  `pnpm exec vitest run --project unit tests/unit/utils/StudentPhoneInput.test.ts tests/unit/pages/StudentAccountPages.test.ts`
  - exit 0; 2 files, 20 tests passed.
- Clean database:
  `corepack pnpm exec supabase db reset --local`
  - exit 0; all migrations through
    `202607220030_student_self_registration.sql` applied and seeds completed.
- Registration pgTAP:
  `corepack pnpm exec supabase test db --local supabase/tests/student_self_registration.test.sql`
  - exit 0; 1 file, 31 tests passed.
- Roster operations pgTAP:
  `corepack pnpm exec supabase test db --local supabase/tests/admission_roster_operations.test.sql`
  - exit 0; 1 file, 64 tests passed.
- Roster schema pgTAP:
  `corepack pnpm exec supabase test db --local supabase/tests/admission_roster_schema.test.sql`
  - exit 0; 1 file, 64 tests passed.
- Full Vitest:
  `pnpm test`
  - exit 0; 107 files, 1,362 tests passed.
- Lint:
  `pnpm lint`
  - exit 0; `eslint .` produced no diagnostics.
- Typecheck:
  `pnpm typecheck`
  - exit 0; `nuxi typecheck` produced no diagnostics.
- Production build:
  `pnpm build`
  - exit 0; Nuxt/Nitro reported `Build complete!`.
  - Non-blocking existing warning: the Nuxt module-preload polyfill did not
    emit a sourcemap for its transformation.
- Focused browser flow:
  `pnpm exec playwright test tests/e2e/student-self-registration.spec.ts`
  - exit 0; Chromium 1/1 passed in 41.2s. Registration did not expose the PIN,
    navigated to assessment, and the derived initial PIN logged in afterward.

## Broader E2E blocker / concern

`pnpm exec playwright test` was also run for the entire suite. Result: exit 1;
23 discovered, 11 passed, 8 failed, and 4 did not run in 2.1 minutes. The
self-registration browser test passed inside this full run. The eight failures
are outside the scoped files and reproduce stale/cross-feature expectations:

- three `admin-security.spec.ts` failures (old body background value, removed
  recovery page heading, and an API expected as 403 now returning 404);
- one `/login` visual-copy expectation still looking for `임시 비밀번호`;
- three assessment fixture logins returning 401 after earlier shared E2E state;
- one counseling record fixture not appearing in the admin list.

No changes were made to those unrelated admin, assessment, visual, or
counseling surfaces. The feature-focused Playwright test and every scoped
database/application gate pass.

## Worktree hygiene

The pre-existing modified `.superpowers/sdd/task-3-report.md` and untracked
`.playwright-cli/`, `output/`, workbook inspection files, `scripts/node_modules`,
and `supabase/.branches/` were not modified for this task and must remain
unstaged.
