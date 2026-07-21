# PHOTO:NEXT Minimal Department Photography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one real department activity photo to the landing page, two track-matched facility photos to each result, and promote the verified print lab into active department facility evidence.

**Architecture:** Keep all photo metadata in one typed static catalog keyed by `TrackKey`, render it through one reusable accessible photo-card component, and integrate it without changing result snapshots or APIs. Promote the existing `archive:facility:print_lab` resource with an idempotent service-role PostgreSQL function so the facility remains sourced, validated, and free-tier friendly.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript 6, Vitest, Vue Test Utils, Supabase PostgreSQL migrations and pgTAP, Cloudflare Workers static assets.

## Global Constraints

- The landing page renders exactly one department photo; a result renders no more than two.
- Photos support the learning path and never replace curriculum, faculty, career, or capability evidence.
- Use only the supplied WebP files; do not add a CMS, carousel, lightbox, generated image, or third-party image service.
- Preserve the blue photo-note tokens; do not add new accent colors or text overlays.
- Do not change DB-backed scoring, faculty matching, result snapshots, or API response schemas.
- Result photos use `loading="lazy"` and `decoding="async"`; the landing photo declares fixed intrinsic dimensions.
- A missing image hides only its image frame while the caption and all product functionality remain.
- The verified print lab is public supporting evidence with inquiry-only operation guidance.

---

## File Structure

- Create `shared/content/department-photos.ts`: typed landing image and exact two-image `TrackKey` mapping.
- Create `app/components/common/DepartmentPhotoCard.vue`: semantic image, label, description, and local image-failure fallback.
- Create `app/components/result/DepartmentSpacePhotos.vue`: result-only two-card grid selected from the static mapping.
- Modify `app/pages/index.vue`: insert the single activity photo after the CTA.
- Modify `app/components/result/ResultTimeline.vue`: insert the two-space evidence grid before existing facility/equipment cards.
- Create `public/images/department/*.webp`: stable English-named copies of the approved source images.
- Create `supabase/migrations/202607210036_activate_print_lab_facility.sql`: idempotent print-lab verification and activation.
- Create `supabase/tests/print_lab_facility_activation.test.sql`: privileges, metadata, tags, activation, and idempotency contract.
- Add focused tests under `tests/unit/content`, `tests/unit/components`, and `tests/unit/pages`.

---

### Task 1: Typed photo catalog and static assets

**Files:**
- Create: `shared/content/department-photos.ts`
- Create: `public/images/department/field-activity.webp`
- Create: `public/images/department/studio-a.webp`
- Create: `public/images/department/studio-b.webp`
- Create: `public/images/department/computer-lab.webp`
- Create: `public/images/department/print-lab.webp`
- Create: `public/images/department/darkroom.webp`
- Test: `tests/unit/content/department-photos.test.ts`

**Interfaces:**
- Produces: `DepartmentPhoto`, `landingDepartmentPhoto`, `departmentPhotosByTrack: Readonly<Record<TrackKey, readonly [DepartmentPhoto, DepartmentPhoto]>>`.
- Every `src` is an absolute public URL beginning with `/images/department/`.

- [ ] **Step 1: Write the failing catalog test**

```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { trackKeys } from '../../../shared/types/domain'
import { departmentPhotosByTrack, landingDepartmentPhoto } from '../../../shared/content/department-photos'

describe('department photo catalog', () => {
  it('provides one landing photo and exactly two approved spaces per track', () => {
    expect(landingDepartmentPhoto.src).toBe('/images/department/field-activity.webp')
    for (const track of trackKeys) {
      expect(departmentPhotosByTrack[track]).toHaveLength(2)
      for (const photo of departmentPhotosByTrack[track]) {
        expect(photo.alt.trim()).not.toBe('')
        expect(photo.label.trim()).not.toBe('')
        expect(photo.description.trim()).not.toBe('')
        expect(existsSync(join(process.cwd(), 'public', photo.src))).toBe(true)
      }
    }
  })

  it('uses the approved A-plan mapping', () => {
    expect(departmentPhotosByTrack.documentary.map(photo => photo.label)).toEqual(['학과 암실', '프린트랩'])
    expect(departmentPhotosByTrack.art_photo.map(photo => photo.label)).toEqual(['학과 암실', '프린트랩'])
    expect(departmentPhotosByTrack.commercial.map(photo => photo.label)).toEqual(['스튜디오 A', '스튜디오 B'])
    expect(departmentPhotosByTrack.video.map(photo => photo.label)).toEqual(['컴퓨터실', '스튜디오 A'])
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `corepack pnpm exec vitest run --project unit tests/unit/content/department-photos.test.ts`

Expected: FAIL because `shared/content/department-photos.ts` does not exist.

- [ ] **Step 3: Copy only the six approved WebP files**

Copy from the workspace-level `resource` folder into `public/images/department` with the English names listed above. Do not transform the originals or include `전시관람_1.webp`, `학생도서관 및 휴게실.webp`, or the PDF/DOCX files.

- [ ] **Step 4: Implement the typed catalog**

```ts
import type { TrackKey } from '../types/domain'

export interface DepartmentPhoto {
  readonly src: string
  readonly alt: string
  readonly label: string
  readonly description: string
  readonly width: number
  readonly height: number
}

const darkroom = { src: '/images/department/darkroom.webp', alt: '붉은 안전등 아래 확대기가 놓인 사진영상미디어학과 암실', label: '학과 암실', description: '필름 현상과 인화로 기록 이미지의 물성을 익힙니다.', width: 2048, height: 1536 } as const
const printLab = { src: '/images/department/print-lab.webp', alt: '대형 사진 출력 장비가 설치된 사진영상미디어학과 프린트랩', label: '프린트랩', description: '작품과 포트폴리오를 전시 가능한 출력물로 완성합니다.', width: 2048, height: 1365 } as const
const studioA = { src: '/images/department/studio-a.webp', alt: '호리존과 조명 장비가 설치된 사진영상미디어학과 스튜디오 A', label: '스튜디오 A', description: '호리존과 조명을 활용해 사진과 영상을 촬영합니다.', width: 1220, height: 700 } as const
const studioB = { src: '/images/department/studio-b.webp', alt: '배경지와 조명 장비가 설치된 사진영상미디어학과 스튜디오 B', label: '스튜디오 B', description: '제품·인물·패션 촬영을 반복해 실습합니다.', width: 2048, height: 1463 } as const
const computerLab = { src: '/images/department/computer-lab.webp', alt: '학생들이 아이맥으로 작업하는 사진영상미디어학과 컴퓨터실', label: '컴퓨터실', description: '사진 보정과 영상 편집, AI 기반 후반작업을 수행합니다.', width: 2048, height: 1365 } as const

export const landingDepartmentPhoto: DepartmentPhoto = Object.freeze({
  src: '/images/department/field-activity.webp',
  alt: '카메라를 들고 현장 촬영 활동에 참여한 사진영상미디어학과 학생들',
  label: '현장 활동',
  description: '사진과 영상으로 현장을 경험하는 사진영상미디어학과',
  width: 2048,
  height: 1365,
})

export const departmentPhotosByTrack = Object.freeze({
  documentary: Object.freeze([darkroom, printLab]),
  art_photo: Object.freeze([darkroom, printLab]),
  commercial: Object.freeze([studioA, studioB]),
  video: Object.freeze([computerLab, studioA]),
}) satisfies Readonly<Record<TrackKey, readonly [DepartmentPhoto, DepartmentPhoto]>>
```

- [ ] **Step 5: Run the test and verify GREEN**

Run: `corepack pnpm exec vitest run --project unit tests/unit/content/department-photos.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the catalog and assets**

```bash
git add shared/content/department-photos.ts public/images/department tests/unit/content/department-photos.test.ts
git commit -m "feat: 2026-07-21 학과 사진 카탈로그 추가"
```

---

### Task 2: Accessible reusable photo card and landing integration

**Files:**
- Create: `app/components/common/DepartmentPhotoCard.vue`
- Modify: `app/pages/index.vue`
- Test: `tests/unit/components/DepartmentPhotoCard.test.ts`
- Test: `tests/unit/pages/LandingPage.test.ts`

**Interfaces:**
- Consumes: `DepartmentPhoto` and `landingDepartmentPhoto` from Task 1.
- Produces: `DepartmentPhotoCard` with props `{ photo: DepartmentPhoto; loading?: 'eager' | 'lazy' }`.

- [ ] **Step 1: Write failing component and landing tests**

```ts
const wrapper = mount(DepartmentPhotoCard, { props: { photo, loading: 'lazy' } })
expect(wrapper.get('img').attributes()).toMatchObject({
  src: photo.src,
  alt: photo.alt,
  loading: 'lazy',
  decoding: 'async',
  width: String(photo.width),
  height: String(photo.height),
})
await wrapper.get('img').trigger('error')
expect(wrapper.find('img').exists()).toBe(false)
expect(wrapper.text()).toContain(photo.label)

const landing = mount(LandingPage)
expect(landing.findAll('[data-department-photo="landing"]')).toHaveLength(1)
expect(landing.get('[data-department-photo="landing"] img').attributes('loading')).toBe('eager')
```

- [ ] **Step 2: Run tests and verify RED**

Run: `corepack pnpm exec vitest run --project unit tests/unit/components/DepartmentPhotoCard.test.ts tests/unit/pages/LandingPage.test.ts`

Expected: FAIL because the component and landing photo do not exist.

- [ ] **Step 3: Implement the card and landing frame**

Create the card with this structure; its scoped CSS must use existing color and radius tokens and set the media wrapper to `overflow: hidden`, `aspect-ratio: var(--department-photo-aspect, 16 / 9)`, and its image to `width: 100%; height: 100%; object-fit: cover`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { DepartmentPhoto } from '../../../shared/content/department-photos'

withDefaults(defineProps<{
  photo: DepartmentPhoto
  loading?: 'eager' | 'lazy'
}>(), { loading: 'lazy' })

const imageFailed = ref(false)
</script>

<template>
  <figure class="department-photo-card" data-department-photo-card>
    <div v-if="!imageFailed" class="department-photo-card__media">
      <img
        :src="photo.src"
        :alt="photo.alt"
        :width="photo.width"
        :height="photo.height"
        :loading="loading"
        decoding="async"
        @error="imageFailed = true"
      >
    </div>
    <figcaption>
      <strong>{{ photo.label }}</strong>
      <span>{{ photo.description }}</span>
    </figcaption>
  </figure>
</template>
```

Import `DepartmentPhotoCard` and `landingDepartmentPhoto` into `app/pages/index.vue`, then add exactly this block after the CTA:

```vue
<div class="landing__photo" data-department-photo="landing">
  <DepartmentPhotoCard :photo="landingDepartmentPhoto" loading="eager" />
</div>
```

Set `.landing__photo` to `margin-top: 2rem` and `--department-photo-aspect: 4 / 3`; change that custom property to `16 / 7` at `min-width: 720px`. Never position the caption over the image.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `corepack pnpm exec vitest run --project unit tests/unit/components/DepartmentPhotoCard.test.ts tests/unit/pages/LandingPage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit landing integration**

```bash
git add app/components/common/DepartmentPhotoCard.vue app/pages/index.vue tests/unit/components/DepartmentPhotoCard.test.ts tests/unit/pages/LandingPage.test.ts
git commit -m "feat: 2026-07-21 첫 화면 학과 활동 사진 추가"
```

---

### Task 3: Track-matched result facility photos

**Files:**
- Create: `app/components/result/DepartmentSpacePhotos.vue`
- Modify: `app/components/result/ResultTimeline.vue`
- Test: `tests/unit/components/DepartmentSpacePhotos.test.ts`
- Test: `tests/unit/components/ResultTimeline.test.ts`

**Interfaces:**
- Consumes: `track: TrackKey`, `departmentPhotosByTrack`, and `DepartmentPhotoCard`.
- Produces: exactly two `[data-department-space-photo]` figures for every current track.

- [ ] **Step 1: Write failing per-track and integration tests**

```ts
it.each([
  ['documentary', ['학과 암실', '프린트랩']],
  ['art_photo', ['학과 암실', '프린트랩']],
  ['commercial', ['스튜디오 A', '스튜디오 B']],
  ['video', ['컴퓨터실', '스튜디오 A']],
] as const)('renders two spaces for %s', (track, labels) => {
  const wrapper = mount(DepartmentSpacePhotos, { props: { track } })
  const cards = wrapper.findAll('[data-department-space-photo]')
  expect(cards).toHaveLength(2)
  expect(cards.map(card => card.get('figcaption strong').text())).toEqual(labels)
  expect(cards.every(card => card.get('img').attributes('loading') === 'lazy')).toBe(true)
})

const timeline = await mountTimeline()
const capability = timeline.get('[data-result-section="capability-evidence"]')
expect(capability.findAll('[data-department-space-photo]')).toHaveLength(2)
expect(capability.text()).toContain('실제 제작 공간')
```

- [ ] **Step 2: Run tests and verify RED**

Run: `corepack pnpm exec vitest run --project unit tests/unit/components/DepartmentSpacePhotos.test.ts tests/unit/components/ResultTimeline.test.ts`

Expected: FAIL because the result photo component is absent.

- [ ] **Step 3: Implement the two-card result grid**

Create the result component with the exact typed lookup:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { departmentPhotosByTrack } from '../../../shared/content/department-photos'
import type { TrackKey } from '../../../shared/types/domain'
import DepartmentPhotoCard from '../common/DepartmentPhotoCard.vue'

const props = defineProps<{ track: TrackKey }>()
const photos = computed(() => departmentPhotosByTrack[props.track])
</script>

<template>
  <section class="department-space-photos" aria-labelledby="department-space-title">
    <h3 id="department-space-title">실제 제작 공간</h3>
    <div class="department-space-photos__grid">
      <div
        v-for="photo in photos"
        :key="photo.src"
        data-department-space-photo
      >
        <DepartmentPhotoCard :photo="photo" loading="lazy" />
      </div>
    </div>
  </section>
</template>
```

Use one grid column by default and two columns at `min-width: 720px`. Fix media aspect ratio at `16 / 9`, apply no hover movement, and keep labels beneath images.

Import the component in `ResultTimeline.vue` and insert it immediately before the capability slot:

```vue
<DepartmentSpacePhotos :track="snapshot.rankedTracks[0]" />
<slot name="capability-evidence">
  <CapabilityEvidence
    :equipment="snapshot.resources.equipment"
    :facility="snapshot.resources.facility"
    :result-public-id="resultPublicId"
  />
</slot>
```

Do not read track scores or modify facility/equipment data.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `corepack pnpm exec vitest run --project unit tests/unit/components/DepartmentSpacePhotos.test.ts tests/unit/components/ResultTimeline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit result integration**

```bash
git add app/components/result/DepartmentSpacePhotos.vue app/components/result/ResultTimeline.vue tests/unit/components/DepartmentSpacePhotos.test.ts tests/unit/components/ResultTimeline.test.ts
git commit -m "feat: 2026-07-21 관심 분야별 제작 공간 사진 연결"
```

---

### Task 4: Promote the verified print lab facility

**Files:**
- Create: `supabase/migrations/202607210036_activate_print_lab_facility.sql`
- Create: `supabase/tests/print_lab_facility_activation.test.sql`

**Interfaces:**
- Produces: `public.activate_verified_print_lab_facility() returns jsonb`.
- The function accepts no arguments, runs as `security definer`, fixes metadata for exactly `archive:facility:print_lab`, and activates that resource through `transition_admin_resource`.
- Execute privilege belongs only to `service_role`.

- [ ] **Step 1: Write the failing pgTAP contract**

Use this complete 10-assertion contract:

```sql
begin;
select plan(10);

select has_function('public', 'activate_verified_print_lab_facility', array[]::text[], 'print lab activation function exists');
select function_privs_are('public', 'activate_verified_print_lab_facility', array[]::text[], 'service_role', array['EXECUTE'], 'service role can activate print lab');
select function_privs_are('public', 'activate_verified_print_lab_facility', array[]::text[], 'authenticated', array[]::text[], 'ordinary users cannot activate print lab');

insert into auth.users(id) values ('36000000-0000-4000-8000-000000000036');
insert into public.admin_users(id, role, is_active)
values ('36000000-0000-4000-8000-000000000036', 'admin', true);

select is(
  public.activate_verified_print_lab_facility() ->> 'status',
  'updated',
  'verified print lab is activated'
);
select is(
  (select count(*)::integer from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'
     and type = 'facility' and visibility = 'public' and status = 'active'),
  1,
  'exactly one print lab is public and active'
);
select is(
  (select metadata ->> 'location_label' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  '사진영상미디어학과 프린트랩',
  'print lab has a precise department location label'
);
select ok(
  (select metadata ->> 'operationNote' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab') like '%출력%'
  and (select metadata ->> 'operationNote' from public.resources
       where metadata ->> 'seedKey' = 'archive:facility:print_lab') like '%학과에 문의%',
  'print lab operation note explains output and inquiry access'
);
select matches(
  (select metadata ->> 'lastVerifiedAt' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+][0-9]{2}:[0-9]{2}$',
  'print lab verification retains an offset timestamp'
);
select is(
  (select array_agg(tag.tag_key order by tag.tag_key)
   from public.resource_tags tag
   join public.resources resource on resource.id = tag.resource_id
   where resource.metadata ->> 'seedKey' = 'archive:facility:print_lab'
     and tag.tag_key = any (array['art_photo', 'commercial', 'documentary']::text[])),
  array['art_photo', 'commercial', 'documentary']::text[],
  'print lab retains all three supported track tags'
);
select is(
  public.activate_verified_print_lab_facility() ->> 'status',
  'already_activated',
  'print lab activation is idempotent'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the focused DB test and verify RED**

Run: `corepack pnpm exec supabase db reset --local && corepack pnpm exec supabase test db --local supabase/tests/print_lab_facility_activation.test.sql`

Expected: FAIL because the activation function does not exist.

- [ ] **Step 3: Implement the idempotent migration**

Use this fail-closed migration body:

```sql
create function public.activate_verified_print_lab_facility()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_user_id uuid;
  v_resource public.resources%rowtype;
  v_outcome jsonb;
  v_metadata_updated integer := 0;
  v_resource_published integer := 0;
begin
  if (select count(*) from public.resources
      where metadata ->> 'seedKey' = 'archive:facility:print_lab') <> 1 then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_SEED_INVALID';
  end if;

  select admin_user.id into v_admin_user_id
  from public.admin_users admin_user
  where admin_user.role = 'admin' and admin_user.is_active
  order by admin_user.created_at, admin_user.id
  limit 1;
  if v_admin_user_id is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  update public.resources resource
  set metadata = (resource.metadata - 'operation_note' - 'last_verified_at')
        || pg_catalog.jsonb_build_object(
          'operationNote', '대형 프린터를 활용한 사진·포트폴리오·전시 출력 시설입니다. 실제 이용은 학과에 문의해야 합니다.',
          'location_label', '사진영상미디어학과 프린트랩',
          'lastVerifiedAt', '2026-07-21T12:20:00+09:00'
        ),
      updated_at = pg_catalog.clock_timestamp()
  where resource.metadata ->> 'seedKey' = 'archive:facility:print_lab'
    and (
      resource.metadata ->> 'operationNote' is distinct from
        '대형 프린터를 활용한 사진·포트폴리오·전시 출력 시설입니다. 실제 이용은 학과에 문의해야 합니다.'
      or resource.metadata ->> 'location_label' is distinct from '사진영상미디어학과 프린트랩'
      or resource.metadata ->> 'lastVerifiedAt' is distinct from '2026-07-21T12:20:00+09:00'
      or resource.metadata ? 'operation_note'
      or resource.metadata ? 'last_verified_at'
    );
  get diagnostics v_metadata_updated = row_count;

  select * into strict v_resource
  from public.resources
  where metadata ->> 'seedKey' = 'archive:facility:print_lab';

  if v_resource.type <> 'facility' or v_resource.visibility <> 'public' then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_SEED_INVALID';
  end if;

  if v_resource.status = 'draft' then
    v_outcome := public.transition_admin_resource(
      v_admin_user_id, v_resource.updated_at, pg_catalog.gen_random_uuid(), v_resource.id, 'active'
    );
    if v_outcome ->> 'status' <> 'updated' then
      raise exception using errcode = 'P0001', message = 'PRINT_LAB_ACTIVATION_FAILED';
    end if;
    v_resource_published := 1;
  elsif v_resource.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_STATUS_INVALID';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', case when v_metadata_updated + v_resource_published > 0
      then 'updated' else 'already_activated' end,
    'metadataUpdated', v_metadata_updated,
    'resourcesPublished', v_resource_published
  );
end;
$$;

revoke all on function public.activate_verified_print_lab_facility()
  from public, anon, authenticated, service_role;
grant execute on function public.activate_verified_print_lab_facility() to service_role;

do $$
begin
  if exists (
    select 1 from public.resources
    where metadata ->> 'seedKey' = 'archive:facility:print_lab'
  ) and exists (
    select 1 from public.admin_users where role = 'admin' and is_active
  ) then
    perform public.activate_verified_print_lab_facility();
  end if;
end;
$$;
```

- [ ] **Step 4: Run focused and full DB tests**

Run:

```bash
corepack pnpm exec supabase db reset --local
corepack pnpm exec supabase test db --local supabase/tests/print_lab_facility_activation.test.sql
corepack pnpm exec supabase test db --local
```

Expected: all pgTAP files PASS; repeat activation reports `already_activated`.

- [ ] **Step 5: Commit the facility activation**

```bash
git add supabase/migrations/202607210036_activate_print_lab_facility.sql supabase/tests/print_lab_facility_activation.test.sql
git commit -m "feat: 2026-07-21 프린트랩 기반시설 활성화"
```

---

### Task 5: Whole-product verification and deployment

**Files:**
- Modify only if verification exposes a scoped defect in the files above.

**Interfaces:**
- Consumes all deliverables from Tasks 1–4.
- Produces a production release whose health commit matches Git HEAD.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
corepack pnpm exec vitest run --project unit \
  tests/unit/content/department-photos.test.ts \
  tests/unit/components/DepartmentPhotoCard.test.ts \
  tests/unit/components/DepartmentSpacePhotos.test.ts \
  tests/unit/components/ResultTimeline.test.ts \
  tests/unit/pages/LandingPage.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run complete verification**

Run:

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Perform visual QA**

Check desktop and 390px mobile widths. Confirm one landing image, two result images, no text overlay, correct track mapping, no horizontal overflow, and preserved CTA/curriculum/faculty hierarchy. Simulate one image error and confirm the caption and all result actions remain.

- [ ] **Step 4: Push database migration and deploy Worker**

Use the repository's existing fail-closed release procedure. Apply the Supabase migration first, deploy staging, run smoke checks, then deploy production. Do not print secrets or administrator credentials.

- [ ] **Step 5: Verify production**

Verify:

- `/api/health` returns `ok: true` and the exact Git HEAD commit.
- `/` returns 200 and the activity image URL returns 200.
- a real result returns 200 and both mapped image URLs return 200.
- the database has exactly one active public `archive:facility:print_lab` resource.

- [ ] **Step 6: Commit any scoped verification fix and push**

If Step 3 or 5 required a correction, commit only that correction with a dated Korean summary, rerun the affected checks, and push `feature/photo-next-mvp`.
