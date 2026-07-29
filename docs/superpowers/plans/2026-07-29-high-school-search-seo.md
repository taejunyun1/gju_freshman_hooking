# PHOTO:NEXT High-School Search SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the public PHOTO:NEXT landing discoverable to high-school students searching for photo, video, editing, and university pathways while keeping private student and administration routes out of search.

**Architecture:** A single shared public SEO content module supplies the canonical site identity, Korean discovery copy, and JSON-LD. The landing consumes it through server-only meta helpers, while Nitro routes and Nuxt route rules give crawlers a one-page sitemap and explicit noindex protection for private paths.

**Tech Stack:** Nuxt 4, Vue 3, Nitro Cloudflare preset, Vitest, TypeScript.

## Global Constraints

- Public indexable surface remains the root landing only; do not add regional or programmatic landing pages.
- Use the canonical site URL https://photo-next-mvp.taejunyun.workers.dev and the verified official site https://gjuphoto.com/.
- Preserve the existing blue rounded PHOTO:NEXT visual system and one primary login CTA.
- Use natural Korean search copy; do not promise rankings, admission eligibility, regional recruitment, statistics, or unverified contact details.
- Exclude login, register, assessment, result, history, counseling, credentials, PIN, password, admin, and API paths through both robots directives and X-Robots-Tag.

## File Structure

- Create: shared/content/public-seo.ts — immutable public copy, canonical URLs, JSON-LD records, crawler path list.
- Create: server/routes/robots.txt.ts — plain-text crawler policy and sitemap pointer.
- Create: server/routes/sitemap.xml.ts — root-only XML sitemap.
- Modify: app/app.vue — safe brand-default head metadata.
- Modify: app/pages/index.vue — root-specific server metadata, JSON-LD, concise discovery section.
- Modify: nuxt.config.ts — noindex response header route rules.
- Modify: tests/unit/content/public-seo.test.ts — public content contract.
- Modify: tests/unit/pages/LandingPage.test.ts — visible discovery copy and one-CTA contract.
- Create: tests/integration/public-seo-routes.test.ts — robots, sitemap, and header route-rule contract.

### Task 1: Public SEO content and landing metadata

**Files:**
- Create: shared/content/public-seo.ts
- Modify: app/app.vue
- Modify: app/pages/index.vue
- Test: tests/unit/content/public-seo.test.ts
- Test: tests/unit/pages/LandingPage.test.ts

**Interfaces:**
- Produces PUBLIC_SITE_URL, PUBLIC_SEO, PUBLIC_WEB_SITE_JSON_LD, PUBLIC_DEPARTMENT_JSON_LD, and LANDING_DISCOVERY_COPY.
- Landing consumes these values only; no student data, result IDs, or runtime secrets enter metadata.

- [ ] **Step 1: Write the failing tests**

~~~ts
expect(PUBLIC_SEO.description).toContain('광주·전남·전북')
expect(PUBLIC_DEPARTMENT_JSON_LD['@type']).toBe('CollegeOrUniversity')
expect(PUBLIC_WEB_SITE_JSON_LD.inLanguage).toBe('ko-KR')
expect(wrapper.get('[data-seo-discovery]').text()).toContain('영상촬영·편집')
expect(wrapper.findAll('a[href="/login"]')).toHaveLength(1)
~~~

- [ ] **Step 2: Run the focused unit tests**

Run: pnpm vitest run --project unit tests/unit/content/public-seo.test.ts tests/unit/pages/LandingPage.test.ts

Expected: FAIL because the public SEO module and discovery section do not exist.

- [ ] **Step 3: Implement the shared copy and landing changes**

~~~ts
export const PUBLIC_SITE_URL = 'https://photo-next-mvp.taejunyun.workers.dev'
export const PUBLIC_SEO = { title: '광주대학교 사진영상미디어학과 | 사진·영상·편집 진로·입시 안내' }
useServerSeoMeta({ title: PUBLIC_SEO.title, ogType: 'website', twitterCard: 'summary_large_image' })
~~~

Use the existing event-shooting-1 image. Add one semantic section with data-seo-discovery after the sequence section. It must have one h2 and the approved Korean text; do not add another CTA.

- [ ] **Step 4: Re-run the focused unit tests**

Run: pnpm vitest run --project unit tests/unit/content/public-seo.test.ts tests/unit/pages/LandingPage.test.ts

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

~~~sh
git add shared/content/public-seo.ts app/app.vue app/pages/index.vue tests/unit/content/public-seo.test.ts tests/unit/pages/LandingPage.test.ts
git commit -m "feat: 2026-07-29 랜딩 고등학생 검색 메타 추가"
~~~

### Task 2: Crawler routes and private-path noindex policy

**Files:**
- Create: server/routes/robots.txt.ts
- Create: server/routes/sitemap.xml.ts
- Modify: nuxt.config.ts
- Test: tests/integration/public-seo-routes.test.ts

**Interfaces:**
- Uses PUBLIC_SITE_URL and a shared private-path list from public-seo.ts.
- robots route returns text/plain; sitemap route returns application/xml; private rules return X-Robots-Tag with noindex, nofollow, noarchive.

- [ ] **Step 1: Write the failing integration tests**

~~~ts
expect(robots).toContain('Sitemap: https://photo-next-mvp.taejunyun.workers.dev/sitemap.xml')
expect(robots).toContain('Disallow: /admin/')
expect(sitemap).toContain('<loc>https://photo-next-mvp.taejunyun.workers.dev/</loc>')
expect(routeRules['/admin/**'].headers['X-Robots-Tag']).toContain('noindex')
expect(routeRules['/api/**'].headers['X-Robots-Tag']).toContain('nofollow')
~~~

- [ ] **Step 2: Run the focused integration test**

Run: pnpm vitest run --project integration tests/integration/public-seo-routes.test.ts

Expected: FAIL because crawler routes and noindex rules do not exist.

- [ ] **Step 3: Implement routes and route rules**

~~~ts
setHeader(event, 'content-type', 'text/plain; charset=utf-8')
setHeader(event, 'content-type', 'application/xml; charset=utf-8')
headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' }
~~~

Return only the root URL in sitemap.xml and omit lastmod. Disallow all listed private routes in robots.txt. Keep the root route indexable.

- [ ] **Step 4: Re-run the focused integration test**

Run: pnpm vitest run --project integration tests/integration/public-seo-routes.test.ts

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

~~~sh
git add server/routes/robots.txt.ts server/routes/sitemap.xml.ts nuxt.config.ts tests/integration/public-seo-routes.test.ts
git commit -m "feat: 2026-07-29 검색 크롤러 제어 추가"
~~~

### Task 3: Regression verification and production release

**Files:**
- Verify: all files from Tasks 1 and 2

- [ ] **Step 1: Run complete verification**

Run: pnpm test && pnpm lint && pnpm typecheck && pnpm build

Expected: all commands exit 0.

- [ ] **Step 2: Run browser check**

Run: pnpm exec playwright test tests/e2e/student-self-registration.spec.ts

Expected: PASS; SEO work must not alter registration and student login flow.

- [ ] **Step 3: Deploy after review**

Push the branch, deploy staging then production while retaining existing Worker secrets. Smoke-check the root, robots.txt, sitemap.xml, and login X-Robots-Tag header. The root health response must report the deployed commit.
