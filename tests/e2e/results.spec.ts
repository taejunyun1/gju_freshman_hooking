import { expect, test, type Page } from '@playwright/test'
import {
  expectedCommercialMatchingFixtureSummary,
  installCommercialMatchingFixture,
} from './support/commercial-matching-fixture'
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
  expect(installCommercialMatchingFixture())
    .toEqual(expectedCommercialMatchingFixtureSummary)
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
