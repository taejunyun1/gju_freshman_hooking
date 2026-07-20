# Track-specific 3rd/4th year curriculum pathways

## Outcome

Keep the existing PHOTO:NEXT four-year `IN → OUT` timeline and ensure that the student's primary track always carries the verified advanced courses supplied by the department. Existing high-affinity 1st/2nd year foundation recommendations remain visible instead of being displaced.

## Frontend design direction

- Subject: Gwangju University Department of Photography, Video & Media applicant pathway result.
- Audience: applicants checking whether their interests can become a concrete four-year study plan.
- Single job: make the transition from foundation study to track-specific advanced coursework legible at a glance.
- Palette: retain Ink Navy `#14213D`, Primary Blue `#2864F0`, Blue Mist `#EEF4FF`, Paper `#FFFFFF`, Canvas `#F5F7FC`.
- Type: retain Wanted Sans for display, Pretendard for Korean body copy, and IBM Plex Mono for year/course labels.
- Layout: retain the four-column sequence and current course cards; do not introduce a second visualization or more colors.
- Signature: the existing `IN → OUT` rail is the sole visual signature. The data should complete the empty 3Y/4Y columns.

## Required pathway mapping

### Art photography (`art_photo`)

- 3Y: `사물,데이터,이미지 워크숍`, `사진과 장소 그리고 콘텍스트 워크숍`
- 4Y: `예술창작 프로젝트 세미나`, `예술창작 프로젝트 랩`

### Documentary (`documentary`)

- 3Y: `포토 스토리 워크숍`, `포토에세이 워크숍`
- 4Y: `다큐멘터리 세미나`, `포스트 다큐멘터리 랩`

### Video and drone (`video`)

- 3Y: `영상 인터뷰 내러티브 워크숍`, `영상 드론 콘텐츠 워크숍`, `영상 콘텐츠 크리에이터 워크숍`
- 4Y: no forced course because the department did not specify one in this request.

### Commercial photography (`commercial`)

- 3Y: `커머셜 포토그라피 기초 워크숍`, `커머셜 포토그라피 심화 워크숍`
- 4Y: `커머셜 포토그라피 세미나`, `커머셜 포토그라피 랩`

## Implementation constraints

1. Use the primary ranked track, not a UI guess.
2. Preserve up to five existing positive-affinity 1Y/2Y foundation courses.
3. Add only the exact advanced titles for the primary track; do not leak other tracks' advanced courses as filler.
4. Preserve the immutable stored-result model. New completions receive the corrected pathway; old snapshots are not rewritten.
5. Course reasons must still cite a real selected-interest label. A deterministic pathway evidence tag may be added only in memory during matching and must not be stored as student input.
6. Order same-year cards by confirmed term before affinity so 1학기 precedes 2학기.
7. Raise only the course collection bound needed for five foundations plus four advanced courses (maximum 9). Do not change other resource caps.
8. No database migration: all required courses already exist in the verified 2026 course catalog.
9. Follow test-first red/green/refactor. Add table-driven coverage for all four tracks and integration coverage proving completion passes the primary track into matching.
10. Run focused tests, typecheck, lint, full Vitest, build, staged deployment, production deployment, and authenticated browser QA.
