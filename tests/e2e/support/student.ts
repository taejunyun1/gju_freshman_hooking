import { expect, type Page } from '@playwright/test'
export { uniqueAssessmentPhone } from './phone'

type RegisteredStudent = {
  nickname: string
}

export const registerAndLoginStudent = async (
  page: Page,
  phone: string,
): Promise<RegisteredStudent> => {
  await page.goto('/start')
  await page.getByLabel('휴대전화 번호').fill(phone)
  await page.getByLabel('학교명').fill('광주고등학교')
  await page.getByLabel('현재 상태').selectOption('high3')
  await page.getByLabel('지역').selectOption('gwangju')

  const registerResponsePromise = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === '/api/student/register'
  })
  await page.getByRole('button', { name: '내 연결 경로 시작하기' }).click()
  expect((await registerResponsePromise).ok()).toBe(true)

  await expect(page).toHaveURL('/credentials')
  const nickname = await page.getByTestId('nickname').textContent()
  const initialPassword = await page.getByTestId('initial-password').textContent()
  expect(nickname).toBeTruthy()
  expect(initialPassword).toBeTruthy()

  await page.getByRole('link', { name: '로그인하러 가기' }).click()
  await page.getByLabel('휴대전화 번호').fill(phone)
  await page.getByLabel('임시 비밀번호').fill(initialPassword!)

  const loginResponsePromise = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === '/api/student/login'
  })
  await page.getByRole('button', { name: '내 경로 이어 보기' }).click()
  expect((await loginResponsePromise).ok()).toBe(true)

  await expect(page).toHaveURL('/assessment')
  await expect(page.getByText(`${nickname}님`, { exact: true })).toBeVisible()
  return { nickname: nickname! }
}
