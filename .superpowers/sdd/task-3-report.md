# Task 3 Report — 전공필수 교과 추천 계약

## Result

- 2026 curriculum seed now classifies exactly five official courses as `major_required` and the remaining 36 as `major_elective`.
- The generated seed SQL, content revision, administrator course metadata, publishing checks, result DTO, and matching candidate mapping carry the classification.
- Every newly generated assessment result requires a classification on course candidates, includes every active public required course without an interest signal, deduplicates by resource ID, caps courses at 15, and retains the five-course annual bucket limit.
- Required courses use the exact common-foundation reason: `사진영상미디어학과의 공통 제작 기반을 익히는 전공필수 교과입니다.`
- Historical result snapshots may omit `displayMetadata.requirementType`; new completion mappings always provide it.
- Added the scoped `202607210034_required_course_classification.sql` migration and pgTAP regression coverage.

## Review follow-up

- Legacy and non-2026 active public courses remain valid matcher candidates without a classification. Completion only requires `requirementType` when mapped course metadata identifies academic year 2026, so preserved courses cannot turn submissions into `INTERNAL_ERROR` responses.
- Course composition now reserves active public 2026 required courses and exact selected pathway courses before it selects general personalized courses. It then fills only the remaining five-course annual capacity and 15-course total capacity in ranked order. This keeps all required and protected pathway IDs, prevents duplicate IDs, and deterministically caps general personalized courses instead of selecting them and silently deleting a pathway item later.
- Force inclusion now has one explicit eligibility predicate: course type, `status === 'active'`, student-public visibility, academic year 2026, and `major_required`. It gates zero-affinity admission, required reservation, and the common-foundation reason; `next_year_confirmed` courses remain available only through ordinary positive-affinity ranking.

## TDD evidence

RED was observed before implementation for:

- exact seed classification (missing `requirementType`),
- required-course merging with no matching interest signal,
- 15-course result schema capacity,
- administrator `requirement_type` input and publish validation.

## Verification

- `corepack pnpm exec tsx scripts/seed-content.ts --check`
- `corepack pnpm vitest run --project unit tests/unit/content/content-seed.test.ts tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts tests/unit/components/AdminResources.test.ts` — 112 passed
- `corepack pnpm vitest run --project integration tests/integration/admin/resources.test.ts` — 58 passed
- `corepack pnpm vitest run --project integration tests/integration/result/completion.test.ts` — 64 passed
- `corepack pnpm typecheck`
- `corepack pnpm exec supabase db reset --local`
- `corepack pnpm exec supabase test db --local supabase/tests/required_course_classification.test.sql` — 7 passed
- `git diff --check`
