# Result Examples and Capability Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관심사 기반 전문분야·포트폴리오 예시를 로컬에서 제공하고, 시설→카메라→렌즈 순으로 학과 기반을 보여주며, 검증된 핵심 조건이 갖춰진 결과의 교육환경 연결도를 최대 100점으로 계산한다.

**Architecture:** 공유 카탈로그가 네 트랙의 예시 텍스트와 기존 선택창 그래픽 키를 제공하고, 재사용 가능한 시각 컴포넌트가 선택 화면과 결과 화면을 같은 그래픽 언어로 묶는다. 서버는 검증 기자재 유형을 결과 스냅샷에 선택적으로 보존하고, 시설·바디·렌즈·학년별 교과·총괄교수의 존재 여부만으로 준비도 점수를 계산한다. 기존 저장 결과는 조회 시 동일한 순수 함수로 다시 계산한다.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript 6, Zod 4, Vitest, Vue Test Utils, Playwright

## Global Constraints

- OpenAI API와 다른 외부 생성 API를 호출하지 않는다.
- 카테고리는 `다큐멘터리 사진`, `예술사진`, `광고사진`, `영상과 기술(AI·편집·드론)` 네 가지다.
- 예시에는 항상 `관심사 기반 예시` 또는 `예시`를 표시하고 검증 사실과 분리한다.
- 기존 팔레트 `#2563EB`, `#14213D`, `#EAF1FF`, `#F5F8FF`, `#FFFFFF`, `#58677F`만 사용한다.
- 기존 서체 Wanted Sans, Pretendard, IBM Plex Mono와 기존 radius 토큰만 사용한다.
- 결과 화면의 최대 제목 크기는 기존 `2rem`을 넘지 않는다.
- 초기 학과 기반 순서는 관련 시설 1개, 검증 카메라 바디 1개, 검증 렌즈 1개다.
- 교육환경 연결도는 시설 35점, 바디 15점, 렌즈 15점, 관련 교과 학년당 6.25점(최대 25점), 활성 총괄교수 10점이다.
- 예시 콘텐츠는 교육환경 연결도에 포함하지 않는다.
- 기존 결과·상담·관리자 내보내기 API의 외부 필드 이름을 바꾸지 않는다.
- 모바일 390px에서 가로 스크롤이 없어야 하고, 모든 조작 요소는 최소 44px이다.
- 모든 동작 변경은 실패하는 테스트를 먼저 확인한 뒤 최소 구현으로 통과시킨다.

### Frontend Design Direction

- **Color:** 기존 블루 노트 팔레트만 유지하고 예시 카드에 새 강조색을 추가하지 않는다.
- **Type:** 제목은 Wanted Sans, 본문은 Pretendard, `EXAMPLE`·카테고리 코드는 IBM Plex Mono를 사용한다.
- **Layout:** 검증 카드보다 한 단계 낮은 작은 3열 예시 스트립을 사용한다.

```text
[ 관심사 기반 예시 ]
[선형 그래픽] [선형 그래픽] [선형 그래픽]
[분야/작품명] [분야/작품명] [분야/작품명]
[한 문장]     [한 문장]     [한 문장]
```

- **Signature:** 입시 선택창의 선형 프레임 그래픽을 결과의 전문분야·포트폴리오에 그대로 이어, 학생의 선택이 결과로 연결되었다는 시각적 연속성을 만든다.
- **Self-critique:** 새로운 일러스트 스타일이나 장식색은 일반적인 카드 갤러리처럼 보이므로 제외한다. 기존 선택 그래픽의 재사용만이 이 서비스의 질문→결과 관계를 직접 표현한다.

---

### Task 1: 관심사 기반 예시 카탈로그와 공용 그래픽

**Files:**
- Create: `shared/content/result-examples.ts`
- Create: `app/components/visual/SelectionGraphic.vue`
- Create: `app/components/result/ResultExampleGrid.vue`
- Modify: `app/components/assessment/OptionCard.vue`
- Modify: `app/components/result/FacultyRecommendation.vue`
- Modify: `app/components/result/ResultTimeline.vue`
- Test: `tests/unit/result/result-examples.test.ts`
- Test: `tests/unit/components/ResultTimeline.test.ts`

**Interfaces:**
- Produces: `resultExamplesFor(track: TrackKey, kind: 'specialty' | 'portfolio'): readonly ResultExample[]`
- Produces: `ResultExample = { key: string; title: string; description: string; visualKey: VisualKey }`
- Produces: `<SelectionGraphic visual-key code :selected="false" />`
- Consumes: `ResultTimeline.snapshot.rankedTracks[0]`

- [ ] **Step 1: 예시 카탈로그 실패 테스트 작성**

```ts
import { describe, expect, it } from 'vitest'
import { trackKeys } from '../../../shared/types/domain'
import { resultExamplesFor } from '../../../shared/content/result-examples'

describe('result example catalog', () => {
  it.each(trackKeys)('%s 전문분야와 포트폴리오 예시를 각각 3개 제공한다', (track) => {
    for (const kind of ['specialty', 'portfolio'] as const) {
      const examples = resultExamplesFor(track, kind)
      expect(examples).toHaveLength(3)
      expect(new Set(examples.map(item => item.key)).size).toBe(3)
      expect(examples.every(item => item.title && item.description && item.visualKey)).toBe(true)
    }
  })

  it('영상 트랙에 AI·편집·드론 예시를 제공한다', () => {
    expect(resultExamplesFor('video', 'specialty').map(item => item.title))
      .toEqual(['영상편집·색보정', 'AI 이미지·영상', '드론·360 콘텐츠'])
  })
})
```

- [ ] **Step 2: 카탈로그 테스트가 모듈 부재로 실패하는지 확인**

Run: `corepack pnpm exec vitest run --project unit tests/unit/result/result-examples.test.ts`

Expected: FAIL with `Cannot find module '../../../shared/content/result-examples'`.

- [ ] **Step 3: 네 트랙의 고정 예시 카탈로그 구현**

```ts
export interface ResultExample {
  readonly key: string
  readonly title: string
  readonly description: string
  readonly visualKey: VisualKey
}

const catalog = {
  documentary: {
    specialty: [
      ['documentary-interview', '인터뷰·구술기록', '사람의 목소리와 삶을 사진·영상 기록으로 구성합니다.', 'interview_strip'],
      ['documentary-archive', '지역문화 아카이브', '장소와 공동체의 변화를 조사하고 시각 자료로 축적합니다.', 'location_board'],
      ['documentary-story', '포토스토리 편집', '여러 장의 사진과 글을 하나의 이야기 흐름으로 엮습니다.', 'photobook_spread'],
    ],
    portfolio: [
      ['documentary-essay', '인물 인터뷰 포토에세이', '인터뷰와 인물사진을 결합한 짧은 기록 연작입니다.', 'interview_strip'],
      ['documentary-book', '지역 기록 사진집', '지역의 장소와 사람을 조사해 사진집으로 편집합니다.', 'photobook_spread'],
      ['documentary-public', '공공 아카이브 프로젝트', '공공·문화기관과 연결할 수 있는 기록 포트폴리오입니다.', 'location_board'],
    ],
  },
  art_photo: {
    specialty: [
      ['art-research', '개인 창작 리서치', '개인의 관심을 자료 조사와 이미지 실험으로 발전시킵니다.', 'contact_sheet'],
      ['art-installation', '사진·영상 설치', '사진과 영상이 공간에서 만나는 전시 형태를 탐색합니다.', 'gallery_grid'],
      ['art-book', '포토북·전시 구성', '이미지 순서와 공간 배치로 작업의 의미를 전달합니다.', 'photobook_spread'],
    ],
    portfolio: [
      ['art-series', '개인 주제 사진 연작', '하나의 주제를 일관된 시각 언어로 완성한 연작입니다.', 'photo_frame'],
      ['art-exhibition', '사진·영상 설치전', '사진과 영상, 공간 구성을 결합한 전시 예시입니다.', 'gallery_grid'],
      ['art-ai', 'AI 이미지 실험 포트폴리오', '촬영 이미지와 생성 기술을 결합한 기술적 이미지 실험입니다.', 'edit_timeline'],
    ],
  },
  commercial: {
    specialty: [
      ['commercial-product', '제품·패션 촬영', '제품의 특성과 스타일을 조명과 구도로 표현합니다.', 'studio_still'],
      ['commercial-lighting', '스튜디오 조명', '빛의 방향과 질감을 설계해 상업 이미지를 완성합니다.', 'photo_frame'],
      ['commercial-brand', '브랜드 이미지 기획', '브랜드 메시지를 사진·영상 캠페인으로 구성합니다.', 'project_board'],
    ],
    portfolio: [
      ['commercial-product-work', '제품 광고 이미지', '제품 세팅과 조명, 보정을 보여주는 광고사진 예시입니다.', 'studio_still'],
      ['commercial-fashion', '패션·뷰티 화보', '인물 연출과 스타일링을 결합한 에디토리얼 예시입니다.', 'photo_frame'],
      ['commercial-campaign', '브랜드 캠페인 포트폴리오', '기획안부터 촬영 결과까지 묶은 캠페인 예시입니다.', 'project_board'],
    ],
  },
  video: {
    specialty: [
      ['video-post', '영상편집·색보정', '촬영한 장면의 리듬과 색을 다듬어 완성도를 높입니다.', 'edit_timeline'],
      ['video-ai', 'AI 이미지·영상', '촬영과 생성 기술을 결합해 기술적 이미지를 실험합니다.', 'contact_sheet'],
      ['video-drone', '드론·360 콘텐츠', '공중 촬영과 몰입형 화면으로 공간을 새롭게 기록합니다.', 'video_frame'],
    ],
    portfolio: [
      ['video-short', '시네마틱 단편', '프레임과 컷, 사운드를 설계한 짧은 영상 작품입니다.', 'video_frame'],
      ['video-reel', '촬영·편집 쇼릴', '촬영과 편집 역량을 짧게 모아 보여주는 영상 포트폴리오입니다.', 'edit_timeline'],
      ['video-fusion', '드론·AI 융합 영상', '드론 촬영과 AI 후반작업을 결합한 기술 프로젝트 예시입니다.', 'music_cuts'],
    ],
  },
} as const
```

튜플을 `ResultExample`로 변환해 `Object.freeze`한 배열을 반환하고, 입력은 `TrackKey`로 제한한다.

- [ ] **Step 4: 공용 선택 그래픽과 결과 예시 그리드의 실패 테스트 추가**

`tests/unit/components/ResultTimeline.test.ts`에 다음 기대를 추가한다.

```ts
expect(wrapper.findAll('[data-result-example-kind="specialty"] [data-result-example]')).toHaveLength(3)
expect(wrapper.findAll('[data-result-example-kind="portfolio"] [data-result-example]')).toHaveLength(3)
expect(wrapper.get('[data-result-example-kind="portfolio"]').text()).toContain('관심사 기반 예시')
expect(wrapper.get('[data-result-example-kind="portfolio"]').text()).toContain('제품 광고 이미지')
expect(wrapper.findAll('[data-selection-graphic]')).not.toHaveLength(0)
```

Run: `corepack pnpm exec vitest run --project unit tests/unit/components/ResultTimeline.test.ts`

Expected: FAIL because the example regions do not exist.

- [ ] **Step 5: 선택 그래픽 추출과 결과 영역 통합**

`SelectionGraphic.vue`는 `visualKey: VisualKey`, `code: string`, `selected?: boolean` props를 받고, 기존 `OptionCard.vue`의 프레임 마크업과 모든 프레임 CSS를 `selection-graphic*` 클래스 이름으로 이동한다. `OptionCard.vue`는 다음처럼 공용 컴포넌트를 사용한다.

```vue
<SelectionGraphic
  :visual-key="option.visualKey"
  :code="option.key.split('.')[1] ?? option.key"
  :selected="selected"
/>
```

`ResultExampleGrid.vue`는 `track`과 `kind`을 받아 카탈로그 3개를 렌더링한다.

```vue
<section :data-result-example-kind="kind" class="result-example-grid">
  <p class="result-example-grid__label">관심사 기반 예시</p>
  <div class="result-example-grid__items">
    <article v-for="example in examples" :key="example.key" data-result-example>
      <SelectionGraphic :visual-key="example.visualKey" :code="'EXAMPLE'" />
      <span class="result-example-grid__badge">예시</span>
      <h4>{{ example.title }}</h4>
      <p>{{ example.description }}</p>
    </article>
  </div>
</section>
```

`FacultyRecommendation.vue`에 `track: TrackKey` prop을 추가하고 전문교수 카드 아래에 `<ResultExampleGrid :track="track" kind="specialty" />`를 렌더링한다. 전문가가 없을 때 기존 `확인된 학과 데이터를 준비 중입니다` 문구는 제거한다. `ResultTimeline.vue`는 교수진에 `:track="snapshot.rankedTracks[0]"`을 넘기고 작품·포트폴리오 lane의 첫 요소로 `kind="portfolio"` 예시 그리드를 렌더링한다.

- [ ] **Step 6: 예시 카탈로그와 컴포넌트 테스트 통과 확인**

Run: `corepack pnpm exec vitest run --project unit tests/unit/result/result-examples.test.ts tests/unit/components/ResultTimeline.test.ts`

Expected: PASS.

- [ ] **Step 7: Task 1 커밋**

```bash
git add shared/content/result-examples.ts app/components/visual/SelectionGraphic.vue app/components/result/ResultExampleGrid.vue app/components/assessment/OptionCard.vue app/components/result/FacultyRecommendation.vue app/components/result/ResultTimeline.vue tests/unit/result/result-examples.test.ts tests/unit/components/ResultTimeline.test.ts
git commit -m "feat: 2026-07-18 관심사 기반 결과 예시 추가"
```

---

### Task 2: 시설·카메라·렌즈 분류와 표시 우선순위

**Files:**
- Create: `shared/utils/equipment-category.ts`
- Modify: `shared/types/result.ts`
- Modify: `shared/schemas/result.ts`
- Modify: `server/modules/matching/resources.ts`
- Modify: `server/modules/assessment/completion.ts`
- Modify: `app/components/result/CapabilityEvidence.vue`
- Modify: `docs/content/equipment-facilities-guide.md`
- Modify: `scripts/seed-content.ts`
- Modify: `supabase/seed/content-2026.sql`
- Create: `supabase/migrations/202607180027_verify_department_facilities.sql`
- Create: `supabase/tests/department_facilities_activation.test.sql`
- Modify: `tests/fixtures/result.ts`
- Test: `tests/unit/matching/resources.test.ts`
- Test: `tests/unit/result/result-schema.test.ts`
- Test: `tests/unit/components/ResultTimeline.test.ts`

**Interfaces:**
- Produces: `EquipmentCategory = 'body' | 'lens' | 'lighting' | 'audio' | 'drone' | 'other'`
- Produces: `equipmentCategoryOf(resource: EquipmentResultResource): EquipmentCategory`
- Adds: `EquipmentDisplayMetadata.category?: EquipmentCategory`
- Consumes: database `resources.metadata.category`

- [ ] **Step 1: 장비 유형 보존과 호환 분류 실패 테스트 작성**

`tests/unit/matching/resources.test.ts`에서 body 후보의 결과 메타데이터에 `category: 'body'`가 보존되는지, 잘못된 category 후보가 제외되는지 확인한다. `tests/unit/result/result-schema.test.ts`에서 여섯 category 값은 허용하고 `camera-secret`은 거부하며 category가 없는 기존 스냅샷은 허용하는 테스트를 추가한다.

```ts
expect(ranked.capabilityEvidence.find(item => item.id === 2)?.displayMetadata)
  .toMatchObject({ category: 'body' })
expect(equipmentCategoryOf(legacyCameraResource)).toBe('body')
expect(equipmentCategoryOf(legacyLensResource)).toBe('lens')
```

- [ ] **Step 2: 장비 유형 테스트 실패 확인**

Run: `corepack pnpm exec vitest run --project unit tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts`

Expected: FAIL because `category` and `equipmentCategoryOf` do not exist.

- [ ] **Step 3: 장비 category 타입·스키마·매핑 구현**

`shared/types/result.ts`에 상수와 타입을 추가한다.

```ts
export const equipmentCategories = ['body', 'lens', 'lighting', 'audio', 'drone', 'other'] as const
export type EquipmentCategory = typeof equipmentCategories[number]
```

`EquipmentDisplayMetadataBase`에 `readonly category?: EquipmentCategory`를 추가하고 Zod equipment display schema에 `category: z.enum(equipmentCategories).optional()`을 추가한다. `server/modules/matching/resources.ts`의 candidate metadata에도 선택적 category를 추가하고 허용 값만 통과시킨 뒤 결과 metadata로 복사한다. `server/modules/assessment/completion.ts`의 `mapResourceRow`는 `category: metadata.category`를 전달한다.

`shared/utils/equipment-category.ts`는 다음 호환 규칙만 구현한다.

```ts
export const equipmentCategoryOf = (resource: EquipmentResultResource): EquipmentCategory => {
  if (resource.displayMetadata.category) return resource.displayMetadata.category
  if (resource.primaryTag === 'camera') return 'body'
  if (resource.primaryTag === 'lens') return 'lens'
  return 'other'
}
```

- [ ] **Step 4: 시설→바디→렌즈 초기 표시 실패 테스트 작성**

fixture 장비를 `소니 FX3 Body(category: body)`, `소니 FE 24-70mm F2.8 Lens(category: lens)`로 바꾼다. `ResultTimeline.test.ts`의 capability 테스트를 다음 계약으로 교체한다.

```ts
const collapsed = wrapper.findAll('[data-capability-evidence]')
expect(collapsed).toHaveLength(3)
expect(collapsed.map(item => item.attributes('data-capability-kind')))
  .toEqual(['facility', 'body', 'lens'])
expect(collapsed[0]!.text()).toContain('스튜디오 A(호리존)')
expect(wrapper.get('[data-testid="capability-more"]').text()).toBe('학과 기반 더보기')
```

Run: `corepack pnpm exec vitest run --project unit tests/unit/components/ResultTimeline.test.ts`

Expected: FAIL because current component combines all evidence by affinity and shows only two.

- [ ] **Step 5: 네 시설 검증 데이터와 운영 마이그레이션 작성**

콘텐츠 가이드와 seed parser에서 네 시설의 존재 확인일을 `2026-07-18T16:28:30+09:00`으로 기록한다. 컴퓨터실 운영 문구는 다음 값을 그대로 사용한다.

```text
2020년형 iMac 및 RTX 4080급 그래픽카드 탑재 워크스테이션이 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.
```

스튜디오 A, 스튜디오 B, 암실은 각각 `시설 존재가 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.`라는 운영 문구와 같은 확인 시각을 갖는다. migration은 `metadata.seedKey`가 `facility:studio_a_horizon`, `facility:studio_b`, `facility:darkroom`, `facility:computer_lab`인 행만 갱신하고, draft인 네 행을 기존 `transition_admin_resource` 함수로 active 전환한다. 이미 active이면 내용만 갱신한다. 다른 시설 후보나 검증 전 archive 시설은 변경하지 않는다.

SQL 테스트는 네 시설이 public+active이고, `lastVerifiedAt`이 ISO timestamp이며, 컴퓨터실 문구에 `2020년형 iMac`과 `RTX 4080급`이 모두 포함되는지 확인한다.

Run: `corepack pnpm exec supabase test db --local supabase/tests/department_facilities_activation.test.sql`

Expected before migration application: FAIL because the four seeded facilities are draft or lack verified timestamps.

- [ ] **Step 6: 서버 후보 선택과 UI 우선순위 구현**

`rankResources`는 capability 후보를 다음 순서로 최대 4개 고른다: 상위 시설 2개, 상위 body 1개, 상위 lens 1개. 한 유형이 부족하면 선택되지 않은 다른 장비를 친화도 순으로 남은 칸에 채우되, 초기 UI는 부족한 body나 lens를 다른 장비로 대체하지 않는다.

`CapabilityEvidence.vue`는 `facility`, `body`, `lens`, `remaining` 배열을 만들고 다음 순서로 `allEvidence`를 구성한다.

```ts
const featured = [facilities.value[0], bodies.value[0], lenses.value[0]]
  .filter((item): item is CapabilityResource => item !== undefined)
const allEvidence = computed(() => [...featured, ...remaining.value].slice(0, 4))
const visibleEvidence = computed(() => expanded.value ? allEvidence.value : featured)
```

각 article에 `:data-capability-kind="resource.type === 'facility' ? 'facility' : equipmentCategoryOf(resource)"`를 지정하고 버튼 조건을 `allEvidence.length > featured.length`, 텍스트를 `학과 기반 더보기`/`학과 기반 접기`로 바꾼다.

- [ ] **Step 7: Task 2 집중 테스트 통과 확인**

Run: `corepack pnpm exec vitest run --project unit tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts tests/unit/components/ResultTimeline.test.ts`

Expected: PASS.

- [ ] **Step 8: Task 2 커밋**

```bash
git add shared/utils/equipment-category.ts shared/types/result.ts shared/schemas/result.ts server/modules/matching/resources.ts server/modules/assessment/completion.ts app/components/result/CapabilityEvidence.vue docs/content/equipment-facilities-guide.md scripts/seed-content.ts supabase/seed/content-2026.sql supabase/migrations/202607180027_verify_department_facilities.sql supabase/tests/department_facilities_activation.test.sql tests/fixtures/result.ts tests/unit/matching/resources.test.ts tests/unit/result/result-schema.test.ts tests/unit/components/ResultTimeline.test.ts
git commit -m "feat: 2026-07-18 시설·카메라·렌즈 우선 추천"
```

---

### Task 3: 검증 근거 기반 교육환경 연결도

**Files:**
- Create: `server/modules/matching/environment-score.ts`
- Modify: `server/modules/matching/resources.ts`
- Modify: `server/modules/assessment/completion.ts`
- Modify: `server/modules/assessment/stored-result.ts`
- Test: `tests/unit/matching/environment-score.test.ts`
- Test: `tests/unit/matching/resources.test.ts`
- Test: `tests/integration/result/completion.test.ts`

**Interfaces:**
- Produces: `computeEnvironmentScore(input: EnvironmentScoreInput): number`
- Produces: `withComputedEnvironmentScore(snapshot: ResultSnapshot): ResultSnapshot`
- Consumes: `resources.facility`, `resources.equipment`, `learningPath`, `faculty.primary`

- [ ] **Step 1: 정확한 배점 실패 테스트 작성**

```ts
describe('education environment readiness score', () => {
  it('시설·바디·렌즈·4개 학년·총괄교수가 있으면 100점이다', () => {
    expect(computeEnvironmentScore(fullEvidence())).toBe(100)
  })

  it.each([
    ['facility', without('facility'), 65],
    ['body', without('body'), 85],
    ['lens', without('lens'), 85],
    ['one course year', withoutCourseYear(4), 93.8],
    ['faculty', without('faculty'), 90],
  ])('%s 근거가 없으면 해당 배점만 제외한다', (_name, input, expected) => {
    expect(computeEnvironmentScore(input)).toBe(expected)
  })

  it('예시 콘텐츠 필드를 입력으로 받지 않는다', () => {
    expect(Object.keys(fullEvidence()).sort()).toEqual(['equipment', 'facility', 'hasPrimaryFaculty', 'learningPath'])
  })
})
```

- [ ] **Step 2: 점수 모듈 부재로 실패 확인**

Run: `corepack pnpm exec vitest run --project unit tests/unit/matching/environment-score.test.ts`

Expected: FAIL with missing `environment-score` module.

- [ ] **Step 3: 순수 점수 함수 구현**

```ts
export const computeEnvironmentScore = (input: EnvironmentScoreInput): number => {
  const categories = new Set(input.equipment.map(equipmentCategoryOf))
  const years = new Set(input.learningPath
    .filter(year => year.resources.length > 0)
    .map(year => year.year))
  const raw = (input.facility.length > 0 ? 35 : 0)
    + (categories.has('body') ? 15 : 0)
    + (categories.has('lens') ? 15 : 0)
    + Math.min(years.size, 4) * 6.25
    + (input.hasPrimaryFaculty ? 10 : 0)
  return Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10
}
```

`withComputedEnvironmentScore`는 snapshot의 검증 근거로 점수를 계산하고 `{ ...snapshot, environmentScore }`를 `decodeResultSnapshot`으로 다시 검증해 반환한다.

- [ ] **Step 4: 새 결과와 기존 결과 재계산 실패 테스트 작성**

`completion.test.ts`에서 새 결과가 저장할 때 100점을 사용하고, 저장 snapshot에 27.6이 있어도 `getOwnedResult`와 `getAssessmentHistory`가 동일한 재계산 점수를 반환하는 테스트를 추가한다.

```ts
expect(savedInput.environmentScore).toBe(100)
expect((await service.getOwnedResult(publicId, context)).environmentScore).toBe(100)
expect((await service.getAssessmentHistory(context)).items[0]?.environmentScore).toBe(100)
```

- [ ] **Step 5: completion과 stored-result에 점수 함수 연결**

`resources.ts`에서 기존 가중평균 `EnvironmentCategoryScores`, `environmentWeights`, `computeEnvironmentScore`를 제거하고 그 단위 테스트도 삭제한다. `completion.ts`는 기존 category weighted score 호출을 제거하고 `resources`, `learningPath`, `faculty.primary.id`로 새 함수를 호출한다. `decodeStoredResultSnapshot`은 현재/legacy decode가 끝난 뒤 모두 `withComputedEnvironmentScore`를 통과시킨다. 데이터베이스 사용자 정보와 응답은 갱신하지 않는다.

- [ ] **Step 6: 점수 단위·통합 테스트 통과 확인**

Run: `corepack pnpm exec vitest run --project unit tests/unit/matching/environment-score.test.ts && corepack pnpm exec vitest run --project integration tests/integration/result/completion.test.ts`

Expected: PASS.

- [ ] **Step 7: Task 3 커밋**

```bash
git add server/modules/matching/environment-score.ts server/modules/matching/resources.ts server/modules/assessment/completion.ts server/modules/assessment/stored-result.ts tests/unit/matching/environment-score.test.ts tests/unit/matching/resources.test.ts tests/integration/result/completion.test.ts
git commit -m "feat: 2026-07-18 교육환경 준비도 점수 재계산"
```

---

### Task 4: 결과 흐름 통합 QA와 반응형 마감

**Files:**
- Modify: `tests/e2e/results.spec.ts`
- Modify: `app/components/result/ResultExampleGrid.vue`
- Modify: `app/components/result/CapabilityEvidence.vue`
- Modify: `app/components/result/ResultTimeline.vue`

**Interfaces:**
- Consumes: Tasks 1–3의 예시 `data-*`, category, 점수 계약
- Produces: 광고사진·영상과 기술 경로의 브라우저 회귀 검증

- [ ] **Step 1: 광고사진 E2E 계약을 먼저 강화**

광고사진 결과에서 `관심사 기반 예시`, `제품 광고 이미지`, `제품·패션 촬영`을 확인하고 capability kind 순서가 `facility`, `body`, `lens`인지 확인한다. 교육환경 연결도 meter 값은 90 이상 100 이하로 검증한다.

```ts
await expect(outcomes).toContainText('제품 광고 이미지')
await expect(specialists).toContainText('제품·패션 촬영')
expect(await capability.locator('[data-capability-evidence]').evaluateAll(items =>
  items.slice(0, 3).map(item => item.getAttribute('data-capability-kind')),
)).toEqual(['facility', 'body', 'lens'])
expect(Number(await page.locator('meter').last().getAttribute('value'))).toBeGreaterThanOrEqual(90)
```

- [ ] **Step 2: 강화된 E2E가 기존 화면에서 실패하는지 확인**

Run: `corepack pnpm exec playwright test tests/e2e/results.spec.ts --grep "상업사진 관심사"`

Expected: FAIL on the new example or ordering assertion before final integration is complete.

- [ ] **Step 3: 영상과 기술 결과 E2E 추가**

영상 장면, 촬영·편집 쇼릴, 컴퓨터 후반작업, 영상 진로를 선택하는 helper를 추가한다. 결과에서 `영상편집·색보정`, `AI 이미지·영상`, `드론·360 콘텐츠`, `촬영·편집 쇼릴`을 확인하고, 첫 시설이 `컴퓨터실`인지 확인한다. 로컬 검증 데이터에 더 구체적인 컴퓨터실 제목이 있으면 `/컴퓨터실/u` 정규식으로 일치시킨다.

- [ ] **Step 4: 반응형·접근성 CSS 마감**

예시 그리드는 모바일 1열, 720px 이상 3열로 바꾸고 카드 설명은 `word-break: keep-all`, `overflow-wrap: anywhere`를 함께 사용한다. 공용 그래픽은 `aria-hidden="true"`이며 예시 텍스트가 독립적으로 의미를 전달해야 한다. `prefers-reduced-motion: reduce`에서 새 transition을 제거하고 새 색상 토큰은 추가하지 않는다.

- [ ] **Step 5: 집중 E2E와 전체 정적 검증**

Run:

```bash
corepack pnpm exec playwright test tests/e2e/results.spec.ts
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Expected: all commands exit 0; unit/integration baseline remains at least 1,216 passing tests plus the new tests.

- [ ] **Step 6: 브라우저 시각 QA**

390×844와 1440×1000에서 광고사진 및 영상과 기술 결과를 캡처한다. 다음을 확인한다: 새 예시 카드가 실제 검증 카드보다 작고 조용함, 시설이 첫 번째임, 바디와 렌즈가 뒤를 이음, 제목이 2rem 이하임, 가로 스크롤이 없음, `학과 기반 더보기` 터치 높이가 44px 이상임.

- [ ] **Step 7: Task 4 커밋**

```bash
git add tests/e2e/results.spec.ts app/components/result/ResultExampleGrid.vue app/components/result/CapabilityEvidence.vue app/components/result/ResultTimeline.vue
git commit -m "test: 2026-07-18 결과 예시·학과 기반 통합 QA"
```

---

## Release Verification

- [ ] `git diff --check`가 통과한다.
- [ ] `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build`가 모두 통과한다.
- [ ] 결과 E2E가 광고사진과 영상과 기술 경로에서 통과한다.
- [ ] OpenAI 관련 Worker secret을 추가하지 않는다.
- [ ] 기존 fail-closed 배포 스크립트로 staging과 production을 배포한다.
- [ ] production에서 학생 로그인→평가→결과→이력과 관리자 로그인을 smoke 검증한다.
