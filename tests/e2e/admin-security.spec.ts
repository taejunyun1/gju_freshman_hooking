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

test('administrator login reaches local Supabase Auth for invalid credentials', async ({ page }) => {
  const blockedRequests: string[] = []
  page.on('requestfailed', (request) => {
    if (request.url().includes('/auth/v1/')) blockedRequests.push(request.failure()?.errorText ?? 'failed')
  })
  const documentResponse = await page.goto('/admin/login')
  expect(documentResponse?.headers()['content-security-policy'])
    .toContain("connect-src 'self' http://127.0.0.1:54321")
  await page.getByLabel('이메일').fill('missing-admin@example.test')
  await page.getByLabel('비밀번호').fill('definitely-invalid-password')
  await expect(page.getByRole('button', { name: '비밀번호 확인' })).toBeEnabled()

  const authResponsePromise = page.waitForResponse(response => (
    response.url().includes('/auth/v1/token') && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: '비밀번호 확인' }).click()
  const authResponse = await authResponsePromise

  expect(authResponse.status()).toBeGreaterThanOrEqual(400)
  expect(authResponse.status()).toBeLessThan(500)
  expect(blockedRequests).toEqual([])
  await expect(page.getByRole('alert')).toContainText('관리자 로그인 정보를 확인하세요.')
})

test('administrator recovery hard-load restores a future session before the client guard', async ({ page }) => {
  await page.goto('/admin/login')
  await page.evaluate(() => {
    sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
      accessToken: 'allow-listed-but-not-authorized-by-server',
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      refreshToken: 'must-not-be-restored',
      userId: '00000000-0000-4000-8000-000000000001',
    }))
  })

  await page.goto('/admin/recovery')

  await expect(page).toHaveURL('/admin/recovery')
  await expect(page.getByRole('heading', { name: '복구 대기열' })).toBeVisible()
  await expect(page.getByText('복구 대기열을 불러오지 못했습니다. 세션을 확인한 뒤 다시 시도하세요.')).toBeVisible()
})

test('administrator API authentication failures keep safe 403 bodies and private request headers', async ({ request }) => {
  for (const headers of [{}, { Authorization: 'Bearer invalid-admin-token' }]) {
    const response = await request.get('/api/admin/recovery', { headers })
    const responseHeaders = response.headers()
    const payload = await response.json()

    expect(response.status()).toBe(403)
    expect(responseHeaders['cache-control']).toBe('private, no-store')
    expect(responseHeaders['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    expect(payload).toMatchObject({
      error: true,
      message: 'ADMIN_REQUIRED',
      stack: ['ADMIN_REQUIRED', ''],
      statusCode: 403,
      statusMessage: 'ADMIN_REQUIRED',
    })
    expect(new URL(payload.url).pathname).toBe('/api/admin/recovery')
    expect(JSON.stringify(payload)).not.toMatch(/cause|data|supabase|authorization|server\/middleware|node_modules/iu)
  }

  const health = await request.get('/api/health')
  expect(health.headers()['cache-control']).not.toBe('private, no-store')
})
