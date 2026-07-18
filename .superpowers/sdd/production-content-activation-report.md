# 2026-07-18 Production Content Activation Report

## Outcome

- Added `202607180026_publish_verified_2026_content.sql` with the idempotent, service-role-only `public.activate_verified_2026_content()` operation.
- The operation finds one active administrator, limits faculty handling to the six approved seeded names, explicitly assigns the three primary faculty a capacity of `4` and priorities `300/200/100`, normalizes the seeded taxonomy prerequisites, then calls the existing `publish_admin_faculty` validator in primary-before-specialist order.
- It normalizes only the missing seeded course `goal` field from its existing `source_goal`, then calls the existing `transition_admin_resource(..., 'active')` for every public draft resource. Only `updated` and `validation_error` outcomes are accepted; validation failures are asserted to remain draft and all other outcomes abort the transaction.
- Postconditions require six approved active faculty, three active primary faculty with positive capacity, and an active/public course for each supported track.
- The migration only creates the operation, so fresh resets remain safe while content tables are empty. The remote deployment runner invokes it immediately after creating/upserting its active administrator, making the post-seed production path automatic and retry-safe.

## TDD record

- RED: added `supabase/tests/production_content_activation.test.sql`; after a fresh reset it failed because `activate_verified_2026_content()` did not exist.
- GREEN: implemented the migration and deployment invocation. The focused pgTAP test passes 16 assertions, including idempotency, course coverage, verified equipment activation, and draft preservation for unverified entries.

## Verification

- `pnpm exec supabase db reset --local`
- `pnpm exec supabase test db --local supabase/tests/production_content_activation.test.sql` — 16 passing
- `pnpm exec supabase test db --local` — 27 files, 1,132 tests passing
- `PHOTO_NEXT_ALLOW_DESTRUCTIVE_ASSESSMENT_SEED_TESTS=1 pnpm test:assessment-seed` — 8 passing
- `pnpm exec tsx scripts/seed-content.ts --check`
- `pnpm eslint scripts/deploy-photo-next-remote.mjs`
- `node scripts/deploy-photo-next-remote.mjs --self-check`
- `git diff --check`

## Self-review

- No existing publisher or resource validator was bypassed.
- No secret or personal data is written by the operation or deployment failure path.
- The operation selects no administrator identity for output and returns only aggregate counts.
