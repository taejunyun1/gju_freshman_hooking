import { expect, test } from '@playwright/test'

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

test('new student can register, log in, and log out', async ({ page }) => {
  const phone = '01070000017'

  const rejectedCrossOriginRegistration = await page.request.post('/api/student/register', {
    data: {
      applicantStage: 'high3',
      phone,
      region: 'gwangju',
      schoolName: '광주고등학교',
    },
    headers: { Origin: 'https://cross-origin.example' },
  })
  expect(rejectedCrossOriginRegistration.status()).toBe(403)

  await page.goto('/start')
  await page.getByLabel('휴대전화 번호').fill(phone)
  await page.getByLabel('학교명').fill('광주고등학교')
  await page.getByLabel('현재 상태').selectOption('high3')
  await page.getByLabel('지역').selectOption('gwangju')
  const registerResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/student/register')
  await page.getByRole('button', { name: '내 연결 경로 시작하기' }).click()
  const registerResponse = await registerResponsePromise
  expect(registerResponse.ok()).toBe(true)

  await expect(page).toHaveURL('/credentials')
  expect(new URL(page.url()).search).toBe('')
  const nickname = await page.getByTestId('nickname').textContent()
  const password = await page.getByTestId('initial-password').textContent()
  expect(nickname).toBeTruthy()
  expect(password).toBeTruthy()

  await page.getByRole('link', { name: '로그인하러 가기' }).click()
  await page.getByLabel('휴대전화 번호').fill(phone)
  await page.getByLabel('임시 비밀번호').fill(password!)
  await page.getByRole('button', { name: '내 경로 이어 보기' }).click()

  await expect(page).toHaveURL('/assessment')
  expect(new URL(page.url()).search).toBe('')
  await expect(page.getByText(`${nickname}님`)).toBeVisible()

  const sessionPayload = await page.evaluate(async () => {
    const response = await fetch('/api/student/session')
    if (!response.ok) throw new Error('SESSION_BOOTSTRAP_FAILED')
    return response.json() as Promise<{ data: { csrfToken: string } }>
  })
  const csrfToken = sessionPayload.data.csrfToken
  expect(csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  expect(await page.evaluate(token => ({
    local: Object.values(localStorage).some(value => value.includes(token)),
    session: Object.values(sessionStorage).some(value => value.includes(token)),
  }), csrfToken)).toEqual({ local: false, session: false })

  const missingOriginLogout = await page.request.post('/api/student/logout', {
    headers: { 'x-photo-next-csrf': csrfToken },
  })
  expect(missingOriginLogout.status()).toBe(403)
  const wrongCsrfLogout = await page.request.post('/api/student/logout', {
    headers: { Origin: 'http://127.0.0.1:3000', 'x-photo-next-csrf': 'A'.repeat(43) },
  })
  expect(wrongCsrfLogout.status()).toBe(403)
  expect(await page.evaluate(async () => (await fetch('/api/student/session')).ok)).toBe(true)

  await page.goto('/password/reset')
  await expect(page.getByRole('heading', { name: /비밀번호를\s*새로 정하세요/u })).toBeVisible()
  await page.getByLabel('현재 비밀번호').fill(password!)
  await page.getByLabel('새 비밀번호').fill('새비밀번호-88')
  const changeResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/student/password/change')
  await page.getByRole('button', { name: '새 비밀번호 저장하기' }).click()
  expect((await changeResponsePromise).ok()).toBe(true)
  await expect(page.getByRole('status')).toContainText('비밀번호를 변경했습니다.')

  await page.goto('/assessment')
  await expect(page.getByText(`${nickname}님`)).toBeVisible()
  await page.getByRole('button', { name: '로그아웃' }).click()

  await expect(page).toHaveURL('/login')
  expect(await page.evaluate(async () => (await fetch('/api/student/session')).status)).toBe(401)
})

test('anonymous recovery requires same Origin but no session CSRF', async ({ page }) => {
  const data = { nickname: '없는닉네임00', phone: '01079999999', region: 'gwangju' }

  const missingOrigin = await page.request.post('/api/student/password/recovery/request', { data })
  const crossOrigin = await page.request.post('/api/student/password/recovery/request', {
    data,
    headers: { Origin: 'https://cross-origin.example' },
  })
  const sameOrigin = await page.request.post('/api/student/password/recovery/request', {
    data,
    headers: { Origin: 'http://127.0.0.1:3000' },
  })

  expect(missingOrigin.status()).toBe(403)
  expect(crossOrigin.status()).toBe(403)
  expect(sameOrigin.status()).toBe(202)
  expect(await sameOrigin.json()).toEqual({ accepted: true })
})
