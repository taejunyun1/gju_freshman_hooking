import { expect, test, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'

const cycle = {
  id: '11111111-1111-4111-8111-111111111111', year: 2027, status: 'current', rosterVersion: 2, passwordKeyVersion: 1,
  createdAt: '2026-07-17T00:00:00.000Z', archivedAt: null,
} as const

const rosterRows = Array.from({ length: 200 }, (_, index) => ({
  name: `지원자${index + 1}`,
  phone: `010${(index + 1).toString().padStart(8, '0')}`,
  highSchool: '광주고등학교',
  grade: 'high3',
}))

const preview = (rosterVersion = cycle.rosterVersion) => ({
  cycleId: cycle.id,
  rosterVersion,
  counts: { add: 200, update: 0, inactive: 0, unchanged: 0 },
  rows: rosterRows.map((row, index) => ({ rowNumber: index + 2, action: 'add', row, changedFields: [] })),
  inactiveApplicantIds: [],
})

const applyResult = (rosterVersion = 3) => ({
  cycleId: cycle.id,
  previousVersion: rosterVersion - 1,
  rosterVersion,
  counts: { add: 200, update: 0, inactive: 0, unchanged: 0 },
  credentials: [{ name: rosterRows[0]!.name, phone: rosterRows[0]!.phone, password: '1234AB' }],
})

const gotoWhenReady = async (page: Page, path: string): Promise<void> => {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(path)
      return
    }
    catch (error) {
      lastError = error
      await page.waitForTimeout(300)
    }
  }
  throw lastError
}

const authorize = async (page: Page): Promise<void> => {
  await gotoWhenReady(page, '/admin/login')
  await page.evaluate(() => {
    sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
      accessToken: 'route-intercepted-roster-session', authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), userId: '00000000-0000-4000-8000-000000000001',
    }))
  })
}

const csv200 = () => [
  '이름,연락처,출신고교,학년',
  ...rosterRows.map(row => `${row.name},${row.phone},${row.highSchool},${row.grade}`),
].join('\n')

const xlsx200 = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('지원자명단')
  sheet.addRow(['이름', '연락처', '출신고교', '학년'])
  rosterRows.forEach(row => sheet.addRow([row.name, row.phone, row.highSchool, row.grade]))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

test('admin previews/applies 200 CSV rows, reuses a lost-response key, downloads current credentials, and remains mobile-safe', async ({ page }) => {
  const applyKeys: string[] = []
  let applyAttempts = 0
  await page.route('**/api/admin/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const reply = (data: unknown, requestId: string) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, requestId }) })
    if (request.method() === 'GET' && path === '/api/admin/admission-cycles') return reply([cycle], 'cycles')
    if (request.method() === 'POST' && path === '/api/admin/students/roster/preview') return reply(preview(), 'preview')
    if (request.method() === 'POST' && path === '/api/admin/students/roster/apply') {
      applyKeys.push((request.postDataJSON() as { idempotencyKey: string }).idempotencyKey)
      applyAttempts++
      if (applyAttempts === 1) return route.abort('connectionreset')
      return reply(applyResult(), 'apply-retry')
    }
    if (request.method() === 'GET' && path === '/api/admin/students/credentials') return reply(applyResult().credentials, 'current-credentials')
    return route.abort('blockedbyclient')
  })

  await authorize(page)
  await page.goto('/admin/students/roster')
  await expect(page.getByRole('heading', { name: '연간 지원자 명단' })).toBeVisible()
  await page.getByLabel('명단 파일 선택').setInputFiles({ name: 'roster-200.csv', mimeType: 'text/csv', buffer: Buffer.from(csv200()) })
  await expect(page.locator('[data-row]')).toHaveCount(200)
  await expect(page.locator('[data-count="add"]')).toContainText('신규 200')
  await page.getByLabel(/적용 문구/u).fill('2027 명단 적용')

  await page.getByRole('button', { name: '명단 적용' }).click()
  await expect.poll(() => applyKeys.length).toBe(1)
  await expect(page.getByRole('alert')).toContainText('같은 적용 키로 다시 시도하세요')
  const credentialDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '명단 적용' }).click()
  await credentialDownload
  expect(applyKeys).toHaveLength(2)
  expect(applyKeys[1]).toBe(applyKeys[0])

  const currentDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '현재 자격증명 다시 다운로드' }).click()
  await expect((await currentDownload).suggestedFilename()).toContain('초기비밀번호')

  await page.getByLabel('명단 파일 선택').setInputFiles({ name: 'roster-200.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await xlsx200() })
  await expect(page.locator('[data-row]')).toHaveCount(200)
  await page.setViewportSize({ width: 320, height: 900 })
  await expect(page.locator('.import-panel')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('stale roster apply offers a reload that uses the new cycle version', async ({ page }) => {
  const appliedVersions: number[] = []
  let cycleRequests = 0
  await page.route('**/api/admin/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const reply = (data: unknown, requestId: string) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, requestId }) })
    if (request.method() === 'GET' && path === '/api/admin/admission-cycles') {
      cycleRequests++
      return reply([{ ...cycle, rosterVersion: cycleRequests > 1 ? 3 : 2 }], `cycles-${cycleRequests}`)
    }
    if (request.method() === 'POST' && path === '/api/admin/students/roster/preview') return reply(preview(cycleRequests > 1 ? 3 : 2), 'preview')
    if (request.method() === 'POST' && path === '/api/admin/students/roster/apply') {
      appliedVersions.push((request.postDataJSON() as { expectedVersion: number }).expectedVersion)
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ROSTER_CONFLICT', message: 'stale' }, requestId: 'conflict' }) })
    }
    return route.abort('blockedbyclient')
  })

  await authorize(page)
  await page.goto('/admin/students/roster')
  await page.getByLabel('명단 파일 선택').setInputFiles({ name: 'roster-200.csv', mimeType: 'text/csv', buffer: Buffer.from(csv200()) })
  await page.getByLabel(/적용 문구/u).fill('2027 명단 적용')
  await page.getByRole('button', { name: '명단 적용' }).click()
  await expect(page.getByRole('button', { name: '최신 비교 결과 다시 불러오기' })).toBeVisible()
  await page.getByRole('button', { name: '최신 비교 결과 다시 불러오기' }).click()
  await expect(page.locator('[data-count="add"]')).toContainText('신규 200')
  await expect(page.locator('.roster-page__counts')).toContainText('현재 버전 v3')
  await expect(page.getByRole('button', { name: '명단 적용' })).toBeDisabled()
  await page.getByLabel(/적용 문구/u).fill('2027 명단 적용')
  await page.getByRole('button', { name: '명단 적용' }).click()
  await expect.poll(() => appliedVersions).toEqual([2, 3])
})
