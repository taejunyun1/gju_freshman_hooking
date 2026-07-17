# PHOTO:NEXT 관리자 비밀번호 전용 로그인 구현 계획

> 이 계획은 `superpowers:subagent-driven-development`와 `superpowers:test-driven-development`로 실행한다.

**Goal:** 관리자 로그인에서 TOTP를 제거하고 이메일/비밀번호만으로 활성 관리자 세션을 만들며 staging과 production에 안전하게 배포한다.

**Architecture:** 브라우저는 Supabase `signInWithPassword`로 access token을 받고 `/api/admin/session`이 claims와 활성 관리자 행, 인증 시각을 재검증한다. Worker는 AAL1/AAL2를 허용하되 기존 8시간·최근 15분 제한을 유지한다. 배포는 현재 Worker secrets를 보존하고 빌드 산출물과 배포 commit을 검증하는 별도 release 경로를 사용한다.

**Tech Stack:** Nuxt 3, Vue 3, Pinia, Supabase Auth, Vitest, Playwright, Cloudflare Workers/Wrangler 4.

## Global Constraints

- 공개 관리자 회원가입을 추가하지 않는다.
- TOTP 등록·QR·6자리 코드 UI와 `auth.mfa.*` 런타임 호출을 제거한다.
- 서버는 `aal1`과 `aal2`만 허용하고 활성 `admin_users` 검증을 유지한다.
- 일반 세션 8시간과 `recentAuthMinutes` 기반 최근 비밀번호 인증 제한을 유지한다.
- refresh token을 저장하거나 출력하지 않는다.
- 학생 등록 500, OpenAI provider, DB schema는 이번 변경 범위에 포함하지 않는다.
- Cloudflare의 기존 앱 비밀을 출력·삭제·덮어쓰지 않는다.
- staging 성공과 smoke 검증 뒤 production을 배포하고 다시 smoke 검증한다.

### Task 1: 관리자 인증을 이메일/비밀번호 한 단계로 전환

**Files:**
- Modify: `tests/unit/admin/AdminSupabase.test.ts`
- Modify: `tests/unit/admin/AdminShell.test.ts`
- Modify: `tests/unit/admin/BootstrapLocalAdmin.test.ts`
- Modify: `tests/integration/identity/admin-auth.test.ts`
- Modify: `tests/integration/request-context.test.ts`
- Modify: `tests/e2e/admin-security.spec.ts`
- Modify: `tests/e2e/counseling.spec.ts`
- Modify: `tests/unit/scripts/DeploymentSafety.test.ts`
- Modify: `app/utils/admin-supabase.ts`
- Modify: `app/pages/admin/login.vue`
- Modify: `server/modules/identity/admin-auth.ts`
- Modify: `server/middleware/00-request-context.ts`
- Modify: `scripts/bootstrap-local-admin.ts`
- Modify: `supabase/config.toml`

1. 먼저 AAL1 허용, 단일 password sign-in, MFA API 미호출, TOTP UI 부재, data-image CSP 제거, 로컬 TOTP 비활성화를 검증하는 테스트로 기존 동작이 실패하는 RED를 확인한다.
2. `admin-supabase.ts`를 하나의 `signInAdminWithPassword` 함수로 단순화해 Supabase 세션의 access token, 만료 초, user id만 반환한다. refresh token은 반환·저장하지 않는다.
3. 로그인 페이지를 단일 폼으로 만들고 password sign-in 직후 `/api/admin/session`을 확인한 뒤 기존 sessionStorage 계약과 8시간 상한을 적용한다.
4. 서버는 `aal1 | aal2`만 허용하고 실제 AAL을 반환한다. 관리자 활성 여부, 8시간 상한, `recentAuthMinutes` 검사는 그대로 둔다.
5. TOTP 전용 CSP 예외와 로컬 TOTP 설정, bootstrap 안내를 제거한다. E2E 관리자 로그인 helper도 단일 단계가 되게 한다.
6. 집중 테스트, 전체 Vitest, typecheck, lint, Cloudflare production build를 실행한다.

### Task 2: 기존 비밀을 보존하는 재배포 경로 추가

**Files:**
- Add: `scripts/deploy-photo-next-release.mjs`
- Modify: `tests/unit/scripts/DeploymentSafety.test.ts`
- Add/Modify (gitignored handoff): `.superpowers/sdd/finish-photo-next-release.sh`

1. 먼저 release runner가 clean tracked tree, Cloudflare/Supabase 인증, 필수 secret 이름, provider-off 상태, 빌드 산출물의 비밀 부재, 현재 commit을 검증해야 한다는 테스트를 RED로 작성한다.
2. release runner는 public Supabase URL/publishable key만 빌드 환경에 주입하고 앱 비밀은 빌드 환경에서 제거한다.
3. staging을 먼저 배포하고 health, landing, options, admin login의 password-only marker를 smoke 검증한다. 성공 후 production에 동일 절차를 적용한다.
4. 배포 commit 표시는 안전한 임시 secrets file로 `GIT_COMMIT_SHA` 하나만 갱신하고 Wrangler가 기존 원격 secrets를 보존하는 배포 방식을 사용한다. 임시 파일은 0600으로 만들고 항상 삭제한다.
5. wrapper는 허용된 변경만 stage/commit/push하고 release runner를 실행한다. 비밀값은 로그, Git, 산출물에 포함하지 않는다.
6. runner 단위 테스트와 `--check`/dry validation을 실행하고 독립 리뷰를 받는다.

### Task 3: 최종 검증과 배포

1. 전체 Vitest, typecheck, lint, Cloudflare production build를 새로 실행한다.
2. 독립 최종 리뷰에서 승인된 설계와 Global Constraints 충족 여부를 확인한다.
3. git 제어가 가능한 사용자 Terminal에서 단일 wrapper를 실행해 commit, push, staging, production, smoke를 완료한다.
4. production URL, 관리자 로그인 URL, 검증 결과와 아직 별도 이슈인 학생 등록 500을 사용자에게 전달한다.
