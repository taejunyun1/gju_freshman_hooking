# 관리자 기능 정리·오류 안내·카메라 우선순위 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용하지 않는 AI 문장 신고·캠페인 운영 경로를 닫고, 상담/내보내기 실패 원인을 운영자가 이해할 수 있게 표시하며, 결과 기자재에서 Sony·Canon 카메라와 렌즈를 관심 분야에 맞게 우선한다.

**Architecture:** 과거 캠페인·신고 DB 행과 외래키는 보존하고 신규 접근 경로만 제거한다. 클라이언트에는 정규화된 관리자 오류 해석기를 하나 두어 상담과 XLSX 내보내기가 같은 안전한 오류 계약을 사용한다. 카메라 선호는 기자재 선택 단계의 동률 우선순위로만 적용해 관심 적합도와 검증 상태를 앞선다.

**Tech Stack:** Nuxt 3, Vue 3, TypeScript, Zod, Vitest, Playwright, Supabase PostgreSQL, Cloudflare Workers

## Global Constraints

- 기존 캠페인 및 AI 문장 신고 DB 행·외래키·감사 기록은 물리 삭제하지 않는다.
- AI 문장 신고와 캠페인 운영의 페이지·API·신규 쓰기 경로는 빌드 결과에서 제거한다.
- 내부 예외, SQL 오류, 토큰은 화면에 표시하지 않고 안전한 오류 코드와 요청 번호만 사용한다.
- 기존 파란색·라운드 관리자 UI를 유지하고 제목 크기를 키우지 않는다.
- 시설 2개, 카메라 바디 1개, 렌즈 1개를 우선하는 결과 구조를 유지한다.
- Sony·Canon 선호는 관심 적합도가 같은 기자재 안에서만 우선한다.
- 기존 사용자 미추적 파일은 수정하거나 커밋하지 않는다.

---

### Task 1: AI 문장 신고와 캠페인 운영 접근 경로 제거

**Files:**
- Modify: `app/layouts/admin.vue`
- Modify: `app/components/result/CareerNarrative.vue`
- Modify: `app/components/result/ResultTimeline.vue`
- Modify: `app/pages/admin/counseling.vue`
- Modify: `app/pages/admin/export.vue`
- Modify: `app/pages/admin/students/[id].vue`
- Modify: `server/api/assessment/submit.post.ts`
- Modify: `server/api/student/login.post.ts`
- Modify: `server/modules/assessment/completion.ts`
- Modify: `server/modules/identity/roster-auth.ts`
- Modify: `server/modules/metrics/events.ts`
- Modify: `server/middleware/20-student-request-security.ts`
- Modify: `server/utils/app-error.ts`
- Modify: `shared/schemas/admin-export.ts`
- Modify: `shared/schemas/admin-students.ts`
- Modify: `shared/schemas/admin.ts`
- Modify: `shared/schemas/counseling.ts`
- Modify: `nuxt.config.ts`
- Modify: `scripts/verify-env.mjs`
- Modify: `scripts/deploy-photo-next-release.mjs`
- Modify: `scripts/deploy-photo-next-remote.mjs`
- Delete: `app/pages/admin/campaigns.vue`
- Delete: `app/pages/admin/narrative-reports.vue`
- Delete: `app/components/result/CareerNarrativeReport.vue`
- Delete: `server/api/admin/campaigns/[id]/archive.post.ts`
- Delete: `server/api/admin/campaigns/index.get.ts`
- Delete: `server/api/admin/campaigns/index.post.ts`
- Delete: `server/api/admin/narrative-reports/[id]/resolve.post.ts`
- Delete: `server/api/admin/narrative-reports/[id]/result.get.ts`
- Delete: `server/api/admin/narrative-reports/index.get.ts`
- Delete: `server/api/campaign/[code].get.ts`
- Delete: `server/api/career-narrative/report.post.ts`
- Delete: `server/modules/admin/campaigns.ts`
- Delete: `server/modules/admin/narrative-reports.ts`
- Delete: `server/modules/assessment/career-narrative-report.ts`
- Delete: `server/utils/campaign-attribution.ts`
- Delete: `shared/schemas/admin-narrative-reports.ts`
- Delete: `shared/schemas/career-narrative-report.ts`
- Test: `tests/unit/admin/AdminShell.test.ts`
- Test: `tests/unit/pages/AdminCounselingPage.test.ts`
- Test: `tests/unit/pages/AdminExportPage.test.ts`
- Test: `tests/unit/components/CareerNarrative.test.ts`
- Test: `tests/unit/scripts/VerifyEnv.test.ts`
- Test: `tests/unit/scripts/DeploymentSafety.test.ts`
- Delete: `tests/unit/pages/AdminCampaignsPage.test.ts`
- Delete: `tests/unit/components/AdminCampaigns.test.ts`
- Delete: `tests/unit/pages/AdminNarrativeReports.test.ts`
- Delete: `tests/unit/components/CareerNarrativeReport.test.ts`
- Delete: `tests/integration/admin/campaigns.test.ts`
- Delete: `tests/integration/admin/narrative-reports.test.ts`
- Delete: `tests/integration/result/career-narrative-report.test.ts`
- Delete: `tests/e2e/admin-campaigns-responsive.spec.ts`
- Delete: `tests/e2e/admin-narrative-reports-layout.spec.ts`

**Interfaces:**
- Consumes: 기존 Supabase 컬럼 `campaign_id`, `campaign_id_snapshot`, `career_narrative_reports`는 레거시 보존 데이터로 유지한다.
- Produces: 관리자 메뉴 7개 이하, 캠페인·신고 라우트 미생성, 신규 설문·로그인 이벤트의 캠페인 값 `null`.

- [ ] **Step 1: 제거 계약 테스트를 먼저 작성한다**

  `AdminShell.test.ts`에 메뉴 두 항목이 없음을 추가하고 상담·내보내기 페이지 테스트에서 `campaignId` 필드가 없음을 검증한다. 결과 E2E에서는 신고 POST 대기 및 신고 UI 기대를 제거하고 진로 제안 본문은 유지함을 검증한다.

  ```ts
  expect(layoutText).not.toContain('/admin/campaigns')
  expect(layoutText).not.toContain('/admin/narrative-reports')
  expect(wrapper.find('[name="campaignId"]').exists()).toBe(false)
  expect(careerNarrative.text()).not.toContain('신고')
  ```

- [ ] **Step 2: RED 상태를 확인한다**

  Run: `corepack pnpm exec vitest run --project unit tests/unit/admin/AdminShell.test.ts tests/unit/pages/AdminCounselingPage.test.ts tests/unit/pages/AdminExportPage.test.ts`

  Expected: 기존 메뉴와 캠페인 입력이 남아 있어 새 부정 검증이 실패한다.

- [ ] **Step 3: 사용자 접근 표면을 제거한다**

  관리자 메뉴, 두 페이지, 결과 신고 컴포넌트, 캠페인 필터와 상세 표시를 제거한다. 진로 제안의 비확정 안내 문구는 유지하되 신고 유도 문구는 제거한다.

  ```vue
  <nav aria-label="관리자 메뉴">
    <NuxtLink to="/admin">운영 홈</NuxtLink>
    <NuxtLink to="/admin/students">학생 찾기</NuxtLink>
    <NuxtLink to="/admin/students/roster">연간 명단 관리</NuxtLink>
    <NuxtLink to="/admin/counseling">상담 운영</NuxtLink>
    <NuxtLink to="/admin/resources">학과 자원</NuxtLink>
    <NuxtLink to="/admin/faculty">교수진 운영</NuxtLink>
    <NuxtLink to="/admin/export">데이터 내보내기</NuxtLink>
  </nav>
  ```

- [ ] **Step 4: 전용 API와 신규 귀속 경로를 제거한다**

  캠페인·신고 API/서비스/스키마를 삭제한다. 로그인과 설문 제출은 캠페인 쿠키를 읽지 않으며 새 레코드에는 `null`을 전달한다. 역사 데이터 판독에 필요한 DB 컬럼과 기존 SQL migration은 수정하지 않는다.

  ```ts
  return dependencies.assessment.submitAssessment(envelope, {
    anonymousId: context.anonymousId,
    ip: context.ip,
    requestId: context.requestId,
    sessionToken: context.sessionToken,
  })
  ```

- [ ] **Step 5: 사용하지 않는 런타임 비밀 요구를 제거한다**

  `NUXT_CAMPAIGN_COOKIE_KEY`를 Nuxt 설정, 환경 검증, 배포 상태 생성·검증 목록에서 제거한다. 다른 HMAC·암호화 비밀은 변경하지 않는다.

  ```js
  const required = [
    'NUXT_NAME_HMAC_KEY',
    'NUXT_PHONE_HMAC_KEY',
    'NUXT_PHONE_ENCRYPTION_KEY',
    'NUXT_PASSWORD_PEPPER',
  ]
  ```

- [ ] **Step 6: 삭제 후 참조가 남지 않았는지 확인한다**

  Run: `rg -n 'admin/campaigns|admin/narrative-reports|career-narrative/report|NUXT_CAMPAIGN_COOKIE_KEY|캠페인 운영|AI 문장 신고' app server shared scripts nuxt.config.ts tests`

  Expected: 삭제 URL·메뉴·비밀 참조가 0건이며, 보존 정책 문서 외 활성 기능 참조가 없다.

- [ ] **Step 7: 관련 테스트를 통과시킨다**

  Run: `corepack pnpm exec vitest run --project unit tests/unit/admin/AdminShell.test.ts tests/unit/pages/AdminCounselingPage.test.ts tests/unit/pages/AdminExportPage.test.ts tests/unit/scripts/VerifyEnv.test.ts tests/unit/scripts/DeploymentSafety.test.ts`

  Expected: 모두 PASS.

- [ ] **Step 8: 커밋한다**

  ```bash
  git add app server shared scripts nuxt.config.ts tests
  git commit -m "refactor: 2026-07-20 미사용 운영 기능 제거"
  ```

---

### Task 2: 상담·내보내기 실패 원인 안내

**Files:**
- Create: `app/utils/admin-operation-error.ts`
- Modify: `app/pages/admin/counseling.vue`
- Modify: `app/composables/useXlsxExport.ts`
- Modify: `app/pages/admin/export.vue`
- Create: `tests/unit/admin/AdminOperationError.test.ts`
- Modify: `tests/unit/pages/AdminCounselingPage.test.ts`
- Modify: `tests/unit/admin/AdminXlsxExport.test.ts`
- Modify: `tests/unit/pages/AdminExportPage.test.ts`

**Interfaces:**
- Consumes: `$fetch` 오류의 `data.error.code`, `data.error.message`, `requestId`, HTTP status와 XLSX 단계.
- Produces: `explainAdminOperationError(error, context): AdminOperationFailure` — `reason`, `action`, `requestId`, `requiresLogin`, `canRetry`를 반환한다.

- [ ] **Step 1: 공통 오류 해석기 테스트를 작성한다**

  인증(`ADMIN_REQUIRED`, `REAUTH_REQUIRED`), 필터(`COUNSELING_INVALID`, `EXPORT_INVALID`), 행 제한(`EXPORT_FILTER_REQUIRED`), 충돌, 네트워크, Zod 응답 오류, 워크북 생성, 다운로드, 알 수 없는 `INTERNAL_ERROR`를 표로 검증한다. 알 수 없는 서버 오류는 원문 예외를 숨기고 `requestId`만 보이는지 확인한다.

  ```ts
  expect(explainAdminOperationError(apiFailure('EXPORT_FILTER_REQUIRED', 'req-17'), {
    operation: 'export',
    phase: 'collecting',
  })).toMatchObject({
    reason: expect.stringContaining('허용 범위'),
    requestId: 'req-17',
    requiresLogin: false,
  })
  expect(JSON.stringify(explainAdminOperationError(new Error('secret sql text'), {
    operation: 'counseling',
    phase: 'loading',
  }))).not.toContain('secret sql text')
  ```

- [ ] **Step 2: RED 상태를 확인한다**

  Run: `corepack pnpm exec vitest run --project unit tests/unit/admin/AdminOperationError.test.ts`

  Expected: 모듈이 없어 FAIL.

- [ ] **Step 3: 최소 공통 오류 해석기를 구현한다**

  안전한 코드 allow-list와 처리 단계별 문구를 사용한다. 응답이 없는 `TypeError`는 네트워크 실패, `ZodError`는 응답 형식 실패로 분류한다. `requestId`는 길이와 문자 범위를 검사한 뒤에만 표시한다.

  ```ts
  export type AdminOperationFailure = {
    reason: string
    action: string
    requestId: string | null
    requiresLogin: boolean
    canRetry: boolean
  }

  const readSafeFailurePayload = (error: unknown): { code: string, requestId: string | null } => {
    if (typeof error !== 'object' || error === null) return { code: '', requestId: null }
    const value = error as {
      data?: { error?: { code?: unknown }, requestId?: unknown }
      response?: { status?: unknown, _data?: { error?: { code?: unknown }, requestId?: unknown } }
    }
    const data = value.data ?? value.response?._data
    const code = typeof data?.error?.code === 'string' ? data.error.code : ''
    const requestId = typeof data?.requestId === 'string' && /^[A-Za-z0-9._:-]{1,200}$/u.test(data.requestId)
      ? data.requestId
      : null
    return { code, requestId }
  }

  const safeFallback = (
    payload: { code: string, requestId: string | null },
    context: { operation: 'counseling' | 'export', phase: string },
  ): AdminOperationFailure => ({
    reason: context.operation === 'counseling'
      ? '서버가 상담 목록을 처리하지 못했습니다.'
      : `내보내기 ${context.phase} 단계에서 작업을 처리하지 못했습니다.`,
    action: '잠시 후 다시 시도하고, 반복되면 요청 번호를 전달해 주세요.',
    requestId: payload.requestId,
    requiresLogin: false,
    canRetry: true,
  })

  export const explainAdminOperationError = (
    error: unknown,
    context: { operation: 'counseling' | 'export', phase: string },
  ): AdminOperationFailure => {
    const payload = readSafeFailurePayload(error)
    if (['ADMIN_REQUIRED', 'REAUTH_REQUIRED', 'MFA_REQUIRED'].includes(payload.code)) {
      return {
        reason: '관리자 로그인 세션이 만료되었거나 권한을 확인할 수 없습니다.',
        action: '다시 로그인한 뒤 작업을 시작해 주세요.',
        requestId: payload.requestId,
        requiresLogin: true,
        canRetry: false,
      }
    }
    if (payload.code === 'EXPORT_FILTER_REQUIRED') {
      return {
        reason: '내보낼 결과가 XLSX 허용 범위를 초과했습니다.',
        action: '대상·담당 교수·날짜 필터로 범위를 줄여 주세요.',
        requestId: payload.requestId,
        requiresLogin: false,
        canRetry: true,
      }
    }
    return safeFallback(payload, context)
  }
  ```

- [ ] **Step 4: 상담 운영에 원인·해결 방법을 연결한다**

  초기 로드, 새로고침, 다음 페이지 오류가 공통 해석기를 사용하도록 바꾸고, 인증 오류는 로그인 버튼을, 재시도 가능한 오류는 다시 시도 버튼을 표시한다. 0건 응답은 계속 빈 상태로 처리한다.

  ```ts
  catch (error) {
    failure.value = explainAdminOperationError(error, {
      operation: 'counseling',
      phase: append ? 'pagination' : background ? 'refreshing' : 'loading',
    })
  }
  ```

- [ ] **Step 5: XLSX 단계별 원인 안내를 연결한다**

  현재 `recoverOrPatchFailure`의 포괄 문구를 공통 해석기 결과로 교체한다. 수집·워크북·다운로드·완료 확인 단계를 구분하고 상태 카드에 `이유`, `해결 방법`, `요청 번호`를 표시한다.

  ```ts
  const failure = explainAdminOperationError(error, {
    operation: 'export',
    phase: pending?.browserDownloaded ? 'confirming' : state.value.phase,
  })
  patchState(version, {
    error: failure.reason,
    message: failure.action,
    requestId: failure.requestId,
    phase: 'failed',
  })
  ```

- [ ] **Step 6: RED-GREEN 회귀 테스트를 통과시킨다**

  Run: `corepack pnpm exec vitest run --project unit tests/unit/admin/AdminOperationError.test.ts tests/unit/pages/AdminCounselingPage.test.ts tests/unit/admin/AdminXlsxExport.test.ts tests/unit/pages/AdminExportPage.test.ts`

  Expected: 모두 PASS.

- [ ] **Step 7: 커밋한다**

  ```bash
  git add app/utils/admin-operation-error.ts app/pages/admin/counseling.vue app/composables/useXlsxExport.ts app/pages/admin/export.vue tests/unit
  git commit -m "fix: 2026-07-20 관리자 실패 원인 안내"
  ```

---

### Task 3: Sony·Canon 카메라와 렌즈 우선순위

**Files:**
- Modify: `server/modules/matching/resources.ts`
- Modify: `tests/unit/matching/resources.test.ts`
- Modify: `tests/e2e/results.spec.ts`

**Interfaces:**
- Consumes: 기자재 후보의 검증된 `title`, `metadata.category`, 학생 `interestVector`.
- Produces: 관심 적합도가 같은 body/lens 후보의 한정된 브랜드 순위와 선택된 body 브랜드에 맞춘 lens 순위.

- [ ] **Step 1: 분야별 카메라 선택 테스트를 작성한다**

  사진·광고사진에서는 Sony/Canon이 Nikon보다 앞서고, 영상에서는 Sony FX3/A7SII/FS7 계열이 Canon보다 앞서며, 필름·암실에서는 Canon EOS가 Sony·Nikon보다 앞서는 사례를 추가한다. 바디와 같은 브랜드의 렌즈가 동률 후보 중 선택되는지도 검증한다.

  ```ts
  expect(video.capabilityEvidence.find(item => item.displayMetadata.category === 'body')?.title)
    .toMatch(/소니 (FX3|A7SII|PXW FS7)/u)
  expect(film.capabilityEvidence.find(item => item.displayMetadata.category === 'body')?.title)
    .toMatch(/캐논 EOS/u)
  expect([photoBodyBrand, photoLensBrand]).toEqual([photoBodyBrand, photoBodyBrand])
  ```

- [ ] **Step 2: RED 상태를 확인한다**

  Run: `corepack pnpm exec vitest run --project unit tests/unit/matching/resources.test.ts`

  Expected: 기존 정렬은 ID 순서를 사용하므로 새 Sony/Canon 기대가 FAIL.

- [ ] **Step 3: 제한된 카메라 우선순위를 구현한다**

  `selectCapabilityEvidence` 내부에서 body/lens 후보만 대상으로 브랜드와 영상·필름 관심을 해석한다. 정렬 순서는 `rawAffinity`, 분야별 브랜드 선호, 선택 body와 lens의 브랜드 일치, 기존 안정 정렬 순서다. 비카메라 자원과 환경 점수 공식은 변경하지 않는다.

  ```ts
  type CameraBrand = 'sony' | 'canon' | 'other'

  const cameraBrand = (title: string): CameraBrand => {
    const normalized = title.trim().toLocaleLowerCase('ko-KR')
    if (/^(소니|sony)(?:\s|$)/u.test(normalized)) return 'sony'
    if (/^(캐논|canon)(?:\s|$)/u.test(normalized)) return 'canon'
    return 'other'
  }

  const cameraPreference = (
    candidate: RankedCandidate,
    interestVector: Readonly<Record<string, number>>,
    preferredLensBrand: CameraBrand | null,
  ): number => {
    const brand = cameraBrand(candidate.candidate.title)
    const video = Math.max(interestVector.video ?? 0, interestVector.cinematography ?? 0)
    const film = Math.max(
      interestVector.film ?? 0,
      interestVector.darkroom ?? 0,
      interestVector.black_and_white ?? 0,
    )
    const base = film > video
      ? brand === 'canon' && /\bEOS\b/iu.test(candidate.candidate.title) ? 4 : brand === 'canon' ? 3 : 0
      : video > 0
        ? brand === 'sony' && /\b(FX3|A7SII|PXW\s*FS7)\b/iu.test(candidate.candidate.title) ? 4 : brand === 'sony' ? 3 : brand === 'canon' ? 2 : 0
        : brand === 'sony' || brand === 'canon' ? 2 : 0
    return base + (preferredLensBrand !== null && brand === preferredLensBrand ? 1 : 0)
  }

  const compareCameraCandidates = (
    left: RankedCandidate,
    right: RankedCandidate,
    interestVector: Readonly<Record<string, number>>,
    preferredLensBrand: CameraBrand | null,
  ): number => (
    right.rawAffinity - left.rawAffinity
    || cameraPreference(right, interestVector, preferredLensBrand)
      - cameraPreference(left, interestVector, preferredLensBrand)
    || compareRankedCandidates(left, right)
  )
  ```

- [ ] **Step 4: 단위 및 결과 E2E를 통과시킨다**

  Run: `corepack pnpm exec vitest run --project unit tests/unit/matching/resources.test.ts tests/unit/matching/environment-score.test.ts`

  Run: `corepack pnpm exec playwright test tests/e2e/results.spec.ts --project=chromium`

  Expected: 시설 2 + body 1 + lens 1 구조와 분야별 브랜드 추천이 PASS.

- [ ] **Step 5: 커밋한다**

  ```bash
  git add server/modules/matching/resources.ts tests/unit/matching/resources.test.ts tests/e2e/results.spec.ts
  git commit -m "feat: 2026-07-20 카메라 추천 우선순위"
  ```

---

### Task 4: 통합 검증과 배포

**Files:**
- Modify: `.superpowers/sdd/progress.md` (gitignored 진행 장부)
- Modify only if required by verified failures: affected implementation or test files

**Interfaces:**
- Consumes: Tasks 1–3의 커밋.
- Produces: 검토 완료 커밋, 원격 브랜치, Cloudflare production 배포와 smoke 결과.

- [ ] **Step 1: 삭제 잔여물과 데이터 보존 경계를 검사한다**

  활성 app/server/scripts에 삭제 기능 참조가 없고, Supabase migration과 과거 컬럼·테이블은 유지됐는지 확인한다.

- [ ] **Step 2: 전체 정적 검증을 실행한다**

  Run: `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm build`

  Expected: exit 0.

- [ ] **Step 3: 전체 Vitest를 실행한다**

  Run: `corepack pnpm test`

  Expected: unit/integration 모두 PASS.

- [ ] **Step 4: 전체 로컬 DB 테스트를 실행한다**

  Run: `corepack pnpm exec supabase db reset --local && corepack pnpm exec supabase test db --local`

  Expected: 과거 데이터 스키마 보존 검사를 포함해 모두 PASS.

- [ ] **Step 5: 관리자와 학생 핵심 E2E를 실행한다**

  Run: `corepack pnpm exec playwright test tests/e2e/results.spec.ts tests/e2e/counseling.spec.ts tests/e2e/admin-export-xlsx.spec.ts --project=chromium`

  Expected: 모두 PASS.

- [ ] **Step 6: 최종 코드 리뷰를 받고 Critical/Important 지적을 수정한다**

  계획·설계 대비 누락, 삭제 후 잔여 경로, 오류 정보 노출, 브랜드 편향 과다 여부를 검토한다. 수정 후 관련 검증을 다시 실행한다.

- [ ] **Step 7: 브랜치를 push하고 Cloudflare에 배포한다**

  현재 브랜치와 커밋 SHA를 원격에 push한 뒤 기존 fail-closed 배포 절차를 사용한다. 런타임 비밀 값은 출력하지 않는다.

- [ ] **Step 8: production smoke를 실행한다**

  `/api/health`, `/admin/login`, `/admin/counseling`, `/admin/export`가 정상이고 삭제된 네 페이지/API가 404인지 확인한다. 실제 관리자 로그인 후 상담 오류 문구와 XLSX 생성 동작을 확인한다.
