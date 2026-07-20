# 관리자 내보내기 운영 분류 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement each task independently, with its review checkpoint before the next task.

**Goal:** 이름 검색이 아닌 설문·상담 진행 상태와 실제 담당 교수 기준으로 학생 데이터를 내보내고, 다운로드 파일에서도 선택한 운영 분류를 확인할 수 있게 한다.

**Architecture:** 새 필터 두 개를 기존 `AdminExportFilter` 계약에 선택 필드로 추가한다. PostgreSQL의 기존 export matcher들이 대상 분류와 최신 상담 요청의 담당 교수를 함께 판정하므로, 행 수 집계와 3개 XLSX 시트가 같은 기준을 공유한다. 화면은 기존 관리자 API에서 활성 교수 목록만 1회 읽고, 학생 이름·학교 검색은 접을 수 있는 보조 영역으로 이동한다.

**Tech Stack:** Nuxt 4/Vue 3, TypeScript, Zod, Vitest, Supabase PostgreSQL/pgTAP, Cloudflare Workers.

## Global Constraints

- 대상 분류는 `상담 신청자`, `설문 완료자 (상담 미신청)`, `설문 미완료자` 중 하나만 선택하며 서로 겹치지 않는다.
- `설문 미완료자`는 완료 assessment가 없는 학생을 뜻한다. 시작 후 이탈 여부는 현재 저장하지 않으므로 구분하지 않는다.
- 담당 교수는 추천 교수나 과거 이력이 아니라 기준 시점의 가장 최근 상담 요청에 실제로 배정된 교수다.
- 모든 필터는 AND로 결합하며, 기존 export job과 snapshot은 새 선택 필드가 없어도 계속 읽을 수 있다.
- 학생 원본 데이터, assessment, counseling 이력은 읽기만 한다. 새 테이블·외부 API·백그라운드 집계는 만들지 않는다.
- 학생목록·참여이력·상담현황의 3개 XLSX 시트는 유지하고, 학생목록에만 계산된 `내보내기 분류` 열을 추가한다.

### Task 1: Export contract and database matcher

**Files:**
- Modify: `shared/schemas/admin-export.ts`
- Create: `supabase/migrations/202607200030_admin_export_operational_segments.sql`
- Modify: `supabase/tests/admin_operations.test.sql`
- Modify: `supabase/tests/admin_export_rpc.test.sql`

**Interfaces:** Add optional `exportSegment` with `counseling_requested | completed_without_counseling | not_completed`, and optional `assignedFaculty` with a positive faculty ID or `unassigned`, to `AdminExportFilter`.

- [ ] Write failing schema and pgTAP cases for all accepted target values, invalid values, invalid faculty selector, and compatibility with snapshots that omit the new keys.
- [ ] Run the focused database test after a local reset; confirm the new values are initially rejected or the matcher behavior is missing.
- [ ] Add one forward-only migration that replaces only export filter validation and matcher functions. Use completed assessment and counseling `exists/not exists` checks for the exclusive segment; use the latest request ordered by `created_at desc, id desc` for assigned faculty.
- [ ] Cover the four fixture cases: completed-only, completed plus counseling, no completed assessment, and historic faculty A/current faculty B. Assert count and row RPC predicates stay aligned, including AND composition with counseling status.
- [ ] Re-run focused pgTAP tests, then commit only the contract, migration, and tests with message `feat: 2026-07-20 운영 내보내기 분류`.

### Task 2: Admin filter UI and workbook provenance

**Files:**
- Modify: `app/pages/admin/export.vue`
- Modify: `app/composables/useXlsxExport.ts`
- Modify: `tests/unit/pages/AdminExportPage.test.ts`
- Modify: `tests/e2e/admin-export-xlsx.spec.ts`

**Interfaces:** Read active faculty with `/api/admin/faculty?status=active&limit=50`; translate the UI’s `미배정` value and numeric faculty selection into the shared filter contract; calculate the student worksheet’s category from `counselingStatus` and `latestResultAt`.

- [ ] Write failing UI tests for the default operation controls, faculty loading/failure fallback, reset behavior, and normalized payload. Write a workbook assertion for the `내보내기 분류` heading and one category value.
- [ ] Run unit and XLSX e2e tests to establish the red failure.
- [ ] Build the first row around `내보내기 대상` and `담당 교수`, preserving the existing navy/blue rounded system. Put name and school under an `추가 검색` disclosure and retain the existing supplementary filters.
- [ ] Preserve the existing three-sheet workbook and add a provenance value to every student row; do not change PII columns or download transport.
- [ ] Re-run focused UI/e2e tests, lint, and typecheck; commit only the UI, workbook, and tests with message `feat: 2026-07-20 운영 중심 내보내기 화면`.

### Task 3: Integrated verification and deployment

**Files:** no planned product-file changes unless a verified regression needs a minimal correction.

- [ ] Reset the local database and run the full relevant pgTAP export suite, followed by targeted TypeScript unit/integration/e2e tests, lint, typecheck, and production build.
- [ ] Have a fresh reviewer inspect the final diff for filter consistency, query performance, unauthorized data exposure, and responsive UI regressions; fix only confirmed findings and re-run affected tests.
- [ ] Push the current feature branch, apply the forward-only Supabase migration through the established deployment workflow, deploy the Worker, and smoke-test an operational target filter plus an XLSX download with non-production test data.
- [ ] Record the deployed URL and any credentials only in the existing restricted deployment result file; never put passwords or secrets in source, git, logs, or the user-facing response.
