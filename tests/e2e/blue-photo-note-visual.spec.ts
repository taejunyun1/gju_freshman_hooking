import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  expectedCommercialMatchingFixtureSummary,
  installCommercialMatchingFixture,
} from './support/commercial-matching-fixture'
import { provisionLocalRosterStudent } from './support/local-roster-student-fixture'
import { registerAndLoginStudent, uniqueAssessmentPhone } from './support/student'

const desktop = { width: 1280, height: 900 }
const mobile = { width: 320, height: 900 }

const assertVisualContract = async (page: Page) => {
  const heading = page.locator('h1').first()
  if (await heading.count()) {
    expect(Number.parseFloat(await heading.evaluate(node => getComputedStyle(node).fontSize))).toBeLessThanOrEqual(32)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 248, 255)')
}

const assertRadius = async (surface: Locator) => {
  expect(Number.parseFloat(await surface.evaluate(node => getComputedStyle(node).borderRadius))).toBeGreaterThanOrEqual(14)
}

const assertKeyControl = async (control: Locator) => {
  const box = await control.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}

const assertKeyboardFocusOutline = async (page: Page) => {
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus-visible')
  await expect(focused).toHaveCount(1)
  const outline = await focused.evaluate((node) => {
    const target = node.closest('.option-card') ?? node
    const style = getComputedStyle(target)
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
  })
  expect(outline).toEqual({ style: 'solid', width: 3 })
}

const authorizeAdmin = async (page: Page): Promise<void> => {
  await page.goto('/admin/login')
  await page.evaluate(() => sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
    accessToken: 'route-intercepted-visual-session',
    authenticatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    userId: '00000000-0000-4000-8000-000000000001',
  })))
}

const selectCommercialPath = async (page: Page): Promise<void> => {
  await page.getByRole('group', { name: '무엇을 해보고 싶나요?' })
    .getByRole('checkbox', { name: /제품·패션·광고 이미지 만들기/u }).check()
  await page.getByTestId('assessment-next').click()
  await page.getByRole('group', { name: '어떤 결과물을 만들고 싶나요?' })
    .getByRole('checkbox', { name: /광고·패션 이미지/u }).check()
  await page.getByTestId('assessment-next').click()
  await page.getByRole('group', { name: '어떤 방식으로 작업하고 싶나요?' })
    .getByRole('checkbox', { name: /스튜디오에서 촬영/u }).check()
  await page.getByTestId('assessment-next').click()
  await page.getByRole('group', { name: '어떤 방향을 탐색하고 싶나요?' })
    .getByRole('checkbox', { name: /사진을 직접 촬영하고 보정해/u }).check()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  expect(installCommercialMatchingFixture()).toEqual(expectedCommercialMatchingFixtureSummary)
})

for (const path of ['/', '/login', '/admin/login']) {
  test(`${path} keeps the Blue Photo Note contract on desktop and mobile`, async ({ page }) => {
    for (const viewport of [desktop, mobile]) {
      await page.setViewportSize(viewport)
      await page.goto(path)
      await assertVisualContract(page)
    }
  })
}

test('a local assessment state and populated result expose the visual and accessibility cues', async ({ page }, testInfo) => {
  await page.setViewportSize(desktop)
  const phone = uniqueAssessmentPhone(testInfo)
  const fixture = provisionLocalRosterStudent(phone)
  try {
    await registerAndLoginStudent(page, phone, undefined, { phone, password: fixture.password })

    const firstChoice = page.getByRole('checkbox', { name: /제품·패션·광고 이미지 만들기/u })
    await firstChoice.check()
    const optionCard = firstChoice.locator('xpath=ancestor::label[contains(@class, "option-card")]')
    await assertVisualContract(page)
    await assertRadius(optionCard)
    await assertKeyControl(page.getByTestId('assessment-next'))
    await assertKeyboardFocusOutline(page)
    await expect(optionCard).toContainText('선택됨')
    await expect(optionCard).toHaveClass(/option-card--selected/u)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await optionCard.evaluate(node => Number.parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThanOrEqual(0.01)
    expect(await optionCard.evaluate(node => getComputedStyle(node).scrollBehavior)).toBe('auto')

    await selectCommercialPath(page)
    const submitResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assessment/submit')
    await page.getByTestId('assessment-submit').click()
    expect((await submitResponse).ok()).toBe(true)
    await expect(page).toHaveURL(/\/result\/[0-9a-f-]{36}$/u)
    await expect(page.getByRole('heading', { level: 1, name: '선택한 관심사는 4년 동안 이렇게 이어집니다' })).toBeVisible()
    await assertVisualContract(page)
    await assertRadius(page.locator('[data-result-section="summary"]'))
    await assertKeyControl(page.getByRole('link', { name: '최근 편집본' }))

    await page.setViewportSize(mobile)
    await assertVisualContract(page)

    await page.route('**/api/assessment/options', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'VISUAL_LOCAL_FAILURE' } }),
    }))
    await page.goto('/assessment')
    await expect(page.getByText('LOAD / INTERRUPTED', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('선택지를 불러오지 못했습니다')
  }
  finally {
    fixture.cleanup()
  }
})

test('the route-intercepted administrator students surface keeps visual contracts without external data', async ({ page }) => {
  await page.route('**/api/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET' && path === '/api/admin/students') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            items: [{
              id: 1,
              nickname: '시각 점검 지원자',
              phone: '010-****-1234',
              schoolName: '광주고등학교',
              applicantStage: 'high3',
              region: 'gwangju',
              status: 'active',
              cycleId: '11111111-1111-4111-8111-111111111111',
              isTest: true,
              passwordGeneration: 1,
              lastActiveAt: '2026-07-18T00:00:00+09:00',
              createdAt: '2026-07-18T00:00:00+09:00',
            }],
            nextCursor: null,
          },
          requestId: 'visual-admin-students',
        }),
      })
    }
    return route.abort('blockedbyclient')
  })

  await authorizeAdmin(page)
  for (const viewport of [desktop, mobile]) {
    await page.setViewportSize(viewport)
    await page.goto('/admin/students')
    await expect(page.getByRole('heading', { name: '학생 찾기' })).toBeVisible()
    await expect(viewport.width === desktop.width
      ? page.locator('.student-data__desktop').getByText('시각 점검 지원자', { exact: true })
      : page.locator('.student-data__mobile h2', { hasText: '시각 점검 지원자' }))
      .toBeVisible()
    await assertVisualContract(page)
    await assertRadius(viewport.width === desktop.width
      ? page.locator('.student-data__desktop')
      : page.locator('.student-data__mobile article'))
    await assertKeyControl(page.getByRole('button', { name: '학생 개별 등록' }))
  }
})
