# Supporting Instructor Scoring Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly generated results show up to two evidence-backed adjunct or part-time instructors without changing the full-time professor recommendation or fabricating fallback cards.

**Architecture:** Keep the existing candidate eligibility, primary/backup selection, threshold, immutable result schema, and Vue rendering. Add one specialist-only category scorer that selects the strongest student signal in each available specialist/result/career category, count distinct label-backed positive evidence keys, and apply the existing 50-point boundary when at least two independent keys match. Leave the weighted-average scorer used by full-time professor matching unchanged.

**Tech Stack:** TypeScript 6, Nuxt 4, Vitest 4, Vue 3, Cloudflare Workers

## Global Constraints

- Keep category weights exactly `specialist 0.50`, `result 0.30`, and `career 0.20`.
- Exclude a category from the denominator only when the candidate has no positive-weight tag in that category; a present category with no student signal remains zero.
- Keep the specialist threshold at `rawScore >= 50` and the result limit at two people.
- Count only distinct positive-signal keys with a selected questionnaire label in the specialist, result, or career category; two or more such keys raise a lower calculated score to exactly 50, while one weak key receives no floor.
- Keep deterministic ordering by qualification score, underlying calculated score, distinct verified evidence count, priority, then ID.
- Keep eligibility limited to active `adjunct|practitioner` candidates with `consultationRole: specialist`, an applicable primary/null link, and positive link evidence.
- Do not change primary or backup professor scoring, distribution, output schema, reason copy, or contact visibility.
- Do not add a database migration, result-page read, dependency, static fallback card, or historical-result backfill.
- Preserve the existing blue rounded PHOTO:NEXT card hierarchy; `app/components/result/FacultyRecommendation.vue` requires no change.
- The reproduced multi-selection must return `김태현` then `곽동욱` when `김사라` is the selected primary.
- Keep the existing compact supporting-card rendering and the data/schema cap of two instructors; supporting cards remain smaller than primary and backup professor cards.

---

## File Structure

- Modify `server/modules/matching/faculty.ts`: add the specialist-only strongest-match helper and use it only inside `scoreSpecialist()`.
- Modify `tests/unit/matching/faculty-balance.test.ts`: add the production-selection regression against the canonical seed and assessment catalog.
- Modify `tests/unit/matching/faculty.test.ts`: add an isolated anti-dilution boundary test while retaining exact-50 and zero-signal-category tests.
- Do not modify Vue components, shared result schemas, seed JSON, migrations, or API handlers.

### Task 1: Correct specialist scoring and lock the production regression

**Files:**
- Modify: `tests/unit/matching/faculty-balance.test.ts`
- Modify: `tests/unit/matching/faculty.test.ts`
- Modify: `server/modules/matching/faculty.ts:203-217,591-610`

**Interfaces:**
- Consumes: `signalForTag(student, tag): number`, `scoreSpecialist(student, candidate): SpecialistScore`, canonical `faculty-2026.json`, and canonical `assessment-options.json`.
- Produces: private `strongestCategoryMatch(student, tags, category): number`, private `countSpecialistEvidence(student, tags): number`, and internal `SpecialistScore.evidenceCount`; public `recommendFaculty()` signature and result remain unchanged.

- [ ] **Step 1: Add the exact questionnaire regression test**

Add this test to `canonical faculty recommendation balance` in `tests/unit/matching/faculty-balance.test.ts`:

```ts
it('links the two documentary-video time instructors for the reproduced multi-selection', () => {
  const reproducedSelections: AssessmentSelections = {
    work: ['work.photo_everyday', 'work.video_post'],
    result: ['result.documentary', 'result.brand_video'],
    style: ['style.solo', 'style.studio'],
    career: ['career.photo', 'career.video'],
    careerOther: null,
  }

  const result = recommendation(reproducedSelections, 3)

  expect(result.primary.name).toBe('김사라')
  expect(result.backup.name).toBe('윤태준')
  expect(result.specialists.map(person => person.name)).toEqual(['김태현', '곽동욱'])
  expect(result.specialists.map(person => person.title)).toEqual(['시간강사', '겸임교수'])
})
```

- [ ] **Step 2: Add an isolated anti-dilution test**

Add this test to `recommendFaculty` in `tests/unit/matching/faculty.test.ts`:

```ts
it('전문가의 선택하지 않은 세부 태그가 가장 강한 검증 분야를 희석하지 않는다', () => {
  const faculty = facultyFixture().slice(0, 3)
  faculty.push({
    ...clone(facultyFixture()[4]),
    id: 72,
    name: '복합분야 전문가',
    tags: [
      tag('focused_specialist', '선택한 전문분야', 'specialist'),
      tag('weak_specialist_a', '선택하지 않은 전문분야 A', 'specialist'),
      tag('weak_specialist_b', '선택하지 않은 전문분야 B', 'specialist'),
      tag('weak_specialist_c', '선택하지 않은 전문분야 C', 'specialist'),
      tag('focused_result', '선택한 결과물', 'result', 2),
      tag('weak_result_a', '선택하지 않은 결과물 A', 'result', 2),
      tag('weak_result_b', '선택하지 않은 결과물 B', 'result', 2),
      tag('weak_result_c', '선택하지 않은 결과물 C', 'result', 2),
    ],
  })
  const evidence = student(
    { ...zeroTracks(), video: 100 },
    { focused_specialist: 0.8, focused_result: 0.8 },
    { focused_specialist: '선택한 전문분야', focused_result: '선택한 결과물' },
  )

  const result = recommend(
    evidence,
    faculty,
    [{ primaryFacultyId: 2, specialistFacultyId: 72, tagKey: 'focused_specialist', priority: 1 }],
  )

  expect(result.primary.id).toBe(2)
  expect(result.specialists.map(({ id }) => id)).toContain(72)
})
```

- [ ] **Step 3: Run the two new tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run --project unit \
  tests/unit/matching/faculty-balance.test.ts \
  tests/unit/matching/faculty.test.ts \
  -t "reproduced multi-selection|가장 강한 검증 분야"
```

Expected: the production regression fails because `result.specialists` omits the expected candidates under the current per-category weighted average. The anti-dilution test also fails before any production edit. If the primary/backup assertions fail, stop and report the canonical distribution mismatch instead of weakening those assertions.

- [ ] **Step 4: Add the minimal specialist-only strongest-match helper**

Add these helpers next to `categoryMatch()` in `server/modules/matching/faculty.ts`:

```ts
const strongestCategoryMatch = (
  student: ParsedStudent,
  tags: readonly ParsedTag[],
  category: TagCategory,
): number => tags
  .filter(tag => tag.category === category && tag.weight > 0)
  .reduce((strongest, tag) => Math.max(strongest, signalForTag(student, tag)), 0)

const specialistScoringCategories = new Set<TagCategory>(['specialist', 'result', 'career'])

const countSpecialistEvidence = (
  student: ParsedStudent,
  tags: readonly ParsedTag[],
): number => new Set(tags
  .filter(tag => specialistScoringCategories.has(tag.category)
    && tag.weight > 0
    && signalForTag(student, tag) > 0
    && student.selectedLabels[tag.key] !== undefined)
  .map(tag => tag.key)).size
```

Extend `SpecialistScore` and replace `scoreSpecialist()` with this complete specialist-only implementation:

```ts
interface SpecialistScore {
  readonly candidate: ParsedFaculty
  readonly rawScore: number
  readonly qualificationScore: number
  readonly evidenceCount: number
}

const scoreSpecialist = (student: ParsedStudent, candidate: ParsedFaculty): SpecialistScore => {
  const tags = [...candidate.tags].sort(compareTags)
  const specialist = strongestCategoryMatch(student, tags, 'specialist')
  const result = strongestCategoryMatch(student, tags, 'result')
  const career = strongestCategoryMatch(student, tags, 'career')
  const components = [
    { category: 'specialist' as const, score: specialist, weight: 0.50 },
    { category: 'result' as const, score: result, weight: 0.30 },
    { category: 'career' as const, score: career, weight: 0.20 },
  ].filter(component => tags.some(tag => (
    tag.category === component.category && tag.weight > 0
  )))
  const availableWeight = components.reduce((sum, component) => sum + component.weight, 0)
  const weightedScore = components.reduce(
    (sum, component) => sum + component.score * component.weight,
    0,
  )
  const evidenceCount = countSpecialistEvidence(student, tags)
  const normalizedScore = availableWeight === 0 ? 0 : weightedScore / availableWeight
  return {
    candidate,
    rawScore: normalizedScore,
    qualificationScore: evidenceCount >= 2 ? Math.max(50, normalizedScore) : normalizedScore,
    evidenceCount,
  }
}
```

Filter on `qualificationScore >= 50`. Sort first by `qualificationScore`, then by the underlying `rawScore`, then by `evidenceCount`, candidate priority, and ID. Do not change `categoryMatch()` or the four calls inside `scorePrimary()`.

- [ ] **Step 5: Run the focused matcher suite and verify GREEN**

Run:

```bash
corepack pnpm exec vitest run --project unit \
  tests/unit/matching/faculty.test.ts \
  tests/unit/matching/faculty-balance.test.ts \
  tests/unit/components/FacultyRecommendation.test.ts
```

Expected: all three files pass. The reproduced result returns `김태현`, `곽동욱`; the existing 김명우 case remains inside the two-person cap; and the existing exact-50 inclusion, single-signal 49.9 exclusion, present-but-unselected result-category penalty, link eligibility, public-contact, primary balance, and compact-card tests remain green.

- [ ] **Step 6: Run static verification**

Run:

```bash
corepack pnpm typecheck
corepack pnpm exec eslint \
  server/modules/matching/faculty.ts \
  tests/unit/matching/faculty.test.ts \
  tests/unit/matching/faculty-balance.test.ts
git diff --check
```

Expected: every command exits zero with no diagnostics.

- [ ] **Step 7: Self-review and commit the implementation**

Confirm the diff contains exactly the three planned files and no seed, migration, schema, UI, or unrelated changes. Then run:

```bash
git add -- \
  server/modules/matching/faculty.ts \
  tests/unit/matching/faculty.test.ts \
  tests/unit/matching/faculty-balance.test.ts
git commit -m "fix: 2026-07-21 강사진 추천 점수 희석 보정"
```

Expected: one implementation commit containing the RED/GREEN regression tests and the specialist-only helper.

---

## Post-task Review and Release Gate

After Task 1 passes its independent spec-and-quality review and the whole-branch review:

1. Run `corepack pnpm test`, `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm build`, and `git diff --check`.
2. Push `feature/photo-next-mvp` without force and run `node scripts/deploy-photo-next-release.mjs`.
3. Confirm staging and production `/api/health` report the released commit.
4. Use the existing dummy student `010-9000-0002` without exposing its PIN in logs, resubmit the reproduced selections, and verify the newly created result API returns `김태현`, `곽동욱` in that order.
5. In a real mobile browser, verify both compact instructor cards render below the primary/backup cards, retain the example grid beneath them, create no horizontal overflow, and emit no console errors or warnings.
6. Do not update or backfill any historical result row; only the new dummy result is allowed to change during QA.
