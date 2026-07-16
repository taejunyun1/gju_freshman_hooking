import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'

import type {
  AdminExportAssessment,
  AdminExportCounseling,
  AdminExportStudent,
} from '../../shared/schemas/admin-export'

const authorize = async (page: Page): Promise<void> => {
  await page.goto('/admin/login')
  await page.evaluate(() => {
    sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
      accessToken: 'route-intercepted-admin-export-session',
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      userId: '00000000-0000-4000-8000-000000000001',
    }))
  })
}

const student = (index: number): AdminExportStudent => ({
  nickname: `학생${index.toString().padStart(4, '0')}`,
  phone: `010${index.toString().padStart(8, '0')}`,
  schoolName: '광주고등학교',
  currentStage: 'high3',
  region: 'gwangju',
  primaryCareer: index % 2 === 0 ? 'art_photo' : 'video',
  secondaryCareer: 'documentary',
  totalParticipation: index,
  latestResultAt: '2026-07-16T01:02:03.000Z',
  recommendedFaculty: '윤태준 교수',
  assignedFaculty: index % 2 === 0 ? '윤태준 교수' : null,
  counselingStatus: index % 2 === 0 ? 'assigned' : null,
})

const assessment: AdminExportAssessment = {
  nickname: '학생0001',
  sequence: 1,
  participatedAt: '2026-07-16T02:03:04.000Z',
  selectedWork: ['영상 작업'],
  selectedResult: ['전시와 포트폴리오'],
  selectedStyle: ['기술적 이미지'],
  selectedCareer: ['AI 영상'],
  documentaryScore: 60,
  artPhotoScore: 89.5,
  commercialScore: 70,
  videoScore: 95,
  environmentScore: 91,
  recommendedResources: ['컴퓨터실', '스튜디오 A'],
}

const counseling: AdminExportCounseling = {
  nickname: '학생0001',
  requestedAt: '2026-07-16T03:04:05.000Z',
  contactMethod: 'text',
  availability: 'weekday_evening',
  inquiry: '예술사진과 AI 기술 이미지를 같이 배울 수 있나요?',
  recommendedPrimaryFaculty: '윤태준 교수',
  recommendedBackupFaculty: '조대연 교수',
  specialistFaculty: ['박재웅 교수'],
  assignedFaculty: '윤태준 교수',
  status: 'assigned',
  contactedAt: null,
  completedAt: null,
  result: null,
  adminNote: '영상과 기술 분야 상담',
}

test('downloads and decodes the real 1,001-row private workbook in Chromium', async ({ page }) => {
  const firstBatch = Array.from({ length: 1_000 }, (_, index) => student(index + 1))
  const secondBatch = [student(1_001)]
  const calls: string[] = []
  const consoleMessages: string[] = []
  const pageErrors: string[] = []
  const requests: string[] = []
  let completionBody: unknown
  let downloadedAcknowledged = false
  page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/admin/export')) requests.push(`${request.method()} ${url.pathname}${url.search}`)
  })

  await page.route('**/api/admin/export**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    calls.push(`${request.method()} ${url.pathname}${url.search}`)
    if (request.method() === 'POST' && url.pathname === '/api/admin/export') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { id: 7, status: 'created', createdAt: '2026-07-16T01:00:00.000Z', filterSnapshot: { track: 'video' } },
          requestId: 'export-create-e2e',
        }),
      })
      return
    }
    if (request.method() === 'GET' && url.pathname === '/api/admin/export/7/students') {
      const second = url.searchParams.get('cursor') === 'students-1000'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { items: second ? secondBatch : firstBatch, nextCursor: second ? null : 'students-1000' },
          requestId: second ? 'students-second' : 'students-first',
        }),
      })
      return
    }
    if (request.method() === 'GET' && url.pathname === '/api/admin/export/7/assessments') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { items: [assessment], nextCursor: null }, requestId: 'assessment-page' }),
      })
      return
    }
    if (request.method() === 'GET' && url.pathname === '/api/admin/export/7/counseling') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { items: [counseling], nextCursor: null }, requestId: 'counseling-page' }),
      })
      return
    }
    if (request.method() === 'POST' && url.pathname === '/api/admin/export/7/complete') {
      completionBody = request.postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { id: 7, status: 'completed', createdAt: '2026-07-16T01:00:00.000Z', filterSnapshot: { track: 'video' } },
          requestId: 'export-complete-e2e',
        }),
      })
      return
    }
    if (request.method() === 'POST' && url.pathname === '/api/admin/export/7/downloaded') {
      downloadedAcknowledged = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: 7,
            status: 'completed',
            createdAt: '2026-07-16T01:00:00.000Z',
            filterSnapshot: { track: 'video' },
            downloadedAt: '2026-07-16T02:06:00.000Z',
          },
          requestId: 'export-downloaded-e2e',
        }),
      })
      return
    }
    await route.abort('blockedbyclient')
  })

  await authorize(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/admin/export')
  await expect(page.getByRole('heading', { name: '데이터 내보내기', exact: true })).toBeVisible()
  await expect(page.getByText(/^세션 만료/u)).toBeVisible()
  await page.getByLabel('관심 분야').selectOption('video')

  const createRequestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return request.method() === 'POST' && url.pathname === '/api/admin/export'
  }, { timeout: 5_000 })
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 })
  await page.getByRole('button', { name: 'XLSX 만들기' }).click()
  await createRequestPromise.catch(async (error: unknown) => {
    throw new Error(JSON.stringify({
      button: await page.locator('[data-action="start"]').textContent().catch(() => null),
      calls,
      consoleMessages,
      error: error instanceof Error ? error.message : String(error),
      pageErrors,
      requests,
      url: page.url(),
    }))
  })
  const download = await downloadPromise.catch(async (error: unknown) => {
    throw new Error(JSON.stringify({
      alert: await page.locator('[role="alert"]').textContent().catch(() => null),
      calls,
      consoleMessages,
      error: error instanceof Error ? error.message : String(error),
      live: await page.locator('[aria-live="polite"]').textContent().catch(() => null),
      pageErrors,
      requests,
      url: page.url(),
    }))
  })
  expect(download.suggestedFilename()).toMatch(/^PHOTO_NEXT_students_\d{4}-\d{2}-\d{2}\.xlsx$/u)
  const artifactDirectory = resolve('.superpowers/sdd/s5-task-6-export-ui-qa')
  const path = resolve(artifactDirectory, download.suggestedFilename())
  await mkdir(artifactDirectory, { recursive: true })
  await download.saveAs(path)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['학생목록', '최근참여이력', '상담현황'])
  const students = workbook.getWorksheet('학생목록')!
  expect(students.rowCount).toBe(1_002)
  expect(students.getCell('A2').value).toBe('학생0001')
  expect(students.getCell('A1001').value).toBe('학생1000')
  expect(students.getCell('A1002').value).toBe('학생1001')
  expect(students.getCell('B2').value).toBe('010-0000-0001')
  expect(students.getCell('B2').numFmt).toBe('@')
  expect(students.getCell('H1002').value).toBe(1_001)
  expect(students.getCell('I1002').value).toBeInstanceOf(Date)
  expect((students.getCell('I1002').value as Date).toISOString()).toBe('2026-07-16T10:02:03.000Z')
  expect(students.getCell('I1002').numFmt).toBe('yyyy-mm-dd hh:mm')
  expect(students.views[0]).toMatchObject({ state: 'frozen', ySplit: 1, showGridLines: false })
  expect(workbook.getWorksheet('최근참여이력')!.getCell('K2').value).toBe(95)
  expect(workbook.getWorksheet('상담현황')!.getCell('N2').value).toBe('영상과 기술 분야 상담')
  expect(completionBody).toEqual({
    status: 'completed',
    studentRowCount: 1_001,
    participationRowCount: 1,
    counselingRowCount: 1,
    downloaded: false,
  })
  expect(calls).toEqual([
    'POST /api/admin/export',
    'GET /api/admin/export/7/students',
    'GET /api/admin/export/7/students?cursor=students-1000',
    'GET /api/admin/export/7/assessments',
    'GET /api/admin/export/7/counseling',
    'POST /api/admin/export/7/complete',
    'POST /api/admin/export/7/downloaded',
  ])
  expect(downloadedAcknowledged).toBe(true)
  await expect(page.locator('[aria-live="polite"]')).toContainText(download.suggestedFilename())
})
