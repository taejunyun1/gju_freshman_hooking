import { expect, test, type Page } from '@playwright/test'
import { registerAndLoginStudent, uniqueAssessmentPhone } from './support/student'

const assessmentStorageKey = 'photo_next_assessment_v1'
const selections = {
  work: 'work.commercial_image',
  result: 'result.commercial_fashion',
  style: 'style.studio',
  career: 'career.photo',
} as const

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

const selectCommercialPath = async (page: Page): Promise<void> => {
  await expect(page.getByRole('group', { name: '무엇을 해보고 싶나요?' })).toBeVisible()
  await page.getByRole('checkbox', { name: /제품·패션·광고 이미지 만들기/u }).check()
  await page.getByRole('button', { name: '다음' }).click()

  await expect(page.getByRole('group', { name: '어떤 결과물을 만들고 싶나요?' })).toBeVisible()
  await page.getByRole('checkbox', { name: /광고·패션 이미지/u }).check()
  await page.getByRole('button', { name: '다음' }).click()

  await expect(page.getByRole('group', { name: '어떤 방식으로 작업하고 싶나요?' })).toBeVisible()
  await page.getByRole('checkbox', { name: /스튜디오에서 촬영/u }).check()
  await page.getByRole('button', { name: '다음' }).click()

  await expect(page.getByRole('group', { name: '어떤 방향을 탐색하고 싶나요?' })).toBeVisible()
  await page.getByRole('checkbox', { name: /사진을 직접 촬영하고 보정해/u }).check()
}

test('student completes four steps with commercial as the primary track', async ({ page }, testInfo) => {
  await registerAndLoginStudent(page, uniqueAssessmentPhone(testInfo))
  await selectCommercialPath(page)

  await page.getByRole('button', { name: '결과 계산' }).click()

  const primaryTrack = page.getByTestId('validated-primary-track')
  await expect(primaryTrack).toHaveCount(1)
  await expect(primaryTrack).toHaveText('광고사진')
})

test('matching catalog revision restores only the safe assessment snapshot', async ({ page }, testInfo) => {
  await registerAndLoginStudent(page, uniqueAssessmentPhone(testInfo))
  await expect(page.getByRole('group', { name: '무엇을 해보고 싶나요?' })).toBeVisible()
  await page.getByRole('checkbox', { name: /제품·패션·광고 이미지 만들기/u }).check()
  await page.getByRole('button', { name: '다음' }).click()
  await expect(page.getByRole('group', { name: '어떤 결과물을 만들고 싶나요?' })).toBeVisible()

  await page.reload()

  await expect(page.getByRole('group', { name: '어떤 결과물을 만들고 싶나요?' })).toBeVisible()
  const storageState = await page.evaluate(async (storageKey) => {
    const sessionResponse = await fetch('/api/student/session')
    if (!sessionResponse.ok) throw new Error('SESSION_BOOTSTRAP_FAILED')
    const sessionPayload = await sessionResponse.json() as { data: { csrfToken: string } }
    const sessionEntries = Object.entries(sessionStorage)
    const localEntries = Object.entries(localStorage)
    const raw = JSON.stringify({ localEntries, sessionEntries })
    const snapshotEntry = sessionEntries.find(([key]) => key === storageKey)
    return {
      applicationLocalKeys: localEntries
        .map(([key]) => key)
        .filter(key => key.startsWith('photo_next_')),
      csrfTokenStored: raw.includes(sessionPayload.data.csrfToken),
      raw,
      sessionKeys: sessionEntries.map(([key]) => key),
      snapshot: snapshotEntry ? JSON.parse(snapshotEntry[1]) as unknown : null,
    }
  }, assessmentStorageKey)

  expect(storageState.sessionKeys).toEqual([assessmentStorageKey])
  expect(storageState.applicationLocalKeys).toEqual([])
  expect(storageState.csrfTokenStored).toBe(false)
  expect(storageState.raw).not.toMatch(/csrf|token|session_material|trackScores|rankedTracks|interestVector/iu)
  expect(storageState.snapshot).toEqual({
    careerOther: '',
    catalogRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    selections: {
      career: [],
      result: [],
      style: [],
      work: [selections.work],
    },
    step: 1,
  })

  await page.getByRole('button', { name: /이전/u }).click()
  await expect(page.getByRole('checkbox', { name: /제품·패션·광고 이미지 만들기/u })).toBeChecked()
})

test('first validation network failure preserves every choice and retries the real server once', async ({ page }, testInfo) => {
  await registerAndLoginStudent(page, uniqueAssessmentPhone(testInfo))
  await selectCommercialPath(page)

  let validateRequests = 0
  const successfulStatuses: number[] = []
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/student/assessment/validate' && response.ok()) {
      successfulStatuses.push(response.status())
    }
  })
  await page.route('**/api/student/assessment/validate', async (route) => {
    validateRequests += 1
    if (validateRequests === 1) {
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: '결과 계산' }).click()

  await expect(page.getByRole('alert')).toContainText('선택은 그대로 유지됩니다')
  const retry = page.getByRole('button', { name: '결과 다시 계산' })
  await expect(retry).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /사진을 직접 촬영하고 보정해/u })).toBeChecked()
  const preservedSelections = await page.evaluate((storageKey) => {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) throw new Error('ASSESSMENT_SNAPSHOT_MISSING')
    return (JSON.parse(raw) as { selections: Record<string, string[]> }).selections
  }, assessmentStorageKey)
  expect(preservedSelections).toEqual({
    career: [selections.career],
    result: [selections.result],
    style: [selections.style],
    work: [selections.work],
  })

  await retry.click()

  const primaryTrack = page.getByTestId('validated-primary-track')
  await expect(primaryTrack).toHaveCount(1)
  await expect(primaryTrack).toHaveText('광고사진')
  expect(validateRequests).toBe(2)
  expect(successfulStatuses).toEqual([200])
})

test('assessment loads the three approved font roles from same-origin WOFF2 assets', async ({ page }, testInfo) => {
  await registerAndLoginStudent(page, uniqueAssessmentPhone(testInfo))
  await expect(page.getByRole('group', { name: '무엇을 해보고 싶나요?' })).toBeVisible()

  const typography = await page.evaluate(async () => {
    const fontContracts = [
      { font: '700 16px "Wanted Sans Variable"', text: '무엇을 해보고 싶나요?' },
      { font: '400 16px "Pretendard Variable"', text: '관심사 진단' },
      { font: '400 16px "IBM Plex Mono"', text: '01 / 04' },
    ]
    const loadedFaceCounts = await Promise.all(fontContracts.map(async contract => (
      await document.fonts.load(contract.font, contract.text)
    ).length))
    await document.fonts.ready

    const display = document.querySelector<HTMLElement>('legend')
    const mono = document.querySelector<HTMLElement>('.assessment-progress__readout span')
    if (!display || !mono) throw new Error('ASSESSMENT_FONT_TARGET_MISSING')

    const fontResources = performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(url => /\.woff2(?:\?|$)/u.test(url))
    return {
      computed: {
        body: getComputedStyle(document.body).fontFamily,
        display: getComputedStyle(display).fontFamily,
        mono: getComputedStyle(mono).fontFamily,
      },
      fontResources,
      loadedFaceCounts,
      sameOriginResources: fontResources.every(url => new URL(url).origin === location.origin),
    }
  })

  expect(typography.loadedFaceCounts.every(count => count > 0)).toBe(true)
  expect(typography.computed.display).toContain('Wanted Sans Variable')
  expect(typography.computed.body).toContain('Pretendard Variable')
  expect(typography.computed.mono).toContain('IBM Plex Mono')
  expect(typography.fontResources.length).toBeGreaterThanOrEqual(3)
  expect(typography.sameOriginResources).toBe(true)
})
