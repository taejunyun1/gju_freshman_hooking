import { expect, test, type Page } from '@playwright/test'

import type { AdminCampaign, AdminCampaignStored } from '../../shared/schemas/admin'

const createdAt = '2026-07-15T01:00:00.123456Z'
const updatedAt = '2026-07-16T01:00:00.654321Z'
const pendingMetrics: AdminCampaign['metrics'] = {
  version: 's6-daily-metrics-v1',
  availability: 'pending',
  visits: null,
  assessmentCompletions: null,
  counselingConversions: null,
}
const stored: AdminCampaignStored = {
  id: 7,
  code: 'open-day-2026',
  name: '2026 오픈데이',
  channel: 'qr',
  status: 'active',
  startsAt: null,
  endsAt: null,
  sentCount: 120,
  createdAt,
  updatedAt,
}

const authorize = async (page: Page): Promise<void> => {
  await page.goto('/admin/login')
  await page.evaluate(() => {
    sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
      accessToken: 'route-intercepted-admin-session',
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      userId: '00000000-0000-4000-8000-000000000001',
    }))
  })
}
const noDocumentOverflow = async (page: Page): Promise<boolean> => page.evaluate(() => (
  document.documentElement.scrollWidth <= document.documentElement.clientWidth
))

test('campaign ledger is responsive, truthful, keyboard-operable, and reduced-motion safe', async ({ context, page }) => {
  let campaigns: AdminCampaign[] = [{ ...stored, metrics: pendingMetrics }]
  await page.route('**/api/admin/campaigns**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/admin/campaigns') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { items: campaigns, nextCursor: null }, requestId: 'campaign-list-e2e' }),
      })
      return
    }
    if (request.method() === 'POST' && path === '/api/admin/campaigns') {
      const body = request.postDataJSON() as { code: string, name: string, channel: AdminCampaign['channel'], status: 'draft' | 'active', sentCount: number }
      const created: AdminCampaignStored = {
        id: 8,
        code: body.code.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, ''),
        name: body.name,
        channel: body.channel,
        status: body.status,
        startsAt: null,
        endsAt: null,
        sentCount: body.sentCount,
        createdAt: '2026-07-16T02:00:00.000001Z',
        updatedAt: '2026-07-16T02:00:00.000001Z',
      }
      campaigns = [{ ...created, metrics: pendingMetrics }, ...campaigns]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { campaign: created }, requestId: 'campaign-create-e2e' }),
      })
      return
    }
    if (request.method() === 'POST' && path === '/api/admin/campaigns/7/archive') {
      const archived: AdminCampaignStored = { ...stored, status: 'archived', updatedAt: '2026-07-16T03:00:00.000001Z' }
      campaigns = campaigns.map(campaign => campaign.id === 7 ? { ...archived, metrics: pendingMetrics } : campaign)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { campaign: archived }, requestId: 'campaign-archive-e2e' }),
      })
      return
    }
    await route.abort('blockedbyclient')
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:3000' })
  await authorize(page)

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/admin/campaigns')
    await expect(page.getByRole('heading', { name: '캠페인 운영', exact: true })).toBeVisible()
    await expect(page.locator('.campaigns-page__table-wrap')).toBeHidden()
    await expect(page.locator('.campaigns-page__cards')).toBeVisible()
    const card = page.locator('[data-campaign-card]').first()
    await expect(card).toBeVisible()
    expect(await card.locator('[data-card-section]').evaluateAll(sections => sections.map(section => section.getAttribute('data-card-section'))))
      .toEqual(['identity', 'url', 'attribution', 'lifecycle'])
    const mobileFrames = card.locator('[data-attribution-frame]')
    await expect(mobileFrames).toHaveCount(4)
    const mobileGeometry = await mobileFrames.evaluateAll(frames => frames.map((frame) => {
      const box = frame.getBoundingClientRect()
      return { left: box.left, top: box.top, width: box.width }
    }))
    expect(new Set(mobileGeometry.map(frame => Math.round(frame.top))).size).toBe(1)
    expect(mobileGeometry.every((frame, index) => frame.width > 0 && (index === 0 || frame.left > mobileGeometry[index - 1]!.left))).toBe(true)
    await expect(card.getByText('집계 준비 중').first()).toBeVisible()
    expect(await noDocumentOverflow(page)).toBe(true)
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/admin/campaigns')
  await expect(page.locator('.campaigns-page__table-wrap')).toBeVisible()
  await expect(page.getByRole('table', { name: '캠페인 운영 목록' })).toBeVisible()
  await expect(page.locator('.campaigns-page__cards')).toBeHidden()
  const desktopFrames = page.getByRole('table', { name: '캠페인 운영 목록' }).locator('[data-attribution-frame]')
  await expect(desktopFrames).toHaveCount(4)
  const desktopGeometry = await desktopFrames.evaluateAll(frames => frames.map((frame) => {
    const box = frame.getBoundingClientRect()
    return { left: box.left, top: box.top, width: box.width }
  }))
  expect(new Set(desktopGeometry.map(frame => Math.round(frame.top))).size).toBe(1)
  expect(Math.max(...desktopGeometry.map(frame => frame.width)) - Math.min(...desktopGeometry.map(frame => frame.width))).toBeLessThan(2)
  expect(await noDocumentOverflow(page)).toBe(true)

  await page.getByLabel('캠페인 이름').fill('여름 오픈데이')
  await page.getByLabel('링크 코드').fill('SUMMER OPEN DAY')
  await page.locator('select[name="channel"]').selectOption('social')
  await page.locator('select[name="status"]').selectOption('active')
  await page.getByLabel('발송 수').fill('25')
  const createButton = page.getByRole('button', { name: '캠페인 링크 만들기' })
  await createButton.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-live="mutation"]')).toContainText('summer-open-day')
  await expect(page.getByRole('table', { name: '캠페인 운영 목록' }).getByText('여름 오픈데이')).toBeVisible()

  const originalRow = page.getByRole('row').filter({ hasText: '2026 오픈데이' })
  const copyButton = originalRow.getByRole('button', { name: '링크 복사' })
  await copyButton.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-live="copy"]')).toContainText('복사했습니다')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:3000/api/campaign/open-day-2026')

  const archiveTrigger = originalRow.getByRole('button', { name: '보관', exact: true })
  await archiveTrigger.focus()
  await page.keyboard.press('Enter')
  const confirm = originalRow.getByRole('button', { name: '보관 확인' })
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(archiveTrigger).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(originalRow.getByRole('button', { name: '보관됨' })).toBeFocused()
  await expect(page.locator('[data-live="mutation"]')).toContainText('기존 기여 기록은 유지됩니다')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedDurations = await page.locator('[data-attribution-frame]').first().evaluate(element => ({
    animation: getComputedStyle(element).animationDuration,
    transition: getComputedStyle(element).transitionDuration,
  }))
  expect(['0s', '0.00001s', '1e-05s', '0.01ms']).toContain(reducedDurations.transition)
  expect(['0s', '0.00001s', '1e-05s', '0.01ms']).toContain(reducedDurations.animation)
})
