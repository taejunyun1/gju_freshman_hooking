# Department Brand Copy and Free-Tier Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 광주대학교 사진영상미디어학과를 PHOTO:NEXT의 명확한 운영 주체로 모든 핵심 화면에 통일하고, 연 1회 200명 참여가 현재 Cloudflare Workers·Supabase 무료 티어에서 안전하게 운영 가능한지 근거와 계산으로 검증한다.

**Architecture:** 정식 학과명과 서비스 결합 표기는 `shared/constants/department-brand.ts`의 단일 읽기 전용 계약으로 관리하고, 화면별 문장은 각 페이지에 남겨 과도한 카피 사전을 만들지 않는다. 용량 검증은 공식 한도, 실제 학생 여정의 동적 요청 수, DB 레코드 상한, 읽기 전용 원격 스모크를 결합한 운영 문서로 남기며, 측정 결과가 한도 안이면 보안·데이터 구조를 약화하거나 새 인프라를 추가하지 않는다.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Vitest, Playwright, Cloudflare Workers Static Assets, Supabase PostgreSQL/Auth

## Global Constraints

- 주체의 정식 명칭은 정확히 `광주대학교 사진영상미디어학과`다.
- 서비스명 `PHOTO:NEXT`를 유지하며 공통 결합 표기는 `광주대학교 사진영상미디어학과 · PHOTO:NEXT`다.
- 문서 제목 표기는 `광주대학교 사진영상미디어학과 | PHOTO:NEXT`다.
- 같은 화면의 첫 브랜드 노출에만 정식 명칭을 쓰고 후속 문장은 `학과`로 줄인다.
- 졸업 당시 학과명, 교수 학력, 출처 원문, `sourcePageTitle`은 일괄 치환하지 않는다.
- 기자재·시설은 `이 제작을 가능하게 하는 학과 기반`이라는 지원 근거로 유지한다.
- 블루 포토 노트 디자인과 모든 `h1`의 32px 상한을 유지한다.
- HMAC, PostgreSQL bcrypt cost 10, RLS, CSRF, rate limit, 암호화 저장을 비용 절감 목적으로 제거하거나 약화하지 않는다.
- 기능, API, DB 스키마, 인증 흐름은 변경하지 않는다.
- Cloudflare·Supabase 한도 수치는 구현 시점의 공식 문서를 다시 확인하고 URL과 확인일을 운영 문서에 기록한다.

---

### Task 1: Shared department brand contract and global metadata

**Files:**
- Create: `shared/constants/department-brand.ts`
- Modify: `app/app.vue`
- Create: `tests/unit/department-brand-copy.test.ts`

**Interfaces:**
- Consumes: 승인된 설계의 정식 학과명, 서비스명, 결합 표기 규칙
- Produces: `DEPARTMENT_NAME`, `SERVICE_NAME`, `DEPARTMENT_SERVICE_BRAND`, `DOCUMENT_BRAND`, `HOME_ARIA_LABEL`, `ADMIN_HOME_ARIA_LABEL`

- [ ] **Step 1: Write the failing shared-contract test**

```ts
import { describe, expect, it } from 'vitest'
import {
  ADMIN_HOME_ARIA_LABEL,
  DEPARTMENT_NAME,
  DEPARTMENT_SERVICE_BRAND,
  DOCUMENT_BRAND,
  HOME_ARIA_LABEL,
  SERVICE_NAME,
} from '../../shared/constants/department-brand'

describe('department brand copy', () => {
  it('keeps the department as the owner and PHOTO:NEXT as the service', () => {
    expect(DEPARTMENT_NAME).toBe('광주대학교 사진영상미디어학과')
    expect(SERVICE_NAME).toBe('PHOTO:NEXT')
    expect(DEPARTMENT_SERVICE_BRAND).toBe('광주대학교 사진영상미디어학과 · PHOTO:NEXT')
    expect(DOCUMENT_BRAND).toBe('광주대학교 사진영상미디어학과 | PHOTO:NEXT')
    expect(HOME_ARIA_LABEL).toBe('광주대학교 사진영상미디어학과 PHOTO:NEXT 홈')
    expect(ADMIN_HOME_ARIA_LABEL).toBe('광주대학교 사진영상미디어학과 PHOTO:NEXT 관리자 홈')
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `corepack pnpm exec vitest run --project unit tests/unit/department-brand-copy.test.ts`

Expected: FAIL because `shared/constants/department-brand.ts` does not exist.

- [ ] **Step 3: Implement the immutable shared constants and global document metadata**

```ts
// shared/constants/department-brand.ts
export const DEPARTMENT_NAME = '광주대학교 사진영상미디어학과' as const
export const SERVICE_NAME = 'PHOTO:NEXT' as const
export const DEPARTMENT_SERVICE_BRAND = `${DEPARTMENT_NAME} · ${SERVICE_NAME}` as const
export const DOCUMENT_BRAND = `${DEPARTMENT_NAME} | ${SERVICE_NAME}` as const
export const HOME_ARIA_LABEL = `${DEPARTMENT_NAME} ${SERVICE_NAME} 홈` as const
export const ADMIN_HOME_ARIA_LABEL = `${DEPARTMENT_NAME} ${SERVICE_NAME} 관리자 홈` as const
```

Add to `app/app.vue`:

```ts
<script setup lang="ts">
import { DOCUMENT_BRAND } from '../shared/constants/department-brand'

useHead({
  title: DOCUMENT_BRAND,
  meta: [{
    name: 'description',
    content: '광주대학교 사진영상미디어학과에서 관심사를 교과과정, 프로젝트, 교수진과 진로로 연결해 보는 PHOTO:NEXT입니다.',
  }],
})
</script>
```

- [ ] **Step 4: Run the focused test, typecheck, and lint**

Run: `corepack pnpm exec vitest run --project unit tests/unit/department-brand-copy.test.ts && corepack pnpm typecheck && corepack pnpm lint`

Expected: brand test PASS, typecheck exit 0, lint exit 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add shared/constants/department-brand.ts app/app.vue tests/unit/department-brand-copy.test.ts
git commit -m "feat: 2026-07-18 학과 브랜드 공통 계약 추가"
```

### Task 2: Student entry and assessment copy

**Files:**
- Modify: `app/pages/index.vue`
- Modify: `app/pages/login.vue`
- Modify: `app/pages/assessment.vue`
- Modify: `tests/unit/pages/LandingPage.test.ts`
- Modify: `tests/unit/pages/StudentAccountPages.test.ts`
- Modify: `tests/unit/pages/StudentAssessmentPage.test.ts`

**Interfaces:**
- Consumes: `DEPARTMENT_SERVICE_BRAND`, `HOME_ARIA_LABEL`, `DEPARTMENT_NAME` from Task 1
- Produces: 학과 주도형 랜딩·학생 로그인·관심사 선택 첫 노출

- [ ] **Step 1: Change page tests first to require the approved copy**

Require these exact outcomes in the existing mount tests:

```ts
expect(wrapper.get('[data-department-brand]').text()).toBe('광주대학교 사진영상미디어학과 · PHOTO:NEXT')
expect(wrapper.get('h1').text()).toBe(
  '하고 싶은 사진·영상, 광주대학교 사진영상미디어학과에서 어떻게 시작할 수 있는지 확인해보세요.',
)
expect(wrapper.get('a[href="/"]').attributes('aria-label'))
  .toBe('광주대학교 사진영상미디어학과 PHOTO:NEXT 홈')
```

The login test must require the same brand label and an intro containing `광주대학교 사진영상미디어학과에서 받은 휴대전화 번호와 임시 비밀번호`. The assessment test must require the visible context `광주대학교 사진영상미디어학과 · 관심사 연결` while preserving the four question groups and existing submit behavior.

- [ ] **Step 2: Run the three page tests and verify RED**

Run: `corepack pnpm exec vitest run --project unit tests/unit/pages/LandingPage.test.ts tests/unit/pages/StudentAccountPages.test.ts tests/unit/pages/StudentAssessmentPage.test.ts`

Expected: FAIL on the old `광주대학교 사진영상학과`, `PHOTO:NEXT 홈`, landing title, login intro, and assessment context.

- [ ] **Step 3: Implement the minimal student-entry copy changes**

Use explicit imports from `shared/constants/department-brand.ts`. Apply:

```vue
<p data-department-brand class="landing__eyebrow">{{ DEPARTMENT_SERVICE_BRAND }}</p>
<h1>하고 싶은 사진·영상, 광주대학교 사진영상미디어학과에서 어떻게 시작할 수 있는지 확인해보세요.</h1>
<p class="landing__intro">선택한 관심사가 학과의 교과과정과 프로젝트·비교과, 교수진을 거쳐 어떤 작업과 진로로 이어지는지 보여드립니다.</p>
```

Set every home link on these pages to `:aria-label="HOME_ARIA_LABEL"`. Keep the visible PHOTO:NEXT lettermark. On the login page, use the combined brand as the eyebrow and change only the intro. On assessment, replace the timecode text with `광주대학교 사진영상미디어학과 · 관심사 연결`; retain the screen-reader `h1` and all functional labels.

- [ ] **Step 4: Run focused and full unit tests**

Run: `corepack pnpm exec vitest run --project unit tests/unit/pages/LandingPage.test.ts tests/unit/pages/StudentAccountPages.test.ts tests/unit/pages/StudentAssessmentPage.test.ts && corepack pnpm test:unit`

Expected: focused and full unit suites PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add app/pages/index.vue app/pages/login.vue app/pages/assessment.vue tests/unit/pages/LandingPage.test.ts tests/unit/pages/StudentAccountPages.test.ts tests/unit/pages/StudentAssessmentPage.test.ts
git commit -m "copy: 2026-07-18 학생 여정 학과 브랜드 통일"
```

### Task 3: Result, history, and counseling copy

**Files:**
- Modify: `app/pages/result/[publicId].vue`
- Modify: `app/components/result/ResultTimeline.vue`
- Modify: `app/pages/history.vue`
- Modify: `app/pages/counseling.vue`
- Modify: `app/components/counseling/CounselingForm.vue`
- Modify: `tests/unit/pages/ResultPage.test.ts`
- Modify: `tests/unit/components/ResultTimeline.test.ts`
- Modify: `tests/unit/pages/HistoryPage.test.ts`
- Modify: `tests/unit/pages/CounselingPage.test.ts`
- Modify: `tests/unit/components/CounselingForm.test.ts`

**Interfaces:**
- Consumes: `HOME_ARIA_LABEL`, `DEPARTMENT_NAME` from Task 1
- Produces: 결과·이력·상담의 첫 학과 연결 문구와 이후 축약 문구

- [ ] **Step 1: Add failing assertions for one full-name exposure per surface**

```ts
expect(resultTimeline.text()).toContain(
  '선택한 관심사가 광주대학교 사진영상미디어학과의 교과와 프로젝트를 거쳐 어떤 작업과 진로로 이어지는지 확인해 보세요.',
)
expect(history.text()).toContain(
  '광주대학교 사진영상미디어학과와 연결해 본 관심사를 다시 열어보세요.',
)
expect(counselingForm.text()).toContain(
  '광주대학교 사진영상미디어학과 상담으로 관심 경로를 이어갑니다.',
)
```

Also require `HOME_ARIA_LABEL` on result, history, and counseling mastheads. Retain assertions that capability evidence follows curriculum, project, faculty, and career sections.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run --project unit tests/unit/pages/ResultPage.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/pages/HistoryPage.test.ts tests/unit/pages/CounselingPage.test.ts tests/unit/components/CounselingForm.test.ts`

Expected: FAIL only on missing approved department copy or old aria labels.

- [ ] **Step 3: Implement minimal result/history/counseling copy**

Update the result summary lead so its first sentence is the approved full-name sentence and its second sentence retains the primary track and evidence-first instruction. Update history intro exactly. Put the counseling full-name sentence in the form heading description, followed by the existing contact-method instruction. Change only masthead aria labels otherwise; do not repeat the full name in error states or every result section.

- [ ] **Step 4: Run focused tests and result ordering regressions**

Run: `corepack pnpm exec vitest run --project unit tests/unit/pages/ResultPage.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/pages/HistoryPage.test.ts tests/unit/pages/CounselingPage.test.ts tests/unit/components/CounselingForm.test.ts tests/unit/components/CareerNarrative.test.ts tests/unit/blue-photo-note-design.test.ts`

Expected: all selected tests PASS and equipment/facility remains supporting evidence.

- [ ] **Step 5: Commit Task 3**

```bash
git add app/pages/result/'[publicId].vue' app/components/result/ResultTimeline.vue app/pages/history.vue app/pages/counseling.vue app/components/counseling/CounselingForm.vue tests/unit/pages/ResultPage.test.ts tests/unit/components/ResultTimeline.test.ts tests/unit/pages/HistoryPage.test.ts tests/unit/pages/CounselingPage.test.ts tests/unit/components/CounselingForm.test.ts
git commit -m "copy: 2026-07-18 결과 상담 학과 연결 문구 통일"
```

### Task 4: Administrator ownership copy and preservation guard

**Files:**
- Modify: `app/pages/admin/login.vue`
- Modify: `app/layouts/admin.vue`
- Modify: `app/pages/admin/index.vue`
- Modify: `tests/unit/admin/AdminShell.test.ts`
- Modify: `tests/unit/pages/LandingPage.test.ts`
- Create: `tests/unit/department-brand-preservation.test.ts`

**Interfaces:**
- Consumes: `DEPARTMENT_NAME`, `ADMIN_HOME_ARIA_LABEL` from Task 1
- Produces: 학과 운영 주체가 보이는 관리자 입구·셸과 과거 기록 보존 회귀 검사

- [ ] **Step 1: Add failing administrator and preservation tests**

Require:

```ts
expect(adminLogin.text()).toContain('광주대학교 사진영상미디어학과 운영')
expect(adminShell.get('a[href="/admin"]').attributes('aria-label'))
  .toBe('광주대학교 사진영상미디어학과 PHOTO:NEXT 관리자 홈')
expect(adminDashboard.text()).toContain('광주대학교 사진영상미디어학과의 운영 작업')
```

The preservation test reads `docs/content/faculty-directory-guide.md` and `supabase/seed/department-archive-2026-05-26.json` and requires representative historical strings such as `2010 광주대학교 사진영상학과 미술학사` and existing `sourcePageTitle` values to remain unchanged. It separately scans current UI entry files and rejects the exact stale current-brand string `광주대학교 사진영상학과`.

- [ ] **Step 2: Run tests and verify RED**

Run: `corepack pnpm exec vitest run --project unit tests/unit/admin/AdminShell.test.ts tests/unit/department-brand-preservation.test.ts`

Expected: FAIL on missing administrator ownership copy and stale landing current-brand text, while historical preservation assertions already pass.

- [ ] **Step 3: Implement administrator copy without expanding every menu label**

Use `광주대학교 사진영상미디어학과 운영` as the admin-login eyebrow, `ADMIN_HOME_ARIA_LABEL` for the shell home link, `사진영상미디어학과 운영` as the shell small label, and `광주대학교 사진영상미디어학과의 운영 작업을 선택하세요.` as the dashboard intro. Keep menu names such as `학생 찾기`, `연간 명단 관리`, and `학과 자원` short.

- [ ] **Step 4: Run focused and full tests**

Run: `corepack pnpm exec vitest run --project unit tests/unit/admin/AdminShell.test.ts tests/unit/department-brand-preservation.test.ts tests/unit/pages/LandingPage.test.ts && corepack pnpm test`

Expected: focused tests and all unit/integration tests PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add app/pages/admin/login.vue app/layouts/admin.vue app/pages/admin/index.vue tests/unit/admin/AdminShell.test.ts tests/unit/pages/LandingPage.test.ts tests/unit/department-brand-preservation.test.ts
git commit -m "copy: 2026-07-18 관리자 학과 운영 주체 명시"
```

### Task 5: 200-student free-tier capacity audit

**Files:**
- Create: `docs/operations/free-tier-capacity-200-students.md`
- Modify: `tests/e2e/blue-photo-note-visual.spec.ts`

**Interfaces:**
- Consumes: official Cloudflare Workers and Supabase limits, current student request flow, existing production/staging URLs
- Produces: transparent 200-student request/storage/egress model, operational safeguards, read-only burst evidence

- [ ] **Step 1: Record current official limits from primary sources**

The document must link directly to:

- `https://developers.cloudflare.com/workers/platform/limits/`
- `https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/`
- `https://supabase.com/pricing`
- `https://supabase.com/docs/guides/platform/database-size`
- `https://supabase.com/docs/guides/platform/free-project-pausing`
- `https://supabase.com/docs/guides/deployment/going-into-prod`

Record the verification date and these current free limits: 100,000 dynamic Worker requests/day, 10ms CPU/request, 50 external subrequests/request, free/unlimited static asset requests, Supabase unlimited API requests, 500MB database quota, 5GB egress, 1GB Storage, 50,000 MAU, possible pause after low activity, and no downloadable automatic backups on Free.

- [ ] **Step 2: Calculate conservative workload bounds**

Write the formulas explicitly:

```text
base dynamic requests = 200 students × 25 requests = 5,000/day (5% of Workers Free)
retry/refresh stress = 5,000 × 3 = 15,000/day (15% of Workers Free)
one max-size result snapshot = 200 × 256 KiB = 50 MiB
three retained max-size results = 200 × 3 × 256 KiB = 150 MiB
extreme result egress = 200 × 3 × 256 KiB = 150 MiB, before small API responses
```

Document that typical snapshots and responses are much smaller. State the remaining per-request risk separately: the 10ms Worker CPU limit is not multiplied by 200, and authentication/SSR/matching endpoints must be checked for `exceededCpu`; waiting for Supabase does not count as Worker CPU.

- [ ] **Step 3: Add production-safe browser assertions and a read-only burst probe**

Extend the visual spec to assert the new full-name strings at 1280px and 320px without horizontal overflow. Run a separate read-only burst against staging with 200 total `GET /api/assessment/options` requests, concurrency 20, no cookies, no mutations, and record status counts and p95 latency in the operations document. The probe must fail if any response is not 200 or lacks a catalog revision.

Use this non-mutating script from the shell without creating a repository file:

```js
const total = 200
const concurrency = 20
const url = 'https://photo-next-mvp-staging.taejunyun.workers.dev/api/assessment/options'
// Dispatch total requests in concurrency-sized batches, validate JSON catalogRevision,
// record durations, sort them, and print only aggregate count/status/p95.
```

- [ ] **Step 4: State the capacity verdict and operational boundary**

The document verdict must distinguish:

- Capacity: 200 annual participants fit comfortably if the burst probe passes.
- Security: keep current HMAC+bcrypt/RLS/rate-limit/session design; do not replace it with plaintext or weaker hashes.
- Reliability: restore/warm the free Supabase project 48 hours before the event, run health/login/options smoke tests, and export the roster before and results after the event because Free lacks guaranteed non-pause availability and downloadable backups.
- Upgrade trigger: move to paid service only if Worker `exceededCpu` appears repeatedly, DB approaches 400MB, egress approaches 4GB, or guaranteed no-pause availability/backups become required.

- [ ] **Step 5: Commit Task 5**

```bash
git add docs/operations/free-tier-capacity-200-students.md tests/e2e/blue-photo-note-visual.spec.ts
git commit -m "docs: 2026-07-18 200명 무료 티어 운영 검증"
```

### Task 6: Full verification, independent review, and release

**Files:**
- Modify only if a test or independent review finds a scoped defect

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: reviewed and deployed department-led PHOTO:NEXT release

- [ ] **Step 1: Run all local verification gates**

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm exec playwright test tests/e2e/blue-photo-note-visual.spec.ts --project=chromium
git diff --check
```

Expected: every command exits 0; the existing Nuxt module-preload sourcemap warning may remain non-fatal.

- [ ] **Step 2: Independently review copy scope and historical preservation**

Reviewer must verify: every core surface has one first full-name exposure, PHOTO:NEXT remains visible, no current UI uses `광주대학교 사진영상학과`, historical/degree/source strings remain unchanged, and equipment/facilities remain supporting evidence.

- [ ] **Step 3: Push the current branch and run the fail-closed release gates**

```bash
git push origin feature/photo-next-mvp
node scripts/deploy-photo-next-release.mjs --check
node scripts/deploy-photo-next-release.mjs --self-check
node scripts/deploy-photo-next-release.mjs
```

Expected: staging deploy and smoke pass before production; production `/api/health` reports the released commit.

- [ ] **Step 4: Verify production branding and administrator login**

At 1280px and 320px, verify landing, student login, assessment, result fixture, admin login, and admin home have no horizontal overflow, `h1 <= 32px`, and the approved department name. Read the existing 0600 administrator result file internally for login automation; never print unrelated service secrets.

- [ ] **Step 5: Record final evidence**

Append exact test counts, burst results, production commit, URLs, and any free-tier caveats to `docs/operations/free-tier-capacity-200-students.md`, then commit only if the evidence changes the tracked document.
