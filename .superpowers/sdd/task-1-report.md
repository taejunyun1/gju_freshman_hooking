# Task 1 Report — Nuxt Worker scaffold and design foundation

## Status

DONE_WITH_CONCERNS — all required tests, standalone typecheck, lint, runtime smoke checks, and the Cloudflare-module production build pass. The concerns are limited to two current toolchain warnings/workarounds documented below.

## Implementation

- Scaffolded a Nuxt 4 / Vue 3 / TypeScript application with Pinia, Supabase JS, Zod, Vitest, Vue Test Utils, Playwright, Nuxt ESLint, Supabase CLI, Wrangler, and tsx locked by pnpm.
- Configured Nitro for `cloudflare-module`, Wrangler Workers Assets, `nodejs_compat`, observability, strict TypeScript, server-only runtime keys, and the public Supabase URL boundary.
- Added Vitest unit/integration projects, Playwright Chromium configuration, Nuxt flat ESLint configuration, root TypeScript project references, and pnpm build-script allowlisting.
- Added the approved design tokens, global resets, reduced-motion behavior, accessible `AppButton`, and polite-live-region `AppState` variants.
- Implemented the mobile-first PHOTO:NEXT landing page with the required headline, ordered four-stage path, one `/start` CTA, and a single concise teal production-basis note below the sequence.
- Added `/api/health`, returning only `{ ok, commit }`, with `GIT_COMMIT_SHA` and a safe `development` fallback; it never reads or serializes application secrets.
- Added project commands, approved spec/index links, and repository safety guidance to the README.

## Frontend design plan and critique (completed before UI code)

- Subject: PHOTO:NEXT, for Korean high-school applicants considering 광주대학교 사진영상학과.
- Single page job: explain how a selected photo/video interest becomes a four-year curriculum/project learning path and then an output/career.
- Color: the approved Surface `#FFFFFF`, Canvas `#EEF1F6`, Ink `#151A22`, Sequence `#6B43B5`, Resource `#2E7773`, Signal `#C27628`, and Error `#B8423E` roles only.
- Type: Wanted Sans Variable for display, Pretendard Variable for body, IBM Plex Mono for sequence/time labels.
- Signature: one editing-sequence rail. It is vertical on mobile and becomes four connected clips on desktop; the teal production basis is attached below it as evidence, never promoted into a hero or primary stage.

Selected layout:

```text
MOBILE                         DESKTOP
[PHOTO:NEXT | SEQ / 04Y]       [PHOTO:NEXT                         SEQ / 04Y]
[thesis headline]              [centered thesis headline]
[single primary CTA]           [single primary CTA]
  ● SOURCE                       ●────────●────────●────────●
  │ 관심 선택                  [관심]   [4년 경로] [작품·진로] [상담]
  ● Y1—Y4                       [teal supporting production evidence]
  │ 4년 학습경로
  ● OUTPUT
  │ 작품·진로
  ● NEXT
    교수 상담
[teal supporting evidence]
```

A split hero with a decorative timeline beside the headline was rejected because it would make the sequence look like generic SaaS decoration on small screens. Self-critique also removed gradient/glass treatments and excessive rounding; violet is confined to the sequence and primary action, amber marks output/next clips, and teal appears only for supporting production evidence.

## Files changed

- Toolchain/configuration: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `nuxt.config.ts`, `wrangler.jsonc`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`
- Documentation: `README.md`
- App shell/design: `app/app.vue`, `app/assets/css/tokens.css`, `app/assets/css/main.css`
- Components: `app/components/common/AppButton.vue`, `app/components/common/AppState.vue`
- Page/API: `app/pages/index.vue`, `server/api/health.get.ts`
- Tests: `tests/unit/design-tokens.test.ts`, `tests/unit/components/AppButton.test.ts`, `tests/unit/components/AppState.test.ts`, `tests/unit/pages/LandingPage.test.ts`, `tests/integration/health.test.ts`

## Scaffold and install notes

The exact requested initializer command was run first:

```text
pnpm dlx nuxi@latest init . --packageManager pnpm --gitInit false
```

Because the worktree already contained the approved specification and plans, Nuxi asked to override the entire directory. That destructive option was aborted. The same minimal template was generated under a temporary `.nuxt-scaffold` directory, its required scaffold shape was applied to the repository, and the temporary directory was removed. The requested production and development install commands were then run. pnpm 11 required explicit build-script allowlisting in `pnpm-workspace.yaml`; TypeScript was pinned to `6.0.3`, the newest version satisfying the installed ESLint peer range, and `@vitejs/plugin-vue` was added so Vitest can mount Vue SFCs directly.

## TDD evidence

### RED — required foundation

Command:

```text
pnpm vitest run tests/unit/design-tokens.test.ts tests/unit/components/AppButton.test.ts tests/unit/pages/LandingPage.test.ts tests/integration/health.test.ts
```

Expected failure observed (exit 1):

```text
Test Files  4 failed (4)
Tests       3 failed (3)
Failed to resolve import "../../../app/components/common/AppButton.vue"
Failed to resolve import "../../../app/pages/index.vue"
Cannot find module '/server/api/health.get'
ENOENT: no such file or directory, open 'app/assets/css/tokens.css'
```

The failures were caused only by the missing foundation requested in the brief.

### RED — AppState

Command:

```text
pnpm vitest run tests/unit/components/AppState.test.ts
```

Expected failure observed (exit 1):

```text
Test Files  1 failed (1)
Failed to resolve import "../../../app/components/common/AppState.vue"
```

### GREEN

The first GREEN attempt isolated one intentional contract mismatch: CTA text included the visible arrow in DOM text. The implementation was corrected by moving the visual arrow to CSS; the test was not weakened.

Command:

```text
pnpm vitest run tests/unit/design-tokens.test.ts tests/unit/components/AppButton.test.ts tests/unit/pages/LandingPage.test.ts tests/integration/health.test.ts tests/unit/components/AppState.test.ts
```

Passing output (exit 0):

```text
Test Files  5 passed (5)
Tests       11 passed (11)
Duration    354ms
```

Final exact Task 1 focused command (exit 0):

```text
Test Files  4 passed (4)
Tests       8 passed (8)
Duration    321ms
```

## Verification

| Command | Result | Output quality |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS — already up to date | Pristine |
| exact focused Vitest command | PASS — 4 files, 8 tests | Pristine |
| five-file GREEN command including AppState | PASS — 5 files, 11 tests | Pristine |
| `pnpm nuxi typecheck` | PASS — exit 0, zero output/errors | Pristine |
| `pnpm eslint .` | PASS — exit 0, zero output/errors | Pristine |
| `pnpm nuxt build` | PASS — Cloudflare module server built; `.output/server/index.mjs` exists | Noisy: one non-fatal Nuxt module-preload sourcemap warning |
| dev runtime smoke (`curl /api/health` and `/`) | PASS — health returned only `ok`/`commit`; required heading, CTA, and production-basis label rendered | Dev checker reported 0 errors; Nuxt Router warned that staged future route `/start` does not exist yet |

Runtime health response:

```json
{
  "ok": true,
  "commit": "development"
}
```

## Self-review

- Requirements: all named Task 1 files exist; `tsconfig.json`, `pnpm-workspace.yaml`, and an AppState test were additionally necessary products of a functional Nuxt/pnpm scaffold and TDD discipline.
- Design: the required headline and exact stage order are tested; the CTA is unique and points to `/start`; no gradient-card hero, glass cards, equipment statistic, or independent facilities stage was introduced.
- Accessibility: interactive targets use the 44px token, AppButton has native disabled/busy state and a safe button type, focus rings are visible, live state messages are polite, and reduced motion is respected.
- Security: runtime secret keys remain server-only; the public health payload is exact-key tested against both secret names and sentinel values; no real secret or internal DOCX/PDF was added.
- Worker output: Wrangler main/assets paths match the produced `.output` tree, the compatibility date is exact, and the built server entry exists.
- Quality: staged diff passes `git diff --cached --check`; ESLint and standalone typecheck are silent; focused tests are silent apart from the normal Vitest summary.

## Concerns

1. `vite-plugin-checker@0.14.4` joins its build command through `shell: true` without quoting the absolute tsconfig path. The required Korean workspace path contains a space, so Nuxt's inline production checker fails with false TS5083 paths. `nuxt.config.ts` removes only that plugin during production builds when the cwd has whitespace; dev inline checking remains active, and the required standalone `pnpm nuxi typecheck` passes with zero errors. This workaround should be removed when the upstream checker quotes arguments.
2. Nuxt 4.4.8/Vite 7.3.6 emits one non-fatal `nuxt:module-preload-polyfill` sourcemap warning during an otherwise successful production build. No application sourcemap failure or runtime failure was observed.
3. `/start` is deliberately only a CTA target in Task 1, so dev SSR logs a router no-match warning until the next identity/start task adds that route.
4. Deployments should provide `GIT_COMMIT_SHA` if a real commit identifier is required in `/api/health`; local development intentionally returns `development`.

## Commit

- `a68eb96` — `chore: scaffold Nuxt Worker application`

## Accessibility review follow-up — 2026-07-14

### Status

DONE — both Important review findings are fixed without changing the approved landing-page hierarchy. Equipment and facilities remain compact supporting evidence below the four-stage sequence.

### Files changed

- `app/components/common/AppButton.vue`
- `app/pages/index.vue`
- `tests/unit/components/AppButton.test.ts`
- `tests/unit/design-tokens.test.ts`
- `tests/unit/pages/LandingPage.test.ts`

### TDD evidence

#### RED

The two-axis target tests were written before changing component or page CSS:

```text
pnpm vitest run tests/unit/components/AppButton.test.ts tests/unit/pages/LandingPage.test.ts tests/unit/design-tokens.test.ts
```

Expected failures were observed: AppButton lacked `min-inline-size` and the masthead home link lacked `min-inline-size`; both tests failed from the missing production contracts. The initial footer parser selected a grouped CSS selector rather than the final footer declaration, so it was narrowed before any production CSS change.

The corrected contrast check then demonstrated the existing accessibility defect:

```text
pnpm vitest run tests/unit/design-tokens.test.ts
```

Expected failure (exit 1):

```text
expected 4.131936481210004 to be greater than or equal to 4.5
```

#### GREEN

Minimal CSS changes add `min-inline-size` and `min-block-size` from the existing 44px token to AppButton and the labelled masthead brand. Footer foreground ink increases from 58% to 64%; the automated sRGB calculation now evaluates the configured ink/canvas combination at `4.9935:1`.

```text
pnpm vitest run tests/unit/components/AppButton.test.ts tests/unit/pages/LandingPage.test.ts tests/unit/design-tokens.test.ts
```

Passing result (exit 0):

```text
Test Files  3 passed (3)
Tests       9 passed (9)
```

### Verification

| Command | Result |
|---|---|
| `pnpm vitest run tests/unit/design-tokens.test.ts tests/unit/components/AppButton.test.ts tests/unit/pages/LandingPage.test.ts tests/integration/health.test.ts` | PASS — 4 files, 10 tests |
| `pnpm nuxi typecheck` | PASS — exit 0, no output/errors |
| `pnpm eslint .` | PASS — exit 0, no output/errors |
| `pnpm nuxt build` | PASS — Cloudflare-module build and `.output/server/index.mjs` created |
| `git diff --check` | PASS — no whitespace errors |

The production build retains the known non-fatal `nuxt:module-preload-polyfill` sourcemap warning only.

### Self-review

- AppButton retains its native button, loading, busy, and focus behavior while gaining a 44px logical inline and block minimum.
- The masthead brand is still the single labelled home link and now has the same 44px two-axis touch contract.
- The brand test mounts the actual page with a NuxtLink stub and asserts both the accessible link behavior and the CSS sizing contract; AppButton is mounted for its contract test.
- The footer assertion locates the final footer declaration and calculates WCAG contrast against `#EEF1F6`, so the previous 58% value fails and the new 64% value passes.
- No primary landing stage, CTA, sequence ordering, or supporting-evidence positioning changed.

### Commit

- `4ce7cad` — `fix: 2026-07-14 accessibility targets and contrast`

### Concerns

- The pre-existing Nuxt module-preload sourcemap warning remains during production builds; it does not prevent a successful build.

## Accessibility review follow-up — sequence clip labels — 2026-07-14

### Status

DONE — the visible `SOURCE`, `Y1—Y4`, `OUTPUT`, and `NEXT` clip labels now meet WCAG 2.2 AA contrast on both existing tinted clip backgrounds. The sequence order, page hierarchy, palette roles, routes, dependencies, and concise supporting-evidence treatment remain unchanged.

### Files changed

- `app/pages/index.vue`
- `tests/unit/design-tokens.test.ts`

### TDD evidence

#### RED

The automated source-level contrast test was added before the production CSS change. It reads the actual `.sequence__clip-label`, `.sequence__clip`, and `.sequence__clip--signal` declarations; composites the configured ink alpha over each configured 7% tint in sRGB; and requires `>= 4.5:1` for both backgrounds.

```text
pnpm vitest run tests/unit/design-tokens.test.ts
```

Expected failure observed (exit 1):

```text
expected 4.1597114284507 to be greater than or equal to 4.5
```

This is the existing 58%-opacity ink label on the violet-tinted clip. The same calculation evaluates the amber-tinted clip at `4.1982:1`, also below AA.

#### GREEN

Only `.sequence__clip-label` changed: `var(--color-ink)` opacity increased from `58%` to `61%`. The final configured ratios are `4.5714:1` on the violet tint and `4.6182:1` on the amber tint.

```text
pnpm vitest run tests/unit/design-tokens.test.ts tests/unit/pages/LandingPage.test.ts
```

Passing result (exit 0):

```text
Test Files  2 passed (2)
Tests       7 passed (7)
```

### Verification

| Command | Result |
|---|---|
| affected Vitest command above | PASS — 2 files, 7 tests |
| `pnpm nuxi typecheck` | PASS — exit 0, no output/errors |
| `pnpm eslint .` | PASS — exit 0, no output/errors |
| `pnpm nuxt build` | PASS — Cloudflare-module output generated, including `.output/server/index.mjs` |
| `git diff --check` | PASS — no whitespace errors |

The production build retains only the pre-existing, non-fatal `nuxt:module-preload-polyfill` sourcemap warning.

### Self-review

- The regression test exercises the production CSS declarations rather than a hard-coded replacement value, and will fail if either clip tint or label opacity is later changed below AA.
- `SOURCE`/`Y1—Y4` share the tested violet background and `OUTPUT`/`NEXT` share the tested amber background, so all four visible labels are covered.
- The foreground adjustment is the smallest whole-percentage change that clears AA on both backgrounds; no content, layout, sequence stage, or palette token changed.
- Equipment and facilities remain a single supporting-evidence aside beneath the sequence, not a stage or hero claim.

### Commit

- `b339a0c` — `fix: 2026-07-14 clip label contrast`

### Concerns

- The known non-fatal Nuxt module-preload sourcemap warning remains during production builds; no new concerns were introduced.
