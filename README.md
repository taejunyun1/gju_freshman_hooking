# PHOTO:NEXT

PHOTO:NEXT는 고등학생이 하고 싶은 사진·영상 작업을 선택하면 광주대학교 사진영상학과의 4년 교과·프로젝트 학습경로와 작품·진로의 연결을 확인할 수 있는 모바일 우선 웹 서비스입니다.

## Local development

```bash
pnpm install
supabase start
supabase db reset
pnpm dev
pnpm test:unit
pnpm test:integration
pnpm test:local-integration
pnpm test:sql
pnpm test:e2e
pnpm build
```

`test:local-integration`과 `test:sql`, `test:e2e`는 실행 중인 로컬 Supabase만 허용하며 원격 프로젝트 URL에서는 mutation 전에 종료합니다. 학생 상태 변경 API는 정확한 same-origin `Origin`을 요구하고, 쿠키 인증 로그아웃·비밀번호 변경은 `/api/student/session`이 페이지 메모리에 제공한 `X-Photo-Next-CSRF` 값도 전송합니다. 복구 요청 제한은 IP 10회/시간과 번호 HMAC 3회/시간, 복구 완료 제한은 IP 10회/5분과 코드 해시 5회/15분입니다.

## Project references

- [승인된 MVP 설계 명세](docs/superpowers/specs/2026-07-14-photo-next-mvp-design.md)
- [구현 계획 인덱스](docs/superpowers/plans/2026-07-14-photo-next-implementation-index.md)

## Repository safety

내부 기획·기술 DOCX/PDF 원본과 모든 비밀값은 커밋하지 않습니다. 로컬 환경 변수는 `.env`에만 두고, 공개 가능한 값과 서버 전용 비밀값의 경계를 유지합니다.
