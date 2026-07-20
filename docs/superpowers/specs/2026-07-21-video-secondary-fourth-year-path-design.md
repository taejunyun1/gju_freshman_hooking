# Video Secondary-Interest Fourth-Year Path Design

## Approval and goal

The user explicitly delegated the detailed design on 2026-07-21 and asked implementation to begin from the written document without another approval pause.

When `영상과 기술(AI·편집·드론)` is the student's first-ranked track, keep the verified video curriculum for year 3 and use the second-ranked track to complete year 4. Do not invent a video course that is absent from the confirmed 2026 curriculum.

## Confirmed root cause

`primaryTrackPathwayCourses.video` contains three verified year-3 courses and no year-4 course:

- 영상 인터뷰 내러티브 워크숍
- 영상 드론 콘텐츠 워크숍
- 영상 콘텐츠 크리에이터 워크숍

The completion flow currently passes only `rankedTracks[0]` into resource matching. Resource selection therefore appends only the first track's pathway, leaving year 4 empty for a video-first student even though `rankedTracks[1]` has a verified year-4 seminar and lab.

## Considered approaches

### A. Second-track year-4 fallback — selected

Keep all first-track video courses in year 3. Only when the first track is `video`, append exactly the second track's verified year-4 courses. This uses confirmed department data, preserves the student's ordering, and changes only course-path matching.

### B. Create new year-4 video courses — rejected

This would make the timeline visually complete but would fabricate curriculum that is not in the 2026 source data.

### C. Mix the second track into every pathway — rejected

This would weaken the exact art-photo, documentary, and commercial pathways, which already contain their own verified year-3 and year-4 courses.

## Deterministic mapping

Apply the fallback only when `rankedTracks[0] === 'video'`:

- second `art_photo` → 예술창작 프로젝트 세미나, 예술창작 프로젝트 랩
- second `documentary` → 다큐멘터리 세미나, 포스트 다큐멘터리 랩
- second `commercial` → 커머셜 포토그라피 세미나, 커머셜 포토그라피 랩

Do not append the second track's year-3 courses. When the first track is not video, ignore the second track for forced pathway selection and retain the current exact pathway.

## Data flow

1. Assessment scoring continues to produce the same four `rankedTracks`.
2. Completion passes both the first and second tracks to resource matching.
3. Resource preparation injects synthetic pathway evidence for the first track and, for video-first results only, the second track's year-4 courses.
4. Synthetic evidence uses an actual selected questionnaire label for the matching track, with the existing first-label fallback only when a track-key label is unavailable.
5. Synthetic `pathway_*` keys remain internal and are removed from the canonical result's `primaryTag`, selected interests, and serialized snapshot.
6. Faculty recommendations, track scores, ranked-track order, career narrative, projects, equipment, and facilities remain unchanged.

## Course cap

The complete video-first path can contain five foundation courses, three video year-3 courses, and two second-track year-4 courses. Increase the canonical course cap from 9 to 10 so neither verified year-4 course is silently removed. This adds no database read or dependency and changes the payload by at most one course for affected new results.

Historical result snapshots remain immutable and valid. The new cap only permits new snapshots with ten course resources; it does not rewrite stored rows.

## UI and instructor hierarchy

No new visual styling is needed. `LearningPath` already groups verified courses into year buckets and will display the new year-4 courses in the existing blue rounded timeline.

Supporting instructors remain subordinate to full-time professors:

- maximum two cards in the matcher and shared schema
- `compact` FacultyCard mode for every supporting instructor
- smaller padding, heading, expertise, and reason text than primary and backup cards
- two-column desktop grid and single-column mobile layout

## Failure handling

- If the second-ranked track has no verified year-4 course with the exact title and grade, do not substitute a similarly named or wrong-grade course.
- If no secondary track is provided, preserve the existing video year-3-only pathway.
- If actual selected-label evidence is unavailable, keep the existing closed validation error rather than persisting an unverifiable connection reason.
- Candidate IDs, titles, grade years, and synthetic evidence keys remain unique and deterministic.

## Verification

1. Unit tests cover video-first with each of the three possible second tracks.
2. Tests prove only video year-3 and second-track year-4 courses are appended.
3. Tests preserve video without a second track and every non-video primary pathway.
4. Wrong-grade courses are never forced.
5. Integration covers a video-first, art-photo-second result and asserts both year buckets, unchanged ranked tracks, and unchanged professor selection inputs.
6. Result schema accepts ten courses while continuing to reject eleven.
7. Serialized results contain no synthetic `pathway_` key.
8. Existing component tests confirm supporting instructor cards remain compact and capped at two.

## Out of scope

- adding or renaming curriculum courses
- changing track scoring or rank order
- changing professor or instructor expertise data
- displaying more than two supporting instructors
- redesigning the result timeline or faculty cards
- backfilling historical results
- adding a database migration or additional database query
