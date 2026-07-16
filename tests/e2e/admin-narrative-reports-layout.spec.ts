import { expect, test } from '@playwright/test'

const session = JSON.stringify({
  accessToken: 'layout-regression-access-token',
  authenticatedAt: '2026-07-16T01:00:00.000Z',
  expiresAt: '2099-07-16T09:00:00.000Z',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
})

const reports = {
  data: {
    items: [{
      id: 701,
      category: 'unsafe',
      priority: 'urgent',
      createdAt: '2026-07-16T01:30:00.123456Z',
      updatedAt: '2026-07-16T01:30:00.123456Z',
      status: 'open',
      assessmentPublicId: '22222222-2222-4222-8222-222222222222',
      resultPath: '/api/admin/narrative-reports/701/result',
    }],
    nextCursor: null,
  },
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

test('admin report queue follows its available content width at every supported viewport', async ({ page }) => {
  await page.addInitScript((value) => {
    sessionStorage.setItem('photo_next_admin_session_v1', value)
  }, session)
  await page.route('**/api/admin/narrative-reports?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(reports),
  }))

  for (const width of [390, 864, 900, 1024, 1100, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/admin/narrative-reports')
    await page.getByRole('heading', { name: 'AI 문장 신고' }).waitFor()
    await page.locator('[data-report-id="701"]').waitFor()

    const audit = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('.report-card')
      const number = document.querySelector<HTMLElement>('.report-card__number')
      const action = document.querySelector<HTMLElement>('.report-card__action')
      const controls = [...document.querySelectorAll<HTMLElement>('button, select, a')]
        .filter((element) => {
          const style = getComputedStyle(element)
          return style.display !== 'none' && style.visibility !== 'hidden'
        })
        .map((element) => {
          const box = element.getBoundingClientRect()
          return { width: box.width, height: box.height }
        })
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        undersized: controls.filter(control => control.width < 44 || control.height < 44),
        cardColumns: card ? getComputedStyle(card).gridTemplateColumns.split(' ').length : 0,
        numberLeft: number?.getBoundingClientRect().left ?? 0,
        actionLeft: action?.getBoundingClientRect().left ?? 0,
      }
    })

    expect(audit.overflow, `${width}px document overflow`).toBeLessThanOrEqual(0)
    expect(audit.undersized, `${width}px touch targets`).toEqual([])
    if (width === 1440) {
      expect(audit.cardColumns).toBe(5)
      expect(audit.actionLeft).toBeGreaterThan(audit.numberLeft)
    }
    else {
      expect(audit.cardColumns).toBe(1)
    }
  }
})
