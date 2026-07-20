import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  expectedCommercialMatchingFixtureSummary,
  installCommercialMatchingFixture,
} from './support/commercial-matching-fixture'
import { provisionLocalRosterStudent } from './support/local-roster-student-fixture'
import { registerAndLoginStudent, uniqueAssessmentPhone } from './support/student'

const canonicalResultUrl = /\/result\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const canonicalPublicId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const canonicalResultHref = /^\/result\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const expectedSectionOrder = [
  'summary',
  'interests',
  'scores',
  'learning-path',
  'faculty',
  'career-narrative',
  'outcomes',
  'capability-evidence',
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

const selectVideoTechnologyPath = async (page: Page) => {
  await page.getByRole('group', { name: '무엇을 해보고 싶나요?' })
    .getByRole('checkbox', { name: /카메라로 영상 장면 촬영하기/u })
    .check()
  await page.getByTestId('assessment-next').click()

  await page.getByRole('group', { name: '어떤 결과물을 만들고 싶나요?' })
    .getByRole('checkbox', { name: /영상 촬영·편집 쇼릴/u })
    .check()
  await page.getByTestId('assessment-next').click()

  await page.getByRole('group', { name: '어떤 방식으로 작업하고 싶나요?' })
    .getByRole('checkbox', { name: /컴퓨터로 편집·후반작업/u })
    .check()
  await page.getByTestId('assessment-next').click()

  await page.getByRole('group', { name: '어떤 방향을 탐색하고 싶나요?' })
    .getByRole('checkbox', { name: /영상을 직접 촬영하고 편집해/u })
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

const completeVideoTechnologyAssessment = async (page: Page) => {
  await selectVideoTechnologyPath(page)
  const submitResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/assessment/submit'
  ))
  await page.getByTestId('assessment-submit').click()
  expect((await submitResponsePromise).ok()).toBe(true)
  await expect(page).toHaveURL(canonicalResultUrl)
  await expect(page.getByRole('heading', { level: 1, name: '선택한 관심사는 4년 동안 이렇게 이어집니다' })).toBeVisible()
}

const captureResultVisualQa = async (page: Page, flow: 'commercial' | 'video-technology') => {
  const heading = page.getByRole('heading', { level: 1, name: '선택한 관심사는 4년 동안 이렇게 이어집니다' })
  const exampleCard = page.locator('[data-result-example-kind="portfolio"] [data-result-example]').first()
  const exampleDescription = exampleCard.locator('p')
  const capabilityCard = page.locator('[data-capability-evidence]').first()

  await page.setViewportSize({ width: 1440, height: 1000 })
  expect(Number.parseFloat(await heading.evaluate(node => getComputedStyle(node).fontSize))).toBeLessThanOrEqual(32)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const desktopExampleBox = await exampleCard.boundingBox()
  const desktopCapabilityBox = await capabilityCard.boundingBox()
  expect(desktopExampleBox?.width ?? Number.POSITIVE_INFINITY)
    .toBeLessThan(desktopCapabilityBox?.width ?? 0)
  expect(await page.locator('[data-selection-graphic]').evaluateAll(graphics => (
    graphics.every(graphic => graphic.getAttribute('aria-hidden') === 'true')
  ))).toBe(true)
  expect(await exampleDescription.evaluate((node) => {
    const style = getComputedStyle(node)
    return { overflowWrap: style.overflowWrap, wordBreak: style.wordBreak }
  })).toEqual({ overflowWrap: 'anywhere', wordBreak: 'keep-all' })
  await page.screenshot({
    path: `test-results/task-4-${flow}-1440x1000.png`,
    fullPage: true,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: 390, scrollWidth: 390 })
  const moreCapability = page.getByTestId('capability-more')
  await expect(moreCapability).toBeVisible()
  expect((await moreCapability.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await moreCapability.evaluate(node => Number.parseFloat(getComputedStyle(node).transitionDuration)))
    .toBeLessThanOrEqual(0.01)
  await page.screenshot({
    path: `test-results/task-4-${flow}-390x844.png`,
    fullPage: true,
  })
}

const withLocalStudent = async (
  page: Page,
  testInfo: TestInfo,
  run: () => Promise<void>,
): Promise<void> => {
  const phone = uniqueAssessmentPhone(testInfo)
  const fixture = provisionLocalRosterStudent(phone)
  try {
    await registerAndLoginStudent(page, phone, undefined, { phone, password: fixture.password })
    await run()
  }
  finally {
    fixture.cleanup()
  }
}

test.describe.configure({ mode: 'serial' })

let commercialMatchingFixture: ReturnType<typeof installCommercialMatchingFixture> | undefined

test.beforeAll(() => {
  commercialMatchingFixture = installCommercialMatchingFixture()
  expect(commercialMatchingFixture.summary)
    .toEqual(expectedCommercialMatchingFixtureSummary)
})

test.afterAll(() => {
  commercialMatchingFixture?.cleanup()
})

test('상업사진 관심사가 4년 경로, 제작 근거, 교수 연결로 이어진다', async ({ page }, testInfo) => withLocalStudent(page, testInfo, async () => {
  const browserOriginatedOpenAiRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'api.openai.com') {
      browserOriginatedOpenAiRequests.push(request.url())
    }
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const publicId = await completeCommercialAssessment(page)

  await expect.poll(async () => page.locator('[data-result-section]').evaluateAll(sections => (
    sections.map(section => section.getAttribute('data-result-section'))
  ))).toEqual(expectedSectionOrder)

  const narrative = page.locator('[data-result-section="career-narrative"]')
  await expect(narrative.locator('[data-narrative-slot]')).toHaveCount(4)
  expect(await narrative.locator('[data-narrative-slot]').evaluateAll(items => (
    items.map(item => item.getAttribute('data-narrative-slot'))
  ))).toEqual([
    'direction',
    'learning_path',
    'career_direction',
    'faculty_connection',
  ])
  await expect(narrative).toContainText('광고사진')
  await expect(narrative).toContainText('실제 교과 운영과 상담 배정은 학과 확인 후 확정됩니다')
  await expect(narrative).toContainText('AI는 진로를 결정하지 않습니다')
  await expect(narrative).not.toContainText(/openai|deterministic|gpt-5\.6/iu)
  const deterministicBox = await narrative.boundingBox()
  expect(deterministicBox).not.toBeNull()

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
  await expect(learningPath.locator('time[datetime^="2026-"]')).not.toHaveCount(0)

  const outcomes = page.locator('[data-result-section="outcomes"]')
  await expect(outcomes).toContainText('이 경로에서 만들어볼 결과물')
  await expect(outcomes).toContainText('관심사 기반 예시')
  await expect(outcomes).toContainText('제품 광고 이미지')
  await expect(outcomes).toContainText('진로')

  const capability = page.locator('[data-result-section="capability-evidence"]')
  expect(await capability.locator('[data-capability-evidence]').evaluateAll(items => (
    items.slice(0, 3).map(item => item.getAttribute('data-capability-kind'))
  ))).toEqual(['facility', 'body', 'lens'])
  const moreCapability = capability.getByTestId('capability-more')
  if (await moreCapability.isVisible()) {
    await moreCapability.click()
  }
  await expect(capability.getByRole('heading', { name: '스튜디오 A(호리존)', exact: true })).toBeVisible()
  await expect(capability.getByRole('heading', { name: '소니 FX3 Body', exact: true })).toBeVisible()
  await expect(capability.getByRole('heading', { name: '소니 FE 28-70mm F3.5-5.6 Lens', exact: true })).toBeVisible()

  const faculty = page.locator('[data-result-section="faculty"]')
  await expect(faculty.getByText('추천 총괄교수', { exact: true })).toBeVisible()
  const specialists = faculty.locator('.faculty-recommendation__group--specialists')
  await expect(specialists.getByRole('heading', { name: '함께 연결되는 실무·창작 강사', exact: true })).toBeVisible()
  await expect(specialists).toContainText('관심사 기반 예시')
  await expect(specialists).toContainText('제품·패션 촬영')
  await expect(specialists.getByRole('heading', { name: '곽동욱 겸임교수', exact: true })).toBeVisible()
  await expect(specialists.locator('[data-faculty-person="6"]')).toHaveClass(/faculty-card--compact/u)
  await expect(faculty.locator('[data-faculty-person="1"]')).not.toHaveClass(/faculty-card--compact/u)
  await expect(specialists).toContainText('광고사진·패션사진·브랜드 이미지')
  await expect(faculty.locator('address.faculty-card__contacts')).toHaveCount(0)
  await expect(faculty.locator('.faculty-card__office')).toHaveCount(0)
  await expect(faculty.locator('a[href^="tel:"]')).toHaveCount(0)
  await expect(faculty.locator('a[href^="mailto:"]')).toHaveCount(0)
  await expect(faculty.getByRole('link', { name: '웹사이트 (새 창)', exact: true })).toHaveCount(0)

  const environmentMeterValue = Number(await page.locator('meter').last().getAttribute('value'))
  expect(environmentMeterValue).toBeGreaterThanOrEqual(90)
  expect(environmentMeterValue).toBeLessThanOrEqual(100)

  const resultEnvelope = await page.evaluate(async (path) => {
    const response = await fetch(path)
    return response.json()
  }, `/api/result/${publicId}`) as {
    data: { careerNarrative: { source: string } }
    requestId: string
  }
  resultEnvelope.data.careerNarrative.source = 'openai'
  await page.route(`**/api/result/${publicId}`, async route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(resultEnvelope),
    status: 200,
  }))
  await page.reload()
  await expect(narrative.locator('[data-narrative-slot]')).toHaveCount(4)
  const openaiBox = await narrative.boundingBox()
  expect(openaiBox).not.toBeNull()
  expect(Math.abs(openaiBox!.width - deterministicBox!.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(openaiBox!.height - deterministicBox!.height)).toBeLessThanOrEqual(1)
  await expect(narrative).not.toContainText(/openai|deterministic|gpt-5\.6/iu)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: 390, scrollWidth: 390 })
  const mobileReportButton = narrative.getByRole('button', { name: '내용 알리기' })
  const mobileButtonBox = await mobileReportButton.boundingBox()
  expect(mobileButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44)
  await captureResultVisualQa(page, 'commercial')
  expect(browserOriginatedOpenAiRequests).toEqual([])
}))

test('영상과 기술 관심사가 후반작업 예시와 컴퓨터실로 이어진다', async ({ page }, testInfo) => withLocalStudent(page, testInfo, async () => {
  await completeVideoTechnologyAssessment(page)

  const interests = page.locator('[data-result-section="interests"]')
  await expect(interests).toContainText('카메라로 영상 장면 촬영하기')
  await expect(interests).toContainText('영상 촬영·편집 쇼릴')
  await expect(interests).toContainText('컴퓨터로 편집·후반작업')

  const faculty = page.locator('[data-result-section="faculty"]')
  await expect(faculty).toContainText('영상편집·색보정')
  await expect(faculty).toContainText('AI 이미지·영상')
  await expect(faculty).toContainText('드론·360 콘텐츠')

  const outcomes = page.locator('[data-result-section="outcomes"]')
  await expect(outcomes).toContainText('촬영·편집 쇼릴')

  const firstFacility = page.locator('[data-result-section="capability-evidence"]')
    .locator('[data-capability-kind="facility"]')
    .first()
  await expect(firstFacility.getByRole('heading')).toHaveText(/컴퓨터실/u)

  const exampleItems = outcomes.locator('.result-example-grid__items')
  await page.setViewportSize({ width: 719, height: 1000 })
  expect(await exampleItems.evaluate(element => (
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/u).length
  ))).toBe(1)
  await page.setViewportSize({ width: 720, height: 1000 })
  expect(await exampleItems.evaluate(element => (
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/u).length
  ))).toBe(3)
  await captureResultVisualQa(page, 'video-technology')
}))

test('같은 학생의 결과 이력은 최신 3개 UUID 링크만 보존한다', async ({ page }, testInfo) => withLocalStudent(page, testInfo, async () => {
  test.setTimeout(90_000)

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
}))
