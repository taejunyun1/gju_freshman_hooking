# 4개 분야 1~4학년 커리큘럼 루트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 영상+AI·예술사진·다큐멘터리·광고사진의 공통 1·2학년 기반과 3·4학년 심화 경로를 메인·결과 화면 및 독립 HTML에 제공한다.

**Architecture:** shared/content/curriculum-routes.ts가 네 트랙과 공통 기반의 유일한 데이터 원본이 된다. Vue 탐색 컴포넌트는 이 콘텐츠를 메인·결과에 재사용하며, 독립 HTML은 shared/content/curriculum-routes-html.ts가 같은 데이터를 인라인 CSS·JS 문서로 렌더링하고 build 전에 public/curriculum-routes.html을 생성한다.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Vitest, tsx, Cloudflare Workers static assets.

## Global Constraints

- TrackKey는 video, art_photo, documentary, commercial만 사용한다.
- 표시는 영상+AI, 예술사진, 다큐멘터리, 광고사진 순서를 고정한다.
- 1·2학년은 공통 기반으로만 표시하고 전용 과목으로 표기하지 않는다.
- 3·4학년의 확정 교과명은 설계 문서의 정확한 한글 문자열을 사용한다.
- 영상+AI 4학년은 확정 교과목이 아닌 통합 포트폴리오·졸업전시·캡스톤 제작 단계로 표시한다.
- 기존 LearningPath의 실제 개설 교과, 설문 점수, DB, 관리자 기능은 변경하지 않는다.
- 컴포넌트는 파란색·둥근 카드·모노 라벨 디자인 토큰을 사용하고 모바일에서 세로 흐름으로 전환한다.
- public/curriculum-routes.html은 외부 CSS·JS·이미지 의존성이 없는 단일 파일이다.
- production code는 반드시 failing test 확인 후 작성하고, 날짜+주요내용 한국어 커밋 메시지를 사용한다.

---

## File structure

- Create: shared/content/curriculum-routes.ts — immutable route types, common stages, four-track route data, safe track resolver.
- Create: shared/content/curriculum-routes-html.ts — standalone HTML renderer using only curriculum route content.
- Create: scripts/generate-curriculum-routes-html.ts — writes renderer output to public/curriculum-routes.html.
- Create: public/curriculum-routes.html — generated, portable one-file curriculum document.
- Create: app/components/curriculum/CurriculumRouteExplorer.vue — accessible four-track route switcher.
- Modify: app/pages/index.vue — add compact explorer after the current four-stage sequence and before SEO discovery copy.
- Modify: app/components/result/ResultTimeline.vue — add detailed explorer directly after the existing real LearningPath section.
- Modify: package.json — add generate:curriculum-routes and prepend it to build.
- Create: tests/unit/content/curriculum-routes.test.ts — data and resolver tests.
- Create: tests/unit/content/curriculum-routes-html.test.ts — standalone renderer assertions.
- Create: tests/unit/components/CurriculumRouteExplorer.test.ts — rendering, switching, fallback tests.
- Modify: tests/unit/pages/LandingPage.test.ts — compact explorer integration test.
- Modify: tests/unit/components/ResultTimeline.test.ts — recommendation-track integration test.

## Task 1: Curriculum route content and portable HTML

**Files:**
- Create: shared/content/curriculum-routes.ts
- Create: shared/content/curriculum-routes-html.ts
- Create: scripts/generate-curriculum-routes-html.ts
- Create: public/curriculum-routes.html
- Modify: package.json
- Test: tests/unit/content/curriculum-routes.test.ts
- Test: tests/unit/content/curriculum-routes-html.test.ts

**Interfaces:**
- Produces type CurriculumTrackKey = TrackKey.
- Produces type CurriculumStage = { year: 1 | 2 | 3 | 4; phase: string; kind: common | course | outcome; items: readonly string[]; outcome: string }.
- Produces const curriculumTrackOrder: readonly CurriculumTrackKey[].
- Produces const curriculumRoutes: Readonly<Record<CurriculumTrackKey, { label: string; summary: string; stages: readonly CurriculumStage[] }>>.
- Produces resolveCurriculumTrack(value: unknown): CurriculumTrackKey.
- Produces renderCurriculumRoutesHtml(): string.

- [ ] **Step 1: Write failing content and HTML tests**

    import { describe, expect, it } from 'vitest'
    import { curriculumRoutes, curriculumTrackOrder, resolveCurriculumTrack } from '../../../shared/content/curriculum-routes'
    import { renderCurriculumRoutesHtml } from '../../../shared/content/curriculum-routes-html'

    describe('four-year curriculum routes', () => {
      it('keeps four tracks and their confirmed senior courses', () => {
        expect(curriculumTrackOrder).toEqual(['video', 'art_photo', 'documentary', 'commercial'])
        expect(curriculumRoutes.documentary.stages[2]!.items).toContain('포토 스토리 워크숍')
        expect(curriculumRoutes.art_photo.stages[3]!.items).toContain('예술창작 프로젝트 랩')
        expect(curriculumRoutes.commercial.stages[3]!.items).toContain('커머셜 포토그라피 랩')
      })

      it('uses a non-course video fourth-year outcome and a safe fallback', () => {
        expect(curriculumRoutes.video.stages[3]!.kind).toBe('outcome')
        expect(resolveCurriculumTrack('unknown')).toBe('video')
      })
    })

    it('renders a standalone self-contained four-track document', () => {
      const html = renderCurriculumRoutesHtml()
      expect(html).toContain('영상 드론 콘텐츠 워크숍')
      expect(html).toContain('커머셜 포토그라피 랩')
      expect(html).not.toMatch(/<(link|script)\s+[^>]+src=/iu)
    })

- [ ] **Step 2: Run tests to verify RED**

    Run: corepack pnpm exec vitest run --project unit tests/unit/content/curriculum-routes.test.ts tests/unit/content/curriculum-routes-html.test.ts

    Expected: FAIL because the two content modules do not exist.

- [ ] **Step 3: Implement immutable content and HTML renderer**

    export const curriculumTrackOrder = Object.freeze(['video', 'art_photo', 'documentary', 'commercial'] as const)

    export const resolveCurriculumTrack = (value: unknown): CurriculumTrackKey => (
      curriculumTrackOrder.includes(value as CurriculumTrackKey) ? value as CurriculumTrackKey : 'video'
    )

    Create the two shared modules using the exact stage names in the Global Constraints. In renderCurriculumRoutesHtml, serialize only label, summary, stage phase, kind, items, and outcome into an application/json script element. Add an inline script that switches a data-active-track attribute and updates aria-pressed on the four buttons. Include all styles in one style element.

    Create scripts/generate-curriculum-routes-html.ts with:

    import { mkdir, writeFile } from 'node:fs/promises'
    import { dirname, resolve } from 'node:path'
    import { renderCurriculumRoutesHtml } from '../shared/content/curriculum-routes-html'

    const output = resolve(process.cwd(), 'public/curriculum-routes.html')
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, renderCurriculumRoutesHtml(), 'utf8')

    Add package scripts:

    "generate:curriculum-routes": "tsx scripts/generate-curriculum-routes-html.ts",
    "build": "pnpm generate:curriculum-routes && nuxt build"

    Run the generator once so public/curriculum-routes.html is committed.

- [ ] **Step 4: Run tests to verify GREEN**

    Run: corepack pnpm exec vitest run --project unit tests/unit/content/curriculum-routes.test.ts tests/unit/content/curriculum-routes-html.test.ts

    Expected: 2 files passed.

- [ ] **Step 5: Commit Task 1**

    git add shared/content/curriculum-routes.ts shared/content/curriculum-routes-html.ts scripts/generate-curriculum-routes-html.ts public/curriculum-routes.html package.json tests/unit/content/curriculum-routes.test.ts tests/unit/content/curriculum-routes-html.test.ts
    git commit -m "feat: 2026-08-03 커리큘럼 루트 데이터와 HTML 추가"

## Task 2: Reusable explorer and two in-app placements

**Files:**
- Create: app/components/curriculum/CurriculumRouteExplorer.vue
- Modify: app/pages/index.vue
- Modify: app/components/result/ResultTimeline.vue
- Test: tests/unit/components/CurriculumRouteExplorer.test.ts
- Test: tests/unit/pages/LandingPage.test.ts
- Test: tests/unit/components/ResultTimeline.test.ts

**Interfaces:**
- Consumes curriculumRoutes, curriculumTrackOrder, resolveCurriculumTrack from Task 1.
- Component props: defaultTrack?: CurriculumTrackKey; variant?: compact | detailed.
- Emits no events and does not write remote state.
- Uses data-curriculum-route-explorer, data-curriculum-track, data-curriculum-stage attributes for tests.

- [ ] **Step 1: Write failing component and integration tests**

    it('switches to documentary and exposes its four-year route', async () => {
      const wrapper = mount(CurriculumRouteExplorer, { props: { defaultTrack: 'video', variant: 'detailed' } })
      await wrapper.get('[data-curriculum-track="documentary"]').trigger('click')
      expect(wrapper.get('[data-curriculum-route-explorer]').attributes('data-active-track')).toBe('documentary')
      expect(wrapper.text()).toContain('포스트 다큐멘터리 랩')
    })

    it('uses video when the requested track is invalid', () => {
      const wrapper = mount(CurriculumRouteExplorer, { props: { defaultTrack: 'invalid' as never } })
      expect(wrapper.get('[data-curriculum-route-explorer]').attributes('data-active-track')).toBe('video')
    })

    Extend LandingPage.test.ts to expect one compact explorer and all four track controls. Extend ResultTimeline.test.ts to expect the detailed explorer default track to equal the fixture rankedTracks[0].

- [ ] **Step 2: Run tests to verify RED**

    Run: corepack pnpm exec vitest run --project unit tests/unit/components/CurriculumRouteExplorer.test.ts tests/unit/pages/LandingPage.test.ts tests/unit/components/ResultTimeline.test.ts

    Expected: FAIL because CurriculumRouteExplorer and its placements do not exist.

- [ ] **Step 3: Implement component and placements**

    In CurriculumRouteExplorer.vue, use:

    const props = withDefaults(defineProps<{ defaultTrack?: CurriculumTrackKey; variant?: 'compact' | 'detailed' }>(), { defaultTrack: 'video', variant: 'detailed' })
    const activeTrack = ref(resolveCurriculumTrack(props.defaultTrack))
    const route = computed(() => curriculumRoutes[activeTrack.value])

    Render one button per curriculumTrackOrder with :aria-pressed, an explicit 선택됨 span for the active button, and four stage articles. Add scoped styles that use --color-primary, --color-canvas, --color-surface, --radius-panel, and --font-mono. At min-width 1024px use a four-column timeline; below it stack the four stages.

    In app/pages/index.vue import the component and place:

    <CurriculumRouteExplorer variant="compact" />

    after the current sequence section and before the seo-discovery section.

    In app/components/result/ResultTimeline.vue import the component and insert a curriculum route section immediately after the existing learning-path section:

    <CurriculumRouteExplorer :default-track="snapshot.rankedTracks[0]" variant="detailed" />

    Do not remove or alter the existing LearningPath component.

- [ ] **Step 4: Run tests to verify GREEN**

    Run: corepack pnpm exec vitest run --project unit tests/unit/components/CurriculumRouteExplorer.test.ts tests/unit/pages/LandingPage.test.ts tests/unit/components/ResultTimeline.test.ts

    Expected: 3 files passed.

- [ ] **Step 5: Commit Task 2**

    git add app/components/curriculum/CurriculumRouteExplorer.vue app/pages/index.vue app/components/result/ResultTimeline.vue tests/unit/components/CurriculumRouteExplorer.test.ts tests/unit/pages/LandingPage.test.ts tests/unit/components/ResultTimeline.test.ts
    git commit -m "feat: 2026-08-03 화면별 커리큘럼 루트 추가"

## Task 3: Full verification and Cloudflare release

**Files:**
- Modify: .superpowers/sdd/progress.md

**Interfaces:**
- Validates the static asset at /curriculum-routes.html and the existing public home and result routes.

- [ ] **Step 1: Verify generated HTML is current**

    Run: corepack pnpm generate:curriculum-routes && git diff --exit-code -- public/curriculum-routes.html

    Expected: exit 0, proving the committed portable document matches the renderer.

- [ ] **Step 2: Run complete checks**

    Run: corepack pnpm test && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm build

    Expected: all commands exit 0.

- [ ] **Step 3: Deploy safely**

    Push feature/photo-next-mvp. Update only GIT_COMMIT_SHA interactively for staging then production. Deploy both with wrangler deploy --keep-vars; do not modify other runtime secrets or dashboard variables.

- [ ] **Step 4: Smoke-test deployed assets**

    Run cache-busted curl checks against staging and production for /api/health, /, /curriculum-routes.html, /robots.txt, and /login. Assert the standalone page contains all four labels and no external resource URLs; assert /login retains X-Robots-Tag: noindex, nofollow, noarchive.

- [ ] **Step 5: Commit progress ledger if tracked, then report deployed URLs**

    Commit only tracked progress documentation if it changed. Report the production URL and the direct standalone HTML URL.

## Plan self-review

- Spec coverage: Task 1 creates the shared source and portable file; Task 2 places the selector in both approved surfaces; Task 3 verifies deployment and existing crawler safeguards.
- Placeholder scan: no deferred behavior, unbounded scope, or unspecified course strings remain.
- Type consistency: Task 1 defines CurriculumTrackKey, CurriculumStage, curriculumRoutes, and resolveCurriculumTrack; Task 2 consumes exactly those names.

