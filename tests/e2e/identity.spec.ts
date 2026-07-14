import { expect, test } from '@playwright/test'

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

test('new student can register, log in, and log out', async ({ page }) => {
  const phone = '01070000017'

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
  await page.getByRole('button', { name: '로그아웃' }).click()

  await expect(page).toHaveURL('/login')
  const deniedSession = await page.request.get('/api/student/session')
  expect(deniedSession.status()).toBe(401)
})
