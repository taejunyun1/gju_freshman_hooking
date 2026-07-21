# 추천 정합성 및 전공필수 교과 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 추천 근거와 화면 설명을 일치시키고, 전임교원 추천을 전문성 범위 안에서 완만하게 분산하며, 공식 전공필수 5과목을 모든 새 결과에 포함해 기존 파란색 UI로 표시한다.

**Architecture:** 기존 Nuxt/Nitro 결정형 추천 파이프라인과 Supabase `resources.metadata`를 유지한다. 추천 근거는 서버 내부의 명시적 매치 객체로 전달하고, 교과 이수구분은 `requirement_type` 하나로 seed·DB·결과 DTO·UI를 관통한다. 외부 서비스와 신규 네트워크 호출은 추가하지 않는다.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript 6, Zod 4, Vitest, Supabase PostgreSQL, Cloudflare Workers

## Global Constraints

- OpenAI API는 사용하지 않는다.
- 신규 외부 서비스, 신규 네트워크 호출, 별도 추천 엔진은 추가하지 않는다.
- 강사·겸임은 지원 역할이고 최대 2명이며 전임교원보다 작은 카드로 표시한다.
- 전임교원 전문성이 명확한 50점 이상 단독 우위 경로는 해당 전문교수를 우선한다.
- 1,920개 운영 조합에서 윤태준 교수는 55% 이하이고 세 전임교원은 각각 20% 이상이어야 한다.
- 다큐멘터리·예술사진·광고사진·영상과 기술의 1순위 비율은 각각 15% 이상 40% 이하여야 한다.
- 공식 전공필수는 `라이팅과 스튜디오`, `디지털 이미지 제작과 프린트`, `영상 컬러와 포스트 프로덕션`, `커머셜 포토그라피 기초 워크숍`, `커머셜 포토그라피 심화 워크숍` 정확히 5과목이다.
- 새 결과 교과는 최대 15개, 학년별 최대 5개이며 기존 맞춤 경로를 제거하지 않는다.
- 새 강조색을 추가하지 않고 기존 파란색·남색·흰색 토큰만 사용한다.
- 기존 저장 결과는 일괄 재작성하지 않는다.
- 확인되지 않은 2026 광고사진 프로젝트를 만들지 않는다.

---

### Task 1: 전임교원 분산과 강사 추천 근거 통일

**Files:**
- Modify: `server/modules/matching/faculty.ts`
- Modify: `tests/unit/matching/faculty.test.ts`
- Modify: `tests/unit/matching/faculty-balance.test.ts`

**Interfaces:**
- Consumes: `RecommendFacultyInput.student`, `FacultySpecialistLink`, `distributionKey`
- Produces: 기존 `FacultyRecommendationResult`; 공개 DTO 형태는 변경하지 않는다.
- Internal: 링크별 `SpecialistMatch`는 `candidate`, `linkTagKey`, `labelKey`, `linkPriority`, `qualificationScore`, `supportScore`, `evidenceCount`를 보존한다.

- [ ] **Step 1: 강사 링크 근거 회귀 테스트를 먼저 작성한다**

`tests/unit/matching/faculty.test.ts`에 다음 행동을 고정한다.

```ts
it('uses the same specialist link tag for eligibility, ranking, and displayed reason', () => {
  const result = recommendFaculty(mixedCommercialVideoFixture())
  const kim = result.specialists.find(person => person.name === '김태현')
  expect(kim?.reason).not.toContain('팀으로 제작')
})

it('prioritizes a specific exhibition link over a broad art-photo link', () => {
  const result = recommendFaculty(exhibitionCuratingFixture())
  expect(result.specialists.map(person => person.name)).toContain('정철호')
  expect(result.specialists).toHaveLength(2)
})
```

- [ ] **Step 2: 테스트가 현재 잘못된 근거·순위 때문에 실패하는지 확인한다**

Run: `corepack pnpm vitest run --project unit tests/unit/matching/faculty.test.ts`

Expected: 혼합 근거 문구 또는 정철호 우선순위 assertion이 FAIL한다.

- [ ] **Step 3: 링크별 매치 객체와 동일 근거 설명을 구현한다**

`server/modules/matching/faculty.ts`에서 `eligibleSpecialistIds` 축약을 제거하고 다음 의미의 내부 객체를 만든다.

```ts
interface SpecialistMatch {
  readonly candidate: ParsedFaculty
  readonly linkTagKey: string
  readonly labelKey: string
  readonly linkPriority: number
  readonly qualificationScore: number
  readonly supportScore: number
  readonly evidenceCount: number
}
```

각 링크는 선택된 총괄교수 또는 학과 공통 링크이며 `hasPositiveLinkSignal(student, link.tagKey)`가 참일 때만 평가한다. 같은 전문가의 여러 링크 중 `구체 세부태그 > 트랙 태그`, 링크 신호, 링크 priority, 기존 보조 점수, 후보 priority, ID 순으로 가장 강한 하나를 남긴다. `resultFor`와 `reasonFor`에 선택된 `labelKey`를 전달해 지원 강사의 화면 이유도 같은 링크 라벨을 사용한다.

- [ ] **Step 4: 전임교원 분산 회귀 테스트를 강화한다**

`tests/unit/matching/faculty-balance.test.ts`의 1,920개 검사 범위를 다음으로 변경한다.

```ts
expect(counts.get('윤태준')!).toBeLessThanOrEqual(1_920 * 0.55)
expect(counts.get('조대연')!).toBeGreaterThanOrEqual(1_920 * 0.20)
expect(counts.get('김사라')!).toBeGreaterThanOrEqual(1_920 * 0.20)
```

대표 순수 다큐멘터리·지역기록·예술사진·영상 경로의 기존 담당교수 assertion은 그대로 유지한다.

- [ ] **Step 5: 분포 테스트가 현재 윤태준 약 59%와 조대연 약 16%로 실패하는지 확인한다**

Run: `corepack pnpm vitest run --project unit tests/unit/matching/faculty-balance.test.ts`

Expected: 새 20%/55% 범위 assertion이 FAIL한다.

- [ ] **Step 6: 혼합·경계 후보 풀만 완만하게 확장한다**

`selectPrimaryScores`에서 50점 이상 단독 우위와 signature clear 규칙은 유지한다. 나머지 분배 경로에서 `routingFit > 0`이고 최상위와의 절대차가 35점 이하인 후보를 안정적 ID 순서 풀에 포함한다. 전문 근거 0인 후보는 제외하고 `distributionKey`로 선택한다. 필요하면 상대 바닥값만 0.5까지 낮추되 대표 전문경로 테스트가 유지되는 최소 변경에서 멈춘다.

- [ ] **Step 7: 광고사진 총괄 전용 설명 테스트와 구현을 추가한다**

광고사진 단독 1순위에서 전임교원 이유가 광고 전문성을 직접 주장하지 않는지 고정한다.

```ts
expect(result.primary.reason).toContain('전체 학습경로와 상담을 총괄')
expect(result.primary.reason).toContain('곽동욱')
expect(result.primary.reason).toContain('광고·패션·제품')
expect(result.primary.reason).not.toContain(`${result.primary.expertise} 전문분야와 연결`)
```

`reasonFor`는 학생의 공동 최고 트랙에 `commercial`이 포함되고 소유 전임교원이 없을 때 전용 문구를 반환한다. 곽동욱 링크가 실제 추천에 포함되는 기존 assertion도 유지한다.

- [ ] **Step 8: Task 1 집중 테스트를 통과시킨다**

Run: `corepack pnpm vitest run --project unit tests/unit/matching/faculty.test.ts tests/unit/matching/faculty-balance.test.ts`

Expected: PASS, 강사 최대 2명과 세 전임교원 범위 모두 만족한다.

- [ ] **Step 9: 커밋한다**

```bash
git add server/modules/matching/faculty.ts tests/unit/matching/faculty.test.ts tests/unit/matching/faculty-balance.test.ts
git commit -m "fix: 2026-07-21 교수진 추천 근거 및 분산 보정"
```

### Task 2: 다큐멘터리 점수 균형과 영상 2순위 진로 문장

**Files:**
- Modify: `supabase/seed/assessment-options.json`
- Regenerate: `supabase/seed/assessment-options.sql`
- Modify: `tests/unit/assessment/assessment-seed.test.ts`
- Modify: `tests/unit/assessment/scoring.test.ts`
- Modify: `server/modules/assessment/completion.ts`
- Modify: `server/modules/assessment/career-narrative.ts`
- Modify: `tests/unit/assessment/career-narrative-eval.test.ts`
- Modify: `tests/unit/assessment/openai-career-narrative.test.ts`
- Modify: `tests/unit/matching/career-narrative.test.ts`

**Interfaces:**
- Consumes: 기존 assessment catalog, `ResultSnapshotCore.rankedTracks`, `resources.course`
- Produces: 기존 `CareerNarrative` DTO; evidence ID 형식과 4문장 구조는 유지한다.

- [ ] **Step 1: 선택지 분포 테스트를 먼저 추가한다**

실제 10×8×6×4 = 1,920개 최소 선택 조합을 순회하고 각 1순위가 15~40%인지 검증한다. 두 대상 문항의 정확한 가중치도 고정한다.

```ts
expect(byKey('work.photo_everyday').trackWeights).toMatchObject({ documentary: 3, art_photo: 2 })
expect(byKey('work.brand_region').trackWeights).toMatchObject({ documentary: 3, commercial: 2 })
for (const count of Object.values(counts)) {
  expect(count).toBeGreaterThanOrEqual(1_920 * 0.15)
  expect(count).toBeLessThanOrEqual(1_920 * 0.40)
}
```

- [ ] **Step 2: RED를 확인하고 JSON 두 행만 보정한 뒤 seed SQL을 재생성한다**

Run before change: `corepack pnpm vitest run --project unit tests/unit/assessment/assessment-seed.test.ts tests/unit/assessment/scoring.test.ts`

Expected: 다큐멘터리 하한 또는 exact weight assertion이 FAIL한다.

Change only the four numbers in the design, then run:

`corepack pnpm exec tsx scripts/seed-assessment-options.ts --write`

- [ ] **Step 3: 영상 1순위 연결형 문장 테스트를 먼저 작성한다**

예술사진·다큐멘터리·광고사진을 각각 2순위로 둔 core fixture에서 다음을 검증한다.

```ts
expect(choice.choices[0]).toMatchObject({
  templateId: 'direction_bridge_v1',
  factRefs: ['interest:work.video_scene', 'track:video', `track:${secondaryTrack}`],
})
expect(narrative.sentences[1].text).toContain(expectedFourthYearCourse)
```

다중 선택에서 첫 관심사로 top track 기여가 가장 큰 선택지가 선택되는 테스트도 추가한다.

- [ ] **Step 4: RED를 확인한다**

Run: `corepack pnpm vitest run --project unit tests/unit/assessment/career-narrative-eval.test.ts tests/unit/assessment/openai-career-narrative.test.ts tests/unit/matching/career-narrative.test.ts`

Expected: `direction_focus_v1` 또는 기초 교과 선택 때문에 FAIL한다.

- [ ] **Step 5: top-track 기여 관심사와 영상 bridge를 구현한다**

`completion.ts`에서 catalog의 실제 그룹 가중치와 option track weight를 사용해 `selectedInterests`를 top track 기여도 내림차순으로 정렬한다. 동점은 `work → result → career → style`, 기존 option order 순서로 결정한다.

`career-narrative.ts`에서는 top track이 video이고 두 번째 track fact가 있으면 `direction_bridge_v1`과 세 fact ref를 선택한다. learning course facts는 이 경우 영상 3학년 pathway 한 과목과 secondary track 4학년 pathway 한 과목을 실제 `resources.course`에서 선택한다. 없으면 기존 안전 fallback을 사용한다.

- [ ] **Step 6: Task 2 집중 테스트와 생성물 검증을 통과시킨다**

Run:

```bash
corepack pnpm exec tsx scripts/seed-assessment-options.ts --check
corepack pnpm vitest run --project unit tests/unit/assessment/assessment-seed.test.ts tests/unit/assessment/scoring.test.ts tests/unit/assessment/career-narrative-eval.test.ts tests/unit/assessment/openai-career-narrative.test.ts tests/unit/matching/career-narrative.test.ts
```

Expected: PASS.

- [ ] **Step 7: 커밋한다**

```bash
git add supabase/seed/assessment-options.json supabase/seed/assessment-options.sql server/modules/assessment/completion.ts server/modules/assessment/career-narrative.ts tests/unit/assessment tests/unit/matching/career-narrative.test.ts
git commit -m "fix: 2026-07-21 다큐멘터리 균형 및 영상 진로 문장"
```

### Task 3: 전공필수 데이터 계약과 추천 포함

**Files:**
- Modify: `supabase/seed/curriculum-2026.json`
- Modify: `scripts/seed-content.ts`
- Regenerate: `supabase/seed/content-2026.sql`
- Create: `supabase/migrations/202607210034_required_course_classification.sql`
- Modify: `shared/schemas/admin-resources.ts`
- Modify: `server/modules/admin/resources.ts`
- Modify: `server/modules/assessment/completion.ts`
- Modify: `server/modules/matching/resources.ts`
- Modify: `shared/schemas/result.ts`
- Modify: `shared/types/result.ts`
- Modify: `app/components/admin/ResourceEditor.vue`
- Modify: `tests/unit/content/content-seed.test.ts`
- Modify: `tests/integration/admin/resources.test.ts`
- Modify: `tests/unit/matching/resources.test.ts`
- Modify: `tests/unit/result/result-schema.test.ts`
- Modify: `tests/unit/components/AdminResources.test.ts`
- Create: `supabase/tests/required_course_classification.test.sql`

**Interfaces:**
- Adds admin metadata: `requirement_type: 'major_required' | 'major_elective'`
- Adds candidate metadata: `requirementType: 'major_required' | 'major_elective'`
- Adds optional historical result metadata: `CourseDisplayMetadata.requirementType?: 'major_required' | 'major_elective'`
- New snapshots always populate `requirementType`; old snapshots without it remain valid.

- [ ] **Step 1: 공식 이수구분 seed 테스트를 먼저 작성한다**

`tests/unit/content/content-seed.test.ts`에서 정확히 5개 전필 제목과 나머지 36개 전선을 검증한다.

```ts
expect(curriculum.filter(course => course.requirementType === 'major_required').map(course => course.title))
  .toEqual(requiredCourseTitles)
expect(curriculum.filter(course => course.requirementType === 'major_elective')).toHaveLength(36)
```

- [ ] **Step 2: RED를 확인하고 seed·parser·SQL을 갱신한다**

Run: `corepack pnpm vitest run --project unit tests/unit/content/content-seed.test.ts`

Expected: `requirementType` 누락으로 FAIL한다.

41개 JSON 행에 `requirementType`을 기록하고 `curriculumRecordSchema`, `deriveContentSeed`가 `metadata.requirement_type`을 생성하게 한다. `EXPECTED_CONTENT_REVISION`을 새 canonical hash로 갱신하고 `corepack pnpm exec tsx scripts/seed-content.ts --write`로 SQL을 재생성한다.

- [ ] **Step 3: 관리자 메타데이터와 게시 검증 테스트를 먼저 작성한다**

`major_required`, `major_elective`만 허용하고 공개 교과에 값이 없으면 `COURSE_METADATA_REQUIRED`를 반환하는 통합 테스트를 추가한다. 관리자 편집 preview가 `requirementType`을 전달하는 컴포넌트 테스트도 추가한다.

- [ ] **Step 4: 관리자 schema·service·editor를 최소 구현한다**

`courseAdminResourceMetadataSchema`에 `requirement_type`을 추가하고 게시 검증에 필수 조건을 추가한다. `ResourceEditor.vue` 교과 필드에 다음 select를 추가한다.

```vue
<label>이수 구분
  <select v-model="editable.metadata.requirement_type" name="requirement_type">
    <option value="major_required">전공필수</option>
    <option value="major_elective">전공선택</option>
  </select>
</label>
```

- [ ] **Step 5: 결과 schema·매칭 RED 테스트를 먼저 작성한다**

`tests/unit/matching/resources.test.ts`에서 관심 신호가 없는 전필도 5개 포함되고 맞춤 경로와 ID 중복이 없으며 video+secondary 최대 15개인지 검증한다. `tests/unit/result/result-schema.test.ts`는 15개 허용·16개 거부, 과거 optional field 허용을 검증한다.

- [ ] **Step 6: RED를 확인한다**

Run: `corepack pnpm vitest run --project unit tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts`

Expected: 현재 10개 상한과 전필 미강제 때문에 FAIL한다.

- [ ] **Step 7: 전필 병합과 DTO 전달을 구현한다**

`ResourceCandidate` 교과 metadata와 `mapResourceRow`에 `requirementType`을 추가한다. rank 단계에서 유효한 `major_required` 교과를 일반 추천·pathway 결과와 ID로 중복 제거해 병합한다. 전필만의 연결 이유는 다음 형식을 사용한다.

```ts
`${course.title}은(는) 사진영상미디어학과의 공통 제작 기반을 익히는 전공필수 교과입니다.`
```

결과 schema course max를 15로 늘리고 학년 bucket max 5는 유지한다. `displayMetadata.requirementType`은 schema에서 optional로 읽지만 새 candidate mapping에서는 항상 넣는다.

- [ ] **Step 8: 운영 migration과 pgTAP을 추가한다**

`202607210034_required_course_classification.sql`은 `academic_year = 2026`인 course metadata에 제목 기준으로 정확한 5개는 `major_required`, 나머지는 `major_elective`를 넣는다. 다른 학년도와 다른 resource type은 변경하지 않는다. pgTAP은 5/36 수량과 정확한 제목을 검증한다.

- [ ] **Step 9: Task 3 집중 검증을 통과시킨다**

Run:

```bash
corepack pnpm exec tsx scripts/seed-content.ts --check
corepack pnpm vitest run --project unit tests/unit/content/content-seed.test.ts tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts tests/unit/components/AdminResources.test.ts
corepack pnpm vitest run --project integration tests/integration/admin/resources.test.ts
```

Expected: PASS.

- [ ] **Step 10: 커밋한다**

```bash
git add supabase/seed/curriculum-2026.json supabase/seed/content-2026.sql scripts/seed-content.ts supabase/migrations/202607210034_required_course_classification.sql supabase/tests/required_course_classification.test.sql shared server app/components/admin/ResourceEditor.vue tests
git commit -m "feat: 2026-07-21 전공필수 교과 추천 계약"
```

### Task 4: 결과 화면 용어와 전공필수 배지

**Files:**
- Modify: `app/components/result/ResourceCard.vue`
- Modify: `app/components/result/TrackScore.vue`
- Modify: `app/components/result/CareerNarrative.vue`
- Modify: `tests/unit/components/ResultTimeline.test.ts`
- Modify: `tests/unit/components/CareerNarrative.test.ts`
- Create: `tests/unit/components/ResourceCard.test.ts`

**Interfaces:**
- Consumes: `CourseDisplayMetadata.requirementType`
- Produces: 같은 result page DOM 구조에 `data-course-requirement="major_required"`와 텍스트 배지를 추가한다.

- [ ] **Step 1: UI 카피와 배지 실패 테스트를 먼저 작성한다**

```ts
expect(wrapper.get('[data-course-requirement="major_required"]').text()).toContain('전공필수')
expect(electiveWrapper.find('[data-course-requirement]').exists()).toBe(false)
expect(trackScoreSource()).toContain('응답 기반 관심 방향')
expect(trackScoreSource()).toContain('교육환경 근거 충족도')
expect(careerWrapper.text()).toContain('선택한 응답과 확인된 학과 데이터')
expect(careerWrapper.text()).not.toContain('AI가 도움')
```

- [ ] **Step 2: RED를 확인한다**

Run: `corepack pnpm vitest run --project unit tests/unit/components/ResourceCard.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/components/CareerNarrative.test.ts`

Expected: 배지와 새 카피가 없어 FAIL한다.

- [ ] **Step 3: 기존 색 토큰으로 작은 배지를 구현한다**

`ResourceCard.vue`의 `COURSE` 옆에 조건부 텍스트 span을 둔다. CSS는 새 token 없이 다음 성격을 따른다.

```css
.resource-card__required-badge {
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-radius: 0.4rem;
  background: color-mix(in srgb, var(--color-primary) 9%, var(--color-surface));
  padding: 0.12rem 0.35rem;
  color: var(--color-primary);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
}
```

작은 화면에서도 header가 줄바꿈되고 날짜가 잘리지 않도록 type과 badge를 묶는 flex wrapper를 사용한다.

- [ ] **Step 4: 점수·AI 카피를 설계 문구로 교체한다**

TrackScore의 제목·설명과 환경 라벨을 설계의 정확한 용어로 바꾸고, CareerNarrative의 AI 도움 안내를 결정형 데이터 안내로 교체한다. 레이아웃과 색은 변경하지 않는다.

- [ ] **Step 5: Task 4 집중 테스트와 타입 검사를 통과시킨다**

Run:

```bash
corepack pnpm vitest run --project unit tests/unit/components/ResourceCard.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/components/CareerNarrative.test.ts
corepack pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: 커밋한다**

```bash
git add app/components/result tests/unit/components
git commit -m "feat: 2026-07-21 전공필수 배지 및 결과 용어"
```

### Task 5: 전체 회귀검증과 배포

**Files:**
- Modify only if verification exposes a defect covered by this plan.

**Interfaces:**
- Consumes: Tasks 1–4 commits
- Produces: Cloudflare staging/production deployment and smoke evidence

- [ ] **Step 1: 생성물·diff·전체 테스트를 검증한다**

Run:

```bash
corepack pnpm exec tsx scripts/seed-assessment-options.ts --check
corepack pnpm exec tsx scripts/seed-content.ts --check
git diff --check
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Expected: all PASS.

- [ ] **Step 2: 로컬 DB migration과 pgTAP을 검증한다**

Run:

```bash
corepack pnpm exec supabase db reset --local
corepack pnpm exec supabase test db --local supabase/tests/required_course_classification.test.sql
corepack pnpm exec supabase test db --local
```

Expected: migration 적용, 전필 정확히 5개, 전체 pgTAP PASS.

- [ ] **Step 3: 배포 스크립트로 staging·production을 갱신한다**

기존 fail-closed release 스크립트를 사용한다. 비밀값을 출력하지 않고 state 파일의 commit이 현재 HEAD와 일치하는지 확인한다.

- [ ] **Step 4: 신규 더미 결과 smoke를 확인한다**

- 새 설문 결과에 전공필수 5개가 학년별로 모두 표시된다.
- `전공필수` 배지는 필수 과목에만 보인다.
- 영상 1순위 결과 문장이 2순위와 4학년 교과를 언급한다.
- 광고사진 총괄 설명은 전임 총괄 + 곽동욱 실무연계 구조다.
- 지원 강사는 최대 2명이며 표시 이유가 같은 링크 관심사다.
- 응답 방향·교육환경·결정형 문구가 새 용어로 보인다.

- [ ] **Step 5: 최종 커밋 또는 배포 메타데이터를 기록한다**

검증 수정이 있었다면 해당 파일만 커밋하고, 없으면 새 빈 커밋을 만들지 않는다.
