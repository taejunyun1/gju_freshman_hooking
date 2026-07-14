# PHOTO:NEXT 관리자 부트스트랩

## 로컬 개발용 관리자

`scripts/bootstrap-local-admin.ts`는 `localhost` 또는 `127.0.0.1`의 Supabase에서만 실행된다. 다른 호스트의 URL을 받으면 Auth나 데이터베이스를 호출하기 전에 종료한다.

1. `pnpm exec supabase start`로 로컬 스택을 실행한다.
2. 아래 값을 쉘 환경 변수로만 제공한다. 비밀번호나 키를 `.env`, 문서, 명령 기록에 저장하지 않는다.

   - `SUPABASE_URL`: 로컬 API URL
   - `SUPABASE_SECRET_KEY`: 로컬 service-role 키
   - `SUPABASE_PUBLISHABLE_KEY`: 로컬 publishable/anon 키
   - `PHOTO_NEXT_LOCAL_ADMIN_EMAIL`: 로컬 테스트 전용 이메일
   - `PHOTO_NEXT_LOCAL_ADMIN_PASSWORD`: 로컬 테스트 전용 비밀번호

3. `pnpm tsx scripts/bootstrap-local-admin.ts`를 실행한다.
4. 터미널에 한 번만 표시된 TOTP 등록 URI 또는 QR 페이로드를 인증 앱에 등록한다. 터미널 출력을 파일로 리다이렉트하거나 공유하지 않는다.

스크립트는 Supabase Auth의 지원 API로 사용자를 만들고, 그 Auth UUID를 `admin_users`에 upsert한 뒤, 비밀번호로 로그인해 Supabase Auth가 생성한 TOTP 팩터를 등록한다. 비밀번호, TOTP secret, URI, QR 페이로드는 저장하지 않는다.

## 스테이징·프로덕션

이 스크립트를 스테이징이나 프로덕션에 사용하지 않는다.

1. Supabase Dashboard의 Auth 사용자 화면에서 별도의 관리자 계정을 생성한다. 공용 계정을 만들지 않는다.
2. 생성된 Auth UUID만 `admin_users.id`에 추가하고 `role = 'admin'`, `is_active = true`를 확인한다. 비밀번호나 TOTP secret을 데이터베이스에 입력하지 않는다.
3. 해당 관리자가 `/admin/login`에 처음 로그인해 Supabase Auth가 제공한 QR로 TOTP를 등록하고 6자리 코드를 검증한다.
4. Supabase Dashboard에서 일반 사용자의 공개 관리자 회원가입 경로가 없는지 확인하고, Auth의 공개 회원가입을 비활성화한다.
5. 운영 권한을 회수할 때는 `admin_users.is_active = false`로 변경하고 Auth 세션을 폐기한다.

브라우저는 검증된 짧은 수명의 access token만 `sessionStorage`에 저장한다. refresh token은 저장하지 않으며, 관리 API는 현재 access token을 `Authorization: Bearer` 헤더로만 받는다.
