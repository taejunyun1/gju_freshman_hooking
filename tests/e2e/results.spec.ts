import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { registerAndLoginStudent, uniqueAssessmentPhone } from './support/student'

const canonicalResultUrl = /\/result\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const canonicalPublicId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const canonicalResultHref = /^\/result\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const expectedSectionOrder = [
  'summary',
  'interests',
  'learning-path',
  'outcomes',
  'capability-evidence',
  'scores',
  'faculty',
  'counseling',
]
const expectedFixtureTitles = [
  'APUTURE 600X 바이컬러 조명',
  '스튜디오 A(호리존)',
  '커머셜 포토그라피 기초 워크숍',
  '커머셜 포토그라피 랩',
  '커머셜 포토그라피 세미나',
  '커머셜 포토그라피 심화 워크숍',
  '프로포토 B10',
]

const config = readFileSync('supabase/config.toml', 'utf8')
const projectId = config.match(/^project_id = "([a-z0-9-]+)"$/mu)?.[1]

if (!projectId) {
  throw new Error('supabase/config.toml에서 안전한 project_id를 확인할 수 없습니다.')
}

const databaseContainer = `supabase_db_${projectId}`

type FixtureSummary = {
  activeFaculty: number
  adminOnlyContactFields: number
  nonVerifiedPublishableEquipmentItems: number
  positiveFullTimePrimaries: number
  positiveOtherFaculty: number
  publishableResources: number
  publishableTitles: string[]
  verifiedPublishableEquipmentItems: number
  verifiedPublishableFacilities: number
}

const fixtureSql = String.raw`
begin;

do $fixture_preconditions$
declare
  target_resource_count integer;
  target_faculty_count integer;
  admin_only_contact_fields integer;
begin
  select count(*)
  into target_resource_count
  from public.resources
  where title = any (array[
    '커머셜 포토그라피 기초 워크숍',
    '커머셜 포토그라피 심화 워크숍',
    '커머셜 포토그라피 세미나',
    '커머셜 포토그라피 랩',
    '프로포토 B10',
    'APUTURE 600X 바이컬러 조명',
    '스튜디오 A(호리존)'
  ]::text[])
  and visibility = 'public';

  if target_resource_count <> 7 then
    raise exception 'expected exactly 7 public commercial fixture resources, found %', target_resource_count;
  end if;

  select count(*)
  into target_faculty_count
  from public.faculty
  where name = any (array[
    '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
  ]::text[]);

  if target_faculty_count <> 6 then
    raise exception 'expected exactly 6 faculty fixtures, found %', target_faculty_count;
  end if;

  select count(*)
  into admin_only_contact_fields
  from public.faculty f
  cross join lateral jsonb_each_text(f.contact_visibility) contact
  where f.name = any (array[
    '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
  ]::text[])
  and contact.key = any (array['email', 'phone', 'office', 'website']::text[])
  and contact.value = 'admin_only';

  if admin_only_contact_fields <> 24 then
    raise exception 'faculty contacts must remain admin_only; found % of 24 fields', admin_only_contact_fields;
  end if;
end
$fixture_preconditions$;

update public.resources
set
  status = 'draft',
  updated_at = clock_timestamp()
where status in ('active', 'next_year_confirmed')
and title <> all (array[
  '커머셜 포토그라피 기초 워크숍',
  '커머셜 포토그라피 심화 워크숍',
  '커머셜 포토그라피 세미나',
  '커머셜 포토그라피 랩',
  '프로포토 B10',
  'APUTURE 600X 바이컬러 조명',
  '스튜디오 A(호리존)'
]::text[]);

update public.resources
set
  status = 'active',
  priority = case title
    when '커머셜 포토그라피 기초 워크숍' then 100
    when '커머셜 포토그라피 심화 워크숍' then 90
    when '커머셜 포토그라피 세미나' then 80
    when '커머셜 포토그라피 랩' then 70
    when '스튜디오 A(호리존)' then 100
    when '프로포토 B10' then 90
    when 'APUTURE 600X 바이컬러 조명' then 80
    else priority
  end,
  metadata = case
    when title = '스튜디오 A(호리존)' then metadata || jsonb_build_object(
      'locationLabel', '사진영상학과 스튜디오 A(호리존)',
      'operationNote', '학과 관리자가 운영 상태를 확인했습니다.',
      'lastVerifiedAt', '2026-07-14T09:00:00+09:00'
    )
    else metadata
  end,
  updated_at = clock_timestamp()
where title = any (array[
  '커머셜 포토그라피 기초 워크숍',
  '커머셜 포토그라피 심화 워크숍',
  '커머셜 포토그라피 세미나',
  '커머셜 포토그라피 랩',
  '프로포토 B10',
  'APUTURE 600X 바이컬러 조명',
  '스튜디오 A(호리존)'
]::text[])
and visibility = 'public';

update public.faculty
set
  status = case
    when name = any (array[
      '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
    ]::text[]) then 'active'
    else 'draft'
  end,
  weekly_capacity = case
    when name = any (array['조대연', '윤태준', '김사라']::text[])
      and employment_type = 'full_time'
      and consultation_role = 'primary'
      then 4
    else 0
  end,
  last_verified_at = case
    when name = any (array[
      '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
    ]::text[]) then '2026-07-14T00:00:00+00:00'::timestamptz
    else last_verified_at
  end,
  updated_at = clock_timestamp();

do $fixture_postconditions$
declare
  count_value integer;
begin
  select count(*) into count_value
  from public.resources
  where status in ('active', 'next_year_confirmed');
  if count_value <> 7 then
    raise exception 'expected exactly 7 publishable resources, found %', count_value;
  end if;

  select count(*) into count_value
  from public.resources
  where status in ('active', 'next_year_confirmed')
  and title = any (array[
    '커머셜 포토그라피 기초 워크숍',
    '커머셜 포토그라피 심화 워크숍',
    '커머셜 포토그라피 세미나',
    '커머셜 포토그라피 랩',
    '프로포토 B10',
    'APUTURE 600X 바이컬러 조명',
    '스튜디오 A(호리존)'
  ]::text[]);
  if count_value <> 7 then
    raise exception 'publishable resource allowlist mismatch';
  end if;

  select count(*) into count_value from public.faculty where status = 'active';
  if count_value <> 6 then
    raise exception 'expected exactly 6 active faculty, found %', count_value;
  end if;

  select count(*) into count_value
  from public.faculty
  where status = 'active'
  and employment_type = 'full_time'
  and consultation_role = 'primary'
  and weekly_capacity > 0;
  if count_value <> 3 then
    raise exception 'expected positive capacity for exactly 3 full-time primaries, found %', count_value;
  end if;

  select count(*) into count_value
  from public.faculty
  where weekly_capacity > 0
  and not (
    status = 'active'
    and employment_type = 'full_time'
    and consultation_role = 'primary'
  );
  if count_value <> 0 then
    raise exception 'non-primary faculty unexpectedly has positive capacity';
  end if;

  select count(*) into count_value
  from public.faculty f
  cross join lateral jsonb_each_text(f.contact_visibility) contact
  where f.status = 'active'
  and contact.key = any (array['email', 'phone', 'office', 'website']::text[])
  and contact.value = 'admin_only';
  if count_value <> 24 then
    raise exception 'active faculty contacts must remain admin_only; found % of 24 fields', count_value;
  end if;

  select count(*) into count_value
  from public.resources
  where status in ('active', 'next_year_confirmed')
  and type = 'facility'
  and title = '스튜디오 A(호리존)'
  and metadata->>'locationLabel' = '사진영상학과 스튜디오 A(호리존)'
  and nullif(metadata->>'lastVerifiedAt', '') is not null
  and metadata->>'operationNote' = '학과 관리자가 운영 상태를 확인했습니다.';
  if count_value <> 1 then
    raise exception 'Studio A must have verified operational metadata';
  end if;

  select count(*) into count_value
  from public.equipment_inventory_items ri
  join public.resources r on r.id = ri.equipment_resource_id
  where r.status in ('active', 'next_year_confirmed')
  and r.type = 'equipment'
  and ri.data_quality_status = 'verified';
  if count_value <> 5 then
    raise exception 'expected 5 verified publishable equipment inventory items, found %', count_value;
  end if;

  select count(*) into count_value
  from public.equipment_inventory_items ri
  join public.resources r on r.id = ri.equipment_resource_id
  where r.status in ('active', 'next_year_confirmed')
  and r.type = 'equipment'
  and ri.data_quality_status <> 'verified';
  if count_value <> 0 then
    raise exception 'unverified equipment inventory must never be published';
  end if;
end
$fixture_postconditions$;

select jsonb_build_object(
  'publishableResources', (
    select count(*)
    from public.resources
    where status in ('active', 'next_year_confirmed')
  ),
  'activeFaculty', (select count(*) from public.faculty where status = 'active'),
  'positiveFullTimePrimaries', (
    select count(*) from public.faculty
    where status = 'active'
    and employment_type = 'full_time'
    and consultation_role = 'primary'
    and weekly_capacity > 0
  ),
  'positiveOtherFaculty', (
    select count(*) from public.faculty
    where weekly_capacity > 0
    and not (status = 'active' and employment_type = 'full_time' and consultation_role = 'primary')
  ),
  'adminOnlyContactFields', (
    select count(*)
    from public.faculty f
    cross join lateral jsonb_each_text(f.contact_visibility) contact
    where f.status = 'active'
    and contact.key = any (array['email', 'phone', 'office', 'website']::text[])
    and contact.value = 'admin_only'
  ),
  'verifiedPublishableEquipmentItems', (
    select count(*)
    from public.equipment_inventory_items ri
    join public.resources r on r.id = ri.equipment_resource_id
    where r.status in ('active', 'next_year_confirmed')
    and r.type = 'equipment'
    and ri.data_quality_status = 'verified'
  ),
  'nonVerifiedPublishableEquipmentItems', (
    select count(*)
    from public.equipment_inventory_items ri
    join public.resources r on r.id = ri.equipment_resource_id
    where r.status in ('active', 'next_year_confirmed')
    and r.type = 'equipment'
    and ri.data_quality_status <> 'verified'
  ),
  'verifiedPublishableFacilities', (
    select count(*)
    from public.resources
    where status in ('active', 'next_year_confirmed')
    and type = 'facility'
    and title = '스튜디오 A(호리존)'
    and metadata->>'locationLabel' = '사진영상학과 스튜디오 A(호리존)'
    and nullif(metadata->>'lastVerifiedAt', '') is not null
  ),
  'publishableTitles', (
    select jsonb_agg(title order by title)
    from public.resources
    where status in ('active', 'next_year_confirmed')
  )
);

commit;
`

const assertLocalRuntime = () => {
  const rawStatus = execFileSync('pnpm', ['exec', 'supabase', 'status', '--output', 'json'], {
    encoding: 'utf8',
  })
  const status = JSON.parse(rawStatus) as { API_URL?: string; DB_URL?: string }

  for (const [name, value] of Object.entries({ API_URL: status.API_URL, DB_URL: status.DB_URL })) {
    if (!value) {
      throw new Error(`로컬 Supabase ${name}을 확인할 수 없습니다.`)
    }

    const hostname = new URL(value).hostname
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
      throw new Error(`E2E fixture가 로컬이 아닌 ${name}(${hostname})을 가리킵니다.`)
    }
  }

  const running = execFileSync(
    'docker',
    ['inspect', '--format={{.State.Running}}', databaseContainer],
    { encoding: 'utf8' },
  ).trim()

  if (running !== 'true') {
    throw new Error(`허용된 로컬 DB 컨테이너 ${databaseContainer}가 실행 중이 아닙니다.`)
  }
}

const installCommercialFixture = (): FixtureSummary => {
  const output = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      databaseContainer,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=verbose',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-Atq',
    ],
    { encoding: 'utf8', input: fixtureSql },
  )

  const summaryLine = output
    .trim()
    .split('\n')
    .findLast(line => line.startsWith('{'))

  if (!summaryLine) {
    throw new Error('로컬 E2E fixture 설치 결과를 확인할 수 없습니다.')
  }

  return JSON.parse(summaryLine) as FixtureSummary
}

const selectCommercialPath = async (page: Page) => {
  await page.getByRole('group', { name: '무엇을 해보고 싶나요?' })
    .getByRole('checkbox', { name: /제품·패션·광고 이미지 만들기/u })
    .check()
  await page.getByTestId('assessment-next').click()

  await page.getByRole('group', { name: '어떤 결과물을 만들고 싶나요?' })
    .getByRole('checkbox', { name: /광고·패션 이미지/u })
    .check()
  await page.getByTestId('assessment-next').click()

  await page.getByRole('group', { name: '어떤 방식으로 작업하고 싶나요?' })
    .getByRole('checkbox', { name: /스튜디오에서 촬영/u })
    .check()
  await page.getByTestId('assessment-next').click()

  await page.getByRole('group', { name: '어떤 방향을 탐색하고 싶나요?' })
    .getByRole('checkbox', { name: /사진을 직접 촬영하고 보정해/u })
    .check()
}

const completeCommercialAssessment = async (page: Page) => {
  await selectCommercialPath(page)
  const submitResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/assessment/submit'
  ))
  await page.getByTestId('assessment-submit').click()
  const submitResponse = await submitResponsePromise
  expect(submitResponse.ok()).toBe(true)
  await expect(page).toHaveURL(canonicalResultUrl)
  await expect(page.getByRole('heading', { level: 1, name: '선택한 관심사는 4년 동안 이렇게 이어집니다' })).toBeVisible()

  const publicId = new URL(page.url()).pathname.split('/').at(-1)
  expect(publicId).toMatch(canonicalPublicId)
  return publicId as string
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  assertLocalRuntime()
  const summary = installCommercialFixture()

  expect(summary).toEqual({
    activeFaculty: 6,
    adminOnlyContactFields: 24,
    nonVerifiedPublishableEquipmentItems: 0,
    positiveFullTimePrimaries: 3,
    positiveOtherFaculty: 0,
    publishableResources: 7,
    publishableTitles: expectedFixtureTitles,
    verifiedPublishableEquipmentItems: 5,
    verifiedPublishableFacilities: 1,
  })
})

test('상업사진 관심사가 4년 경로, 제작 근거, 교수 연결로 이어진다', async ({ page }, testInfo) => {
  await registerAndLoginStudent(page, uniqueAssessmentPhone(testInfo))
  await completeCommercialAssessment(page)

  await expect.poll(async () => page.locator('[data-result-section]').evaluateAll(sections => (
    sections.map(section => section.getAttribute('data-result-section'))
  ))).toEqual(expectedSectionOrder)

  const interests = page.locator('[data-result-section="interests"]')
  await expect(interests).toContainText('광고·패션 이미지')
  await expect(interests).toContainText('스튜디오에서 촬영')

  const learningPath = page.locator('[data-result-section="learning-path"]')
  await expect(learningPath.locator('[data-learning-year]')).toHaveCount(4)
  await expect(learningPath.locator('[data-learning-year="1"]')).toContainText('1Y 기초')
  await expect(learningPath.locator('[data-learning-year="2"]')).toContainText('2Y 제작·후반')
  await expect(learningPath.locator('[data-learning-year="3"]')).toContainText('3Y 전공심화·프로젝트')
  await expect(learningPath.locator('[data-learning-year="4"]')).toContainText('4Y 캡스톤·포트폴리오')
  await expect(learningPath.getByRole('heading', { name: '커머셜 포토그라피 기초 워크숍', exact: true })).toBeVisible()

  const outcomes = page.locator('[data-result-section="outcomes"]')
  await expect(outcomes).toContainText('이 경로에서 만들어볼 결과물')
  await expect(outcomes).toContainText('진로')

  const capability = page.locator('[data-result-section="capability-evidence"]')
  const moreCapability = capability.getByTestId('capability-more')
  if (await moreCapability.isVisible()) {
    await moreCapability.click()
  }
  await expect(capability.getByRole('heading', { name: '스튜디오 A(호리존)', exact: true })).toBeVisible()
  await expect(capability.getByRole('heading', { name: '프로포토 B10', exact: true })).toBeVisible()
  await expect(capability.getByRole('heading', { name: 'APUTURE 600X 바이컬러 조명', exact: true })).toBeVisible()

  const faculty = page.locator('[data-result-section="faculty"]')
  await expect(faculty.getByText('추천 총괄교수', { exact: true })).toBeVisible()
  const specialists = faculty.locator('.faculty-recommendation__group--specialists')
  await expect(specialists.getByRole('heading', { name: '함께 연결되는 전문분야', exact: true })).toBeVisible()
  await expect(specialists.getByRole('heading', { name: '곽동욱 겸임교수', exact: true })).toBeVisible()
  await expect(specialists).toContainText('광고사진·패션사진·브랜드 이미지')
  await expect(faculty.locator('address.faculty-card__contacts')).toHaveCount(0)
  await expect(faculty.locator('.faculty-card__office')).toHaveCount(0)
  await expect(faculty.locator('a[href^="tel:"]')).toHaveCount(0)
  await expect(faculty.locator('a[href^="mailto:"]')).toHaveCount(0)
  await expect(faculty.getByRole('link', { name: '웹사이트 (새 창)', exact: true })).toHaveCount(0)
})

test('같은 학생의 결과 이력은 최신 3개 UUID 링크만 보존한다', async ({ page }, testInfo) => {
  test.setTimeout(90_000)

  await registerAndLoginStudent(page, uniqueAssessmentPhone(testInfo))

  const idempotencyKeys: string[] = []
  page.on('request', (request) => {
    if (!request.url().endsWith('/api/assessment/submit') || request.method() !== 'POST') return

    const payload = request.postDataJSON() as { idempotencyKey?: unknown }
    if (typeof payload.idempotencyKey === 'string') {
      idempotencyKeys.push(payload.idempotencyKey)
    }
  })

  const publicIds: string[] = []
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) {
      await page.goto('/assessment')
    }
    publicIds.push(await completeCommercialAssessment(page))
  }

  expect(new Set(publicIds).size).toBe(4)
  expect(idempotencyKeys).toHaveLength(4)
  expect(new Set(idempotencyKeys).size).toBe(4)
  idempotencyKeys.forEach(key => expect(key).toMatch(canonicalPublicId))

  await page.goto('/history')
  const cards = page.getByTestId('history-card')
  await expect(cards).toHaveCount(3)

  const resultHrefs = await cards.locator('a').evaluateAll(links => (
    links.map(link => link.getAttribute('href'))
  ))
  const expectedHrefs = publicIds.slice(1).reverse().map(id => `/result/${id}`)

  expect(resultHrefs).toEqual(expectedHrefs)
  resultHrefs.forEach(href => expect(href).toMatch(canonicalResultHref))
  expect(resultHrefs).not.toContain(`/result/${publicIds[0]}`)

  await page.goto(`/result/${publicIds[0]}`)
  await expect(page.getByRole('alert')).toHaveText('결과를 찾을 수 없습니다.')
})
