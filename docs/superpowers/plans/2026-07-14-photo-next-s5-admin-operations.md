# PHOTO:NEXT S5 Administrator Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 학생·결과·학과 자원·교수진·캠페인을 운영하고 현재 필터 기준 XLSX를 안전하게 생성하도록 한다.

**Architecture:** AdminModule은 AAL2와 역할을 확인한 서버 API만 제공하고 모든 목록은 커서 페이지네이션을 사용한다. 콘텐츠는 draft 미리보기 후 게시하며, 내보내기는 최근 재인증된 관리자가 페이지 단위 데이터를 받아 브라우저에서 XLSX를 구성하고 서버에 감사 상태를 남긴다.

**Tech Stack:** Nuxt 4, Vue 3, Supabase PostgreSQL/Storage/Auth, Zod, ExcelJS, Vitest, Playwright, pgTAP

## Global Constraints

- 학생 전화번호는 기본 마스킹이며 전체 공개와 XLSX는 AAL2 최근 인증 15분 이내만 허용한다.
- 목록은 서버 정렬과 `(sort_key,id)` 커서 페이지네이션을 사용한다.
- 교과·자원·교수는 draft, 미리보기, 게시, 보관 상태를 가진다.
- 교수 연락처는 필드별 `hidden|admin_only|public`을 관리한다.
- 학생 작품은 공개 동의와 대체 텍스트 없이는 게시할 수 없다.
- 캠페인 코드는 생성 후 수정하지 않고 비활성화 후 새로 만든다.
- XLSX는 학생 목록, 최근 참여 이력, 상담 현황 세 시트를 가진다.
- 관리자 민감 동작은 감사 이벤트를 남기며 브라우저·서버 로그에 원문 전화번호를 쓰지 않는다.

---

### Task 1: Campaign and export audit schema

**Files:**
- Create: `supabase/migrations/202607140006_admin_operations.sql`
- Create: `supabase/tests/admin_operations.test.sql`
- Create: `shared/schemas/admin.ts`

**Interfaces:**
- Produces: `campaigns`, `export_jobs`; campaign FK on assessments/events; immutable campaign code trigger
- Consumes: active admin IDs and existing audit events

- [ ] **Step 1: Write failing campaign immutability and export tests**

```sql
select throws_ok(
  $$update public.campaigns set code = 'changed' where code = 'open-day-2026'$$,
  'P0001', 'CAMPAIGN_CODE_IMMUTABLE'
);
select col_is_unique('public','campaigns',array['code']);
select has_table('public','export_jobs');
```

- [ ] **Step 2: Run and verify missing schema**

Run: `supabase test db`

Expected: FAIL because campaigns/export jobs do not exist.

- [ ] **Step 3: Implement schema**

Campaign stores code, name, channel `sms|qr|social|kakao|direct|other`, status, optional dates and sent count. Add validated FKs from assessment/event campaign IDs. Export job stores creator, filter snapshot, status `created|fetching|completed|failed`, sheet row counts, error code, created/completed/downloaded timestamps; it never stores a phone list or workbook bytes. Enable default-deny RLS and indexed admin/date lookups.

- [ ] **Step 4: Verify and commit schema**

Run: `supabase db reset && supabase test db`

Expected: immutable code, unique code, export status checks, and FKs pass.

```bash
git add supabase/migrations/202607140006_admin_operations.sql supabase/tests/admin_operations.test.sql shared/schemas/admin.ts
git commit -m "feat: add campaign and export audit schema"
```

### Task 2: Student list, detail, filters, and phone reveal

**Files:**
- Create: `server/modules/admin/students.ts`
- Create: `server/api/admin/students/index.get.ts`
- Create: `server/api/admin/students/[id].get.ts`
- Create: `server/api/admin/students/[id]/reveal-phone.post.ts`
- Create: `app/components/admin/DataTable.vue`
- Create: `app/components/admin/StudentFilters.vue`
- Create: `app/pages/admin/students/index.vue`
- Create: `app/pages/admin/students/[id].vue`
- Create: `tests/integration/admin/students.test.ts`

**Interfaces:**
- Produces: cursor list filters `query,stage,region,school,track,campaign,counselingStatus,dateFrom,dateTo`; student detail with recent 3 results
- Consumes: admin MFA guard and phone decryption

- [ ] **Step 1: Write failing masking and cursor tests**

```ts
expect((await listStudents(admin)).data.items[0].phone).toBe('010-****-5678')
expect((await revealPhone(staleAdmin, studentId)).status).toBe(403)
expect(new Set([...page1.items, ...page2.items].map(x => x.id)).size).toBe(page1.items.length + page2.items.length)
```

- [ ] **Step 2: Run and verify missing routes**

Run: `pnpm vitest run tests/integration/admin/students.test.ts`

Expected: FAIL with route-not-found responses.

- [ ] **Step 3: Implement select-only list and detail queries**

Select required columns only, derive masked phone server-side after decrypting, and never send ciphertext/HMAC. Text search matches nickname or school; an input that normalizes to a valid full `010` number is HMACed server-side for exact phone lookup. Stable sorting is `last_active_at desc,id desc`. Detail returns basic info, recent three result summaries, and counseling history; it omits password/session fields. Reveal requires recent AAL2, sets `private,no-store`, and writes `admin_phone_revealed` audit.

- [ ] **Step 4: Implement list and detail UI**

Use URL query parameters for shareable filters, debounced school/nickname search, semantic table on desktop and labeled cards under 720px. Opening a detail preserves the cursor URL. Full phone appears in a timed dialog and is cleared from Vue state on close and after 60 seconds.

- [ ] **Step 5: Verify and commit student operations**

Run: `pnpm vitest run tests/integration/admin/students.test.ts && pnpm nuxi typecheck`

Expected: masking, reauth, audit, filter, cursor, mobile-card and detail tests pass.

```bash
git add server/modules/admin/students.ts server/api/admin/students app/components/admin/DataTable.vue app/components/admin/StudentFilters.vue app/pages/admin/students tests/integration/admin/students.test.ts
git commit -m "feat: add administrator student operations"
```

### Task 3: Resource catalog and publication workflow

**Files:**
- Create: `server/modules/admin/resources.ts`
- Create: `server/api/admin/resources/index.get.ts`
- Create: `server/api/admin/resources/index.post.ts`
- Create: `server/api/admin/resources/[id].put.ts`
- Create: `server/api/admin/resources/[id]/publish.post.ts`
- Create: `server/api/admin/resources/[id]/archive.post.ts`
- Create: `server/api/admin/resources/equipment/import/validate.post.ts`
- Create: `app/pages/admin/resources/index.vue`
- Create: `app/pages/admin/resources/[id].vue`
- Create: `app/components/admin/ResourceEditor.vue`
- Create: `app/components/admin/EquipmentInventoryTable.vue`
- Create: `tests/integration/admin/resources.test.ts`

**Interfaces:**
- Produces: optimistic resource CRUD with version; publication validator; Storage upload path
- Consumes: resource and tag schema from S3

- [ ] **Step 1: Write failing publication rules**

```ts
expect((await publishResource(courseWithoutSourceDate)).error.code).toBe('RESOURCE_SOURCE_REQUIRED')
expect((await publishResource(workWithoutConsent)).error.code).toBe('WORK_CONSENT_REQUIRED')
expect((await publishResource(equipmentWithoutVerifiedItems)).error.code).toBe('EQUIPMENT_INVENTORY_UNVERIFIED')
expect((await publishResource(facilityWithoutOperationVerification)).error.code).toBe('FACILITY_OPERATION_UNVERIFIED')
expect((await updateResource(staleVersion)).status).toBe(409)
```

- [ ] **Step 2: Run and verify missing resource routes**

Run: `pnpm vitest run tests/integration/admin/resources.test.ts`

Expected: FAIL with missing endpoints.

- [ ] **Step 3: Implement CRUD and publication checks**

All types require title, summary, source date, visibility, priority, one primary tag, and connection template. Course additionally requires academic year, grade, term, credits, and goal. Student work additionally requires consent timestamp, image, alt text, related course/year/track. Equipment publication requires at least one verified inventory row; confirmed quantity is recomputed from verified rows and duplicate/unidentified/quantity-check rows never count. Facility publication requires verified operation note and `last_verified_at`. Image upload validates MIME `image/jpeg|image/png|image/webp`, 8MB maximum, randomized Storage path, and deletes failed orphan uploads.

Update uses expected `updated_at`; stale writes return 409 and current data. Archive never deletes referenced records. Publish writes an audit event with changed field names, not full content.

- [ ] **Step 4: Implement editor and preview**

Editor separates content, tags, media, and publication. Result-card preview uses the same `ResourceCard` component as the student result. Equipment inventory displays all 144 source rows by location with filters for duplicate code, unidentified model and quantity check; editing a code retains the original value in an audit event. Import validation reports expected totals 83/61/144, access totals 81/63, duplicate-code groups and unmatched source rows before applying any update. Facility editor requires location, operation/reservation note, activities and verification date. Disable publish until validator returns zero issues. Show source staleness when older than the configured academic cycle.

- [ ] **Step 5: Verify and commit resource operations**

Run: `pnpm vitest run tests/integration/admin/resources.test.ts && pnpm nuxi typecheck`

Expected: type-specific required fields, upload, preview, stale update, publish, archive tests pass.

```bash
git add server/modules/admin/resources.ts server/api/admin/resources app/pages/admin/resources app/components/admin/ResourceEditor.vue app/components/admin/EquipmentInventoryTable.vue tests/integration/admin/resources.test.ts
git commit -m "feat: add department resource management"
```

### Task 4: Faculty profiles, tags, contacts, and specialist links

**Files:**
- Create: `server/modules/admin/faculty.ts`
- Create: `server/api/admin/faculty/index.get.ts`
- Create: `server/api/admin/faculty/[id].put.ts`
- Create: `server/api/admin/faculty/[id]/preview.post.ts`
- Create: `server/api/admin/faculty/[id]/publish.post.ts`
- Create: `app/pages/admin/faculty/index.vue`
- Create: `app/pages/admin/faculty/[id].vue`
- Create: `app/components/admin/FacultyEditor.vue`
- Create: `tests/integration/admin/faculty.test.ts`

**Interfaces:**
- Produces: faculty profile/tag/link editor and sample recommendation preview
- Consumes: six seeded profiles and S3 `recommendFaculty`

- [ ] **Step 1: Write failing faculty integrity tests**

```ts
expect((await publishFaculty(fullTimeWithoutCapacity)).error.code).toBe('FACULTY_CAPACITY_REQUIRED')
expect((await publishFaculty(publicEmailWithoutVerification)).error.code).toBe('CONTACT_VERIFICATION_REQUIRED')
expect((await previewFaculty(videoDroneScenario)).data.specialists.map(x => x.name)).toContain('박재웅')
```

- [ ] **Step 2: Run and verify missing routes**

Run: `pnpm vitest run tests/integration/admin/faculty.test.ts`

Expected: FAIL with missing endpoints.

- [ ] **Step 3: Implement profile and publication service**

Validate employment/consultation role combinations: full-time must be primary; adjunct/practitioner must be specialist. Active primary requires weekly capacity >0. Public contact fields require `last_verified_at`. Tags require category and 0–3 weight. Specialist links require an active specialist and allowed primary or null-primary. Preview runs the production recommender against the four guide scenarios without saving.

- [ ] **Step 4: Implement faculty editor**

Render profile sections from the faculty guide, contact visibility per field, tags grouped by category, specialist link matrix, weekly capacity, source verification, image permission and alt text. Preview tabs are 사회 포토스토리, 지역 아카이브, 영상·드론, 광고·패션.

- [ ] **Step 5: Verify and commit faculty operations**

Run: `pnpm vitest run tests/integration/admin/faculty.test.ts && pnpm nuxi typecheck`

Expected: role, contact, tag, link and four preview scenarios pass.

```bash
git add server/modules/admin/faculty.ts server/api/admin/faculty app/pages/admin/faculty app/components/admin/FacultyEditor.vue tests/integration/admin/faculty.test.ts
git commit -m "feat: add faculty content management"
```

### Task 5: Campaign links and attribution

**Files:**
- Create: `server/modules/admin/campaigns.ts`
- Create: `server/api/admin/campaigns/index.get.ts`
- Create: `server/api/admin/campaigns/index.post.ts`
- Create: `server/api/admin/campaigns/[id]/archive.post.ts`
- Create: `server/api/campaign/[code].get.ts`
- Create: `app/pages/admin/campaigns.vue`
- Modify: `app/pages/index.vue`
- Create: `tests/integration/admin/campaigns.test.ts`

**Interfaces:**
- Produces: immutable campaign codes, landing attribution cookie `photo_next_campaign`
- Consumes: events and assessments campaign IDs

- [ ] **Step 1: Write failing attribution tests**

```ts
expect((await createCampaign({ code: 'OPEN DAY 2026' })).data.code).toBe('open-day-2026')
expect((await updateCampaignCode(id, 'changed')).status).toBe(409)
expect((await resolveCampaign('archived-code')).status).toBe(404)
```

- [ ] **Step 2: Run and verify missing routes**

Run: `pnpm vitest run tests/integration/admin/campaigns.test.ts`

Expected: FAIL with route-not-found responses.

- [ ] **Step 3: Implement campaign service and landing attribution**

Normalize codes to lowercase ASCII kebab-case, 3–60 characters. Active campaign resolution sets a signed, HttpOnly, SameSite=Lax 30-day campaign cookie and redirects to `/`. Registration, event, assessment and counseling services read the verified campaign ID. Archive stops new attribution but preserves historical metrics.

- [ ] **Step 4: Implement campaign UI and commit**

Show name, code, channel, dates, sent count, visits, assessment completions, and counseling conversions; S6 supplies aggregated counts. Provide copy-link and QR-ready URL text, not QR image generation.

Run: `pnpm vitest run tests/integration/admin/campaigns.test.ts && pnpm nuxi typecheck`

Expected: normalization, immutability, attribution, archive and UI tests pass.

```bash
git add server/modules/admin/campaigns.ts server/api/admin/campaigns server/api/campaign app/pages/admin/campaigns.vue app/pages/index.vue tests/integration/admin/campaigns.test.ts
git commit -m "feat: add campaign attribution"
```

### Task 6: XLSX export with progressive batch fetch

**Files:**
- Create: `server/modules/admin/export.ts`
- Create: `server/api/admin/export/index.post.ts`
- Create: `server/api/admin/export/[id]/students.get.ts`
- Create: `server/api/admin/export/[id]/assessments.get.ts`
- Create: `server/api/admin/export/[id]/counseling.get.ts`
- Create: `server/api/admin/export/[id]/complete.post.ts`
- Create: `app/composables/useXlsxExport.ts`
- Create: `app/pages/admin/export.vue`
- Create: `tests/unit/admin/xlsx.test.ts`
- Create: `tests/integration/admin/export.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: recent-MFA export job, 1,000-row cursor endpoints, three-sheet `.xlsx`
- Consumes: current admin filters, ExcelJS browser bundle

- [ ] **Step 1: Add ExcelJS and write failing workbook tests**

Run: `pnpm add exceljs`

```ts
const workbook = await buildWorkbook(fixture)
expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['학생목록','최근참여이력','상담현황'])
expect(workbook.getWorksheet('학생목록')!.getRow(2).getCell('전화번호').value).toBe('010-1234-5678')
```

- [ ] **Step 2: Run and verify missing export module**

Run: `pnpm vitest run tests/unit/admin/xlsx.test.ts tests/integration/admin/export.test.ts`

Expected: FAIL because export builder and routes do not exist.

- [ ] **Step 3: Implement authorized paged export API**

Creating a job requires recent AAL2 and stores an immutable filter snapshot. Each data endpoint verifies creator, active admin, 15-minute recent auth, job status, and a `(created_at,id)` cursor; batch size is fixed at 1,000 and total rows are capped at 30,000. Requests above the cap return `EXPORT_FILTER_REQUIRED`. Student sheet columns are 닉네임, 전화번호, 학교, 현재상태, 지역, 진로1, 진로2, 총참여, 최근결과, 추천교수, 배정교수, 상담상태. Recent-assessment columns are 닉네임, 회차, 참여일, 선택작업, 선택결과물, 선택방식, 선택진로, 다큐멘터리점수, 예술사진점수, 광고사진점수, 영상점수, 환경점수, 추천자원. Counseling columns are 닉네임, 신청일, 희망방식, 가능시간, 문의, 추천총괄교수, 예비교수, 전문연계교원, 배정교수, 상태, 연락일, 완료일, 결과, 관리자메모. Responses are `private,no-store`.

- [ ] **Step 4: Implement browser workbook and progress**

Fetch one batch at a time, append rows, update progress with fetched row counts, and discard each JSON batch before fetching the next. Freeze header rows, apply filters, set readable widths, format dates in Asia/Seoul, and write `PHOTO_NEXT_students_YYYY-MM-DD.xlsx`. On failure mark the job failed with a stable code and offer a fresh job retry; clear arrays and workbook references after download.

- [ ] **Step 5: Verify and commit export**

Run: `pnpm vitest run tests/unit/admin/xlsx.test.ts tests/integration/admin/export.test.ts && pnpm nuxi typecheck`

Expected: exact sheet names/columns, 1,001-row pagination, recent-auth failure, retry, and Korean filename tests pass.

```bash
git add package.json pnpm-lock.yaml server/modules/admin/export.ts server/api/admin/export app/composables/useXlsxExport.ts app/pages/admin/export.vue tests/unit/admin/xlsx.test.ts tests/integration/admin/export.test.ts
git commit -m "feat: export filtered administrator data"
```

### Task 7: S5 administrator E2E gate

**Files:**
- Create: `tests/e2e/admin-operations.spec.ts`

**Interfaces:**
- Consumes: S5 administrator features
- Produces: browser proof of publish, filter, campaign, reveal, export

- [ ] **Step 1: Write the administrator operations E2E**

```ts
test('admin publishes verified faculty contact and exports filtered students', async ({ page }) => {
  await loginMfaAdmin(page)
  await page.goto('/admin/faculty')
  await page.getByRole('link', { name: /윤태준/ }).click()
  await page.getByLabel('이메일 공개').selectOption('public')
  await page.getByRole('button', { name: '게시' }).click()
  await page.goto('/admin/export')
  await page.getByLabel('지역').selectOption('gwangju')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'XLSX 생성' }).click()
  expect((await download).suggestedFilename()).toMatch(/^PHOTO_NEXT_students_\d{4}-\d{2}-\d{2}\.xlsx$/)
})
```

- [ ] **Step 2: Run S5 quality gate**

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:sql
pnpm playwright test tests/e2e/admin-operations.spec.ts --project=chromium
```

Expected: all commands exit 0 and the filtered XLSX download completes.

- [ ] **Step 3: Commit S5 coverage**

```bash
git add tests/e2e/admin-operations.spec.ts
git commit -m "test: verify administrator operations"
```
