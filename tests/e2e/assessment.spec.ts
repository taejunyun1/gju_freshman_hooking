import { expect, test, type Page, type Response } from '@playwright/test'
import {
  expectedCommercialMatchingFixtureSummary,
  installCommercialMatchingFixture,
} from './support/commercial-matching-fixture'
import { registerAndLoginStudent, uniqueAssessmentPhone } from './support/student'

const assessmentStorageKey = 'photo_next_assessment_v1'
const assessmentSubmitPath = '/api/assessment/submit'
const canonicalResultUrl = /\/result\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const selections = {
  work: 'work.commercial_image',
  result: 'result.commercial_fashion',
  style: 'style.studio',
  career: 'career.photo',
} as const

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

test.beforeAll(() => {
  expect(installCommercialMatchingFixture())
    .toEqual(expectedCommercialMatchingFixtureSummary)
})

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

const assertRuntimeTypography = async (page: Page): Promise<void> => {
  const typography = await page.evaluate(async () => {
    const fontContracts = [
      { font: '700 16px "Wanted Sans Variable"', text: '무엇을 해보고 싶나요?' },
      { font: '400 16px "Pretendard Variable"', text: '관심사 진단' },
      { font: '700 16px "IBM Plex Mono"', text: '01 / 04' },
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
        monoWeight: getComputedStyle(mono).fontWeight,
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
  expect(typography.computed.monoWeight).toBe('700')
  expect(typography.fontResources.length).toBeGreaterThanOrEqual(3)
  expect(typography.sameOriginResources).toBe(true)
}

const assertCommercialResult = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL(canonicalResultUrl)
  await expect(page.getByRole('heading', {
    level: 1,
    name: '선택한 관심사는 4년 동안 이렇게 이어집니다',
  })).toBeVisible()
  await expect(page.locator('[data-result-section="summary"]')
    .getByText('광고사진', { exact: true }))
    .toBeVisible()
}

const assertSuccessfulSubmit = async (response: Response): Promise<void> => {
  if (!response.ok()) {
    throw new Error(`ASSESSMENT_SUBMIT_FAILED:${response.status()}:${await response.text()}`)
  }
  expect(response.status()).toBe(200)
}

test('student completes four steps with commercial as the primary track', async ({ page }, testInfo) => {
  await registerAndLoginStudent(page, uniqueAssessmentPhone(testInfo))
  await expect(page.getByRole('group', { name: '무엇을 해보고 싶나요?' })).toBeVisible()
  await assertRuntimeTypography(page)
  await selectCommercialPath(page)

  const submitResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === assessmentSubmitPath
    && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: '나의 연결 경로 보기', exact: true }).click()
  const submitResponse = await submitResponsePromise

  await assertSuccessfulSubmit(submitResponse)
  await assertCommercialResult(page)
})

test('matching catalog revision restores only the safe assessment snapshot', async ({ page }, testInfo) => {
  await registerAndLoginStudent(page, uniqueAssessmentPhone(testInfo))
  await expect(page.getByRole('group', { name: '무엇을 해보고 싶나요?' })).toBeVisible()
  const baselineLocalEntries = await page.evaluate(() => (
    Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right))
  ))
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
      .sort(([left], [right]) => left.localeCompare(right))
    const rawValues = JSON.stringify([
      ...localEntries.map(([, value]) => value),
      ...sessionEntries.map(([, value]) => value),
    ])
    const snapshotEntry = sessionEntries.find(([key]) => key === storageKey)
    return {
      csrfTokenStored: rawValues.includes(sessionPayload.data.csrfToken),
      localEntries,
      rawValues,
      sessionKeys: sessionEntries.map(([key]) => key),
      snapshot: snapshotEntry ? JSON.parse(snapshotEntry[1]) as unknown : null,
    }
  }, assessmentStorageKey)

  expect(storageState.sessionKeys).toEqual([assessmentStorageKey])
  expect(storageState.localEntries).toEqual(baselineLocalEntries)
  expect(storageState.csrfTokenStored).toBe(false)
  expect(storageState.rawValues).not.toMatch(/csrf|token|session|trackScores|rankedTracks|interestVector/iu)
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

test('first submit network failure preserves every choice and retries the real server once', async ({ page }, testInfo) => {
  await registerAndLoginStudent(page, uniqueAssessmentPhone(testInfo))
  const baselineLocalEntries = await page.evaluate(() => (
    Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right))
  ))
  await selectCommercialPath(page)

  let submitRequests = 0
  const successfulStatuses: number[] = []
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === assessmentSubmitPath
      && response.request().method() === 'POST'
      && response.ok()) {
      successfulStatuses.push(response.status())
    }
  })
  await page.route(`**${assessmentSubmitPath}`, async (route) => {
    if (new URL(route.request().url()).pathname !== assessmentSubmitPath
      || route.request().method() !== 'POST') {
      await route.continue()
      return
    }

    submitRequests += 1
    if (submitRequests === 1) {
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: '나의 연결 경로 보기', exact: true }).click()

  await expect(page.getByRole('alert')).toHaveText('결과를 준비하지 못했습니다. 선택은 그대로 유지됩니다. 다시 시도하세요.')
  const retry = page.getByRole('button', { name: '결과 다시 만들기', exact: true })
  await expect(retry).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /사진을 직접 촬영하고 보정해/u })).toBeChecked()
  const preservedStorage = await page.evaluate((storageKey) => {
    const localEntries = Object.entries(localStorage)
      .sort(([left], [right]) => left.localeCompare(right))
    const sessionEntries = Object.entries(sessionStorage)
    const snapshotEntry = sessionEntries.find(([key]) => key === storageKey)
    if (!snapshotEntry) throw new Error('ASSESSMENT_SNAPSHOT_MISSING')
    return {
      localEntries,
      rawValues: JSON.stringify([
        ...localEntries.map(([, value]) => value),
        ...sessionEntries.map(([, value]) => value),
      ]),
      sessionKeys: sessionEntries.map(([key]) => key),
      snapshot: JSON.parse(snapshotEntry[1]) as unknown,
    }
  }, assessmentStorageKey)

  expect(preservedStorage.localEntries).toEqual(baselineLocalEntries)
  expect(preservedStorage.sessionKeys).toEqual([assessmentStorageKey])
  expect(preservedStorage.rawValues).not.toMatch(/csrf|token|session|trackScores|rankedTracks|interestVector/iu)
  expect(preservedStorage.snapshot).toEqual({
    careerOther: '',
    catalogRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    selections: {
      career: [selections.career],
      result: [selections.result],
      style: [selections.style],
      work: [selections.work],
    },
    step: 3,
  })

  const retryResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === assessmentSubmitPath
    && response.request().method() === 'POST'
  ))
  await retry.click()
  const retryResponse = await retryResponsePromise

  await assertSuccessfulSubmit(retryResponse)
  await assertCommercialResult(page)
  expect(submitRequests).toBe(2)
  expect(successfulStatuses).toEqual([200])
})
