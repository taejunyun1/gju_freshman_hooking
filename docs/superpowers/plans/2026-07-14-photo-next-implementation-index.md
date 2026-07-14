# PHOTO:NEXT MVP Implementation Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 광주대학교 사진영상학과 입시생이 관심사를 선택하고 실제 교과·장비·비교과·교수진·작품·진로와의 연결 근거를 확인한 뒤 상담까지 신청할 수 있는 전체 MVP를 구축한다.

**Architecture:** Nuxt 4 단일 저장소에서 Vue 3 학생·관리자 UI와 Nitro 서버 API를 함께 운영하고 Cloudflare Workers에 배포한다. 학생 브라우저는 Supabase에 직접 접근하지 않으며, 서버 모듈이 Data API와 짧은 PostgreSQL RPC 트랜잭션을 호출한다. 기능은 독립 검증 가능한 여섯 수직 슬라이스로 구현한다.

**Tech Stack:** pnpm, Nuxt 4, Vue 3, TypeScript, Pinia, Zod, Supabase PostgreSQL/Auth/Storage, Cloudflare Workers, Vitest, Vue Test Utils, Playwright, pgTAP, k6

## Global Constraints

- 기준 설계: `docs/superpowers/specs/2026-07-14-photo-next-mvp-design.md`
- 교수 기준: `docs/content/faculty-directory-guide.md`
- 내부 PK는 `bigint generated always as identity`, 공개 결과 ID는 `uuid default gen_random_uuid()`를 사용한다.
- 학생 브라우저는 Supabase를 직접 호출하지 않고 `/api/**`만 호출한다.
- Worker 런타임은 `SUPABASE_SECRET_KEY`와 Supabase Data API를 사용하고 PostgreSQL 직접 연결 문자열은 마이그레이션에만 사용한다.
- 휴대전화는 HMAC-SHA-256 조회키와 AES-256-GCM 암호문으로 저장한다.
- 학생 비밀번호는 PBKDF2-HMAC-SHA-256 600,000회, 레코드 salt와 Worker pepper로 저장한다.
- 학생 세션은 256-bit 불투명 토큰, DB SHA-256 해시, `HttpOnly; Secure; SameSite=Lax` 쿠키를 사용한다.
- 학생 세션은 30분 유휴, 12시간 절대 만료다. 관리자 세션은 8시간이며 TOTP MFA가 필수다.
- 모든 브라우저 상태 변경 요청은 exact Origin을 검증하고, 인증된 학생 변경 요청은 세션 결합 CSRF까지 검증한다.
- 평가 선택 비중은 작업 40%, 결과물 30%, 진로 20%, 작업 방식 10%다.
- 교육환경 점수 비중은 교과 35%, 장비·시설 20%, 비교과·프로젝트 15%, 교수 15%, 진로·포트폴리오 15%다.
- 최근 완료 결과 3개만 상세 보관하고 네 번째 완료 시 가장 오래된 상세를 같은 트랜잭션에서 삭제한다.
- 추천 교수는 전임 총괄 1명, 전임 예비 1명, 겸임·전문 연계 0–2명이며 관리자가 실제 담당자를 최종 배정한다.
- 학생 UI는 모바일 우선, WCAG 2.2 AA, 최소 44×44px 터치 영역, reduced motion을 지원한다.
- 결과 화면은 요약 → 관심사 클립 → 1–4학년 교과·프로젝트 학습경로 → 결과물·진로 → 장비·시설 등 보조 근거 → 점수 → 작품·지원·교수 → 상담 순서다. 장비·시설은 독립 메인 레인이 아니며 관련 학습 단계의 실행 가능성을 증명하는 보조 콘텐츠로 기본 1–2개만 노출한다.
- 첫 모바일 콘텐츠 3초, 평가 완료 2초, 관리자 필터 2초, 17 req/s 피크를 출시 게이트로 검증한다.
- 실제 사실 데이터만 공개하고 교과·교수 연락처·작품은 관리자 검수와 공개 상태를 가진다.
- 각 슬라이스는 loading, empty, error, unauthenticated 상태, 이벤트, 자동 테스트를 포함해야 완료다.
- `.env`, PostgreSQL 비밀번호, Supabase 비밀키, 암호화 키, 쿠키와 토큰을 Git·로그·이벤트에 기록하지 않는다.
- 마이그레이션 파일명은 계획 문서의 오래된 숫자를 그대로 재사용하지 않고 구현 시작 시 현재 HEAD의 마지막 번호 다음으로 배정한다.

---

## Plan Sequence

| 순서 | 계획 | 독립 결과물 | 선행 계획 |
|---:|---|---|---|
| S1 | `2026-07-14-photo-next-s1-foundation-identity.md` | 배포 가능한 앱 셸, 학생 계정·세션, 관리자 MFA 셸 | 없음 |
| S2 | `2026-07-14-photo-next-s2-assessment.md` | 4단계 평가와 재현 가능한 트랙 점수 | S1 |
| S3 | `2026-07-14-photo-next-s3-results-matching.md` | 교과 41개·기자재 144개·시설 4곳·교수진 6명 seed, 매칭, 결과 타임라인, 최근 3개 | S2 |
| S4 | `2026-07-14-photo-next-s4-counseling.md` | 상담 신청, 교수 추천, 관리자 배정·상태 전이 | S3 |
| S5 | `2026-07-14-photo-next-s5-admin-operations.md` | 학생·자원·교수·캠페인 관리와 XLSX | S4 |
| S6 | `2026-07-14-photo-next-s6-operations-deployment.md` | 지표·보존·보안·접근성·부하·프로덕션 배포 | S5 |

한 번에 한 슬라이스만 진행한다. 각 계획의 마지막 전체 검증과 커밋이 통과한 뒤 다음 계획으로 이동한다.

> **2026-07-15 migration amendment:** S1 is complete through `202607140007_login_hardening.sql`, so S2 begins at `202607140008_assessment_options.sql`. Existing S3–S6 plan files contain pre-S1 placeholder filenames; every later migration must be renamed from the current branch's next available number before that slice starts.

## Specification Coverage

| 설계 명세 영역 | 구현 계획 |
|---|---|
| 제품 원칙·학생/관리자 흐름·라우트 | S1, S2, S3, S4, S5 |
| Nuxt/Worker/Supabase 아키텍처·모듈 경계 | S1 |
| 4년 학습경로 Edit Timeline 디자인·토큰·반응형·모션 | S1, S2, S3 |
| 데이터 모델·인덱스·RLS | S1–S6의 SQL Task |
| 학생 인증·개인정보·세션·복구·MFA | S1, S6 |
| 4단계 선택지·트랙 점수 | S2 |
| 2026 커리큘럼·기자재·시설·자원·환경 점수·최근 3개 | S3 |
| 전임 총괄·예비·겸임 전문 연계 추천 | S3, S5 |
| 상담 신청·배정·상태·전달 요약 | S4 |
| 학생·자원·교수·캠페인·XLSX 관리자 기능 | S5 |
| 이벤트·대시보드·Cron·1년 보존 | S1, S2, S6 |
| 오류·소유권·멱등성·재시도 | S1–S5 통합/SQL 테스트 |
| 성능·캐시·접근성·보안·배포·롤백 | S6 |
| 콘텐츠 준비와 출시 차단 기준 | S3, S5, S6 |

## Locked Repository Map

```text
app/
  app.vue                         # 전역 앱 셸
  assets/css/tokens.css           # 승인된 색·타입·간격 토큰
  assets/css/main.css             # 전역 리셋과 접근성 규칙
  components/common/              # 버튼·입력·상태·레이아웃
  components/assessment/          # 평가 단계와 선택 카드
  components/result/              # 관심사 클립·4년 학습경로·보조 근거 카드
  components/counseling/          # 교수 추천·상담 상태
  components/admin/               # 표·필터·편집 폼
  composables/                    # API·세션·이벤트 클라이언트
  layouts/default.vue             # 학생 레이아웃
  layouts/admin.vue               # 관리자 레이아웃
  middleware/                     # 학생·관리자 라우트 가드
  pages/                          # 설계 명세의 전체 라우트
  stores/                         # Pinia 세션·평가 상태
server/
  api/                            # 얇은 HTTP 핸들러
  middleware/                     # request ID·헤더·세션·CSRF
  modules/identity/               # 학생·관리자 인증 도메인
  modules/assessment/             # 질문·점수·평가 완료
  modules/matching/               # 자원·교수 매칭
  modules/counseling/             # 신청·추천·상태 전이
  modules/admin/                  # 운영 CRUD·내보내기
  modules/metrics/                # 이벤트·집계·보존
  utils/                          # Supabase·crypto·HTTP·logging
shared/
  schemas/                        # 공유 Zod 계약
  types/                          # 공유 TypeScript 타입
supabase/
  migrations/                     # 순서가 고정된 SQL 마이그레이션
  tests/                          # pgTAP/RLS/RPC 테스트
  seed/                           # 평가·교과·교수 구조화 seed
tests/
  unit/                           # 도메인 단위 테스트
  integration/                    # Nuxt server handler 테스트
  e2e/                            # Playwright 사용자 흐름
  load/                           # k6 시나리오
scripts/                          # seed 변환·검증·운영 명령
docs/content/                     # 검수 가능한 학과 콘텐츠 가이드
```

## Shared Contracts

`shared/types/api.ts`에서 전 슬라이스가 다음 계약을 사용한다.

```ts
export type ApiSuccess<T> = { data: T; requestId: string }
export type ApiFailure = {
  error: {
    code:
      | 'AUTH_FAILED' | 'VALIDATION_FAILED' | 'RATE_LIMITED' | 'INTERNAL_ERROR'
      | 'ADMIN_REQUIRED' | 'MFA_REQUIRED' | 'REAUTH_REQUIRED' | 'RECOVERY_INVALID'
      | 'ASSESSMENT_INVALID' | 'ASSESSMENT_CATALOG_STALE'
    message: string
  }
  requestId: string
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure
```

응답 envelope에는 `ok`나 `fieldErrors`를 추가하지 않는다. S2의 `ASSESSMENT_INVALID`는 HTTP 422, `ASSESSMENT_CATALOG_STALE`은 HTTP 409이며 나머지 S1 오류 상태는 기존 의미를 유지한다.

`shared/types/domain.ts`의 고정 식별자와 역할은 다음과 같다.

```ts
export type TrackKey = 'documentary' | 'art_photo' | 'commercial' | 'video'
export type QuestionGroup = 'work' | 'result' | 'style' | 'career'
export type ResourceType =
  | 'course' | 'equipment' | 'facility' | 'extracurricular'
  | 'project' | 'student_work' | 'career' | 'support'
export type FacultyRole = 'primary' | 'backup' | 'specialist'
export type CounselingStatus = 'new' | 'assigned' | 'contacted' | 'completed' | 'closed'
```

서버 모듈은 HTTP 이벤트 객체를 도메인 함수에 넘기지 않는다. API 핸들러가 쿠키·헤더·body를 검증해 명시적 입력 타입으로 변환하고, 도메인 함수는 결과 또는 `AppError`만 반환한다.

## Cross-Slice Quality Gate

각 계획의 마지막 커밋 전에 다음을 순서대로 실행한다.

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:sql
pnpm test:local-integration
pnpm test:e2e --project=chromium
pnpm build
git diff --check
```

예상 결과는 모든 명령 종료 코드 0, 실패 테스트 0, Git whitespace 오류 0이다. S6에서는 여기에 WebKit, 모바일 프로젝트, 접근성, 부하, 배포 스모크 테스트를 추가한다.

## Commit Policy

- 한 Task가 독립 검증을 통과할 때마다 해당 Task 파일만 stage한다.
- 메시지는 `chore:`, `feat:`, `fix:`, `test:`, `docs:` 중 하나로 시작한다.
- 내부 원본 DOCX/PDF, `.superpowers/`, 생성 리포트와 비밀 파일은 stage하지 않는다.
- 마이그레이션과 이를 사용하는 코드·테스트가 서로 다른 깨진 커밋에 남지 않게 같은 Task에서 커밋한다.
