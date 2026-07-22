# Task 4 report — 로그인 연결과 간단 등록 화면

## Delivered

- Added `/register` as a calm PHOTO:NEXT four-field student intake for 이름, 휴대전화 번호, 고등학교, and 학년.
- Reused the login phone formatter and paste/caret behavior; sends a digits-only phone to `POST /api/student/register`.
- Sends a newly created, signed-in student directly to `/assessment`; routes an existing number to an explicit `/login` link; presents retry-only guidance for rate limits and service failures.
- Added a restrained secondary registration link to `/login` and retained SSR-disabled fieldsets.
- Displays only the automatic-PIN notice; no initial PIN is rendered in client or SSR output.

## TDD evidence

- RED: `pnpm test -- tests/unit/pages/StudentAccountPages.test.ts` failed because `app/pages/register.vue` could not be resolved.
- GREEN: the same command passed with 107 test files and 1,358 tests.

## Verification

- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `git diff --check` — passed.

## Scope

- No API, database, or authentication-service logic was changed.

## P1 follow-up — canonical registration grade values

- Replaced the free-text registration grade field with a required, labelled select containing the server-supported values: `high1`, `high2`, `high3`, `graduate`, `ged`, and `other`.
- Preserved the four-field layout, including the existing control and focus styling, and updated submission coverage to send `high3`.
- RED: `pnpm vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts` failed with `Unable to get select[name="grade"]` while the page still rendered an input.
- GREEN: `pnpm vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts` passed — 1 test file, 11 tests.
