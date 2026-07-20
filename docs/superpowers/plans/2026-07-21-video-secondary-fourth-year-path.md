# Video Secondary-Interest Fourth-Year Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete a video-first student's year-4 curriculum with the second-ranked track's two verified year-4 courses while preserving the video year-3 path and every other result decision.

**Architecture:** Extend resource matching with an optional secondary track. The primary path remains authoritative; only a video primary may borrow grade-4 entries from the secondary path. Carry both synthetic pathway evidence keys through in-memory matching, filter them from canonical output, and raise only the course resource cap from 9 to 10.

**Tech Stack:** TypeScript 6, Nuxt 4, Zod 4, Vitest 4

## Global Constraints

- Apply the secondary fallback only when `primaryTrack === 'video'` and `secondaryTrack` is a different verified track.
- Keep all three exact video year-3 courses and add only the secondary track's exact two year-4 courses; never add the secondary track's year-3 courses.
- Use only the confirmed `primaryTrackPathwayCourses` titles and exact grade years; do not invent or rename a course.
- Keep up to five positive-affinity year-1/year-2 foundations and raise only the course cap from 9 to 10.
- Synthetic `pathway_*` evidence remains in memory only and must not appear in canonical `primaryTag`, selected interests, or serialized snapshots.
- Course reasons must cite a real selected questionnaire label; prefer evidence whose key matches the corresponding ranked track.
- Do not change track scores, ranked-track order, faculty matching, career narrative logic, other resource caps, dependencies, database reads, or migrations.
- Historical result snapshots remain immutable; the change applies only to newly generated results.
- Supporting instructors remain capped at two and render with the existing compact card, smaller than primary and backup professor cards.

---

## File Structure

- Modify `server/modules/matching/resources.ts`: accept the secondary track, resolve the video-only fallback, carry all synthetic evidence keys, and select up to ten course resources.
- Modify `shared/schemas/result.ts`: raise only `resources.course` from `.max(9)` to `.max(10)`.
- Modify `tests/unit/matching/resources.test.ts`: cover the three secondary mappings, non-video isolation, missing-secondary compatibility, wrong-grade rejection, and synthetic-key removal.
- Modify `tests/unit/result/result-schema.test.ts`: accept ten and reject eleven course resources.
- Modify `server/modules/assessment/completion.ts`: pass `rankedTracks[1]` and the synthetic evidence-key set through resource preparation.
- Modify `tests/integration/result/completion.test.ts`: prove a real video-first/art-photo-second completion fills year 3 and year 4 without changing the ranked tracks.

### Task 1: Add the video-only secondary pathway contract

**Files:**
- Modify: `server/modules/matching/resources.ts:82-196,622-664`
- Modify: `shared/schemas/result.ts:249-259`
- Modify: `tests/unit/matching/resources.test.ts:90-240`
- Modify: `tests/unit/result/result-schema.test.ts:220-240`

**Interfaces:**
- Consumes: `primaryTrackPathwayCourses`, `RankResourcesInput.primaryTrack`, canonical course candidates.
- Produces: optional `RankResourcesInput.secondaryTrack`, optional `RankResourcesInput.syntheticPathwayEvidenceKeys`, and unchanged `RankedResources` output.

- [ ] **Step 1: Add the video-secondary RED tests**

In `tests/unit/matching/resources.test.ts`, import `primaryTrackPathwayCourses` and add a local builder that creates five foundations plus every exact pathway course needed by the test:

```ts
const exactPathwayCandidates = (
  primaryTrack: 'video',
  secondaryTrack: 'art_photo' | 'documentary' | 'commercial',
): ResourceCandidate[] => {
  const foundations = Array.from({ length: 5 }, (_, index) => course(index + 1, {
    metadata: {
      gradeYear: index < 3 ? 1 : 2,
      term: index % 2 === 0 ? '1학기' : '2학기',
      credits: 3,
      goalSummary: '사진·영상 기초를 익히는',
    },
    tags: [tag(`foundation_${index + 1}`)],
  }))
  const pathway = [
    ...primaryTrackPathwayCourses[primaryTrack],
    ...primaryTrackPathwayCourses[secondaryTrack],
  ].map((item, index) => course(index + 20, {
    title: item.title,
    metadata: {
      gradeYear: item.gradeYear,
      term: index % 2 === 0 ? '1학기' : '2학기',
      credits: 3,
      goalSummary: '전공 심화 과정을 익히는',
    },
    tags: [tag('unmatched_pathway')],
  }))
  return [...foundations, ...pathway]
}
```

Add this table-driven test:

```ts
it.each([
  ['art_photo', ['예술창작 프로젝트 세미나', '예술창작 프로젝트 랩']],
  ['documentary', ['다큐멘터리 세미나', '포스트 다큐멘터리 랩']],
  ['commercial', ['커머셜 포토그라피 세미나', '커머셜 포토그라피 랩']],
] as const)('uses %s only for the video path year 4', (secondaryTrack, fourthYearTitles) => {
  const candidates = exactPathwayCandidates('video', secondaryTrack)
  const foundations = candidates.filter(candidate => (
    candidate.type === 'course' && candidate.metadata.gradeYear <= 2
  ))
  const ranked = rankResources({
    primaryTrack: 'video',
    secondaryTrack,
    interestVector: Object.fromEntries(foundations.map(item => [item.tags[0]!.key, 1])),
    selectedInterests: [
      ...foundations.map(item => ({ key: item.tags[0]!.key, label: `${item.title} 선택` })),
      { key: 'video', label: '영상 촬영·편집' },
      { key: secondaryTrack, label: `${secondaryTrack} 두 번째 관심` },
    ],
    candidates,
  })

  expect(ranked.course).toHaveLength(10)
  expect(ranked.course.filter(item => item.displayMetadata.gradeYear === 3)
    .map(item => item.title)).toEqual([
      '영상 인터뷰 내러티브 워크숍',
      '영상 드론 콘텐츠 워크숍',
      '영상 콘텐츠 크리에이터 워크숍',
    ])
  expect(ranked.course.filter(item => item.displayMetadata.gradeYear === 4)
    .map(item => item.title)).toEqual(fourthYearTitles)
  expect(ranked.course.filter(item => item.displayMetadata.gradeYear === 4)
    .every(item => item.connectionReason.includes(`${secondaryTrack} 두 번째 관심`))).toBe(true)
  expect(JSON.stringify(ranked)).not.toContain('pathway_')
})
```

Add compatibility assertions:

```ts
it('keeps video year 3 only without a secondary track and ignores secondary for non-video primary', () => {
  const videoCandidates = exactPathwayCandidates('video', 'art_photo')
  const video = rankResources({
    primaryTrack: 'video',
    interestVector: { selected: 1 },
    selectedInterests: [{ key: 'selected', label: '실제 선택 문구' }],
    candidates: videoCandidates,
  })
  expect(video.course.filter(item => item.displayMetadata.gradeYear === 4)).toEqual([])

  const art = rankResources({
    primaryTrack: 'art_photo',
    secondaryTrack: 'documentary',
    interestVector: { selected: 1 },
    selectedInterests: [{ key: 'selected', label: '실제 선택 문구' }],
    candidates: videoCandidates,
  })
  expect(art.course.filter(item => item.displayMetadata.gradeYear >= 3)
    .map(item => item.title)).toEqual([
      '사물,데이터,이미지 워크숍',
      '사진과 장소 그리고 콘텍스트 워크숍',
      '예술창작 프로젝트 세미나',
      '예술창작 프로젝트 랩',
    ])
})
```

Add this wrong-grade secondary test:

```ts
it('does not force a secondary year-4 title stored with the wrong grade', () => {
  const ranked = rankResources({
    primaryTrack: 'video',
    secondaryTrack: 'art_photo',
    interestVector: {},
    selectedInterests: [
      { key: 'video', label: '영상 제작' },
      { key: 'art_photo', label: '예술사진 창작' },
    ],
    candidates: [course(90, {
      title: '예술창작 프로젝트 세미나',
      metadata: { gradeYear: 3, term: '1학기', credits: 3, goalSummary: '창작 프로젝트를 익히는' },
      tags: [tag('unmatched_pathway')],
    })],
  })

  expect(ranked.course).toEqual([])
})
```

- [ ] **Step 2: Add the course-cap RED test**

In `tests/unit/result/result-schema.test.ts`, replace the existing nine-course bound test with:

```ts
it('allows ten courses for five foundations and five verified pathway courses, but rejects eleven', () => {
  const snapshot = makeValidSnapshot()
  snapshot.resources.course = [
    course(101, 1), course(102, 1), course(103, 2), course(104, 2), course(105, 2),
    course(106, 3), course(107, 3), course(108, 3), course(109, 4), course(110, 4),
  ]
  expect(() => resultResourcesSchema.parse(snapshot.resources)).not.toThrow()

  snapshot.resources.course.push(course(111, 4))
  expect(() => resultResourcesSchema.parse(snapshot.resources)).toThrow()
})
```

- [ ] **Step 3: Run the new unit tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run --project unit \
  tests/unit/matching/resources.test.ts \
  tests/unit/result/result-schema.test.ts \
  -t "video path year 4|ten courses|video year 3 only"
```

Expected: the secondary-track cases fail because `RankResourcesInput` has no `secondaryTrack` contract and the schema rejects ten courses. The current no-secondary video behavior remains green.

- [ ] **Step 4: Implement the pathway-selection helpers**

In `server/modules/matching/resources.ts`, extend `RankResourcesInput`:

```ts
readonly secondaryTrack?: TrackKey
readonly syntheticPathwayEvidenceKeys?: readonly string[]
```

Add these private units below `matchesPathwayCourse()`:

```ts
interface SelectedPathwayCourse {
  readonly track: TrackKey
  readonly course: PrimaryTrackPathwayCourse
}

const selectedPathwayCourses = (
  primaryTrack: TrackKey,
  secondaryTrack: TrackKey | undefined,
): readonly SelectedPathwayCourse[] => Object.freeze([
  ...primaryTrackPathwayCourses[primaryTrack].map(course => ({ track: primaryTrack, course })),
  ...(primaryTrack === 'video'
    && secondaryTrack !== undefined
    && secondaryTrack !== primaryTrack
    ? primaryTrackPathwayCourses[secondaryTrack]
        .filter(course => course.gradeYear === 4)
        .map(course => ({ track: secondaryTrack, course }))
    : []),
])

const selectedLabelForTrack = (
  selectedInterests: readonly SelectedInterestEvidence[],
  track: TrackKey,
): string => {
  const label = selectedInterests.find(interest => interest.key === track)?.label
    ?? selectedInterests[0]?.label
  if (label === undefined) throw new Error('Selected interest label evidence is required')
  return label
}
```

Replace `withPrimaryTrackPathway()` with:

```ts
export const withPrimaryTrackPathway = (input: RankResourcesInput): RankResourcesInput => {
  if (input.primaryTrack === undefined) return input

  const selections = selectedPathwayCourses(input.primaryTrack, input.secondaryTrack)
  const selectedTracks = [...new Set(selections.map(selection => selection.track))]
  const evidenceByTrack = new Map(selectedTracks.map(track => [
    track,
    {
      key: pathwayEvidenceKey(track),
      label: selectedLabelForTrack(input.selectedInterests, track),
    },
  ]))
  const interestVector = { ...input.interestVector }
  const selectedInterests = [...input.selectedInterests]
  for (const evidence of evidenceByTrack.values()) {
    interestVector[evidence.key] ??= 1
    if (!selectedInterests.some(item => item.key === evidence.key)) {
      selectedInterests.push(evidence)
    }
  }

  const syntheticPathwayCourseIds = new Set(input.syntheticPathwayCourseIds)
  const syntheticPathwayEvidenceKeys = new Set(input.syntheticPathwayEvidenceKeys)
  const candidates = input.candidates.map((candidate): ResourceCandidate => {
    if (candidate.type !== 'course') return candidate
    const selection = selections.find(item => matchesPathwayCourse(candidate, item.course))
    if (selection === undefined) return candidate
    const evidenceKey = evidenceByTrack.get(selection.track)!.key
    if (candidate.tags.some(tag => tag.key === evidenceKey)) return candidate
    syntheticPathwayCourseIds.add(candidate.id)
    syntheticPathwayEvidenceKeys.add(evidenceKey)
    return {
      ...candidate,
      tags: [...candidate.tags, { key: evidenceKey, weight: 3, isPrimary: true }],
    }
  })

  return {
    ...input,
    interestVector,
    selectedInterests,
    candidates,
    ...(syntheticPathwayCourseIds.size === 0 ? {} : {
      syntheticPathwayCourseIds: Object.freeze(
        [...syntheticPathwayCourseIds].sort((left, right) => left - right),
      ),
      syntheticPathwayEvidenceKeys: Object.freeze(
        [...syntheticPathwayEvidenceKeys].sort(compareText),
      ),
    }),
  }
}
```

When selecting a result `primaryTag`, remove a tag only when both conditions hold:

```ts
syntheticPathwayCourseIds.has(candidate.id)
&& syntheticPathwayEvidenceKeys.has(tag.key)
```

This preserves an original positive `pathway_existing` tag when it was not injected by this call.

- [ ] **Step 5: Select five foundations plus all resolved pathway courses**

Resolve the ordered advanced candidates from `selectedPathwayCourses(primaryTrack, secondaryTrack)`. Then replace the primary-track course branch with:

```ts
const pathwayCandidates = selectedPathwayCourses(
  matchingInput.primaryTrack!,
  matchingInput.secondaryTrack,
).flatMap(selection => (
  courseCandidates.find(item => matchesPathwayCourse(item.candidate, selection.course)) ?? []
))
const foundationCap = Math.min(5, Math.max(0, 10 - pathwayCandidates.length))
const course = matchingInput.primaryTrack === undefined
  ? selectDiverse(courseCandidates, 5)
  : Object.freeze([
      ...selectDiverse(courseCandidates.filter(item => (
        item.candidate.metadata.gradeYear <= 2
      )), foundationCap),
      ...pathwayCandidates,
    ].slice(0, 10))
```

Change only `resources.course` in `shared/schemas/result.ts` to `.max(10)`.

- [ ] **Step 6: Run Task 1 GREEN and static checks**

Run:

```bash
corepack pnpm exec vitest run --project unit \
  tests/unit/matching/resources.test.ts \
  tests/unit/result/result-schema.test.ts
corepack pnpm typecheck
corepack pnpm exec eslint \
  server/modules/matching/resources.ts \
  shared/schemas/result.ts \
  tests/unit/matching/resources.test.ts \
  tests/unit/result/result-schema.test.ts
git diff --check
```

Expected: all commands exit zero; every existing four-track path test remains green.

- [ ] **Step 7: Commit Task 1**

```bash
git add -- \
  server/modules/matching/resources.ts \
  shared/schemas/result.ts \
  tests/unit/matching/resources.test.ts \
  tests/unit/result/result-schema.test.ts
git commit -m "feat: 2026-07-21 영상 2순위 4학년 교과 경로"
```

### Task 2: Wire the second ranked track through completion

**Files:**
- Modify: `server/modules/assessment/completion.ts:623-640`
- Modify: `tests/integration/result/completion.test.ts`

**Interfaces:**
- Consumes: Task 1's `RankResourcesInput.secondaryTrack` and `syntheticPathwayEvidenceKeys`.
- Produces: newly completed video-first snapshots with the unchanged `rankedTracks` tuple and a populated year-4 learning bucket.

- [ ] **Step 1: Add the completion RED fixture and test**

Add:

```ts
const videoArtSelections = (): AssessmentSelections => ({
  work: ['work.video_scene'],
  result: ['result.photo_portfolio'],
  style: ['style.solo'],
  career: ['career.video'],
  careerOther: null,
})

const videoArtResourceCandidates = (): ResourceCandidate[] => [
  ...([
    ['카메라와 영상 기초', 1, 'camera'],
    ['영상 프레임과 컷', 1, 'video'],
    ['포트폴리오 기초', 1, 'portfolio'],
    ['개인 창작 기초', 2, 'art_photo'],
    ['리서치와 이미지', 2, 'research'],
  ] as const).map(([title, gradeYear, key], index): ResourceCandidate => ({
    id: 130 + index,
    type: 'course',
    title,
    summary: `${title} 교과입니다.`,
    status: 'active',
    visibility: 'public',
    priority: 30 - index,
    sourceDate: '2026-07-14',
    metadata: { gradeYear, term: index % 2 === 0 ? '1학기' : '2학기', credits: 3, goalSummary: '기초 역량을 익히는' },
    tags: [tag(key)],
  })),
  ...([
    ['영상 인터뷰 내러티브 워크숍', 3, '1학기'],
    ['영상 드론 콘텐츠 워크숍', 3, '2학기'],
    ['영상 콘텐츠 크리에이터 워크숍', 3, '2학기'],
    ['예술창작 프로젝트 세미나', 4, '1학기'],
    ['예술창작 프로젝트 랩', 4, '2학기'],
  ] as const).map(([title, gradeYear, term], index): ResourceCandidate => ({
    id: 140 + index,
    type: 'course',
    title,
    summary: `${title} 교과입니다.`,
    status: 'active',
    visibility: 'public',
    priority: 20 - index,
    sourceDate: '2026-07-14',
    metadata: { gradeYear, term, credits: 3, goalSummary: '전공 프로젝트를 완성하는' },
    tags: [tag('unmatched_pathway')],
  })),
]
```

Add this service test:

```ts
it('uses the second ranked art-photo interest for a video-first year 4 path', async () => {
  const revision = await createAssessmentCatalogRevision(catalog())
  const completeAssessment = vi.fn(async () => ({ assessmentId: 701, publicId, created: true }))
  const service = createAssessmentCompletionService(serviceDependencies({
    loadResourceCandidates: async () => videoArtResourceCandidates(),
    completeAssessment,
  }))

  await service.submitAssessment({
    catalogRevision: revision,
    selections: videoArtSelections(),
    idempotencyKey,
  }, context)

  const snapshot = decodeResultSnapshot(completeAssessment.mock.calls[0]![0].resultSnapshot)
  expect(snapshot.rankedTracks.slice(0, 2)).toEqual(['video', 'art_photo'])
  expect(snapshot.learningPath[2].resources.map(course => course.title)).toEqual([
    '영상 인터뷰 내러티브 워크숍',
    '영상 드론 콘텐츠 워크숍',
    '영상 콘텐츠 크리에이터 워크숍',
  ])
  expect(snapshot.learningPath[3].resources.map(course => course.title)).toEqual([
    '예술창작 프로젝트 세미나',
    '예술창작 프로젝트 랩',
  ])
  expect(snapshot.resources.course).toHaveLength(10)
  expect(JSON.stringify(snapshot)).not.toContain('pathway_')
})
```

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```bash
corepack pnpm exec vitest run --project integration \
  tests/integration/result/completion.test.ts \
  -t "second ranked art-photo interest"
```

Expected: year 4 is empty because completion does not pass `rankedTracks[1]`.

- [ ] **Step 3: Pass the secondary track and synthetic-key set**

In both resource-matching calls inside `completion.ts`, add:

```ts
secondaryTrack: scored.rankedTracks[1]!,
```

In the second `rankResources()` call also add:

```ts
syntheticPathwayEvidenceKeys: matchingInput.syntheticPathwayEvidenceKeys,
```

Do not change the `resultSnapshotCore.rankedTracks`, faculty input, or any stored response.

- [ ] **Step 4: Run Task 2 GREEN and focused regression**

Run:

```bash
corepack pnpm exec vitest run --project integration tests/integration/result/completion.test.ts
corepack pnpm exec vitest run --project unit \
  tests/unit/matching/resources.test.ts \
  tests/unit/matching/learning-path.test.ts \
  tests/unit/result/result-schema.test.ts \
  tests/unit/components/ResultTimeline.test.ts \
  tests/unit/components/FacultyRecommendation.test.ts
corepack pnpm typecheck
corepack pnpm exec eslint \
  server/modules/assessment/completion.ts \
  tests/integration/result/completion.test.ts
git diff --check
```

Expected: every command exits zero; the new result has video in year 3 and art-photo in year 4, while faculty-card compact tests remain green.

- [ ] **Step 5: Commit Task 2**

```bash
git add -- server/modules/assessment/completion.ts tests/integration/result/completion.test.ts
git commit -m "feat: 2026-07-21 영상 2순위 교과 완료 연결"
```

---

## Post-task Review and Release Gate

After both tasks pass independent task reviews and the combined whole-branch review:

1. Run `corepack pnpm test`, `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm build`, and `git diff --check`.
2. Push `feature/photo-next-mvp` without force and run `node scripts/deploy-photo-next-release.mjs`.
3. Confirm staging and production `/api/health` report the exact released commit.
4. Create a new dummy-account result whose ranked tracks start `video`, `art_photo`; verify three video year-3 cards, two art-photo year-4 cards, no synthetic key, no overflow, and no console error.
5. Verify the reproduced mixed-interest dummy result shows only two compact supporting instructors in this order: `김태현`, `곽동욱`.
6. Do not rewrite any historical result row.
