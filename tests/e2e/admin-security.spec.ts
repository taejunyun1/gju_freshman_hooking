import { expect, test } from '@playwright/test'

test('administrator login CSP permits a Supabase-style TOTP data image to load', async ({ page }) => {
  const response = await page.goto('/admin/login')
  const csp = response?.headers()['content-security-policy']

  expect(csp).toContain("img-src 'self' data:")
  await expect(page.getByRole('heading', { name: '관리자 접근' })).toBeVisible()
  await expect(page.locator('.admin-shell')).toHaveCount(0)

  const image = await page.evaluate(async () => {
    const source = 'data:image/svg+xml;utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%222%22%20height%3D%222%22%3E%3Crect%20width%3D%222%22%20height%3D%222%22%2F%3E%3C%2Fsvg%3E'
    const element = new Image()
    document.body.append(element)
    const loaded = await new Promise<boolean>((resolve) => {
      element.addEventListener('load', () => resolve(true), { once: true })
      element.addEventListener('error', () => resolve(false), { once: true })
      element.src = source
    })

    return { loaded, naturalHeight: element.naturalHeight, naturalWidth: element.naturalWidth }
  })

  expect(image).toEqual({ loaded: true, naturalHeight: 2, naturalWidth: 2 })
})
