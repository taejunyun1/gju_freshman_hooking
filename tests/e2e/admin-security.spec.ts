import { expect, test } from '@playwright/test'

const policyNonce = (policy: string, directive: 'script-src' | 'style-src'): string => {
  const directiveValue = policy.split(';').find(value => value.trim().startsWith(directive)) ?? ''
  const nonce = directiveValue.match(/'nonce-([^']+)'/u)?.[1]
  expect(nonce).toBeTruthy()
  return nonce!
}

test('request nonce protects hydrated scripts and styles', async ({ page }) => {
  const firstResponse = await page.goto('/login')
  expect(firstResponse).not.toBeNull()
  const firstPolicy = firstResponse!.headers()['content-security-policy'] ?? ''
  const firstNonce = policyNonce(firstPolicy, 'script-src')
  expect(policyNonce(firstPolicy, 'style-src')).toBe(firstNonce)
  expect(firstPolicy).toContain("script-src-attr 'none'")
  expect(firstPolicy).toContain("style-src-attr 'none'")
  expect(firstPolicy).not.toContain("'unsafe-inline'")

  const firstHtml = await firstResponse!.text()
  const executableTags = firstHtml.match(/<(?:script|style)(?=[\s>])(?:"[^"]*"|'[^']*'|[^'"<>])*>/giu) ?? []
  expect(executableTags.length).toBeGreaterThan(0)
  expect(executableTags.every(tag => tag.includes(`nonce="${firstNonce}"`))).toBe(true)
  expect(firstHtml).toContain(`<meta property="csp-nonce" nonce="${firstNonce}">`)

  await expect(page.locator('fieldset')).toBeEnabled()
  await expect(page.getByRole('heading', { name: /이어 보던 경로로/u })).toBeVisible()
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe('rgb(238, 241, 246)')
  const hydratedExecutableNonceStates = await page.evaluate(expectedNonce => (
    Array.from(document.querySelectorAll('script:not([src]), style')).map(element => ({
      matches: (element as HTMLElement).nonce === expectedNonce,
      tag: element.tagName.toLowerCase(),
    }))
  ), firstNonce)
  expect(hydratedExecutableNonceStates.length).toBeGreaterThan(0)
  expect(hydratedExecutableNonceStates.filter(state => !state.matches)).toEqual([])

  const nonceLessScriptResult = await page.evaluate(async () => {
    Reflect.deleteProperty(window, '__photoNextNonceLessProbe')
    const script = document.createElement('script')
    script.textContent = 'window.__photoNextNonceLessProbe = "executed"'
    document.body.append(script)
    await new Promise(resolve => setTimeout(resolve, 50))
    return Reflect.get(window, '__photoNextNonceLessProbe')
  })
  expect(nonceLessScriptResult).toBeUndefined()

  const secondResponse = await page.request.get('/login')
  const secondPolicy = secondResponse.headers()['content-security-policy'] ?? ''
  const secondNonce = policyNonce(secondPolicy, 'script-src')
  expect(policyNonce(secondPolicy, 'style-src')).toBe(secondNonce)
  expect(secondNonce).not.toBe(firstNonce)
})

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
