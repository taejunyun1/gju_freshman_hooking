import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'

import {
  buildCareerNarrativeBrief,
  buildDeterministicCareerNarrativeChoice,
  renderCareerNarrative,
} from '../../server/modules/assessment/career-narrative'
import { decodeResultSnapshot } from '../../shared/schemas/result'
import type {
  FacultyResult,
  ResultSnapshot,
  ResultSnapshotCore,
} from '../../shared/types/result'
import { makeResultSnapshot } from '../fixtures/result'
import {
  provisionLocalRosterStudent,
  type LocalRosterStudentFixture,
} from './support/local-roster-student-fixture'
import { registerAndLoginStudent, uniqueAssessmentPhone } from './support/student'

type LocalRuntime = {
  apiUrl: string
  databaseContainer: string
  secretKey: string
}

type TestFaculty = {
  id: number
  name: string
  title: string
}

type FixtureCleanup = {
  adminUserId: string | null
  facultyIds: number[]
  prospectId: number | null
}

const readLocalRuntime = (): LocalRuntime => {
  const status = JSON.parse(execFileSync(
    'pnpm',
    ['exec', 'supabase', 'status', '--output', 'json'],
    { encoding: 'utf8' },
  )) as {
    API_URL?: unknown
    SECRET_KEY?: unknown
    SERVICE_ROLE_KEY?: unknown
  }
  const apiUrl = status.API_URL
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
  if (typeof apiUrl !== 'string' || typeof secretKey !== 'string') {
    throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')
  }
  const hostname = new URL(apiUrl).hostname
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')
  }
  const projectId = readFileSync('supabase/config.toml', 'utf8')
    .match(/^project_id = "([a-z0-9-]+)"$/mu)?.[1]
  if (!projectId) throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')
  const databaseContainer = `supabase_db_${projectId}`
  const running = execFileSync(
    'docker',
    ['inspect', '--format={{.State.Running}}', databaseContainer],
    { encoding: 'utf8' },
  ).trim()
  if (running !== 'true') throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')
  return { apiUrl, databaseContainer, secretKey }
}

const serviceClient = (): SupabaseClient => {
  const runtime = readLocalRuntime()
  return createClient(runtime.apiUrl, runtime.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
}

const runLocalSql = (sql: string, variables: Record<string, string> = {}): string => {
  const { databaseContainer } = readLocalRuntime()
  const variableArguments = Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`])
  return execFileSync(
    'docker',
    [
      'exec', '-i', databaseContainer,
      'psql', '-X', '-v', 'ON_ERROR_STOP=1', ...variableArguments,
      '-U', 'postgres', '-d', 'postgres', '-Atq',
    ],
    { encoding: 'utf8', input: sql },
  ).trim()
}

const facultySnapshot = (
  base: FacultyResult,
  faculty: TestFaculty,
): FacultyResult => ({
  ...base,
  id: faculty.id,
  name: faculty.name,
  title: faculty.title,
  publicContacts: {},
})

const resultSnapshot = (
  primary: TestFaculty,
  backup: TestFaculty,
  specialist: TestFaculty,
): ResultSnapshot => {
  const base = makeResultSnapshot()
  const { careerNarrative: _ignored, ...baseCore } = base
  const core: ResultSnapshotCore = {
    ...baseCore,
    completedAt: new Date().toISOString(),
    faculty: {
      primary: { ...facultySnapshot(base.faculty.primary, primary), role: 'primary' },
      backup: { ...facultySnapshot(base.faculty.backup, backup), role: 'backup' },
      specialists: [{ ...facultySnapshot(base.faculty.specialists[0]!, specialist), role: 'specialist' }],
    },
  }
  const brief = buildCareerNarrativeBrief(core)
  return decodeResultSnapshot({
    ...core,
    careerNarrative: renderCareerNarrative(
      brief,
      buildDeterministicCareerNarrativeChoice(brief),
      'deterministic',
    ),
  })
}

const createFaculty = async (
  suffix: string,
): Promise<[TestFaculty, TestFaculty, TestFaculty]> => {
  const output = runLocalSql(String.raw`
with inserted as (
  insert into public.faculty (
    name, title, employment_type, consultation_role, contact_visibility,
    expertise_summary, bio, profile_sections, status, weekly_capacity,
    priority, source_date, last_verified_at
  ) values
    (
      'E2E 총괄 ' || :'suffix', '교수', 'full_time', 'primary',
      '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}'::jsonb,
      '현대예술·예술사진·영상·AI·기술적 이미지', '로컬 상담 수직 검증용 총괄 교수입니다.', '{}'::jsonb,
      'active', 4, 32000, '2026-07-14'::date, clock_timestamp()
    ),
    (
      'E2E 예비 ' || :'suffix', '교수', 'full_time', 'primary',
      '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}'::jsonb,
      '다큐멘터리·기록사진', '로컬 상담 수직 검증용 예비 교수입니다.', '{}'::jsonb,
      'draft', 0, 0, '2026-07-14'::date, clock_timestamp()
    ),
    (
      'E2E 전문 ' || :'suffix', '겸임교수', 'adjunct', 'specialist',
      '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}'::jsonb,
      '광고사진·브랜드 이미지', '로컬 상담 수직 검증용 전문 교수입니다.', '{}'::jsonb,
      'draft', 0, 0, '2026-07-14'::date, clock_timestamp()
    )
  returning id, name, title
)
select id || E'\t' || name || E'\t' || title
from inserted
order by id;
`, { suffix })
  const faculty = output.split('\n').map((line) => {
    const [id, name, title] = line.split('\t')
    return { id: Number(id), name: name ?? '', title: title ?? '' }
  })
  if (faculty.length !== 3 || faculty.some(member => !Number.isSafeInteger(member.id) || !member.name || !member.title)) {
    throw new Error('COUNSELING_E2E_FACULTY_FIXTURE_FAILED')
  }
  return faculty as [TestFaculty, TestFaculty, TestFaculty]
}

const createOwnedResult = async (
  client: SupabaseClient,
  prospectId: number,
  faculty: [TestFaculty, TestFaculty, TestFaculty],
): Promise<string> => {
  const snapshot = resultSnapshot(...faculty)
  const responses = snapshot.selectedInterests.map(interest => ({
    free_text: null,
    option_key: interest.key,
    option_label_snapshot: interest.label,
    question_group: interest.group,
    weight_snapshot: { art_photo: 0, commercial: 3, documentary: 0, video: 0 },
  }))
  const { data: assessments, error: assessmentError } = await client.rpc('complete_assessment', {
    p_campaign_id: null,
    p_environment_score: snapshot.environmentScore,
    p_idempotency_key: randomUUID(),
    p_prospect_id: prospectId,
    p_responses: responses,
    p_result_snapshot: snapshot,
    p_track_scores: snapshot.trackScores,
  })
  const assessment = Array.isArray(assessments) ? assessments[0] : null
  if (assessmentError || typeof assessment?.public_id !== 'string' || assessment.created !== true) {
    throw new Error('COUNSELING_E2E_RESULT_FIXTURE_FAILED')
  }
  return assessment.public_id
}

const createAdmin = async (
  client: SupabaseClient,
): Promise<{ email: string, password: string, userId: string }> => {
  const email = `counseling-${randomUUID()}@example.test`
  const password = `Pn!${randomBytes(18).toString('base64url')}`
  const { data, error } = await client.auth.admin.createUser({ email, email_confirm: true, password })
  if (
    error
    || !data.user
    || typeof data.user.email_confirmed_at !== 'string'
    || data.user.app_metadata.provider !== 'email'
  ) throw new Error('COUNSELING_E2E_ADMIN_AUTH_FIXTURE_FAILED')
  try {
    const { error: allowError } = await client.from('admin_users').insert({ id: data.user.id })
    if (allowError) throw new Error('COUNSELING_E2E_ADMIN_ALLOWLIST_FIXTURE_FAILED')
    return { email, password, userId: data.user.id }
  }
  catch (fixtureError) {
    await client.from('admin_users').delete().eq('id', data.user.id)
    await client.auth.admin.deleteUser(data.user.id)
    throw fixtureError
  }
}

const loginAdminWithPassword = async (
  page: Page,
  credentials: { email: string, password: string },
): Promise<void> => {
  await page.goto('/admin/login?redirect=/admin/counseling')
  const passwordButton = page.getByRole('button', { name: '관리자 로그인' })
  await expect(passwordButton).toBeEnabled()
  await page.getByLabel('이메일').fill(credentials.email)
  await page.getByLabel('비밀번호').fill(credentials.password)
  const passwordResponsePromise = page.waitForResponse(response => (
    response.url().includes('/auth/v1/token') && response.request().method() === 'POST'
  ))
  const sessionResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/admin/session'
  ))
  await passwordButton.click()
  const passwordResponse = await passwordResponsePromise
  expect(passwordResponse.status()).toBe(200)
  expect((await sessionResponsePromise).ok()).toBe(true)
  await expect(page).toHaveURL('/admin/counseling')
}

const cleanup = async (client: SupabaseClient, fixture: FixtureCleanup): Promise<void> => {
  let failed = false
  if (fixture.prospectId !== null) {
    const { error: eventError } = await client.from('events').delete().eq('prospect_id', fixture.prospectId)
    const { error: prospectError } = await client.from('prospects').delete().eq('id', fixture.prospectId)
    failed = eventError !== null || prospectError !== null
  }
  if (fixture.adminUserId !== null) {
    const { error: auditError } = await client.from('audit_events').delete().eq('admin_user_id', fixture.adminUserId)
    const { error: adminError } = await client.auth.admin.deleteUser(fixture.adminUserId)
    failed = failed || auditError !== null || adminError !== null
  }
  if (fixture.facultyIds.length > 0) {
    try {
      runLocalSql(`delete from public.faculty where id = any (array[${fixture.facultyIds.join(',')}]::bigint[]);`)
    }
    catch {
      failed = true
    }
  }
  if (failed) throw new Error('COUNSELING_E2E_FIXTURE_CLEANUP_FAILED')
}

test.use({ screenshot: 'off', trace: 'off', video: 'off' })
test.describe.configure({ mode: 'serial' })

test('student request becomes a completed assigned counseling case', async ({ browser, page }, testInfo) => {
  test.setTimeout(120_000)
  const client = serviceClient()
  const fixture: FixtureCleanup = { adminUserId: null, facultyIds: [], prospectId: null }
  let localRosterFixture: LocalRosterStudentFixture | null = null

  try {
    const phone = uniqueAssessmentPhone(testInfo)
    localRosterFixture = provisionLocalRosterStudent(phone)
    fixture.prospectId = localRosterFixture.prospectId
    const { nickname } = await registerAndLoginStudent(page, phone, undefined, {
      nickname: localRosterFixture.nickname,
      password: localRosterFixture.password,
      phone,
    })
    const suffix = randomUUID().slice(0, 8)
    const faculty = await createFaculty(suffix)
    fixture.facultyIds = faculty.map(member => member.id)
    const resultPublicId = await createOwnedResult(client, fixture.prospectId, faculty)

    await page.goto(`/result/${resultPublicId}`)
    await expect(page.getByRole('heading', { level: 1, name: '선택한 관심사는 4년 동안 이렇게 이어집니다' })).toBeVisible()
    await page.getByRole('link', { name: '상담 신청하기' }).click()
    await expect(page).toHaveURL(new RegExp(`/counseling\\?assessmentPublicId=${resultPublicId}$`, 'u'))
    await page.getByRole('radio', { name: '문자', exact: true }).check()
    await page.getByRole('radio', { name: '평일 저녁', exact: true }).check()
    await page.getByLabel('문의 내용 선택').fill('예술사진과 영상 제작 경로를 상담하고 싶어요.')
    await page.getByRole('checkbox', { name: /진단 결과를 담당 교수에게 전달/u }).check()
    const requestResponsePromise = page.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/counseling' && response.request().method() === 'POST'
    ))
    await page.getByRole('button', { name: '상담 신청하기' }).click()
    expect((await requestResponsePromise).ok()).toBe(true)
    await expect(page.getByRole('heading', { level: 1, name: '상담 진행 상태' })).toBeVisible()
    await expect(page.getByText('추천 총괄교수', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: `${faculty[0].name} ${faculty[0].title}` })).toBeVisible()

    const adminCredentials = await createAdmin(client)
    fixture.adminUserId = adminCredentials.userId
    const adminContext = await browser.newContext()
    const admin = await adminContext.newPage()
    try {
      await loginAdminWithPassword(admin, adminCredentials)
      const card = admin.locator('article.counseling-record').filter({
        has: admin.getByRole('heading', { name: nickname, exact: true }),
      })
      await expect(card).toHaveCount(1)
      await expect(card.locator('.counseling-record__state')).toContainText('신규 접수')
      await expect(card.locator('.counseling-record__state')).toContainText('v0')
      await expect(card.getByLabel('학생 연락 정보')).toContainText(`010-****-${phone.slice(-4)}`)
      await expect(card).not.toContainText(phone)
      await expect(card).not.toContainText(phone.replace(/^(\d{3})(\d{4})(\d{4})$/u, '$1-$2-$3'))
      await expect(card.getByRole('button', { name: '연락 완료' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: '상담 완료' })).toHaveCount(0)

      await card.getByLabel('담당 교수 배정').selectOption({ label: `${faculty[0].name} ${faculty[0].title}` })
      const assignResponsePromise = admin.waitForResponse(response => (
        new URL(response.url()).pathname.endsWith('/assign')
      ))
      await card.getByRole('button', { name: '배정 확정' }).click()
      expect((await assignResponsePromise).ok()).toBe(true)
      await expect(card.locator('.counseling-record__state')).toContainText('배정 완료')
      await expect(card.locator('.counseling-record__state')).toContainText('v1')
      await expect(card.getByRole('button', { name: '연락 완료' })).toBeVisible()
      await expect(card.getByRole('button', { name: '상담 완료' })).toHaveCount(0)

      const contactResponsePromise = admin.waitForResponse(response => (
        new URL(response.url()).pathname.endsWith('/transition')
      ))
      await card.getByRole('button', { name: '연락 완료' }).click()
      expect((await contactResponsePromise).ok()).toBe(true)
      await expect(card.locator('.counseling-record__state')).toContainText('연락 완료')
      await expect(card.locator('.counseling-record__state')).toContainText('v2')
      await expect(card.getByRole('button', { name: '연락 완료' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: '상담 완료' })).toBeVisible()

      const completeResponsePromise = admin.waitForResponse(response => (
        new URL(response.url()).pathname.endsWith('/transition')
      ))
      await card.getByRole('button', { name: '상담 완료' }).click()
      expect((await completeResponsePromise).ok()).toBe(true)
      await expect(card.locator('.counseling-record__state')).toContainText('상담 완료')
      await expect(card.locator('.counseling-record__state')).toContainText('v3')
      await expect(card.getByRole('button', { name: '연락 완료' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: '상담 완료' })).toHaveCount(0)
    }
    finally {
      await adminContext.close()
    }

    await page.reload()
    const priorStatus = page.getByTestId('prior-counseling')
    await priorStatus.getByText('이전 상담 상태 보기', { exact: true }).click()
    const completedStage = priorStatus.locator('[data-counseling-stage][aria-current="step"]')
    await expect(completedStage).toBeVisible()
    await expect(completedStage).toContainText('상담 완료')
    await expect(priorStatus.getByText('담당 교수', { exact: true })).toBeVisible()
    await expect(priorStatus.getByRole('heading', { name: `${faculty[0].name} ${faculty[0].title}` })).toBeVisible()
  }
  finally {
    try {
      await cleanup(client, fixture)
    }
    finally {
      localRosterFixture?.cleanup()
    }
  }
})

test('failed PIN login after roster provisioning removes the student fixture and session', async ({ page }, testInfo) => {
  const client = serviceClient()
  const fixture: FixtureCleanup = { adminUserId: null, facultyIds: [], prospectId: null }
  let localRosterFixture: LocalRosterStudentFixture | null = null

  try {
    const phone = uniqueAssessmentPhone(testInfo)
    localRosterFixture = provisionLocalRosterStudent(phone)
    fixture.prospectId = localRosterFixture.prospectId
    const wrongPassword = localRosterFixture.password === '0000AA' ? '9999AA' : '0000AA'

    await expect(registerAndLoginStudent(
      page,
      phone,
      undefined,
      {
        nickname: localRosterFixture.nickname,
        password: wrongPassword,
        phone,
      },
    )).rejects.toThrow()
  }
  finally {
    try {
      await cleanup(client, fixture)
    }
    finally {
      localRosterFixture?.cleanup()
    }
  }

  expect(fixture.prospectId).not.toBeNull()
  const prospectId = fixture.prospectId!
  const { data: prospects, error: prospectError } = await client.from('prospects')
    .select('id')
    .eq('id', prospectId)
  const { data: sessions, error: sessionError } = await client.from('student_sessions')
    .select('id')
    .eq('prospect_id', prospectId)
  expect(prospectError).toBeNull()
  expect(sessionError).toBeNull()
  expect(prospects).toEqual([])
  expect(sessions).toEqual([])
})
