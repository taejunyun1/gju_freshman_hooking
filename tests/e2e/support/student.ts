import { createHash } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
export { uniqueAssessmentPhone } from './phone'

type RegisteredStudent = {
  nickname: string
}

type OnRegistered = (student: RegisteredStudent) => Promise<void>
type LocalCredentials = { phone: string, password: string, nickname?: string }

const fallbackPasswordForPhone = (phone: string): string => `${phone.replace(/\D/gu, '').slice(-4)}AA`

type PlaywrightTestIdentity = {
  retry: number
  testId: string
}

export const uniqueSelfRegistrationPhone = (testInfo: PlaywrightTestIdentity): string => {
  const digest = createHash('sha256')
    .update(`student-self-registration:${testInfo.testId}:${testInfo.retry}`)
    .digest()
  const suffix = (digest.readUInt32BE(0) % 10_000_000).toString().padStart(7, '0')
  return `0109${suffix}`
}

export const registerAndLoginStudent = async (
  page: Page,
  phone: string,
  onRegistered?: OnRegistered,
  localCredentials?: LocalCredentials,
): Promise<RegisteredStudent> => {
  const rosterPhone = localCredentials?.phone ?? process.env.PHOTO_NEXT_E2E_STUDENT_PHONE ?? phone
  const rosterPassword = localCredentials?.password ?? process.env.PHOTO_NEXT_E2E_STUDENT_PASSWORD ?? fallbackPasswordForPhone(rosterPhone)
  const nickname = localCredentials?.nickname ?? process.env.PHOTO_NEXT_E2E_STUDENT_NAME ?? '지원자'

  await onRegistered?.({ nickname })
  await page.goto('/login')
  await page.getByLabel('휴대전화 번호').fill(rosterPhone)
  await page.getByLabel('PIN').fill(rosterPassword)

  const loginResponsePromise = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === '/api/student/login'
  })
  await page.getByRole('button', { name: '내 경로 이어 보기' }).click()
  const loginResponse = await loginResponsePromise
  expect(loginResponse.status(), await loginResponse.text()).toBe(200)

  await expect(page).toHaveURL('/assessment')
  return { nickname }
}
