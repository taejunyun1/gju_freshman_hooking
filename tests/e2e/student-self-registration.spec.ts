import { expect, test } from '@playwright/test'

import { provisionLocalRosterStudent } from './support/local-roster-student-fixture'
import { uniqueAssessmentPhone, uniqueSelfRegistrationPhone } from './support/student'

test('new student registers without exposing a PIN and can later sign in with the initial PIN', async ({ page }, testInfo) => {
  const phone = uniqueSelfRegistrationPhone(testInfo)
  const initialPin = `27${phone.slice(-4)}`
  const currentCycleFixture = provisionLocalRosterStudent(uniqueAssessmentPhone(testInfo), { admissionYear: 2027 })

  try {
    await page.goto('/login')
    await page.getByRole('link', { name: '처음 방문인가요? 간단 등록하기' }).click()
    await expect(page).toHaveURL('/register')

    await page.getByLabel('이름').fill('신규 등록 학생')
    await page.getByLabel('휴대전화 번호').fill(phone)
    await page.getByLabel('고등학교').fill('새빛고등학교')
    await page.getByLabel('학년').selectOption('high3')

    const registrationResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/student/register'
    ))
    await page.getByRole('button', { name: '관심사 진단 시작하기' }).click()
    const registrationResponse = await registrationResponsePromise
    const registrationBody = await registrationResponse.text()

    expect(registrationResponse.status(), registrationBody).toBe(200)
    expect(registrationBody).not.toContain(initialPin)
    expect(registrationBody).not.toMatch(/(?:password|pin)/iu)
    await expect(page).toHaveURL('/assessment')
    await expect(page.locator('body')).not.toContainText(initialPin)

    await page.getByTestId('logout').click()
    await expect(page).toHaveURL('/login')

    await page.getByLabel('휴대전화 번호').fill(phone)
    await page.getByLabel('PIN').fill(initialPin)
    const loginResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/student/login'
    ))
    await page.getByRole('button', { name: '내 경로 이어 보기' }).click()
    const loginResponse = await loginResponsePromise
    expect(loginResponse.status(), await loginResponse.text()).toBe(200)
    await expect(page).toHaveURL('/assessment')
  }
  finally {
    currentCycleFixture.cleanup()
  }
})
