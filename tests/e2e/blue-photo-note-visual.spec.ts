import { expect, test, type Page } from '@playwright/test'

const assertVisualContract = async (page: Page) => {
  const heading = page.locator('h1').first()
  if (await heading.count()) {
    expect(Number.parseFloat(await heading.evaluate(node => getComputedStyle(node).fontSize))).toBeLessThanOrEqual(32)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 248, 255)')
}

for (const path of ['/', '/login', '/admin/login']) {
  test(`${path} keeps the Blue Photo Note contract on desktop and mobile`, async ({ page }) => {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 900 }]) {
      await page.setViewportSize(viewport)
      await page.goto(path)
      await assertVisualContract(page)
    }
  })
}

test('the administrator roster keeps the contract on desktop and mobile', async ({ page }) => {
  await page.route('**/api/admin/admission-cycles', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [], requestId: 'visual-cycles' }),
  }))
  await page.goto('/admin/login')
  await page.evaluate(() => sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
    accessToken: 'visual-session',
    authenticatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    userId: '00000000-0000-4000-8000-000000000001',
  })))
  for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 900 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/admin/students/roster')
    await assertVisualContract(page)
    expect(Number.parseFloat(await page.locator('.roster-page__start').evaluate(node => getComputedStyle(node).borderRadius))).toBeGreaterThanOrEqual(14)
  }
})
