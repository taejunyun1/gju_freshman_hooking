# PHOTO:NEXT S6 Operations and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지표·1년 보존·보안·접근성·성능·부하 게이트를 완성하고 스테이징과 프로덕션 Cloudflare Workers에 재현 가능하게 배포한다.

**Architecture:** Supabase Cron이 데이터베이스 가까이에서 일별 집계와 개인정보 보존 작업을 실행하고 Nuxt 관리자 대시보드는 집계 테이블을 읽는다. CI는 정적·단위·통합·SQL·E2E를 검증하며 Cloudflare 배포는 환경별 Secret과 별도 Supabase 프로젝트를 사용한다.

**Tech Stack:** Nuxt 4, Supabase pg_cron, Cloudflare Workers/Wrangler, GitHub Actions, Vitest, Playwright, axe-core, Lighthouse CI, k6

## Global Constraints

- 일별 지표 집계는 매일 03:05 KST, 보존 정리는 매일 03:20 KST다.
- `last_active_at` 1년 경과 학생의 개인정보·계정·세션·평가 상세·상담 개인정보를 삭제한다.
- 익명 이벤트와 daily metrics는 유지하고 `prospect_id`는 null로 비식별화한다.
- 공개 랜딩·승인 정적 자원만 캐시하고 결과·상담·관리자 응답은 `private,no-store`다.
- 모바일 첫 콘텐츠 3초, 평가 완료 2초, 관리자 필터 2초, 피크 17 req/s를 검증한다.
- WCAG 2.2 AA, 키보드, 스크린리더 레이블, reduced motion, 44×44px 터치 영역을 검증한다.
- 프로덕션은 스테이징과 Supabase 프로젝트·Worker·Secret을 공유하지 않는다.
- 비밀 값은 GitHub Actions Secret 또는 Cloudflare Secret에만 넣고 명령 출력에 노출하지 않는다.

---

### Task 1: Daily metrics and dashboard

**Files:**
- Create: `supabase/migrations/202607140007_metrics_cron.sql`
- Create: `supabase/tests/metrics.test.sql`
- Create: `server/modules/metrics/dashboard.ts`
- Create: `server/api/admin/dashboard.get.ts`
- Modify: `app/pages/admin/index.vue`
- Create: `app/components/admin/MetricCard.vue`
- Create: `app/components/admin/FunnelChart.vue`
- Create: `tests/integration/metrics/dashboard.test.ts`

**Interfaces:**
- Produces: `daily_metrics`; RPC `aggregate_daily_metrics(date)`; administrator dashboard API
- Consumes: events, prospects, assessments, counseling, campaigns

- [ ] **Step 1: Write failing idempotent aggregation tests**

```sql
select public.aggregate_daily_metrics(date '2026-07-13');
select public.aggregate_daily_metrics(date '2026-07-13');
select is((select count(*) from public.daily_metrics where metric_date='2026-07-13' and metric_name='assessment_completed'), 1::bigint);
select is((select metric_value from public.daily_metrics where metric_date='2026-07-13' and metric_name='assessment_completed'), 2::numeric);
```

- [ ] **Step 2: Run and verify missing metric table/function**

Run: `supabase test db`

Expected: FAIL because daily aggregation does not exist.

- [ ] **Step 3: Implement idempotent metrics and Cron**

Create daily metrics for unique visitors, registrations, assessment starts/completions, average completion time, counseling requests/assignments/contacts/completions, top options/resources, tracks, applicant stages, regions, schools, and campaign conversion. Use `insert ... on conflict ... do update` with `unique nulls not distinct` for nullable campaign. Schedule `aggregate_daily_metrics(current_date - 1)` as `5 18 * * *` UTC.

- [ ] **Step 4: Implement dashboard API and accessible charts**

API accepts bounded date range and optional campaign, returns totals, funnel, distributions, demand rankings, faculty recommendation/assignment counts, and open-case age. Charts include visible values and a semantic table alternative; color is not the sole encoding. Empty dates render “선택한 기간의 데이터가 없습니다.”

- [ ] **Step 5: Verify and commit metrics**

Run: `supabase test db && pnpm vitest run tests/integration/metrics/dashboard.test.ts && pnpm nuxi typecheck`

Expected: idempotent daily rows, correct funnel math, campaign filter, table alternative, and type checks pass.

```bash
git add supabase/migrations/202607140007_metrics_cron.sql supabase/tests/metrics.test.sql server/modules/metrics/dashboard.ts server/api/admin/dashboard.get.ts app/pages/admin/index.vue app/components/admin/MetricCard.vue app/components/admin/FunnelChart.vue tests/integration/metrics/dashboard.test.ts
git commit -m "feat: add operational metrics dashboard"
```

### Task 2: One-year privacy retention and expiring operational data

**Files:**
- Create: `supabase/migrations/202607140008_retention.sql`
- Create: `supabase/tests/retention.test.sql`
- Create: `server/modules/metrics/retention.ts`

**Interfaces:**
- Produces: RPC `purge_inactive_prospects(batch_size int)`; Cron schedule `20 18 * * *`
- Consumes: FK deletion rules and event `on delete set null`

- [ ] **Step 1: Write failing retention boundary tests**

```sql
select public.purge_inactive_prospects(100);
select is((select count(*) from public.prospects where id=:inactive_366_days), 0::bigint);
select is((select count(*) from public.prospects where id=:active_364_days), 1::bigint);
select is((select count(*) from public.events where anonymous_id='retained-event' and prospect_id is null), 1::bigint);
```

- [ ] **Step 2: Run and verify missing purge function**

Run: `supabase test db`

Expected: FAIL because purge RPC does not exist.

- [ ] **Step 3: Implement bounded retention batches**

Select at most `batch_size` prospect IDs with `last_active_at < now() - interval '1 year'` using `for update skip locked`, null event prospect IDs, delete dependent counseling/result/session/credential/recovery rows by FK, then delete prospects. Delete expired rate buckets, recovery codes, and completed export job metadata older than 30 days in separate bounded statements. Return counts and elapsed time without identities. Schedule at `20 18 * * *` UTC.

2026-07-16 진로 제안 보존 보완:

- `assessment_narrative_generations`에서 완료된 assessment에 연결된 행은 recent-three 평가 정리와 assessment cascade를 함께 따른다.
- assessment에 연결되지 않은 terminal generation 행은 24 hours 이후 bounded batch로 정리한다. 중단된 claim은 12초 lease가 끝난 뒤 terminal fallback으로 먼저 수렴해야 한다.
- `input_tokens`와 `output_tokens` 같은 token-count metadata는 30 days 이후 bounded batch에서 null 처리하거나 해당 terminal 행과 함께 삭제한다.
- `career_narrative_reports`의 resolved metadata는 대학이 승인한 incident/audit 보존기간을 따른다. 생성 문장 원문은 report table이나 audit metadata에 복사하지 않고 immutable assessment snapshot에만 둔다.
- 열린 신고와 resolved 신고가 연결된 assessment는 incident review가 끝날 때까지 recent-three 삭제에서 보호한다.

- [ ] **Step 4: Verify and commit retention**

Run: `supabase test db`

Expected: 366-day record deleted, 364-day record retained, anonymous event retained, repeated run returns zero.

```bash
git add supabase/migrations/202607140008_retention.sql supabase/tests/retention.test.sql server/modules/metrics/retention.ts
git commit -m "feat: enforce privacy retention policy"
```

### Task 3: Security headers, CSRF, logging, and secret audit

**Files:**
- Create: `server/middleware/security.ts`
- Create: `server/utils/safe-logger.ts`
- Create: `server/utils/csrf.ts`
- Create: `tests/integration/security/headers.test.ts`
- Create: `tests/integration/security/csrf.test.ts`
- Create: `tests/unit/security/safe-logger.test.ts`
- Create: `scripts/scan-secrets.sh`
- Modify: `package.json`

**Interfaces:**
- Produces: same-origin mutation guard, session-bound CSRF token, sanitized structured logger, repository secret scan
- Consumes: S1 request ID and sessions

- [ ] **Step 1: Write failing security tests**

```ts
expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
expect((await mutate({ origin: 'https://evil.example' })).status).toBe(403)
expect(JSON.stringify(safeLog({ phone:'01012345678', token:'abc', requestId:'r1' }))).toBe('{"phone":"[REDACTED]","token":"[REDACTED]","requestId":"r1"}')
```

- [ ] **Step 2: Run and verify missing protections**

Run: `pnpm vitest run tests/integration/security tests/unit/security`

Expected: FAIL because security middleware/logger are absent.

- [ ] **Step 3: Implement headers and CSRF**

Set CSP default-src self, script/style/font/image/connect sources limited to the app, Supabase and approved font/image hosts; `frame-ancestors 'none'`; no-sniff; strict-origin-when-cross-origin; permissions policy denying camera/microphone/geolocation. State-changing cookie-auth endpoints require matching allowed Origin and `X-CSRF-Token` derived from session ID and server key. Public registration/login rely on origin plus rate limits.

- [ ] **Step 4: Implement sanitizer and secret scan**

Recursively redact keys matching `/phone|password|authorization|cookie|token|secret|cipher|hmac/i`, truncate string values at 1,000 characters, and include request ID/error code only. `scripts/scan-secrets.sh` fails on committed `.env`, PostgreSQL URI, Supabase secret patterns, private keys, or assigned raw secret values; it scans `git ls-files` only.

- [ ] **Step 5: Verify and commit security**

Run: `pnpm vitest run tests/integration/security tests/unit/security && pnpm run security:scan`

Expected: all headers/CSRF/redaction pass and tracked-secret scan exits 0.

```bash
git add server/middleware/security.ts server/utils/safe-logger.ts server/utils/csrf.ts tests/integration/security tests/unit/security scripts/scan-secrets.sh package.json
git commit -m "feat: harden application security boundary"
```

### Task 4: Accessibility, mobile browsers, and motion QA

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/mobile.spec.ts`
- Create: `tests/e2e/reduced-motion.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: Chromium, WebKit, iPhone, Android, axe-core automated gates
- Consumes: all student and admin routes

- [ ] **Step 1: Install axe and write failing route audit**

Run: `pnpm add -D @axe-core/playwright`

```ts
for (const path of ['/', '/start', '/login', '/assessment', '/history', '/counseling', '/admin']) {
  test(`${path} has no serious axe violations`, async ({ page }) => {
    await prepareRoute(page, path)
    expect((await new AxeBuilder({ page }).analyze()).violations.filter(v => ['serious','critical'].includes(v.impact!))).toEqual([])
  })
}
```

- [ ] **Step 2: Run the route accessibility audit**

Run: `pnpm playwright test tests/e2e/accessibility.spec.ts --project=chromium`

Expected: PASS with serious/critical violations 0. If it fails, stop this plan and invoke `superpowers:systematic-debugging` with the reported rule and selector before continuing.

- [ ] **Step 3: Add exact mobile and motion assertions**

Mobile tests use iPhone 13 and Pixel 7 viewports, assert `document.documentElement.scrollWidth <= window.innerWidth`, and inspect every visible button/link/input for width and height at least 44px unless it is an inline text link. Reduced-motion test emulates `reducedMotion: 'reduce'` and asserts timeline elements have zero transition/animation duration.

- [ ] **Step 4: Run full browser matrix**

Run:

```bash
pnpm playwright test tests/e2e/accessibility.spec.ts tests/e2e/mobile.spec.ts tests/e2e/reduced-motion.spec.ts --project=chromium --project=webkit --project=mobile-chrome --project=mobile-safari
```

Expected: serious/critical violations 0, overflow 0, undersized targets 0, reduced motion 0ms.

- [ ] **Step 5: Commit accessibility gate**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts tests/e2e/accessibility.spec.ts tests/e2e/mobile.spec.ts tests/e2e/reduced-motion.spec.ts app
git commit -m "test: enforce accessibility and mobile quality"
```

### Task 5: Performance budgets and 17 req/s load test

**Files:**
- Create: `tests/load/assessment.js`
- Create: `lighthouserc.json`
- Create: `scripts/measure-api.mjs`
- Create: `docs/operations/performance-baseline.md`
- Modify: `package.json`

**Interfaces:**
- Produces: k6 assessment/results/admin scenarios and Lighthouse mobile budget
- Consumes: seeded staging environment

- [ ] **Step 1: Write the k6 scenario**

```js
export const options = {
  scenarios: { peak: { executor: 'constant-arrival-rate', rate: 17, timeUnit: '1s', duration: '2m', preAllocatedVUs: 40 } },
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{route:submit}': ['p(95)<2000'], 'http_req_duration{route:admin}': ['p(95)<2000'] },
}
```

Use pre-created test students and idempotency keys; do not log credentials. Exercise option GET, assessment submit, owned result GET, and administrator filtered list with separate tags.

- [ ] **Step 2: Add Lighthouse and API budgets**

`lighthouserc.json` requires mobile performance ≥0.80, accessibility ≥0.95, best practices ≥0.90, and LCP ≤3,000ms on landing and a seeded result. `measure-api.mjs` runs 20 warm requests and fails if assessment submit or admin filter p95 exceeds 2,000ms.

2026-07-16 진로 제안 성능 보완:

- provider-disabled 또는 즉시 deterministic fallback 평가 제출은 기존 p95 2,000ms 예산을 유지한다.
- 스테이징 provider-enabled 생성은 별도 p95 7,000ms 목표를 사용한다.
- authoritative generation lease polling ceiling은 12,000ms, Cloudflare-compatible hard request ceiling은 15,000ms다.
- provider abort는 기본 5,000ms, 최대 8,000ms이며 fetch header뿐 아니라 streamed response body decode까지 포함한다.
- owner finalization은 12초 lease 안에 끝나야 하고, lease 만료에 도달한 waiter도 settlement, completion, response를 15초 ceiling 안에 마쳐야 한다.
- provider-disabled load test는 DNS·fetch spy로 `api.openai.com` 호출이 0임을 증명한다.

- [ ] **Step 3: Run staging performance gate**

```bash
pnpm build
pnpm lhci autorun
k6 run -e BASE_URL="$STAGING_URL" tests/load/assessment.js
node scripts/measure-api.mjs "$STAGING_URL"
```

Expected: error rate <1%, route p95 <2s, LCP ≤3s, Lighthouse thresholds pass.

- [ ] **Step 4: Record the passing performance evidence**

Save only the command, commit SHA, timestamp, p50/p95, error rate, Lighthouse scores, and threshold result in `docs/operations/performance-baseline.md`; do not commit raw responses or credentials. If Step 3 fails, stop this plan and invoke `superpowers:systematic-debugging` for the failing route before creating the baseline.

- [ ] **Step 5: Commit performance gate**

```bash
git add tests/load/assessment.js lighthouserc.json scripts/measure-api.mjs docs/operations/performance-baseline.md package.json pnpm-lock.yaml
git commit -m "test: enforce performance and load budgets"
```

### Task 6: CI, staging, production, and rollback

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy.yml`
- Create: `scripts/deploy.sh`
- Create: `scripts/smoke.mjs`
- Create: `docs/operations/deployment-runbook.md`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: CI for every push/PR; manual staging/production deploy; health smoke; rollback runbook
- Consumes: existing GitHub repository, existing Cloudflare account, separate Supabase staging/production projects

- [ ] **Step 1: Write the failing deployment smoke script**

```js
const base = process.argv[2]
for (const path of ['/', '/api/health', '/api/assessment/options']) {
  const response = await fetch(new URL(path, base))
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
}
```

Run: `node scripts/smoke.mjs http://127.0.0.1:9`

Expected: FAIL with connection refused.

- [ ] **Step 2: Add CI workflow**

CI uses pinned Node and pnpm versions from `packageManager`, restores pnpm cache, starts Supabase, runs lint, typecheck, unit, integration, SQL, Chromium E2E, build, secret scan, and uploads Playwright report only on failure. It receives local test secrets generated inside the job and no production secrets.

- [ ] **Step 3: Add environment-separated deployment workflow**

Manual input is `staging|production`. Staging uses `photo-next-staging` and staging Supabase ref; production uses `photo-next` and a separate Seoul-region Supabase ref. Workflow applies migrations with the target database secret, runs smoke against preview, deploys the exact tested commit, then runs smoke again. Production requires GitHub Environment approval. Secret names are `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_STAGING_DB_URL`, `SUPABASE_PRODUCTION_DB_URL`, and environment-specific Worker secrets.

Before the first production run, create a separate Supabase production project in the Seoul region under the existing account, save its project ref in the production GitHub Environment, and enter database/API/crypto values directly into the secret stores. Do not copy staging student rows into production and do not paste secret values into the task or repository.

- [ ] **Step 4: Write rollback runbook**

Document commands to inspect Wrangler deployment versions, route traffic to the prior Worker version, restore the prior app without reversing forward-compatible migrations, and restore database from Supabase backup only for destructive data incidents. Include decision owner, request ID/log lookup, validation URLs, and post-rollback smoke command.

- [ ] **Step 5: Authenticate, deploy staging, and smoke**

```bash
pnpm wrangler login
pnpm build
pnpm wrangler deploy --env staging
node scripts/smoke.mjs "$STAGING_URL"
```

Expected: existing Cloudflare account authenticates, deployment succeeds, three smoke paths return 2xx.

- [ ] **Step 6: Verify rollback once on staging**

Deploy a metadata-only version marker, list versions, roll back to the prior staging version, and run `node scripts/smoke.mjs "$STAGING_URL"`.

Expected: prior version serves and all smoke paths return 2xx.

- [ ] **Step 7: Commit operations automation**

```bash
git add .github/workflows scripts/deploy.sh scripts/smoke.mjs docs/operations/deployment-runbook.md wrangler.jsonc
git commit -m "chore: automate verified deployment"
```

### Task 7: Final release gate

**Files:**
- Create: `docs/operations/release-checklist.md`
- Create: `docs/operations/content-readiness.md`

**Interfaces:**
- Consumes: S1–S6 complete application and verified department content
- Produces: signed-off production release evidence

- [ ] **Step 1: Create executable release checklist**

The checklist contains commands and result fields for lint, typecheck, all tests, secret scan, Chromium/WebKit/mobile, axe, Lighthouse, k6, database migrations, Cron jobs, staging smoke, rollback rehearsal, production smoke, privacy deletion, and XLSX open verification.

- [ ] **Step 2: Create content readiness matrix**

List counts and reviewer fields for active 2026 courses, 144 equipment inventory rows grouped into public equipment resources, four facilities, extracurriculars/projects, six faculty, public faculty contacts, student works with consent, careers, and support programs. Verify location totals 83/61, access totals 81/63, and explicit review states for 10 duplicate-code rows, 2 unidentified rows, and 4 quantity-check rows. Block production when any required public category is empty, source date is missing, unresolved inventory is counted as verified, faculty contact is unverified, or work consent is absent.

- [ ] **Step 3: Run the complete release gate**

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:sql
pnpm test:e2e
pnpm run security:scan
pnpm lhci autorun
k6 run -e BASE_URL="$STAGING_URL" tests/load/assessment.js
node scripts/smoke.mjs "$STAGING_URL"
git diff --check
```

Expected: every command exits 0, release checklist has no failed item, content matrix has no blocking category.

- [ ] **Step 4: Commit release evidence templates**

```bash
git add docs/operations/release-checklist.md docs/operations/content-readiness.md
git commit -m "docs: add production release gates"
```
