# Task 3 registration API report

Date: 2026-07-22

## Delivered

- Added `POST /api/student/register`, parsing `applicantRosterRowSchema` before calling the self-registration service.
- Sets the secure `photo_next_session` cookie only for a created registration and returns only `{ kind, expiresAt? }`.
- Converts malformed input to `VALIDATION_FAILED` and unavailable stores to the generic `INTERNAL_ERROR` envelope.
- Added API coverage for created, existing, rate-limited, validation, and unavailable-store outcomes.
- Added explicit middleware coverage proving same-origin registration needs no existing session CSRF token; the existing middleware already enforces same-origin validation for every student mutation, including this route.
- Updated the stale deployment-safety assertion that prohibited the newly specified registration route while retaining the rule that E2E support cannot bypass it.

## TDD evidence

1. RED: `pnpm test -- tests/integration/identity/student-self-registration-api.test.ts tests/integration/student-request-security.test.ts`
   - Failed as expected: all five new API tests reported `Cannot find module '/server/api/student/register.post'`.
2. GREEN (focused): `pnpm exec vitest run --project integration tests/integration/identity/student-self-registration-api.test.ts tests/integration/student-request-security.test.ts tests/integration/security/request-body-bounds.test.ts`
   - Passed: 3 files, 65 tests.
3. Required package command: `pnpm test -- tests/integration/identity/student-self-registration-api.test.ts tests/integration/student-request-security.test.ts tests/integration/security/request-body-bounds.test.ts`
   - Passed with exit code 0 after reconciling the obsolete route-removal assertion.
4. Type check: `pnpm typecheck`
   - Passed with exit code 0.
5. Diff validation: `git diff --check`
   - Passed with no output.
