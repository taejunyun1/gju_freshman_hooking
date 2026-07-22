# Task 2 — Worker self-registration service report

## Scope

Implemented only the Worker registration service, focused integration coverage,
and the unused shared registration API types. No HTTP route or frontend files
were changed.

## RED

Command:

```text
pnpm test -- tests/integration/identity/student-self-registration.test.ts
```

Observed result before implementation: 1 failed test file, 4 failed tests, and
the expected error was `Cannot find module
'/server/modules/identity/student-self-registration'`. The existing suite was
otherwise green (105 files / 1344 tests).

## GREEN

Command:

```text
pnpm test -- tests/integration/identity/student-self-registration.test.ts tests/integration/identity/roster-login.test.ts
```

Observed result after implementation: 106 test files passed and 1348 tests
passed (exit 0). The Vitest project configuration also ran the unaffected suite.

Additional verification:

```text
pnpm typecheck
```

Observed result: exit 0 (`nuxi typecheck`).

## Service contract

- `registerStudent` accepts `ApplicantRosterRow` and
  `RosterIdentityRequestContext`, resolving the current admission year solely
  through `list_admission_cycles_v1` and rejecting zero or multiple current
  cycles.
- It protects phone and applicant name with the existing PII helpers, derives
  the year/phone initial PIN only in memory, hashes that PIN, and sends one
  `register_roster_student_v1` call with bytea/hex protected values, key
  version, IP HMAC, token hash, expiry, school name, and applicant stage.
- RPC arguments contain neither plaintext applicant name nor phone nor initial
  PIN. The public created result exposes only the opaque session token and
  expiry—never the prospect ID or PIN. Existing and rate-limited results expose
  no session token.
- RPC payloads are strict and fail closed as `IDENTITY_STORE_INVALID` when they
  do not match `created`, `existing`, or `rate_limited`.
- Registration telemetry is best-effort: `registration_started` precedes the
  registration RPC, while `registration_completed` is emitted only for a
  validated created result.

## Self-review

- Verified the registration call has exactly the migration's 13 named
  parameters; no cycle ID/year is sent to the RPC.
- Verified API registration types remove the legacy plaintext initial-password
  response and model the three supported outcomes.
- Verified no frontend or API route was added. Existing dirty/unrelated files
  were left untouched.

## Commit

`e5440a9 feat: 2026-07-22 신규 학생 등록 서비스 추가`

The commit stages only:

```text
server/modules/identity/student-self-registration.ts
shared/types/api.ts
tests/integration/identity/student-self-registration.test.ts
```

## P2 Safe-integer prospect ID follow-up — 2026-07-22

### Scope

- `server/modules/identity/student-self-registration.ts`
- `tests/integration/identity/student-self-registration.test.ts`

### RED/GREEN evidence

Added a focused test for a `created` registration RPC result with
`prospectId: Number.MAX_SAFE_INTEGER + 1`. It asserts the service fails closed
with `IDENTITY_STORE_INVALID` and records no `registration_completed` event.

RED command:

```text
pnpm test -- tests/integration/identity/student-self-registration.test.ts
```

Observed result: exit 0 (106 test files / 1349 tests). The installed Zod 4
runtime already rejects unsafe integers through `.int()`, so the new behavioral
test was green before the explicit code change.

The schema now additionally calls `refine(Number.isSafeInteger)` for the
created-result `prospectId`, making the safe-integer requirement explicit and
independent of the current Zod `.int()` implementation before the value can be
sent to registration telemetry.

GREEN command:

```text
pnpm test -- tests/integration/identity/student-self-registration.test.ts tests/integration/identity/roster-login.test.ts
```

Observed result: exit 0 (106 test files / 1349 tests).
