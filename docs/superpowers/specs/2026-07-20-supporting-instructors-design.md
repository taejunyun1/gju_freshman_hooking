# Supporting Instructors in Faculty Results

## Goal

Keep the three full-time faculty members as the only primary and backup counseling recommendations, while showing relevant adjunct faculty and four newly supplied part-time instructors as compact, supporting practice and creation connections.

## Decision

The database employment enum is not expanded. The new people are seeded as `practitioner` + `specialist`, with the public title `시간강사`. This preserves the existing rule that only `full_time` + `primary` faculty can be selected as the main counseling recommendation, while the result matcher already accepts `practitioner` specialists.

The existing maximum of two specialist connections remains. It prevents the result page from becoming a directory, and each added instructor is selected only when their supplied specialist tags have positive student evidence. Existing adjunct specialists remain eligible on the same basis.

## Content and Matching

| Instructor | Public title | Supporting tags | Full-time connection |
| --- | --- | --- | --- |
| 정한결 | 시간강사 | 예술사진, AI, 미디어아트, 설치 | 윤태준 |
| 유별남 | 시간강사 | 다큐멘터리, 기록, 포토스토리 | 조대연·김사라 |
| 김태현 | 시간강사 | 다큐멘터리, 영상, 예술사진 | 조대연·김사라·윤태준 |
| 김명우 | 시간강사 | AI, 영상, 미디어아트, 설치 | 윤태준 |

The supplied descriptions are condensed into factual profile text and source-dated `2026-07-20`. No phone number or email is invented. Links are shown only where a supplied public artist or studio website is available.

## Result-page Presentation

The main and backup faculty cards keep their current size and wording. The third group is relabeled `함께 연결되는 실무·창작 강사`; every returned specialist is rendered through the existing faculty card with a `compact` variant. Compact cards retain name, title, expertise, and the evidence-based connection sentence, but reduce heading and body scale and suppress empty contact spacing. The group remains omitted from automatic selection when there is no matching specialist; the existing specialty example grid remains as guidance.

## Safety and Verification

- No new instructor is eligible for automatic primary/backup recommendation or real counseling assignment.
- Existing adjunct links and all current result snapshots remain valid because the result contract does not change.
- Add a matcher test proving each supplied instructor is selectable only for its declared tags and never replaces a full-time primary/backup.
- Add a component/page test proving the supporting heading and compact modifier render for specialist cards.
- Regenerate `supabase/seed/content-2026.sql` exclusively through `scripts/seed-content.ts`, then run the content seed and result/matching tests.
