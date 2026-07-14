# PHOTO:NEXT

PHOTO:NEXT는 고등학생이 하고 싶은 사진·영상 작업을 선택하면 광주대학교 사진영상학과의 4년 교과·프로젝트 학습경로와 작품·진로의 연결을 확인할 수 있는 모바일 우선 웹 서비스입니다.

## Local development

```bash
pnpm install
supabase start
supabase db reset
pnpm dev
pnpm test:unit
pnpm build
```

## Project references

- [승인된 MVP 설계 명세](docs/superpowers/specs/2026-07-14-photo-next-mvp-design.md)
- [구현 계획 인덱스](docs/superpowers/plans/2026-07-14-photo-next-implementation-index.md)

## Repository safety

내부 기획·기술 DOCX/PDF 원본과 모든 비밀값은 커밋하지 않습니다. 로컬 환경 변수는 `.env`에만 두고, 공개 가능한 값과 서버 전용 비밀값의 경계를 유지합니다.
