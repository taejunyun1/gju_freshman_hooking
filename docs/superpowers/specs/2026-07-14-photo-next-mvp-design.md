# PHOTO:NEXT MVP 설계 명세

- 상태: 승인됨 — 교수진 콘텐츠 보강 포함
- 작성일: 2026-07-14
- 대상: 광주대학교 사진영상학과 신입생 관심사-교육환경 연결 서비스
- 개발 주체: 1인 풀스택 개발자
- 우선순위: 일정보다 전체 기능 완결성과 운영 가능성을 우선

## 1. 문서의 목적

PHOTO:NEXT는 지원 예정 학생이 하고 싶은 사진·영상 작업과 작업 방식, 결과물, 진로를 선택하면 그 관심사가 광주대학교 사진영상학과의 교과목, 장비·시설, 비교과·학과 프로젝트, 교수진, 학생 작품과 진로로 어떻게 이어지는지를 구체적인 근거와 함께 보여주는 모바일 우선 웹 서비스다.

이 문서는 내부 기획서와 기술설계서를 구현 가능한 단일 설계로 통합한다. 구현 단계에서 제품 방향, 화면 우선순위, 데이터 경계, 점수 산식과 보안 정책을 다시 추측하지 않도록 결정값을 명시한다.

### 1.1 기준 내부 문서

- `PHOTO_NEXT_MVP_서비스기획서_v1.0.docx`
- `PHOTO_NEXT_MVP_기술설계서_v1.0.docx`
- `resource/curri-data.pdf` — 2026학년도 개설 예정 교과목, 학년·학기·학점·수업 목표
- `docs/content/faculty-directory-guide.md` — 교수진 프로필, 전문분야, 상담·전문 연계 규칙
- `docs/content/equipment-facilities-guide.md` — 2026-07-14 기준 기자재 144개와 스튜디오·암실·컴퓨터실

원본 문서의 텍스트와 표를 모두 검토했다. 원본 렌더링에서는 로컬 한글 글꼴 문제로 일부 글자가 표시되지 않았으나, OOXML 본문과 표 데이터는 정상 추출되어 요구사항 검토에 사용했다.

## 2. 제품 원칙

1. 결과의 중심은 유형명이 아니라 연결 근거다. 학생이 고른 관심사와 실제 학과 자원을 한 화면에서 추적할 수 있어야 한다.
2. 점수보다 증거를 먼저 제시한다. 결과 화면은 추천 근거 타임라인을 먼저 보여주고 점수는 그 뒤에 배치한다.
3. 모든 추천은 운영자가 관리하는 실제 데이터와 출처 날짜를 가진다. 생성형 AI가 사실을 만들어내지 않는다.
4. 학생 경험은 2분 안에 끝낼 수 있을 만큼 단순해야 하지만, 관리자 운영 기능은 데이터 갱신·상담·내보내기까지 완결되어야 한다.
5. 개인정보는 브라우저와 로그에 최소한으로 노출하고, 서버 경계를 통과한 뒤에도 해시·암호화·권한 검증을 적용한다.
6. 모바일 화면을 기준으로 설계하고 데스크톱에서는 정보 밀도만 확장한다.

## 3. 목표와 제외 범위

### 3.1 목표

- 링크, QR, SNS, 문자 또는 카카오톡 메시지에서 모바일 웹으로 유입한다.
- 휴대전화 번호 기반의 간단한 학생 계정을 생성하고 재방문을 지원한다.
- 4단계 관심사 선택을 통해 사진·영상 트랙 선호와 교육환경 적합도를 계산한다.
- 선택 관심사에서 교과·장비·비교과·작품·진로로 이어지는 연결 근거를 시각화한다.
- 최근 결과 3개를 보관하고 비교 가능한 이력을 제공한다.
- 상담 신청과 교수 추천, 관리자 배정·상태 관리를 제공한다.
- 관리자에게 학생, 자원, 교수, 캠페인, 지표, XLSX 내보내기를 제공한다.
- 월 3만 명 수준의 유입과 약 17 req/s 피크를 안정적으로 처리한다.

### 3.2 명시적 제외 범위

- 학생용 소셜 로그인과 SMS 본인 인증·문자 발송
- 교수 전용 로그인, 일정 예약 또는 캘린더
- 생성형 AI 상담 챗봇
- 대학 입학 시스템과 직접 연계
- 장학금 자동 자격 판정
- 머신러닝 기반 추천
- 네이티브 iOS·Android 앱

## 4. 사용자와 핵심 흐름

### 4.1 학생

1. 캠페인 링크로 랜딩 페이지에 들어온다.
2. 휴대전화 번호, 학교명, 현재 상태, 지역을 입력해 신규 계정을 만들거나 기존 계정 로그인으로 이동한다.
3. 신규 가입 시 시스템이 닉네임과 임시 비밀번호를 생성한다.
4. 재방문 시 휴대전화 번호와 비밀번호로 로그인한다.
5. 4단계 관심사를 선택하고 결과를 제출한다.
6. 연결 근거 타임라인, 추천 자원, 트랙 점수, 작품·진로·지원·교수 정보를 확인한다.
7. 필요하면 상담을 신청하고 이력에서 최근 결과 3개를 다시 본다.

### 4.2 관리자

1. Supabase Auth 계정과 TOTP로 로그인한다.
2. 대시보드에서 유입·완료·상담·캠페인 지표를 확인한다.
3. 학생 상세와 참여 이력, 상담 신청을 조회한다.
4. 교과·장비·비교과·작품·진로·지원 자원과 교수 정보를 관리한다.
5. 교수 추천을 참고해 상담 담당자를 최종 배정하고 상태를 갱신한다.
6. 필터 결과를 XLSX로 내려받는다.

## 5. 정보 구조와 라우트

### 5.1 학생 라우트

| 경로 | 목적 |
|---|---|
| `/` | 캠페인 랜딩, 서비스 설명, 시작 CTA |
| `/start` | 휴대전화·학교·현재 상태·지역 입력 및 신규·기존 분기 |
| `/credentials` | 신규 닉네임·임시 비밀번호 1회 표시 |
| `/login` | 학생 로그인 |
| `/password/reset` | 로그인 상태 비밀번호 변경 또는 관리자 지원 복구 요청 |
| `/assessment` | 4단계 관심사 선택 |
| `/result/:publicId` | 소유권 검증 후 단일 결과 표시 |
| `/history` | 최근 결과 3개 |
| `/counseling` | 상담 신청 및 현재 상태 |

### 5.2 관리자 라우트

| 경로 | 목적 |
|---|---|
| `/admin/login` | 관리자 인증과 TOTP |
| `/admin` | 운영 대시보드 |
| `/admin/students` | 학생 목록, 필터, 상세 |
| `/admin/counseling` | 상담 큐, 교수 배정, 상태 변경 |
| `/admin/resources` | 학과 자원 CRUD와 노출 관리 |
| `/admin/faculty` | 교수 정보, 전문 태그, 용량 관리 |
| `/admin/campaigns` | 캠페인 링크와 성과 관리 |
| `/admin/export` | XLSX 생성 이력과 재시도 |

## 6. 기술 아키텍처

### 6.1 기술 스택

- 패키지 관리: pnpm
- 웹 애플리케이션: Nuxt 4, Vue 3, TypeScript
- 클라이언트 상태: Pinia
- 입력·응답 검증: Zod
- 스타일: CSS Custom Properties 기반 토큰 계층
- 데이터베이스·관리자 인증·파일: Supabase PostgreSQL, Auth, Storage
- 배포: Cloudflare Workers와 Workers Assets
- 테스트: Vitest, Vue Test Utils, Playwright, SQL/pgTAP, k6

### 6.2 단일 저장소 구조

```text
app/
  components/
  composables/
  layouts/
  pages/
  stores/
  assets/css/
server/
  api/
  middleware/
  modules/
    identity/
    assessment/
    counseling/
    admin/
    metrics/
  utils/
shared/
  schemas/
  types/
supabase/
  migrations/
  seed.sql
tests/
  unit/
  integration/
  e2e/
  sql/
scripts/
```

### 6.3 요청 경계

```text
Student/Admin Browser
        |
        v
Nuxt UI + server API on Cloudflare Worker
        |
        +-- IdentityModule
        +-- AssessmentModule
        +-- CounselingModule
        +-- AdminModule
        +-- MetricsModule
        |
        v
Supabase Data API / Auth / Storage
        |
        v
PostgreSQL tables + short transactional RPC functions
```

학생 브라우저는 Supabase 데이터베이스에 직접 접근하지 않는다. Nuxt 서버 API가 입력 검증, 인증, 소유권, 권한, 속도 제한을 통과시킨 뒤 Supabase Data API를 호출한다. Worker 런타임은 HTTPS 기반 Supabase 클라이언트와 서버 전용 `SUPABASE_SECRET_KEY`를 사용한다. PostgreSQL 직접 연결 문자열은 마이그레이션, 덤프, 관리 작업에만 쓰며 Worker 런타임 환경 변수에는 넣지 않는다.

원자성이 필요한 평가 완료·결과 회전과 상담 상태 변경은 Data API에서 PostgreSQL RPC 함수를 호출해 짧은 트랜잭션으로 처리한다. 함수는 고정된 잠금 순서, 빈 `search_path`, 최소 권한과 명시적 실행 권한을 가진다.

### 6.4 모듈 책임

- `IdentityModule`: 학생 등록·로그인·세션·비밀번호 재설정·휴대전화 보호·잠금
- `AssessmentModule`: 질문·선택 검증·점수 계산·추천·스냅샷·최근 3개 회전
- `CounselingModule`: 상담 신청·중복 방지·교수 추천·배정·상태 전이
- `AdminModule`: 관리자 권한·학생/자원/교수/캠페인 CRUD·전화번호 공개·XLSX
- `MetricsModule`: 이벤트 수집·일별 집계·보존 정책·운영 관측

모듈 사이 공유는 `shared`의 Zod 스키마와 타입, 명시된 서비스 인터페이스만 사용한다. API 핸들러에서 SQL과 점수 계산을 직접 작성하지 않는다.

## 7. 프런트엔드 디자인

### 7.1 시각 방향: Edit Timeline

핵심 시그니처는 영상 편집 타임라인을 닮은 **4년 학습경로 타임라인**이다. 학생이 선택한 관심사는 클립으로 놓이고, 각 클립이 교과·프로젝트를 거쳐 결과물과 진로로 이어진다. 기자재·시설은 독립된 주인공 레인이 아니라 각 학습 단계가 실제로 가능한 이유를 보강하는 실행 기반 증거로 붙인다.

```text
[선택 관심사 클립]
          |
          v
1Y 기초 ──> 2Y 제작·후반 ──> 3Y 심화·프로젝트 ──> 4Y 캡스톤·포트폴리오 ──> OUT 작품·진로
  교과·과제       교과·제작             전공심화·협업               졸업성과               무엇이 되는가?
     └──────── 장비·시설·교수·비교과는 관련 단계 아래의 보조 근거로 연결 ────────┘
```

타임라인은 장식이 아니라 실제 추천 데이터의 순서와 연결 이유를 표현한다. 추천 교과와 프로젝트를 1학년 기초 → 2학년 제작·후반 → 3학년 전공심화·프로젝트 → 4학년 캡스톤·포트폴리오로 묶어 관심사가 4년 동안 어떻게 심화되는지 보여준다. 장비·시설은 관련 교과나 프로젝트 카드 아래에 “이 제작을 가능하게 하는 기반”으로 1–2개만 먼저 노출하고, 더 많은 근거는 펼쳐보기에 둔다. 일반적인 보라색 SaaS 대시보드처럼 보이지 않도록 그라디언트 KPI 히어로, 의미 없는 유리 카드, 모든 요소의 과도한 둥근 모서리는 사용하지 않는다. 학생 화면에는 차가운 캔버스와 편집 레인 구조를, 관리자 화면에는 절제된 표와 상태 표시를 사용한다. 한 화면의 강한 시각 요소는 4년 학습경로 하나로 제한한다.

### 7.2 색상 토큰

| 역할 | 값 | 용도 |
|---|---:|---|
| Surface | `#FFFFFF` | 카드와 입력 표면 |
| Canvas | `#EEF1F6` | 전체 배경과 레인 |
| Ink | `#151A22` | 본문과 고대비 선 |
| Sequence Violet | `#6B43B5` | 선택 흐름과 주요 CTA |
| Resource Teal | `#2E7773` | 학과 자원과 근거 |
| Signal Amber | `#C27628` | 진로·상담 강조 |
| Error | `#B8423E` | 오류와 파괴적 동작 전용 |

색만으로 상태를 전달하지 않고 아이콘, 레이블과 패턴을 함께 사용한다. 텍스트와 상호작용 요소는 WCAG 2.2 AA 대비를 충족한다.

### 7.3 타이포그래피

- Display: Wanted Sans Variable
- Body: Pretendard Variable
- Utility/score/timecode: IBM Plex Mono

숫자와 타임코드는 고정폭 글꼴을 사용해 편집 도구의 정밀한 인상을 준다. 본문은 장문 가독성을 위해 Pretendard를 사용한다. 웹 글꼴 실패 시 시스템 한글 산세리프로 자연스럽게 폴백한다.

### 7.4 레이아웃과 반응형

- 모바일 기준 콘텐츠 폭: 100%, 좌우 20px 안전 여백
- 본문 최대 폭: 720px
- 결과 타임라인 최대 폭: 1120px
- 관리자 최대 폭: 1440px
- 모바일 터치 영역: 최소 44×44px
- 데스크톱 1024px 이상에서 타임라인을 가로 레인으로 전환
- 모바일에서는 같은 데이터 순서를 유지하며 세로 레인으로 접는다.

### 7.5 핵심 화면 와이어프레임

#### 평가

```text
PHOTO:NEXT                         02 / 04
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
어떤 결과물을 만들고 싶나요?
최대 3개를 골라주세요.

[ 다큐멘터리 시리즈 ] [ 패션 화보 ]
[ 브랜드 필름       ] [ 단편 영화 ]
[ 전시 작품          ] [ SNS 콘텐츠 ]

선택 2/3
[이전]                                  [다음]
```

#### 결과

```text
당신의 관심사는 4년 동안 이렇게 자랍니다
[패션 화보] [인물 연출] [광고 스튜디오]

1학년 기초        2학년 제작         3학년 프로젝트        4학년 포트폴리오       OUT
기초사진실기  →  라이팅과 스튜디오  →  브랜드 프로젝트  →  광고사진 연작      →  광고 포트폴리오
                  └ 제작 기반: 스튜디오 A(호리존) · 조명 장비  [더보기]
선택한 '패션 화보'와 '인물 연출' 관심이 실제 조명 실습과 브랜드 작업으로 이어집니다.

[교과·프로젝트 경로 8]  [제작 기반 근거 2]

트랙 점수 / 학생 작품 / 진로 / 지원 / 추천 교수
                                               [상담 신청]
```

#### 관리자 상담 큐

```text
상담 요청  42       신규 12       담당 미배정 8
[상태] [트랙] [캠페인] [기간] [검색]

닉네임       관심 트랙     추천 교수       상태       접수일
빛의기록27   광고사진       김OO / 이OO      신규       07-14
```

### 7.6 상호작용과 모션

- 평가 카드 선택: 160ms 색·선 전환, 레이아웃 점프 없음
- 결과 진입: 플레이헤드가 선택 클립에서 OUT까지 이동하며 레인을 한 번만 드러냄
- 결과 전체 연출 시간: 500ms 이하
- 스크롤 때 같은 애니메이션을 반복하지 않음
- `prefers-reduced-motion`에서는 이동을 없애고 즉시 최종 상태를 표시
- 포커스 링은 모든 키보드 상호작용에서 명확히 표시

### 7.7 공통 컴포넌트

- `InterestClip`: 선택한 관심사와 질문 그룹 표시
- `TimelineLane`: 1–4학년 교과·프로젝트와 OUT을 잇는 주 경로 레인
- `CapabilityEvidence`: 관련 교과·프로젝트에 부착되는 장비·시설·교수·비교과 보조 근거
- `ConnectionReason`: 선택값과 추천 자원을 잇는 한 문장 근거
- `ResourceCard`: 자원 유형, 상태, 출처 날짜, 연결 태그
- `TrackScore`: 4개 트랙 점수와 설명
- `AssessmentStep`: 단계 제목, 선택 제한, 진행 상태
- `CounselingCTA`: 상담 이점과 신청 상태
- `StatusBadge`: 텍스트와 아이콘이 포함된 상태
- `DataTable`: 관리자 필터·정렬·커서 페이지네이션
- `EmptyState`, `ErrorState`, `SkeletonState`: 모든 주요 화면의 상태

## 8. 데이터 모델

모든 테이블명과 컬럼명은 소문자 `snake_case`를 사용한다. 내부 PK는 `bigint generated always as identity`, 외부 URL에 노출하는 결과 식별자는 예측 불가능한 `uuid default gen_random_uuid()`를 사용한다. 시간은 모두 `timestamptz`로 저장한다.

### 8.1 핵심 테이블

#### `prospects`

- `id`, `nickname`, `phone_hmac`, `phone_ciphertext`, `phone_iv`
- `school_name`, `applicant_stage`, `region`
- `status`, `last_active_at`, `created_at`, `updated_at`
- `phone_hmac` unique
- 닉네임은 형용사 + 사진/영상 명사 + 두 자리 숫자 규칙으로 생성하며 충돌 시 재시도
- 학교명은 trim 후 1–40자, 현재 상태는 `high1`, `high2`, `high3`, `graduate`, `ged`, `other`
- 지역은 `gwangju`, `jeonbuk`, `capital`, `chungcheong`, `gyeongsang`, `gangwon_jeju`, `overseas`, `other`
- 학생 표시 레이블은 광주광역시, 전북, 수도권, 충청권, 경상권, 강원·제주, 해외, 기타를 사용

#### `student_credentials`

- `prospect_id`, `password_hash`, `password_salt`
- `failed_attempts`, `locked_until`, `password_changed_at`, `updated_at`
- 평문 비밀번호는 저장하지 않음

#### `credential_recovery_requests`

- `id`, `prospect_id`, `status`, `requested_at`, `verified_by_admin_id`, `verified_at`, `expires_at`
- 로그인되지 않은 사용자는 직접 비밀번호를 재설정하지 않고 복구 요청만 생성
- 관리자가 기존 학과 연락 절차로 본인을 확인한 뒤 일회용 복구 코드를 발급

#### `student_sessions`

- `id`, `prospect_id`, `token_hash`, `expires_at`, `idle_expires_at`
- `last_seen_at`, `revoked_at`, `created_at`

#### `assessments`

- `id`, `public_id`, `prospect_id`, `campaign_id`
- `idempotency_key`
- `status`, `track_scores jsonb`, `environment_score numeric(5,2)`
- `result_snapshot jsonb`, `completed_at`, `created_at`
- `public_id` unique
- `(prospect_id, idempotency_key)` unique
- 완료 결과는 당시 연결 근거와 표시 내용을 스냅샷으로 보존

#### `assessment_responses`

- `id`, `assessment_id`, `question_group`, `option_key`
- `option_label_snapshot`, `weight_snapshot jsonb`, `free_text`, `created_at`
- `(assessment_id, question_group, option_key)` unique
- `free_text`는 `career.explore` 응답에서만 허용하며 trim 후 최대 30자

#### `resources`

- `id`, `type`, `title`, `summary`, `connection_template`
- `status`, `visibility`, `priority`, `source_date`
- `metadata jsonb`, `image_path`, `created_at`, `updated_at`
- 유형: `course`, `equipment`, `facility`, `extracurricular`, `project`, `student_work`, `career`, `support`
- 상태: `draft`, `active`, `next_year_confirmed`, `archived`
- 교과 `metadata`: `academic_year`, `grade_year`, `term`, `credits`, `former_name`, `course_goal`, `convergence_major`
- 기자재 `metadata`: `location_key`, `category`, `confirmed_quantity`, `access_mode`, `source_url`
- 시설 `metadata`: `facility_key`, `activities`, `related_course_keys`, `operation_note`, `last_verified_at`

#### `resource_tags`

- `resource_id`, `tag_key`, `weight smallint`, `is_primary`
- `weight` check 0–3
- `(resource_id, tag_key)` unique

#### `equipment_inventory_items`

- `id`, `equipment_resource_id`, `inventory_code`, `source_row`, `location_key`
- `access_mode`, `availability_state`, `note`, `data_quality_status`, `source_date`
- `access_mode`: `reservation`, `inquiry`
- `availability_state`: `available`, `unavailable`, `unknown`
- `data_quality_status`: `verified`, `duplicate_code`, `unidentified`, `quantity_check`
- 2026-07-14 원문에 중복 코드 5건이 있으므로 `inventory_code`는 unique로 만들지 않고 내부 identity PK로 개별 항목을 식별

#### `assessment_options`

- `id`, `question_group`, `option_key`, `label`, `description`
- `track_weights jsonb`, `interest_tags jsonb`, `status`, `sort_order`, `updated_at`
- `(question_group, option_key)` unique
- 가중치와 태그는 게시 전에 서버 스키마와 DB 제약조건으로 0–3 범위를 검증

#### `faculty`

- `id`, `name`, `title`, `employment_type`, `consultation_role`
- `office`, `phone`, `email`, `website`, `contact_visibility jsonb`
- `expertise_summary`, `bio`, `profile_sections jsonb`
- `status`, `weekly_capacity`, `priority`, `source_date`, `last_verified_at`
- `image_path`, `created_at`, `updated_at`
- `employment_type`: `full_time`, `adjunct`, `practitioner`
- `consultation_role`: `primary`, `specialist`

#### `faculty_tags`

- `faculty_id`, `tag_key`, `tag_label`, `category`, `weight`, `is_primary`
- `category`: `track`, `activity`, `result`, `career`, `specialist`
- `weight` check 0–3
- `(faculty_id, tag_key, category)` unique

#### `faculty_specialist_links`

- `primary_faculty_id`, `specialist_faculty_id`, `tag_key`, `priority`, `explanation_template`
- 전임교원 총괄과 겸임교원 전문 연계의 허용 조합을 관리
- `primary_faculty_id`가 null이면 모든 활성 전임 총괄교수와 연결 가능한 학과 공통 전문 연계
- `(primary_faculty_id, specialist_faculty_id, tag_key)` unique nulls not distinct

#### `counseling_requests`

- `id`, `prospect_id`, `assessment_id`, `status`
- `contact_method`, `availability`, `inquiry`, `consent_given_at`
- `assigned_faculty_id`, `admin_note`, `version`
- `contacted_at`, `completed_at`, `closed_at`, `created_at`, `updated_at`
- 상담 방식: `phone`, `text`, `visit`; 가능 시간: `weekday_morning`, `weekday_afternoon`, `weekday_evening`, `weekend`
- 문의는 선택값이며 최대 200자, 정보 전달 동의는 필수

#### `counseling_faculty_recommendations`

- `counseling_request_id`, `faculty_id`, `role`, `rank`, `score`, `reason_snapshot jsonb`
- `role`: `primary`, `backup`, `specialist`
- `(counseling_request_id, role, rank)` unique

#### `campaigns`

- `id`, `code`, `name`, `channel`, `status`, `starts_at`, `ends_at`, `created_at`
- `code` unique

#### `events`

- `id`, `prospect_id`, `anonymous_id`, `campaign_id`, `event_name`
- `path`, `properties jsonb`, `created_at`
- 전화번호, 비밀번호, 세션 토큰은 properties에 저장할 수 없음

#### `daily_metrics`

- `metric_date`, `campaign_id`, `metric_name`, `metric_value`, `dimensions jsonb`
- `(metric_date, campaign_id, metric_name, dimensions)` unique

#### 운영 지원 테이블

- `admin_users`: Supabase Auth 사용자와 관리자 역할·활성 상태 연결
- `audit_events`: 전화번호 공개, 복구 승인, 상담 재개, 내보내기 같은 민감 동작 기록
- `export_jobs`: 필터 스냅샷, 상태, 생성자, 시트별 행 수, 오류 코드, 완료·다운로드 시각
- `rate_limit_buckets`: HMAC 처리한 IP·번호 식별자, 경로, 윈도 시작, 횟수, 만료 시각

### 8.2 제약조건과 인덱스

모든 FK에는 인덱스를 둔다. 주요 조회에 다음 인덱스를 추가한다.

- `assessments (prospect_id, completed_at desc)` where `status = 'completed'`
- `assessments (prospect_id, idempotency_key)` unique
- `student_sessions (token_hash)` unique where `revoked_at is null`
- `student_sessions (prospect_id, expires_at)` where `revoked_at is null`
- `resources (type, status, visibility, priority desc)`
- `resources (source_date desc)` where `status in ('active', 'next_year_confirmed')`
- `resource_tags (tag_key, weight desc)`
- `equipment_inventory_items (equipment_resource_id, data_quality_status)`
- `equipment_inventory_items (inventory_code)`
- `faculty_tags (tag_key, category, weight desc)`
- `faculty_specialist_links (primary_faculty_id, tag_key, priority desc)`
- `counseling_requests (status, created_at desc)`
- `counseling_requests (assigned_faculty_id, status)` where `status in ('assigned', 'contacted')`
- `counseling_faculty_recommendations (counseling_request_id, role, rank)`
- `events (event_name, created_at desc)`
- `events (campaign_id, created_at desc)`
- `daily_metrics (metric_date desc, metric_name)`
- `credential_recovery_requests (prospect_id, requested_at desc)`
- `export_jobs (created_by, created_at desc)`
- `rate_limit_buckets (expires_at)`

목록 API는 대량 오프셋 대신 `(created_at, id)` 또는 해당 정렬 키 기반 커서 페이지네이션을 사용한다. 초기 규모에서는 파티셔닝하지 않으며 실제 데이터 증가와 쿼리 계획을 보고 결정한다.

계정 상세의 FK는 삭제 정책을 명시한다. 자격정보·세션·평가 응답은 계정과 함께 삭제하고, 익명 집계를 유지해야 하는 이벤트의 `prospect_id`는 `on delete set null`로 비식별화한다. 자원·교수처럼 운영 기록에서 참조하는 데이터는 물리 삭제 대신 `archived` 상태를 사용한다.

`daily_metrics`의 캠페인 없는 유입도 중복 집계되지 않도록 집계 unique index는 `nulls not distinct`를 사용한다. JSONB 속성에 의존하는 핵심 무결성은 서버 검증만 믿지 않고 check 함수 또는 정규화된 컬럼으로 DB에서도 검증한다.

### 8.3 RLS와 데이터 권한

- public, anon, 일반 authenticated 역할은 핵심 테이블에 기본 거부 RLS를 적용한다.
- 학생 데이터는 Nuxt 서버 API와 서버 비밀키를 통해서만 접근한다.
- 관리자 Auth 사용자의 역할은 서버가 `admin_users` 허용 목록 또는 커스텀 클레임으로 검증한다.
- Storage 버킷은 관리자만 업로드하고, 공개 승인된 학과 이미지 파일만 읽기 가능하게 분리한다.
- 보안 정의 함수는 `search_path = ''`를 사용하고 public 실행 권한을 회수한 뒤 필요한 서버 역할에만 허용한다.
- 내보내기와 전화번호 원문 공개는 별도 감사 이벤트를 남긴다.

## 9. 인증, 개인정보와 세션

### 9.1 학생 계정

- 가입 식별자는 정규화한 국내 휴대전화 번호다.
- `phone_hmac`: 서버 비밀 `PHONE_HMAC_KEY`를 사용한 HMAC-SHA-256. 중복 확인과 조회에 사용한다.
- `phone_ciphertext`: `PHONE_ENCRYPTION_KEY`를 사용한 AES-256-GCM 암호문. 매 레코드마다 무작위 96-bit IV를 사용한다.
- 신규 비밀번호: 무작위 영문 대문자 2자 + `-` + 전화번호 마지막 4자리.
- 낮은 초기 비밀번호 엔트로피를 보완하기 위해 비밀번호는 Web Crypto PBKDF2-HMAC-SHA-256 600,000회, 레코드별 무작위 salt, 서버 비밀 `PASSWORD_PEPPER`로 파생해 저장한다.
- 최초 로그인 후 비밀번호 변경을 강하게 안내하지만 평가 시작을 막지는 않는다.
- 같은 번호로 다시 가입하면 새 계정을 만들지 않고 기존 사용자 로그인으로 이동한다.
- 재방문 로그인 식별자는 휴대전화 번호이며 닉네임은 자격 정보 표시, 복구 확인과 관리자 식별에 사용한다.
- SMS 인증이 없으므로 번호는 `verified`로 표시하지 않는다. 서비스 안에서 이 번호는 사용자가 입력한 연락 식별자이며, 실제 소유 확인은 상담 연락 또는 관리자 지원 복구 과정에서만 이뤄진다.

### 9.2 비밀번호 변경과 복구

- 로그인 상태에서는 현재 비밀번호를 다시 확인한 뒤 즉시 새 비밀번호로 변경한다.
- 로그인되지 않은 사용자는 휴대전화 번호, 닉네임, 지역으로 복구 요청을 남긴다. 응답은 일치 여부와 무관하게 동일하다.
- 관리자는 기존 학과 연락 절차로 본인을 확인하고, 15분 동안 한 번만 사용할 수 있는 무작위 128-bit 복구 코드를 발급한다.
- 복구 코드는 SHA-256 해시만 저장하고, 관리자가 확인된 사용자에게 전화 등 기존 채널로 전달한다. 애플리케이션은 SMS를 발송하지 않는다.
- 성공 시 모든 학생 세션과 기존 복구 코드를 폐기한다.

### 9.3 로그인 제한

- 계정 기준 실패 5회 시 15분 잠금
- IP 기준 로그인 10회/5분, 번호 HMAC 기준 5회/5분
- 가입 5회/IP/1시간, 비밀번호 재설정 3회/번호/1시간
- 계정 잠금은 `student_credentials`, IP·경로 제한은 `rate_limit_buckets`의 원자적 RPC로 처리하며 원문 IP를 저장하지 않음
- 오류 응답은 계정 존재 여부를 노출하지 않는 동일한 메시지와 상태 코드를 사용
- 성공 로그인 시 실패 횟수를 초기화하고 세션 고정 공격을 막기 위해 새 토큰 발급

### 9.4 학생 세션

- Web Crypto CSPRNG로 256-bit 불투명 토큰 생성
- DB에는 SHA-256 토큰 해시만 저장
- 쿠키: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
- 유휴 만료 30분, 절대 만료 12시간
- 로그아웃·비밀번호 변경·계정 정리 때 관련 세션을 폐기
- 휴대전화, 비밀번호, 토큰은 localStorage, sessionStorage, URL, 분석 이벤트에 저장하지 않음
- 상태 변경 API는 SameSite 쿠키에 더해 허용 Origin 검증과 세션에 결합된 CSRF 토큰을 요구

### 9.5 관리자 인증

- Supabase Auth 이메일 계정 사용
- TOTP MFA 필수
- 관리자 절대 세션 8시간
- 전화번호 전체 공개와 XLSX 생성은 인증 후 15분이 지났으면 재인증
- 목록은 기본적으로 `010-****-1234` 형태로 마스킹

### 9.6 비밀 관리

- `.env`는 커밋하지 않는다.
- `.env.example`에는 값이 없는 변수 이름과 설명만 둔다.
- Cloudflare 환경별 Secret으로 Supabase, 암호화, HMAC, pepper 값을 관리한다.
- 로그 필터가 `phone`, `password`, `authorization`, `cookie`, `token`, `secret` 키를 제거한다.
- 사용자 제공 PostgreSQL 비밀번호는 채팅·코드·문서에 기록하지 않고 로컬 비밀 주입으로만 사용한다.
- 응답에 CSP, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, 엄격한 Referrer-Policy를 적용한다.

## 10. 평가와 추천 로직

### 10.1 검증된 커리큘럼 근거

`resource/curri-data.pdf`의 2026학년도 개설 예정 표를 교과 자원의 최초 기준 데이터로 사용한다. PDF 원문은 내부 자료이므로 저장소에 올리지 않고, 검수된 구조화 데이터만 seed와 마이그레이션으로 관리한다. 모든 교과는 2026 학년도, 학년, 학기, 학점, 기존 수업명, 수업 목표, 융합전공 정보를 가능한 범위에서 보존한다.

“개설 예정” 자료이므로 최초 반입 상태는 `draft`다. 학과 운영자가 실제 노출 가능 여부를 확인한 뒤 `active`로 게시한다. PDF의 줄바꿈·오탈자를 그대로 학생 화면에 노출하지 않고, 원문 보존 필드와 검수된 표시 필드를 분리한다.

관심사에서 4년 학습 경로로 이어지는 대표 연결은 다음과 같다. 실제 결과는 선택 태그와 게시 상태를 기준으로 같은 규칙에서 계산한다.

| 관심사 묶음 | 1학년 기반 | 2학년 제작·후반 | 3학년 트랙 심화 | 4학년 포트폴리오·현장 |
|---|---|---|---|---|
| 광고·패션·스튜디오 | 라이팅과 스튜디오 | 디지털 이미지 제작과 프린트 | 커머셜 포토그라피 기초·심화 워크숍 | 커머셜 포토그라피 세미나·랩 |
| 다큐멘터리·사회 기록 | 이미지와사회 | 다큐멘터리 메이킹&쇼케이스 | 포토 스토리 워크숍, 포토에세이 워크숍 | 다큐멘터리 세미나, 포스트 다큐멘터리 랩 |
| 영상 서사·콘텐츠 | 영상 에세이 메이킹, 영상 프레임과 컷 | 내러티브 영상촬영, 비주얼 스토리 메이킹 | 영상 인터뷰 내러티브 워크숍, 영상 콘텐츠 크리에이터 워크숍 | 예술창작 프로젝트 세미나·랩 또는 현장실습 |
| 예술·리서치·전시 | 기초사진실기 | 리서치와 레퍼런스 이미지 제작 | 사물·데이터·이미지 워크숍, 사진과 장소 그리고 콘텍스트 워크숍 | 예술창작 프로젝트 세미나·랩 |
| 편집·AI·드론 테크닉 | 디지털 포토 에디팅, AI와 이미지 메이킹 | 영상 컬러와 포스트 프로덕션, 영상드론기초 | 영상 드론 콘텐츠 워크숍, 캡스톤 디자인1 | 캡스톤 디자인2, 현장실습 |

연결 이유 문장은 단순 태그 나열이 아니라 선택과 수업 목표를 결합한다. 예를 들어 “패션 화보와 인물 연출을 선택했기 때문에 혼합 조명과 조명 액세서리를 실습하는 ‘라이팅과 스튜디오’를 먼저 추천합니다”처럼 표시한다. 교과명이 비슷하거나 구·신 교과명이 함께 있는 경우 2026 표시명은 `title`, 기존 수업명은 `former_name`으로 저장한다.

### 10.2 평가 단계

| 단계 | 질문 그룹 | 선택 제한 | 트랙 점수 비중 |
|---|---|---:|---:|
| 1 | 하고 싶은 작업 | 1–4개 | 40% |
| 2 | 만들고 싶은 결과물 | 1–3개 | 30% |
| 3 | 선호 작업 방식 | 1–2개 | 10% |
| 4 | 관심 진로 | 1–2개 | 20% |

선택지는 관리자 코드 배포 없이 데이터로 관리하되, 활성화된 선택지의 키·레이블·트랙 가중치가 평가 응답에 스냅샷으로 저장된다. 각 선택지는 다큐멘터리, 예술사진, 광고사진, 영상 4개 트랙에 대해 0–3 가중치를 가진다.

진로 선택지는 사진 제작, 영상 제작, 프로젝트 기획, 가능성 탐색의 문장형 카드다. 가능성 탐색을 선택한 경우에만 30자 이내의 선택 입력을 허용하며, 해당 텍스트는 결과 추천 근거로 직접 사용하지 않고 상담 맥락으로만 저장한다.

### 10.3 트랙 점수

트랙 `t`, 질문 그룹 `g`에 대해:

```text
group_score(t, g)
  = sum(selected_option_weight(t)) / (selected_option_count × 3) × 100

track_score(t)
  = work_score(t) × 0.40
  + result_score(t) × 0.30
  + career_score(t) × 0.20
  + style_score(t) × 0.10
```

각 그룹에서 최소 1개 선택을 요구하므로 0으로 나누지 않는다. 최종 점수는 소수 둘째 자리에서 반올림해 한 자리로 표시한다. 동점 정렬은 하고 싶은 작업 점수, 결과물 점수, 진로 점수, 고정 트랙 순서 순으로 결정해 결과가 재현 가능해야 한다.

### 10.4 자원 적합도

선택 옵션은 트랙 외에도 `portrait`, `studio_lighting`, `documentary`, `editing`, `brand_content` 같은 관심 태그를 가진다. 학생 태그 벡터는 선택 그룹 비중을 적용해 0–1로 정규화한다.

자원 `r`의 적합도:

```text
resource_affinity(r)
  = sum(student_tag_score(k) × resource_tag_weight(r, k))
    / sum(resource_tag_weight(r, k)) × 100
```

일치 태그가 없으면 0이다. 자원은 먼저 `active` 또는 `next_year_confirmed`, 학생 공개 가능 상태로 필터링한 뒤 다음 순서로 정렬한다.

1. `resource_affinity` 내림차순
2. 운영자 `priority` 내림차순
3. `source_date` 내림차순
4. `id` 오름차순

동일 주 태그 자원이 한 범주 결과의 2개를 초과하지 않도록 다양성 규칙을 적용한다. 자원이 부족하면 사실과 무관한 항목을 채우지 않고 최대치보다 적게 표시한다.

기자재는 동일 위치·동일 모델의 개별 재고를 하나의 공개 자원으로 묶고 확인된 수량을 표시한다. 내부 관리에서는 144개 개별 항목과 코드를 유지한다. `duplicate_code`, `unidentified`, `quantity_check` 상태는 정확한 코드·모델·수량이 검수될 때까지 개별 공개 추천에서 제외한다. 이용 가능 표시는 기준일 스냅샷임을 밝히고 실제 대여는 [기자재 예약 시스템](https://gjureserve.co.kr) 또는 학과 문의로 확인하게 한다. 이 데이터는 학생을 장비 보유 여부만으로 설득하기 위한 목록이 아니라, 추천된 교과·프로젝트를 학과에서 실제로 수행할 수 있음을 뒷받침하는 보조 근거다.

### 10.5 교육환경 적합도

```text
environment_score
  = course_fit × 0.35
  + equipment_facility_fit × 0.20
  + extracurricular_project_fit × 0.15
  + faculty_fit × 0.15
  + career_portfolio_fit × 0.15
```

각 범주 점수는 표시 대상으로 선정된 자원 적합도의 가중 평균이다. 해당 범주의 승인 데이터가 전혀 없으면 전체 점수를 과장하지 않도록 그 범주를 0으로 계산하고 관리자 데이터 품질 경고를 남긴다. 장비·시설의 20% 내부 계산 비중은 결과 화면의 시각적 비중을 뜻하지 않으며, 화면에서는 교과·프로젝트 학습경로 아래의 보조 근거로만 표현한다. 장학금과 일반 지원 제도는 결과에 표시하지만 점수에는 넣지 않는다.

### 10.6 결과 자원 상한

| 범주 | 최대 표시 수 |
|---|---:|
| 교과목 | 5 |
| 장비·시설 | 기본 2, 펼침 시 최대 4 |
| 비교과·학과 프로젝트 | 3 |
| 학생 작품 | 3 |
| 진로 | 4 |

학생 작품은 공개 동의를 확인한 레코드만 노출한다. 각 추천 카드에는 선택 관심사, 연결 태그, 구체적 이유, 출처 기준일을 표시한다.

### 10.7 교수 추천

교수진 콘텐츠와 역할의 기준은 `docs/content/faculty-directory-guide.md`다. 총괄 상담교수 후보는 `active`, `full_time`, `primary`인 전임교원으로 제한한다. 조대연 교수는 사회·사람·포토스토리·포토커뮤니케이션, 윤태준 교수는 예술사진·영상·AI·설치·전시·개인창작, 김사라 교수는 지역·공공기관·아카이브·인터뷰·현장조사 태그를 중심으로 매칭한다.

```text
primary_faculty_score
  = track_match × 0.40
  + activity_match × 0.25
  + result_portfolio_match × 0.15
  + career_match × 0.15
  + load_score × 0.05

load_score = max(0, 1 - open_assigned_count / weekly_capacity) × 100
```

다큐멘터리 관심이 사회·사람·포토스토리에 가까우면 조대연 교수를, 지역·기관·아카이브·현장조사에 가까우면 김사라 교수를 우선한다. 두 방향이 같으면 두 교수를 총괄·예비로 함께 보여주고 현재 열린 상담 수로 순서를 정한다. 광고·패션·제품사진처럼 겸임교원의 전문성이 가장 높은 분야는 학생의 다른 관심 태그와 상담 용량으로 전임교원 총괄·예비를 정하고 곽동욱 겸임교수를 전문 연계로 표시한다. 근거 없이 특정 전임교원을 광고사진 전문가로 표현하지 않는다.

전문 연계 후보는 `active`, `adjunct` 또는 `practitioner`, `specialist`인 교수진으로 제한한다.

```text
specialist_score
  = specialist_tag_match × 0.50
  + project_match × 0.30
  + career_match × 0.20
```

- 영상·드론·VR·360은 윤태준 교수 총괄 우선 + 박재웅 겸임교수 연계
- 전시·큐레이팅·예술이론은 윤태준 교수 총괄 우선 + 정철호 겸임교수 연계
- 광고·패션·제품·뷰티·브랜드·스튜디오는 전임교원 총괄 + 곽동욱 겸임교수 연계
- 다큐멘터리·사회·지역·아카이브가 함께 높으면 조대연·김사라 교수 공동 연계 가능

전문 연계는 50점 이상을 최대 2명까지 표시한다. `weekly_capacity`가 0인 전임교원은 신규 총괄 추천에서 제외하되 공개 프로필은 유지한다. 총괄 점수가 같은 경우 현재 열린 상담 수, 관리자 우선순위, 교수 ID 순으로 결정한다. 시스템은 총괄 1명, 예비 1명, 전문 연계 0–2명을 추천하지만 실제 담당 교수의 최종 배정은 관리자만 한다.

### 10.8 원자적 완료와 최근 3개

클라이언트는 평가 제출 때 UUID idempotency key를 보낸다. `complete_assessment` RPC는 다음을 하나의 짧은 트랜잭션에서 처리한다.

1. 학생 행을 잠근다.
2. idempotency key의 기존 완료 결과가 있으면 그대로 반환한다.
3. 응답과 당시 가중치를 저장한다.
4. 점수, 추천, 연결 이유와 표시 데이터를 결과 스냅샷에 저장한다.
5. 해당 학생의 완료 결과를 최신 3개만 남기고 오래된 상세 결과를 삭제한다.
6. 누적·익명 집계용 이벤트는 삭제하지 않는다.

잠금은 항상 학생 → 평가 → 응답 순서로 획득한다. 네트워크 재시도는 결과를 중복 생성하지 않는다.

## 11. 결과 화면 구성

승인된 정보 순서는 다음과 같다.

1. 한 문장 요약
2. 학생이 선택한 관심사 클립
3. 관심사 → 1–4학년 교과·프로젝트 → 결과물·진로를 잇는 주 학습경로 타임라인
4. 학습경로의 예상 작품·포트폴리오와 진로
5. 관련 단계에 부착된 장비·시설·교수·비교과 보조 근거와 구체적인 연결 이유
6. 4개 트랙 점수와 교육환경 적합도
7. 학생 작품, 지원 제도, 추천 총괄교수·예비교수·전문 연계교원
8. 상담 신청 CTA

교과·프로젝트 학습경로와 결과물·진로가 메인 콘텐츠다. 장비·시설은 별도 메인 레인이나 대형 목록으로 앞세우지 않고, 관련 단계의 실행 가능성을 증명하는 작은 근거 카드로 표시한다. 첫 화면에는 가장 강한 장비·시설 근거 1–2개만 보여주고 전체 후보는 사용자가 펼쳤을 때 최대 4개까지 제공한다. 실제 이수 학년이나 학기가 확인된 교과는 카드 메타데이터로 표시한다. 결과 문구는 “당신은 광고사진형입니다”처럼 성격을 단정하지 않고 “선택한 관심사는 광고사진 실습과 높은 연결을 보입니다”처럼 설명한다.

## 12. 상담 운영

### 12.1 상태

```text
new -> assigned -> contacted -> completed
  \        \           \          \
   +--------+-----------+-----------> closed
```

- `new`: 학생 신청 완료
- `assigned`: 관리자가 담당 교수 배정
- `contacted`: 연락 시도 또는 연결 완료
- `completed`: 상담 완료
- `closed`: 철회, 중복, 연락 불가, 운영 종료

서버가 허용된 상태 전이만 검증한다. 완료·종료 상태를 다시 열려면 관리자 사유를 감사 이벤트에 남겨야 한다. 동일 학생이 열린 상담을 중복 신청하면 기존 요청을 반환한다.

### 12.2 알림

MVP는 SMS나 카카오톡을 직접 발송하지 않는다. 관리자 상담 큐와 대시보드 신규 건수로 운영하며, 내보내기 파일을 이용한 외부 연락은 관리자가 수행한다.

## 13. 관리자 기능

### 13.1 대시보드

- 방문, 가입, 평가 시작, 평가 완료, 상담 신청 수
- 단계별 전환율과 평가 이탈 단계
- 상위 관심사·트랙·자원
- 캠페인별 유입·완료·상담 전환
- 미배정·장기 미처리 상담
- 데이터 품질 경고: 만료 출처, 승인 자원 부족, 교수 용량 0

### 13.2 학생과 상담 목록

- 닉네임, 마스킹 번호, 트랙, 캠페인, 평가일, 상담 상태 필터
- 서버 정렬과 커서 페이지네이션
- 학생 상세에 최근 평가 3개와 상담 이력
- 원문 번호 공개는 재인증과 감사 이벤트 필요
- 관리자 메모는 학생에게 노출하지 않음

### 13.3 자원·교수·캠페인 관리

- draft 저장, 미리보기, 활성화, 다음 연도 확정, 보관
- 필수값: 제목, 유형, 공개 상태, 출처 기준일, 연결 태그
- 학생 작품은 공개 동의 상태 필수
- 교수는 전문 태그와 주간 상담 용량을 관리
- 캠페인 코드는 수정하지 않고 비활성화 후 새로 생성

### 13.4 XLSX 내보내기

파일은 다음 시트를 가진다.

1. `학생목록`: 닉네임, 승인된 원문 번호, 학교, 현재 상태, 지역, 진로 1·2, 총 참여, 최근 결과, 추천·배정교수, 상담 상태
2. `최근참여이력`: 회차, 참여일, 선택값, 4개 트랙 점수, 환경 점수, 추천 자원
3. `상담현황`: 희망 방식, 가능 시간, 문의, 추천·배정교수, 연락일, 결과, 메모

필터 조건과 생성자, 생성 시각을 파일 메타데이터와 감사 이벤트에 남긴다. 최근 재인증한 관리자 브라우저가 권한 검증된 API 데이터를 1,000행씩 받아 ExcelJS로 파일을 만들며 데이터베이스 자격증명과 복호화 키는 브라우저에 전달하지 않는다. 파일 생성은 진행 상태를 표시하고 실패 시 새 작업으로 동일 조건을 재시도한다. 한 작업은 최대 30,000행이며 초과하면 필터 범위를 좁히도록 안내한다. 원문 전화번호와 workbook 참조는 다운로드 후 브라우저 상태에서 즉시 제거한다.

## 14. 이벤트와 지표

### 14.1 이벤트

- `landing_viewed`
- `registration_started`, `registration_completed`
- `login_succeeded`, `login_failed`
- `assessment_started`, `assessment_step_completed`, `assessment_completed`
- `result_viewed`, `resource_opened`
- `counseling_requested`
- `admin_phone_revealed`, `admin_export_created`

분석 이벤트는 민감정보를 포함하지 않는다. 가입 전에는 무작위 anonymous ID, 가입 후에는 내부 prospect ID를 사용하고 원문 번호나 해시를 분석 속성에 넣지 않는다.

### 14.2 핵심 지표

- 랜딩 → 가입 완료 전환율
- 가입 → 평가 완료 전환율
- 단계별 이탈률
- 결과 → 상담 신청 전환율
- 캠페인별 완료율과 상담 전환율
- 상담 첫 처리까지 걸린 시간
- 결과 화면 p75 응답 시간과 오류율

## 15. 오류와 복구

| 상황 | 동작 |
|---|---|
| 이미 가입한 번호 | 신규 생성 없이 로그인 화면으로 이동 |
| 로그인·재설정 실패 | 계정 존재 여부를 숨기는 공통 메시지 |
| 잠금·속도 제한 | 재시도 가능 시각을 일반화해 안내 |
| 평가 제출 네트워크 오류 | 선택을 세션 메모리와 안전한 비민감 임시 상태에 유지하고 재시도 |
| 중복 제출 | idempotency key로 동일 결과 반환 |
| 저장 일부 실패 | DB 트랜잭션 전체 롤백 |
| 타인 결과 URL | 존재 여부를 드러내지 않는 404 형태 응답 |
| 상담 상태 잘못된 전이 | 409와 최신 상태 반환, UI 갱신 |
| 이미지 실패 | 유형별 로컬 플레이스홀더와 대체 텍스트 |
| 자원 부족 | 있는 근거만 표시하고 관리자 품질 경고 |
| XLSX 실패 | 실패 원인 코드, 재시도 버튼, 중복 파일 방지 |

서버 오류 응답은 사용자용 메시지, 안정된 오류 코드, request ID만 포함한다. 내부 스택과 Supabase 오류 원문은 브라우저에 노출하지 않는다.

## 16. 성능과 캐시

- 첫 모바일 콘텐츠 표시 목표: 3초 이내
- 평가 제출과 결과 계산: 2초 이내
- 관리자 필터 응답: 2초 이내
- 피크 검증 기준: 약 17 req/s
- 공개 랜딩과 승인된 정적 자원 메타데이터는 Cloudflare 캐시 사용
- 사용자 결과, 상담, 관리자 응답은 `private, no-store`
- 결과 스냅샷으로 과거 결과 조회 시 매번 추천을 재계산하지 않음
- 관리자 목록은 필요한 컬럼만 선택하고 커서 페이지네이션
- 자원 이미지에 크기 지정, 현대 포맷, 지연 로딩 적용
- Nuxt 번들은 라우트 단위로 분할하고 관리자 코드를 학생 초기 번들에서 분리

지원 브라우저는 iOS Safari, Android Chrome, 데스크톱 Chromium과 Safari의 현재 및 이전 두 개 주요 버전이다.

## 17. 정기 작업과 보존

Supabase Cron으로 데이터베이스 가까이에서 실행한다.

- 일별 지표 집계: 매일 03:05 KST, 즉 전날 18:05 UTC
- 1년 비활성 학생 정리: 매일 03:20 KST, 즉 전날 18:20 UTC

비활성 기준은 `last_active_at < now() - interval '1 year'`이다. 정리 작업은 학생 원문·계정·세션·평가 상세·상담 개인정보를 삭제하고 익명화된 누적 이벤트와 일별 집계만 유지한다. 삭제 전후 행 수와 실행 시간을 개인정보 없는 운영 로그에 기록한다. 작업은 배치 단위로 수행해 장시간 잠금을 피한다.

## 18. 테스트 전략

### 18.1 단위 테스트

- 전화번호 정규화, HMAC 입력 규칙, 암복호화 왕복
- 닉네임 충돌 재시도와 비밀번호 형식
- PBKDF2 검증, 로그인 실패 누적과 잠금 해제
- 트랙 점수 정규화, 동점 정렬, 자원 적합도
- 주 태그 다양성, 자원 표시 상한, 자원 부족
- 교수 점수와 용량 0 제외
- 상담 상태 전이
- 최근 결과 3개 회전과 보존 기준

### 18.2 API·DB 통합 테스트

- 동시 중복 가입이 한 prospect만 생성
- 속도 제한과 계정 잠금
- 세션 만료·폐기·비밀번호 변경 후 무효화
- 평가 중복 제출과 트랜잭션 롤백
- 타인 결과 소유권 차단
- RLS 기본 거부와 관리자 권한
- 4번째 결과 생성 후 최신 3개만 유지
- 열린 상담 중복 방지와 잘못된 상태 전이 차단
- XLSX 시트·필터·마스킹 정확성
- Cron 집계와 1년 보존 삭제

### 18.3 E2E 테스트

- 랜딩 → 가입 → 4단계 평가 → 결과 → 상담 신청을 2분 이내 완료
- 기존 사용자 로그인, 로그인 상태 비밀번호 변경, 관리자 지원 복구
- 4번째 평가 후 이력 확인
- 관리자 로그인·MFA·필터·자원 공개·상담 배정·상태 완료
- 전화번호 공개 재인증과 감사 이벤트
- XLSX 생성·다운로드·재시도

### 18.4 품질·비기능 검증

- iPhone 소형 화면과 Android 대표 화면
- 키보드 전용 탐색, 스크린리더 레이블, 색 대비, 44px 터치 영역
- reduced motion
- 로그·이벤트·오류 응답의 민감정보 누출 스캔
- 저장소와 배포 환경의 비밀 누출 스캔
- k6로 17 req/s에서 핵심 API 목표 시간과 오류율 검증
- Cloudflare 미리보기 URL에서 실제 Worker 런타임 검증

각 수직 슬라이스는 정상 화면뿐 아니라 loading, empty, error, unauthenticated 상태와 분석 이벤트, 자동 테스트를 함께 완료해야 끝난 것으로 본다.

## 19. 환경과 배포

### 19.1 환경

- 로컬: Supabase CLI 로컬 스택, Nuxt 개발 서버
- 스테이징: 기존 Supabase 프로젝트 `ifourklrmnswileplgir`, Cloudflare Worker `photo-next-staging`
- 프로덕션: 별도 Supabase 프로젝트와 Cloudflare Worker `photo-next`

프로덕션은 스테이징 데이터베이스를 공유하지 않는다. 스키마는 SQL 마이그레이션으로만 변경하고 대시보드에서 수동 변경한 내용도 즉시 마이그레이션으로 역반영한다.

### 19.2 Cloudflare

- 기존 사용자의 Cloudflare 계정에 `wrangler login`으로 연결
- Nuxt 빌드 출력 `.output/server/index.mjs`와 `.output/public` 배포
- `nodejs_compat`와 관측 설정 활성화
- 스테이징 검증 후 동일 커밋을 프로덕션에 승격
- 공개 정적 자산과 개인 API 캐시 정책 분리

### 19.3 GitHub

- 원격 저장소: `https://github.com/taejunyun1/gju_freshman_hooking.git`
- 기본 브랜치: `main`
- 내부 기획 원본, 비밀, 로컬 시각 검토 파일은 커밋하지 않음
- PR 또는 배포 전 lint, typecheck, unit, integration, E2E 핵심 흐름을 실행

## 20. 수직 슬라이스 개발 순서

기간을 기준으로 자르지 않고, 매 단계가 사용자에게 끝까지 동작하는 기능 묶음이 되도록 한다.

### S1. 기반과 계정

- Nuxt·Supabase·Cloudflare 기반
- 디자인 토큰과 공통 상태 컴포넌트
- 학생 가입, 자격 정보 표시, 로그인, 재설정, 세션, 잠금
- 관리자 Auth·MFA와 기본 레이아웃

### S2. 평가

- 평가 선택지 데이터와 관리자 최소 편집
- 4단계 모바일 평가, 선택 제한, 임시 상태 보존
- 응답 검증, 점수 함수와 이벤트

### S3. 결과·매칭·이력

- 자원·태그·교수 데이터 모델
- 트랙·자원·환경·교수 점수
- 연결 근거 타임라인과 결과 스냅샷
- 최근 결과 3개와 소유권 검증

### S4. 상담

- 상담 신청, 중복 방지, 교수 1순위·예비 추천
- 관리자 배정, 상태 전이, 감사 이벤트
- 학생 상담 상태 확인

### S5. 운영 관리

- 학생·자원·교수·캠페인 전체 관리
- 관리자 필터, 데이터 품질 경고
- XLSX 생성과 재시도

### S6. 지표·보안·성능·배포

- 이벤트와 일별 집계, 1년 보존 작업
- 전체 RLS·비밀·로그·재인증 점검
- 접근성, 브라우저, 부하, 캐시 최적화
- 스테이징과 프로덕션 배포 절차 검증

## 21. 출시 승인 기준

- 학생 신규·기존 사용자 핵심 흐름이 모바일에서 끊김 없이 동작한다.
- 결과의 모든 자원은 학생 선택과 연결되는 구체적 이유를 표시한다.
- 실제 학과 데이터가 각 자원 상한을 만족하거나, 부족한 범주가 운영자에게 명확히 경고된다.
- 교과·장비·비교과·교수·작품·진로의 출처 기준일과 공개 상태가 검증된다.
- 기자재 개별 항목이 기자재실 83개, 판타지랩 61개, 총 144개와 일치하고 중복 코드 5건·확인 필요 6건의 검수 상태가 표시된다.
- 스튜디오 A(호리존), 스튜디오 B, 암실, 컴퓨터실의 운영·예약 정보가 학과 확인을 거친다.
- 최근 3개 결과, 상담 상태, 관리자 내보내기가 데이터 규칙과 일치한다.
- 타인 결과, 학생 목록, 원문 전화번호가 권한 없이 노출되지 않는다.
- 자동 테스트, 17 req/s 부하, WCAG 2.2 AA 핵심 검사가 통과한다.
- 스테이징에서 DB 마이그레이션, Worker 배포, 롤백 절차를 한 번 이상 검증한다.

## 22. 콘텐츠 준비 기준

실제 학과 콘텐츠는 코드와 분리된 운영 데이터로 입력한다. 각 레코드는 제목, 요약, 유형, 공개 상태, 출처 기준일, 연결 태그와 근거 문장을 가져야 한다. 교과 데이터는 `curri-data.pdf`의 2026학년도 개설 예정 표를 기준으로 구조화한 뒤 학과 확인을 거쳐 게시한다. 작품 이미지는 공개 동의와 대체 텍스트가 필수다. 사실 확인되지 않은 교과·장비·프로젝트·진로를 샘플 데이터 그대로 프로덕션에 공개하지 않는다.

현재 제공된 사실 데이터는 2026 교과 표, `faculty-directory-guide.md`의 교수진 6명 프로필·추천 규칙, `equipment-facilities-guide.md`의 기자재 144개와 시설 4곳이다. 교수 연락처는 필드별 공개 상태를 학과가 확인한 뒤 노출하고, 교수·시설·기자재 사진은 사용 권한이 확인될 때까지 플레이스홀더를 사용한다. 기자재는 2026-07-14 스냅샷이므로 실제 이용 상태를 예약 시스템과 학과 문의로 다시 확인하게 한다. 비교과·학과 프로젝트, 학생 작품, 진로, 지원 제도는 구현 시 관리 화면과 반입 서식을 먼저 제공하고, 학과가 확인한 레코드만 게시한다. 이 범주들을 임의로 작성하지 않으며, 출시 승인에서는 각 범주가 비어 있지 않고 공개 상태·출처 날짜·연결 태그를 갖췄는지 확인한다.

## 23. 공식 기술 참고

- [Cloudflare의 Nuxt Workers 배포 가이드](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/)
- [Nuxt 4 배포 문서](https://nuxt.com/docs/4.x/getting-started/deployment)
- [Supabase PostgreSQL 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Supabase Auth 사용자와 서버 비밀키](https://supabase.com/docs/guides/auth/users)
