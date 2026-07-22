# Final Static Release Fixes Report

## Result

- Removed the native `maxlength="13"` constraint from the self-registration phone input. The page continues to use `type="tel"`, numeric input mode, automatic Korean mobile-number hyphenation, and the existing field-specific validation message.
- Updated the page regression to dispatch an actual `InputEvent` containing 12 digits rather than using `setValue` for the phone. It verifies that the overflow reaches page state, remains visible for validation, sets the phone field's accessible error attributes, and blocks `$fetch`.
- Replaced the legacy `public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)` definition in `202607220030_student_self_registration.sql` after the cycle-scoped unique constraint is installed.
- The replacement preserves the RPC signature, `returns table(kind text)` contract, protected inputs, `security definer`, empty search path, and existing grants. It selects the database's current admission cycle, writes that cycle ID with the prospect, and uses generic `ON CONFLICT DO NOTHING` so the composite cycle/phone constraint returns `existing` for a same-cycle duplicate.
- No client cycle input, plaintext identity handling, self-registration session behavior, or registration response privacy was changed.

## TDD evidence

### Phone overflow

RED:

```bash
corepack pnpm exec vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts
```

The new assertion failed with `expected '13' to be undefined`, proving the browser constraint was still present.

GREEN:

```bash
corepack pnpm exec vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts
```

Result: 1 file passed, 13 tests passed.

### Legacy registration RPC

Initial RED after a clean database reset:

```bash
corepack pnpm exec supabase db reset --local
corepack pnpm exec supabase test db --local supabase/tests/identity_service.test.sql
```

PostgreSQL raised `there is no unique or exclusion constraint matching the ON CONFLICT specification` when the legacy RPC started.

The first generic-conflict replacement removed that runtime error and exposed the cycle-binding requirement: without a cycle ID, the same phone could be inserted twice because the composite constraint treats null cycle IDs as distinct. An explicit current-cycle pgTAP assertion was then added and observed RED with `have: NULL`.

Final GREEN after binding the legacy insert to the server-selected current cycle:

```bash
corepack pnpm exec supabase db reset --local
corepack pnpm exec supabase test db --local supabase/tests/identity_service.test.sql
```

Result: 1 file passed, 21 tests passed. The test covers the current-cycle prospect ID, the generic conflict definition, and the existing same-phone duplicate return behavior.

## Verification

- `corepack pnpm exec vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts` — 13 passed.
- `corepack pnpm exec supabase db reset --local` followed by the focused identity pgTAP — 21 passed.
- `corepack pnpm exec supabase test db --local supabase/tests/identity_service.test.sql supabase/tests/student_self_registration.test.sql supabase/tests/admission_roster_operations.test.sql supabase/tests/admission_roster_schema.test.sql` — 4 files, 180 passed.
- `corepack pnpm test` — 107 files, 1,362 passed.
- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm build` — passed.
- `corepack pnpm exec playwright test tests/e2e/student-self-registration.spec.ts --project=chromium` — 1 passed.
- `git diff --check` — passed.

## Concerns and scope notes

- The production build emitted the existing Nuxt module-preload sourcemap warning; it completed successfully.
- Playwright emitted non-failing `NO_COLOR`/`FORCE_COLOR` warnings; the focused browser registration and subsequent login flow passed.
- Pre-existing changes in `.superpowers/sdd/task-3-report.md` and unrelated untracked artifacts were left untouched and are not part of this fix.
