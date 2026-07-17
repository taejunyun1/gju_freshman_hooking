# PHOTO:NEXT 연간 지원자 명단·간소 인증 설계

**작성일:** 2026-07-17
**상태:** 사용자 방향 승인, 구현 전 문서 검토 대기
**대상 규모:** 연간 약 200명, 업로드 안전 상한 500명

## 1. 목적

PHOTO:NEXT의 학생 계정 기능을 불특정 사용자의 공개 가입 시스템이 아니라 광주대학교 사진영상미디어학과가 연 1회 운영하는 사전 등록 지원자 명단으로 단순화한다.

운영자는 Excel 또는 CSV로 해당 연도 지원자 명단을 올리거나 학생을 개별 등록한다. 학생은 사전에 발급된 휴대전화 번호와 초기 비밀번호로 로그인해 관심사 검사를 진행한다. 이전 연도 학생과 검사 결과는 삭제하지 않고 연도별 읽기 전용 기록으로 보관한다.

이 변경의 핵심 목표는 다음과 같다.

- 공개 회원가입을 제거하고 승인된 현재 연도 학생만 로그인시킨다.
- Worker의 PBKDF2 600,000회 연산을 제거한다.
- 비밀번호 평문을 PostgreSQL에 전달하지 않는다.
- 로그인·명단 확정·개별 추가·수정·비밀번호 재발급을 각각 하나의 원자적 PostgreSQL RPC로 처리한다.
- 연 200명 규모에 맞지 않는 복구 신청, 관리자 승인, 복구코드 등의 범용 계정 기능을 제거한다.
- 기존 학생·검사·상담 데이터의 참조 무결성을 보존한다.
- 현재 Supabase와 Cloudflare Workers를 유지하고 새 유료 서비스를 추가하지 않는다.

## 2. 운영 전제

- 실제 기존 학생 계정은 없다. 현재 데이터는 테스트 또는 개발 데이터뿐이다.
- 매년 운영자가 약 200명의 명단을 제공한다.
- 현재 연도의 활성 명단에 속한 학생만 로그인할 수 있다.
- 지원자가 명단에 없는 경우 공개 가입 경로를 제공하지 않는다.
- 학생 기본 정보는 이름, 연락처, 출신고교, 학년이다.
- 학생은 관심사 검사와 결과 확인을 위해서만 계정을 사용한다.
- 테스트 계정 5개를 별도로 유지하며 운영 통계에서 제외한다.
- 이전 연도 명단과 결과는 자동 삭제하지 않고 보관한다.

## 3. 선택한 접근

### 3.1 Supabase Data API와 단일 RPC 유지

기존 Supabase Data API를 유지한다. Worker는 각 명령을 하나의 PostgreSQL 함수 호출로 전달한다. Hyperdrive 직접 연결이나 Cloudflare D1 이전은 도입하지 않는다.

이 선택의 이유는 다음과 같다.

- 현재 RLS, service role, migrations, 검사·상담·콘텐츠 데이터가 이미 Supabase에 있다.
- 연간 200명은 직접 연결 풀이나 별도 데이터베이스를 추가할 규모가 아니다.
- 한 명령을 한 RPC로 합치면 네트워크 왕복 문제는 해결된다.
- PostgreSQL `pgcrypto`가 이미 설치되어 bcrypt를 추가 비용 없이 사용할 수 있다.

### 3.2 범위가 아닌 것

- Supabase를 D1 또는 다른 데이터베이스로 이전하지 않는다.
- 학생용 이메일, 소셜 로그인, 공개 가입, 자동 비밀번호 찾기를 만들지 않는다.
- 학생별 검사 단계마다 서버에 임시 답변을 저장하지 않는다. 기존처럼 완료 시 한 번 제출한다.
- 연 200명 규모에서 비용 효과가 없는 캐시·큐·백그라운드 작업 시스템을 추가하지 않는다.
- 기존 콘텐츠·교수진·기자재 관리 기능 전체를 재작성하지 않는다.

## 4. 데이터 모델

### 4.1 입시 운영 연도

`admission_cycles` 테이블을 추가한다.

| 필드 | 의미 |
|---|---|
| `id` | Worker가 `crypto.randomUUID()`로 생성해 RPC에 전달하는 UUID |
| `year` | 지원연도, 유일값 |
| `status` | `current` 또는 `archived` |
| `roster_version` | 명단 확정 시 증가하는 낙관적 잠금 버전 |
| `password_key_version` | 해당 cycle 전체가 사용하는 HMAC key version |
| `created_at`, `archived_at` | 운영 이력 |

동시에 `current`인 운영 연도는 하나만 허용한다. 새 연도를 현재로 전환하면 이전 연도는 `archived`가 된다.

관리자의 `새 지원연도 시작` 명령은 Worker가 새 cycle UUID와 테스트 5명의 암호화 필드·password digest를 먼저 준비한 뒤, 이전 cycle archive, 기존 세션 폐기, 새 current cycle 생성, 새 cycle용 테스트 계정 5개 생성을 하나의 RPC에서 처리한다. 새 cycle에는 테스트 외 운영 학생이 없으며 첫 명단 확정으로 채운다. 이전 cycle의 테스트 계정도 함께 archive된다.

### 4.2 학생

기존 `prospects` 행을 유지하되 다음 개념을 추가한다.

- `admission_cycle_id`: 소속 지원연도
- `name_hmac`, `name_ciphertext`, `name_iv`: 이름 변경 비교용 HMAC과 암호화한 이름
- `is_test`: 테스트 계정 여부
- 기존 `school_name`: 출신고교
- 기존 `applicant_stage`: 학년

기존 코드가 요구하는 `nickname`은 학생의 실명 대신 결과 화면에 쓸 수 있도록 Worker가 `PHOTO-`와 CSPRNG 기반 8자리 대문자·숫자 코드로 한 번 생성한다. DB 사전 조회는 하지 않고 같은 명단 RPC의 unique constraint로 충돌을 원자적으로 거부한다. 기존 필수 `region`은 신규 명단에서 `other`로 저장하고 학생·관리자 입력 항목에서는 제거한다.

허용 학년은 `고1`, `고2`, `고3`, `졸업`, `검정고시`, `기타`로 정규화한다. 기존 내부 값 `high1`, `high2`, `high3`, `graduate`, `ged`, `other`와 매핑한다.

전화번호는 기존처럼 다음 형태로 저장한다.

- 정규화된 전화번호의 HMAC-SHA-256: 조회와 중복 검사용
- AES-GCM 암호문과 매번 새로 생성한 IV: 관리자 표시용
- 전화번호 평문은 데이터베이스에 저장하지 않음

이름도 AES-GCM으로 암호화하고 정규화한 이름의 도메인 분리 HMAC을 함께 저장한다. 이름 정규화는 Worker와 브라우저에서 동일하게 `Unicode NFKC → 앞뒤 공백 제거 → 연속 Unicode 공백을 ASCII 공백 하나로 축약` 순서로 수행한다. 제어문자를 거부하고 정규화 결과가 Unicode code point 기준 1~40자인 경우만 허용한다. 암호화와 HMAC에는 반드시 같은 정규화 결과를 사용한다. HMAC은 미리보기에서 이름의 변경 여부만 비교하며 이름을 복원하는 데 쓸 수 없다. 출신고교와 학년은 service-role 전용 RLS 테이블에 평문으로 저장한다.

별도 `roster_status`를 만들지 않는다. 기존 `prospects.status` 허용값을 `active`, `inactive`, `deleted`로 확장하고, 과거 연도 여부는 `admission_cycles.status`로만 표현한다. 기존 쿼리·함수·부분 인덱스에서 `prospects.status = 'active'`를 사용하는 곳을 전수 검사해 current cycle 조건이 필요한 학생 로그인·운영 경로와 연도 전체를 보여야 하는 관리자 기록 경로를 명시적으로 분리한다.

같은 전화번호가 다른 연도에 다시 지원할 수 있으므로 전화번호 유일성은 전역이 아니라 `(admission_cycle_id, phone_hmac)` 조합으로 적용한다. 기존 검사·상담 FK는 학생 행을 계속 참조하므로 과거 결과가 유지된다.

### 4.3 비밀번호 자격증명

기존 PBKDF2 전용 열은 신규 인증에 사용하지 않는다. 다음 저장 형식을 추가한다.

- `password_bcrypt text`
- `password_generation integer`
- 실패 횟수, 잠금 시각, 변경 시각은 유지

DB constraint는 다음을 강제한다.

- `password_bcrypt`는 정확히 60자이며 `^\$2[ab]\$10\$[./A-Za-z0-9]{53}$` 형식만 허용
- `password_generation`은 1 이상 2,147,483,647 이하
- `admission_cycles.password_key_version`은 1 이상의 정수
- 재발급 후보 탐색 중 generation이 2,147,483,647을 넘거나 남은 범위가 32개보다 적으면 변경 없이 fail closed

기존 테스트 prospect와 결과는 legacy cycle로 보관하되 기존 credential과 session은 폐기한다. PBKDF2 비밀번호로 로그인시키는 호환 경로는 만들지 않는다. 실제 기존 계정이 없으므로 contract migration에서 PBKDF2 hash/salt 열과 함수도 제거한다.

## 5. 비밀번호 처리

### 5.1 학생 초기 비밀번호

형식은 휴대전화 뒤 4자리와 무작위 영문 대문자 2자리의 조합이다.

```text
4225AB
```

영문자는 서버가 보유한 `passwordPepper`와 도메인 문자열, cycle UUID, phone HMAC, `password_generation`을 HMAC-SHA-256한 값에서 편향 없이 대문자 두 자로 매핑한다. 신규 학생은 generation 1을 사용한다. 관리자 재발급은 현재 generation보다 큰 값 중 기존 두 글자와 다른 결과가 처음 나오는 generation을 선택하며 최대 32회 안에 찾지 못하면 fail closed한다. 선택한 실제 generation을 DB에 저장하고 CAS 조건에도 사용한다. 따라서 재발급이 우연히 기존 비밀번호와 같아지지 않고, 비밀번호 평문을 저장하지 않아도 최근 인증한 관리자가 현재 자격증명 Excel을 다시 내려받을 수 있다.

### 5.2 저장

Worker는 평문 비밀번호를 메모리에서만 다루고 다음 HMAC을 계산한다.

```text
HMAC-SHA-256(passwordPepper, UTF-8(password))
```

PostgreSQL RPC에는 32바이트 HMAC 결과만 전달한다. PostgreSQL은 HMAC 결과를 hex 문자열로 인코딩한 후 다음 방식으로 저장한다.

```sql
extensions.crypt(
  pg_catalog.encode(p_password_digest, 'hex'),
  extensions.gen_salt('bf', 10)
)
```

로그인 검증도 동일한 HMAC 결과에 `crypt(candidate, stored_hash) = stored_hash`를 적용한다. 원본 비밀번호, HMAC 키, 전화번호 평문은 SQL 인자·로그·감사 이벤트·테이블에 저장하지 않는다.

`admission_cycles.password_key_version`은 HMAC key 회전을 지원한다. credential별 version은 두지 않는다. 한 current cycle은 생성 시 정한 key version을 운영 중에 바꾸지 않는다. 새 key는 새 지원연도를 시작하기 전에 활성화하고 새 cycle에만 적용한다. Worker는 현재 키와 직전 키의 candidate digest를 한 로그인 RPC에 함께 전달하고 DB는 cycle version에 맞는 candidate만 검증한다. 이전 cycle은 로그인할 수 없으므로 운영 중 비밀번호 재해시나 다세대 key 보관이 필요하지 않다.

전화·이름 HMAC key와 password pepper는 각각 최소 32 random bytes의 base64url secret이어야 한다. `phone-lookup-v1`, `name-compare-v1`, `password-verify-v1`, `password-issue-v1` 도메인을 입력 앞에 붙여 용도를 분리한다. 필수 key가 없거나 version이 current/previous 어느 것과도 일치하지 않으면 로그인·명단·재발급은 fail closed한다.

### 5.3 온라인 공격 제한

- 전화번호 기준 5회 실패 시 30분 잠금
- IP 기준 15분 동안 최대 20회 로그인 시도
- 존재하지 않는 전화번호와 틀린 비밀번호는 동일한 실패 응답과 상태코드를 사용
- 실패 시 학생 존재 여부, 잠금 여부, 비밀번호 오류 여부를 구분해 공개하지 않음
- 성공 시 실패 횟수 초기화와 세션 생성을 같은 트랜잭션에서 처리
- 존재하지 않는 전화번호와 잠긴 계정도 cost 10의 고정 dummy bcrypt 검증을 수행해 눈에 띄는 응답 시간 차이를 줄임
- 6자리 초기 비밀번호는 전화번호를 아는 공격자에게 후보가 676개이므로 위 IP·전화 잠금과 동일 오류 응답을 완화가 아닌 필수 경계로 취급
- 로그인 RPC는 rate-limit bucket을 먼저 갱신하고 실패도 예외를 던지지 않고 구조화된 결과로 반환한다. 따라서 인증 실패가 트랜잭션 rollback되어 rate-limit 기록이 사라지지 않는다.

### 5.4 학생 비밀번호 운영

- 학생용 비밀번호 변경 기능을 제공하지 않는다.
- 학생용 복구 신청, 관리자 승인, 복구코드 발급, 복구 완료 기능을 제거한다.
- 관리자가 학생 상세 화면에서 비밀번호를 재발급한다.
- 재발급 시 해당 학생의 모든 기존 세션을 즉시 폐기한다.
- 새 평문 비밀번호는 서버에 저장하지 않는다. 최근 15분 인증을 통과한 관리자는 암호화된 전화번호와 현재 generation으로 같은 값을 재생성해 현재 cycle 자격증명 Excel을 다시 받을 수 있다.

### 5.5 관리자 계정

관리자 인증은 Supabase Auth를 유지한다. 학생용 커스텀 자격증명 테이블과 섞지 않는다.

- TOTP 없이 이메일과 비밀번호만 사용
- 관리자 비밀번호는 CSPRNG로 만든 정확히 10자리 값으로 변경하며 대문자·소문자·숫자·기호를 각각 포함
- 공개 관리자 가입 없음
- 활성 `admin_users` 행 검증과 8시간 절대 세션 상한 유지
- 명단 확정, 전화번호 표시, 비밀번호 재발급은 최근 15분 이내 비밀번호 로그인 필요

## 6. 연간 Excel·CSV 명단 갱신

### 6.1 파일 형식

지원 형식은 `.xlsx`와 UTF-8 `.csv`다. XLSX는 숨김 여부와 관계없이 workbook의 전체 worksheet 수가 정확히 하나이고 그 worksheet가 visible인 경우만 허용한다. 숨겨진 추가 worksheet가 하나라도 있으면 전체 파일을 거부한다.

필수 열은 정확히 다음 네 개다.

| 이름 | 연락처 | 출신고교 | 학년 |
|---|---|---|---|

관리자 화면에서 빈 양식을 내려받을 수 있다. 수식 셀, 매크로 포함 형식, 숨김 시트 의존 데이터는 허용하지 않는다.

### 6.2 브라우저 파싱

- 기존 `exceljs`를 관리자 브라우저에서 동적으로 불러와 XLSX와 CSV를 모두 읽는다. CSV의 UTF-8 BOM, quoted comma, quoted newline 처리를 직접 다시 구현하지 않는다.
- 원본 파일을 Supabase Storage나 서버 디스크에 저장하지 않는다.
- 최대 500행, 파일 2 MiB, 정규화 JSON 512 KiB로 제한한다.
- Cloudflare 외곽 경계인 `cloudflare/request-body-guard.mjs`의 override map에 `/api/admin/students/roster/preview`와 `/api/admin/students/roster/apply`만 512 KiB로 등록한다.
- Nitro 내부 경계인 `server/utils/bounded-request-body.ts`의 route body reader도 두 endpoint에서만 512 KiB를 전달한다. 두 경계의 초과 body 거부를 각각 통합 테스트하며 다른 API의 기존 8/64 KiB 경계는 넓히지 않는다.
- 빈 행은 무시하고 필수값 누락, 잘못된 전화번호, 허용되지 않은 학년, 중복 전화번호는 오류로 표시한다.
- 스프레드시트 수식은 실행·평가하지 않고 해당 행을 거부한다.

### 6.3 미리보기

브라우저가 파싱한 정규화 행을 Worker에 보낸다. Worker가 동일한 스키마로 다시 검증하고 전화번호 HMAC을 계산한 뒤 `preview_applicant_roster_v1` RPC를 한 번 호출한다.

미리보기는 다음을 구분한다.

- 신규 추가
- 이름·학교·학년 변경
- 파일에서 빠져 비활성화될 학생
- 변경 없음
- 중복 또는 오류

미리보기는 DB를 변경하지 않는다. 현재 `roster_version`을 함께 반환한다.

명단 파일에는 stable student ID가 없으므로 전화번호 변경을 동일 학생 수정으로 추측하지 않는다. 파일에서 전화번호가 바뀌면 기존 학생 비활성 + 신규 학생 추가로 표시하고, 기존 검사·상담 연결을 유지해야 하는 연락처 변경은 관리자 개별 수정 기능을 사용하라는 경고를 제공한다.

### 6.4 확정

관리자가 차이를 확인하고 확정하면 Worker는 최근 관리자 인증과 미리보기 버전을 검사한다. 신규 학생 비밀번호를 생성하고 이름·전화번호를 암호화하며 비밀번호 HMAC을 계산한 뒤 `apply_applicant_roster_v1` RPC를 한 번 호출한다.

연 1회 bcrypt 일괄 생성은 일반 API보다 오래 걸릴 수 있으므로 이 함수에만 `statement_timeout = '60s'`를 지정한다. 500행 합성 부하 검증이 55초 안에 끝나지 않으면 안전 상한을 실제 측정값에 맞춰 낮추며 bcrypt cost를 임의로 낮추지 않는다.

RPC는 한 트랜잭션에서 다음을 수행한다.

1. 현재 cycle과 `roster_version` 잠금
2. 버전 불일치 시 전체 거부
3. 신규 학생과 bcrypt 자격증명 생성
4. 기존 학생 이름·학교·학년 갱신
5. 파일에서 빠진 현재 연도 학생을 `inactive`로 변경하고 세션 폐기
6. 변경 없는 학생의 비밀번호와 결과 유지
7. 기존 `audit_events`에 PII와 비밀번호가 없는 import 감사 요약 저장
8. `roster_version` 증가

행 일부만 반영하지 않는다. 한 행이라도 유효하지 않거나 충돌하면 전체 롤백한다.

확정 요청은 UUID `idempotencyKey`와 `requestDigest`를 포함한다. Worker는 cycle UUID, expected roster version, 정렬·정규화한 전체 명단 JSON의 SHA-256으로 digest를 만든다. 기존 `audit_events`에 `(action, request_id)` 부분 unique index를 추가하고 metadata에는 digest, 시작·결과 roster version, 추가·변경·비활성 건수를 저장한다. RPC는 request ID의 transaction advisory lock을 먼저 얻고 기존 audit를 조회한 뒤 cycle row를 잠근다. 동일 key·동일 digest 재시도는 명단을 다시 바꾸지 않은 채 이미 적용된 성공 결과를 반환하고, 동일 key·다른 digest는 충돌로 전체 거부한다. 같은 key의 동시 요청도 첫 트랜잭션 완료 후 audit를 다시 읽으므로 unique 예외가 아니라 같은 성공 결과를 받는다. 응답이 유실돼도 관리자는 동일 요청을 안전하게 재시도하거나 현재 cycle 자격증명 Excel을 다시 생성할 수 있다.

### 6.5 자격증명 다운로드

확정 성공 후 Worker는 이번에 신규 발급한 학생의 이름, 연락처, 초기 비밀번호를 응답한다. 브라우저가 즉시 Excel 파일을 만들고 메모리 참조를 해제한다. 별도의 `현재 자격증명 내려받기`는 current cycle의 active 학생에 대해 암호화된 전화번호를 복호화하고 저장된 `password_generation`과 cycle key version으로 현재 비밀번호를 재생성한다.

- 비밀번호는 서버나 import 이력에 평문으로 저장하지 않는다.
- 자격증명 재다운로드는 최근 15분 관리자 인증과 감사 이벤트를 요구하며 과거 archived cycle에는 제공하지 않는다.
- Excel 수식 주입을 막기 위해 `=`, `+`, `-`, `@`로 시작하는 텍스트를 안전하게 이스케이프한다.
- 네트워크 응답 유실이나 브라우저 종료가 발생해도 200명 전체 재발급 없이 현재 자격증명 파일을 다시 만들 수 있다.

### 6.6 연도 전환과 보관

새 지원연도를 현재로 활성화하면 기존 현재 연도는 `archived`로 전환된다.

- 과거 학생 로그인 불가
- 과거 세션 전부 폐기
- 과거 학생 정보와 검사·상담 결과는 관리자만 연도 필터로 조회
- 테스트 계정 5개는 current cycle의 `is_test = true` 행으로 유지하고, 연도 명단 교체의 누락 비교에서 제외해 자동 비활성화하지 않음
- 기존 1년 후 자동삭제 작업에서 학생·검사·상담 기록을 제외한다. 만료 세션과 rate-limit bucket 같은 운영 데이터 정리만 계속한다.
- 이 버전에서는 과거 연도의 영구 삭제 UI를 만들지 않음

## 7. 개별 학생 관리

관리자 학생 화면에 다음 작업을 추가한다.

### 7.1 개별 추가

- 이름, 연락처, 출신고교, 학년 입력
- 현재 운영 연도에만 추가
- 같은 연도 전화번호 중복 거부
- Worker 요청 1회, DB RPC 1회
- 초기 비밀번호 한 번 표시 및 Excel/복사 제공

### 7.2 개별 수정

- 이름, 출신고교, 학년 수정은 비밀번호 유지
- 연락처 변경은 상세 화면이 가진 현재 credential generation과 새 연락처를 Worker에 보내 전화번호 HMAC/암호문 교체, generation 증가, 새 초기 비밀번호 발급, 기존 세션 폐기를 한 RPC에서 처리한다. 새 연락처의 뒤 4자리가 기존과 같아도 전체 평문 비밀번호가 재사용되지 않도록 5.1의 최대 32회 탐색과 `nextGeneration` CAS 규칙을 그대로 사용한다.
- 이미 완료한 검사·상담 데이터는 유지

### 7.3 활성 상태

- 현재 연도 학생을 개별 비활성·재활성할 수 있음
- 비활성화 시 기존 세션 폐기
- 재활성화 시 관리자가 필요하면 비밀번호를 별도로 재발급

### 7.4 비밀번호 재발급

- 새 `뒤 4자리 + 영문 2자` 생성
- Worker HMAC 후 DB bcrypt 저장
- 상세 화면에서 최근 인증으로 복호화한 현재 연락처와 `expectedGeneration`을 요청에 포함
- Worker는 현재 phone HMAC과 `expectedGeneration`을 확인 조건으로 보내고 5.1의 최대 32회 탐색으로 결정한 `nextGeneration`과 새 digest를 함께 전달한다. DB는 CAS가 일치할 때만 갱신하므로 mutation은 DB RPC 1회를 유지
- 실패 횟수와 잠금 초기화
- 모든 기존 세션 폐기
- 감사 이벤트 기록
- 평문 비밀번호 한 번만 표시

## 8. 학생 로그인과 세션

### 8.1 로그인

브라우저는 휴대전화와 비밀번호를 Worker에 HTTPS로 전송한다. Worker는 전화번호를 정규화해 HMAC하고 비밀번호를 HMAC한 뒤 세션 토큰과 IP rate-limit 키를 생성한다.

`login_roster_student_v1` RPC 한 번이 다음을 수행한다.

1. IP와 전화번호 rate-limit 적용
2. current cycle의 active 학생 조회
3. 잠금 상태 확인
4. PostgreSQL bcrypt 검증
5. 실패 횟수·잠금 갱신 또는 초기화
6. 성공 시 세션 hash 저장
7. PII 없는 로그인 이벤트 기록

성공 응답은 HttpOnly, Secure, SameSite=Lax 쿠키를 설정한다.

### 8.2 세션

- 32바이트 무작위 opaque token의 SHA-256 hash만 DB 저장
- 절대 만료 12시간
- 기존 NOT NULL `idle_expires_at`은 신규 세션에서 `expires_at`과 같은 값으로 저장해 schema 호환을 유지하고 idle 연장 의미는 제거
- 세션 조회는 read-only RPC 1회로 처리하고 매 요청 `last_seen_at` UPDATE를 제거
- 기존 `touch_student_session`과 요청별 `last_active_at` 쓰기 호출을 read-only session 함수로 교체
- 검사 저장 같은 명령 RPC는 세션 검증을 같은 트랜잭션 안에서 수행
- 로그아웃은 쿠키 삭제와 세션 폐기 RPC 1회
- 학생 비활성화, 연도 archive, 전화번호 변경, 비밀번호 재발급 시 관련 세션 즉시 폐기

## 9. 공개 화면 변경

- `/start`의 공개 학생 등록 폼 제거
- 첫 화면 CTA를 학생 로그인으로 연결
- 로그인 화면은 휴대전화와 초기 비밀번호만 받음
- 명단에 없거나 비밀번호가 틀린 경우 동일한 안내 표시
- `/credentials` 신규 가입 자격증명 화면을 제거하고 학생 로그인으로 redirect
- 학생 복구 요청·완료 페이지와 관련 링크 제거
- 학생 비밀번호 변경 UI 제거

장비·시설은 기존 원칙대로 학생 관심사와 전공 실현 가능성을 보조하는 콘텐츠로 유지하며 인증 화면 전면에 배치하지 않는다.

## 10. 관리자 화면 변경

기존 관리자 학생 영역을 연도별 명단 관리 화면으로 확장한다.

- 지원연도 선택 및 current/archive 상태
- Excel·CSV 양식 다운로드
- 파일 선택, 검증 오류, 차이 미리보기, 확정
- 확정 후 신규 자격증명 Excel 다운로드
- 개별 학생 추가·수정·비활성·재활성
- 비밀번호 재발급
- 연도·활성 상태·테스트 계정 필터
- 과거 연도 읽기 전용 조회

명단 확정과 비밀번호 재발급은 최근 15분 인증을 요구하며 관리자 감사 이벤트를 남긴다. 같은 요청에서 admin middleware가 이미 검증한 관리자 context를 handler가 재사용해 `admin_users`를 중복 조회하지 않는다.

## 11. 통신 예산

성공 경로의 Worker→Supabase 호출 상한은 다음과 같다.

| 작업 | 현재 | 변경 후 |
|---|---:|---:|
| 학생 등록 | 보통 7회, 최대 26회 이상 | 공개 기능 제거 |
| 학생 로그인 | 보통 5회 | 1 RPC |
| 학생 세션 조회 | 1 UPDATE RPC | 1 read-only RPC |
| 학생 비밀번호 변경 | 화면 포함 4회 | 기능 제거 |
| 복구 요청 | 4회 | 기능 제거 |
| 복구 완료 | 3회 | 기능 제거 |
| 명단 미리보기 | 없음 | 1 RPC |
| 명단 확정 | 없음 | 1 RPC |
| 개별 추가·수정·재발급 | 없음 | 각 1 RPC |

개별 수정·재발급의 1 RPC는 상세 화면을 이미 읽은 뒤의 mutation 예산이다. 상세 화면 최초 조회는 read-only RPC 1회이며 mutation이 다시 전화번호를 조회하지 않는다.

검사 답변은 기존처럼 모든 선택이 끝난 뒤 한 번만 제출한다. 연 200명 규모에서는 정적 콘텐츠 읽기 전체를 다른 DB로 옮기거나 별도 캐시 인프라를 추가하는 것이 절감 효과보다 복잡성이 크므로 이번 범위에서 제외한다.

## 12. 보안과 개인정보

- 공개 가입 없음
- 학생·자격증명·명단 테이블 RLS 유지
- `anon`, `authenticated`의 직접 table 접근과 함수 실행 권한 제거
- Worker의 service role만 최소 RPC 실행
- 모든 `security definer` 함수는 `search_path = ''`와 schema-qualified 이름 사용
- 원본 명단 파일, 평문 전화번호, 평문 이름, 평문 비밀번호를 로그에 기록하지 않음
- DB에는 이름·전화번호 암호문과 IV, 이름·전화 HMAC, bcrypt, `password_generation`, cycle의 `password_key_version`만 저장하고 원본 이름·전화·비밀번호 및 raw password HMAC은 저장하지 않음
- 기존 `audit_events`의 import 감사 항목에는 연도, 추가·변경·비활성 건수, 관리자 ID, 요청 ID, 요청 digest, 시작·결과 roster version, 시각만 저장
- 관리자 목록·내보내기에서 스프레드시트 수식 주입 차단
- 테스트 계정은 통계·상담 운영 집계에서 제외
- 오류 응답에서 학생 존재 여부와 내부 DB 오류를 숨김

## 13. Migration

Migration은 기존 FK 데이터와 이전 관리자 인증 변경을 보존하며 expand → Worker switch → contract 세 단계로 적용한다.

### 13.1 Expand migration

1. `admission_cycles` 추가. 별도 import 작업 테이블은 만들지 않고 기존 `audit_events`를 재사용
2. `prospects`에 nullable cycle, 이름 HMAC·암호문, test 표시를 추가하고 기존 `status` constraint에 `inactive` 허용
3. `student_credentials`에 nullable bcrypt와 generation 열을 추가하고 `admission_cycles`에 cycle 단위 key version을 둔다. 기존 PBKDF2 열과 전역 phone unique는 이 단계에서 유지
4. 기존 prospect를 archived legacy cycle에 배정하고 기존 세션 폐기
5. 이름이 다른 v2 단일 RPC 함수, idempotent import용 audit 부분 unique index와 최소 grants 추가

Expand migration은 Worker secret이 필요한 current cycle이나 테스트 자격증명을 만들지 않는다. Expand 뒤 구 Worker의 함수·열·unique·grants는 그대로여서 즉시 깨지지 않는다. 전환 창에 구 Worker가 만든 nullable cycle 행이 있으면 contract 전에 legacy cycle로 이동한다.

### 13.2 Worker switch

1. 공개 등록·복구·학생 비밀번호 변경 route가 없는 신 Worker 배포
2. 신 Worker는 current cycle이 없으면 학생 로그인과 명단 명령을 fail closed하고 관리자에게 `새 지원연도 시작`만 제공
3. 최근 인증한 관리자가 Worker를 통해 새 cycle UUID, key version, 테스트 5명의 서로 다른 합성 연락처·암호화 필드·password digest를 준비하고 `start_admission_cycle_v1` RPC 한 번으로 current cycle과 테스트 계정을 생성. Contract 전까지 남아 있는 전역 phone unique와 legacy phone HMAC의 충돌을 RPC가 먼저 검사하며, 충돌 시 아무것도 만들지 않고 Worker가 새 합성 연락처 세트로 재시도
4. 신 Worker가 v2 RPC만 호출하는지 staging과 production smoke로 검증
5. current cycle 테스트 계정 5개의 로그인·검사·관리자 재발급 검증

### 13.3 Contract migration

1. 구 공개 등록·로그인·복구·학생 비밀번호 변경 함수 grants를 제거하고 함수를 삭제
2. legacy credential·recovery request를 제거하되 legacy prospect와 검사·상담 행은 유지
3. PBKDF2 hash/salt 열 삭제, 새 cycle/name/credential 열을 NOT NULL로 확정
4. 전화번호 전역 unique를 제거하고 `(admission_cycle_id, phone_hmac)` unique로 교체
5. 기존 1년 삭제 작업에서 학생·검사·상담 기록을 제외하고 만료 운영 데이터만 정리

`prospects.status`, phone unique, 학생 current-cycle 조건을 참조하는 함수·인덱스·테스트 목록을 migration manifest로 고정한다. 각 단계 전후에 학생·검사·상담 FK 수와 orphan 행 0건을 검증한다. Contract는 신 Worker smoke 성공 전에는 실행하지 않는다.

## 14. 테스트와 승인 기준

### 14.1 단위 테스트

- 초기 비밀번호 형식과 CSPRNG
- 비밀번호 HMAC 입력·출력
- CSV/XLSX 열·행 검증과 숨김 포함 추가 worksheet 거부
- 전화번호·이름·학년 정규화
- 수식 셀과 formula injection 거부
- import diff 계산
- deterministic credential 재생성과 generation 증가
- 512 KiB pre-parser/route body 경계와 2 MiB browser file 경계
- bcrypt 60자/cost 10 형식, 양수 key version, generation 상·하한 검증

### 14.2 PostgreSQL/통합 테스트

- current cycle 하나만 허용
- 동일 연도 전화 중복 거부, 다른 연도 재지원 허용
- bcrypt 저장·검증에 평문 또는 raw HMAC이 저장되지 않음
- 로그인 성공·실패·잠금이 한 RPC에서 원자적 처리
- import preview는 무변경
- import apply는 추가·수정·비활성과 version 증가를 한 트랜잭션에서 처리
- 동일 idempotency key 재시도는 중복 반영하지 않음
- 동일 idempotency key와 다른 request digest 조합은 전체 거부
- 동일 idempotency key의 동시 확정 요청은 직렬화되고 둘 다 같은 성공 결과를 반환
- 이름 HMAC으로 변경 없음과 이름 변경을 정확히 구분
- batch 전화번호 변경은 기존 inactive + 신규 create로만 표시
- 한 행 오류 시 전체 rollback
- 연도 archive와 비밀번호 재발급이 모든 세션 폐기
- 과거 검사·상담 FK 유지
- `anon`, `authenticated` 직접 실행 거부
- 각 성공 경로의 Supabase 호출 횟수 계약
- 존재하지 않는 학생과 틀린 비밀번호 모두 dummy/real cost 10 bcrypt 경로를 통과하고 공개 응답이 동일함
- current/previous key version 선택과 unknown version fail-closed
- generation 범위 부족과 32회 내 다른 문자를 찾지 못한 경우 무변경 fail-closed
- Contract 전 legacy 전화 HMAC과 테스트 합성 연락처 충돌은 전체 rollback, Contract 후 다른 연도의 같은 전화번호는 허용되고 current cycle만 로그인됨

### 14.3 브라우저 E2E

- 200행 XLSX preview와 확정
- quoted comma·quoted newline을 포함한 200행 UTF-8 CSV preview와 확정
- 신규 자격증명 Excel 다운로드
- 응답 유실 후 idempotent 재시도와 현재 자격증명 재다운로드
- 명단 학생 로그인과 비명단 학생 거부
- 개별 추가·수정·비밀번호 재발급
- 재발급 전 세션 사용 불가
- 연도 전환 후 과거 학생 로그인 불가, 관리자 과거 결과 조회 가능
- 테스트 계정 5개 로그인과 통계 제외
- 모바일 로그인과 관리자 업로드 접근성

### 14.4 최종 배포

- local Supabase reset과 pgTAP
- 전체 unit/integration/typecheck/lint/build
- staging expand migration → 신 Worker 배포 → current cycle·테스트 5개 생성 → 200행 합성 명단 smoke → contract migration
- staging 학생 로그인·검사 완료·관리자 재발급 smoke
- production expand migration → 신 Worker 배포 → current cycle·테스트 5개 생성 → smoke 성공 후 contract migration
- production 합성 테스트 계정 5개 smoke
- 관리자 비밀번호 10자리로 변경 후 로그인 검증
- production URL과 관리자 자격증명은 기존 0600 결과 파일에만 저장

## 15. 공식 근거

- PostgreSQL pgcrypto `crypt`와 `gen_salt`: <https://www.postgresql.org/docs/18/pgcrypto.html>
- Supabase Database Functions와 `security definer` 주의사항: <https://supabase.com/docs/guides/database/functions>
- Supabase Data API 권한과 함수 실행 제한: <https://supabase.com/docs/guides/api/securing-your-api>
- Cloudflare Workers Free CPU 10ms 한도: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Workers Web Crypto HMAC: <https://developers.cloudflare.com/workers/examples/signing-requests/>
