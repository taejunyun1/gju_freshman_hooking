# Supporting Instructor Scoring Fix Design

## Goal

Show one or two relevant adjunct or part-time instructors in the result faculty section when a student's real questionnaire selections provide verified evidence for those instructors. Keep the three full-time professors as the only primary and backup counseling recommendations.

## Confirmed root cause

The production faculty data, specialist links, result schema, and compact instructor card UI are present and active. The missing cards originate in `recommendFaculty()`: specialist category scores average every tag in a multi-disciplinary instructor profile. A student can strongly select documentary and video while the same instructor's other unselected specialties dilute the average below the existing 50-point threshold. The matcher then persists `faculty.specialists: []`, so the UI correctly has no instructor card to render.

The reproduced production selection is:

- `work.photo_everyday`
- `work.video_post`
- `result.documentary`
- `result.brand_video`
- `style.solo`
- `style.studio`
- `career.photo`
- `career.video`

It produces 김사라 as primary, 윤태준 as backup, and no specialists even though the verified documentary links for 유별남 and 김태현 have positive evidence.

## Scoring correction

Change specialist-only category matching from an average across all candidate tags to the strongest verified tag match in each available category. A specialist is a valid connection when the student's selected interest strongly matches at least one declared subfield; the student is not required to select the instructor's entire practice profile.

Count distinct verified evidence keys across the specialist, result, and career categories. Evidence is verified only when the key has both a positive student signal and a selected questionnaire label. When a candidate has at least two distinct verified keys, treat that independent breadth as sufficient for the existing 50-point specialist boundary: keep the calculated score when it is already 50 or above, otherwise raise it to exactly 50. A single weak signal receives no floor and remains subject to its calculated score.

Keep the existing category weights and normalization:

- specialist: 0.50
- result: 0.30
- career: 0.20
- categories absent from the candidate profile remain unavailable and are excluded from the denominator
- categories present in the candidate profile but with no student signal remain zero

Keep every existing boundary unchanged:

- only active `adjunct|practitioner` + `specialist` candidates
- only candidates linked to the chosen primary or through a null-primary link
- the link tag must have positive student evidence
- the final score must remain at least 50
- return at most two specialists
- retain deterministic qualification-score ordering, then compare the underlying calculated score, distinct verified evidence count, priority, and ID
- do not change primary or backup professor scoring

Keep both the calculated score and the qualification score. Multiple verified keys can raise only the qualification score to 50; ranking still compares the underlying calculated score before evidence count and priority. This prevents the 50-point floor from erasing the difference between a stronger and weaker match.

For the reproduced selection, 김태현 has six distinct verified keys with a 45-point calculated score, 곽동욱 has six with 30 points, and 유별남 has two with 26.9 points. All three qualify at 50, but the two-card cap and calculated-score ordering return 김태현 시간강사 before 곽동욱 겸임교수. Their cards retain the existing compact hierarchy beneath the primary and backup professor cards.

## Stored-result boundary

Results are immutable snapshots. This fix applies when a result is newly generated and does not rewrite historical assessment rows. No database migration or bulk backfill is added. During production QA, resubmit the test student's existing selections to create a new result and verify that the supporting cards render. Real students who submit after the release receive the corrected recommendation automatically.

## UI and copy

No new visual system is introduced. Continue using the existing blue, rounded PHOTO:NEXT result design:

- heading: `함께 연결되는 실무·창작 강사`
- compact cards show name, title, expertise, and evidence-based reason
- primary and backup professor cards remain visually dominant
- the specialty example grid remains subordinate guidance after the actual instructor cards
- when no candidate legitimately reaches 50, no fabricated instructor card is shown

## Tests and verification

1. Add a matcher regression test using the exact reproduced questionnaire selections and canonical seeded faculty data. It must fail before the correction because specialists are empty, then pass with 김태현 and 곽동욱 returned in deterministic order.
2. Add a focused test proving unrelated specialties do not dilute a candidate's strongest verified subfield.
3. Preserve the existing exact-50 inclusion and below-50 exclusion for single-signal candidates, plus the unselected-category penalty, link eligibility, two-person cap, and primary/backup balance tests.
4. Run focused matcher and result-component tests, then the full unit suite, typecheck, lint, and production build.
5. After release, create a new dummy-account result with the reproduced selections and verify both compact instructor cards in a real mobile browser without console errors or horizontal overflow.

## Out of scope

- displaying the full instructor directory in every result
- displaying more than two supporting instructors in a result
- lowering or bypassing the 50-point threshold
- adding fallback cards unrelated to student evidence
- changing full-time professor distribution
- rewriting existing result snapshots
- adding a database migration or additional result-page database reads
