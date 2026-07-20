import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'

import {
  appendExportPageRows,
  createAdminExportWorkbook,
  exportFilename,
  useXlsxExport,
} from '../../../app/composables/useXlsxExport'
import type {
  AdminExportAssessment,
  AdminExportCounseling,
  AdminExportStudent,
} from '../../../shared/schemas/admin-export'

const student = (nickname = '선명한프레임'): AdminExportStudent => ({
  nickname,
  phone: '01012345678',
  schoolName: '광주고등학교',
  currentStage: 'high3',
  region: 'gwangju',
  primaryCareer: 'art_photo',
  secondaryCareer: 'video',
  totalParticipation: 3,
  latestResultAt: '2026-07-16T01:02:03.000Z',
  recommendedFaculty: '윤태준 교수',
  assignedFaculty: null,
  counselingStatus: 'new',
})

const assessment = (): AdminExportAssessment => ({
  nickname: '선명한프레임',
  sequence: 2,
  participatedAt: '2026-07-15T04:05:06.000Z',
  selectedWork: ['사진 연작'],
  selectedResult: ['전시'],
  selectedStyle: ['서사적'],
  selectedCareer: ['예술사진'],
  documentaryScore: 71.5,
  artPhotoScore: 92,
  commercialScore: 44,
  videoScore: 80,
  environmentScore: 88,
  recommendedResources: ['스튜디오 A', '컴퓨터실'],
})

const counseling = (): AdminExportCounseling => ({
  nickname: '선명한프레임',
  requestedAt: '2026-07-14T07:08:09.000Z',
  contactMethod: 'text',
  availability: 'weekday_evening',
  inquiry: '예술사진과 AI 영상을 같이 배우고 싶어요.',
  recommendedPrimaryFaculty: '윤태준 교수',
  recommendedBackupFaculty: '조대연 교수',
  specialistFaculty: ['박재웅 교수'],
  assignedFaculty: null,
  status: 'assigned',
  contactedAt: null,
  completedAt: null,
  result: null,
  adminNote: '영상과 기술 트랙 상담 예정',
})

describe('administrator XLSX workbook', () => {
  it('keeps the exact sheet order, DTO column order, and workbook presentation contract', () => {
    const workbook = new ExcelJS.Workbook()
    const writer = createAdminExportWorkbook(workbook)

    writer.appendStudents([student()])
    writer.appendAssessments([assessment()])
    writer.appendCounseling([counseling()])

    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      '학생목록', '최근참여이력', '상담현황',
    ])
    expect(workbook.getWorksheet('학생목록')!.getRow(1).values).toEqual([
      undefined, '닉네임', '휴대전화', '학교', '지원자 단계', '지역', '1순위 관심 분야',
      '2순위 관심 분야', '총 참여 횟수', '최근 검사 일시', '추천 교수', '배정 교수', '상담 상태',
      '내보내기 분류',
    ])
    for (const sheet of workbook.worksheets) {
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1, showGridLines: false })
      expect(sheet.autoFilter).toEqual({ from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } })
      expect(sheet.getRow(1).font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' }, name: 'Pretendard' })
      expect(sheet.getRow(1).fill).toMatchObject({ fgColor: { argb: 'FF17151D' } })
    }
  })

  it('stores real Date and number cells and wraps descriptive fields without formulas', () => {
    const workbook = new ExcelJS.Workbook()
    const writer = createAdminExportWorkbook(workbook)
    writer.appendStudents([student()])
    writer.appendAssessments([assessment()])
    writer.appendCounseling([counseling()])

    const students = workbook.getWorksheet('학생목록')!
    const participation = workbook.getWorksheet('최근참여이력')!
    const counselingSheet = workbook.getWorksheet('상담현황')!
    expect(students.getCell('B2').value).toBe('010-1234-5678')
    expect(students.getCell('B2').numFmt).toBe('@')
    expect(students.getCell('H2').value).toBe(3)
    expect(students.getCell('I2').value).toBeInstanceOf(Date)
    expect((students.getCell('I2').value as Date).toISOString()).toBe('2026-07-16T10:02:03.000Z')
    expect(students.getCell('I2').numFmt).toBe('yyyy-mm-dd hh:mm')
    expect(students.getCell('M2').value).toBe('상담 신청자')
    expect(participation.getCell('B2').value).toBe(2)
    expect(participation.getCell('C2').value).toBeInstanceOf(Date)
    expect(participation.getCell('H2').value).toBe(71.5)
    expect(counselingSheet.getCell('B2').value).toBeInstanceOf(Date)
    expect(counselingSheet.getCell('E2').alignment).toMatchObject({ vertical: 'top', wrapText: true })
    expect(counselingSheet.getCell('N2').alignment).toMatchObject({ vertical: 'top', wrapText: true })
    for (const sheet of workbook.worksheets) {
      sheet.eachRow(row => row.eachCell(cell => expect(cell.type).not.toBe(6)))
    }
  })

  it('loads 1,001 rows sequentially in 1,000-row pages and releases each consumed batch', async () => {
    const first = Array.from({ length: 1_000 }, (_, index) => student(`학생${index + 1}`))
    const second = [student('학생1001')]
    const order: string[] = []
    const append = vi.fn((items: AdminExportStudent[]) => order.push(`append:${items.length}`))
    const load = vi.fn(async (cursor: string | null) => {
      order.push(`load:${cursor ?? 'first'}`)
      return cursor === null
        ? { items: first, nextCursor: 'cursor-1000' }
        : { items: second, nextCursor: null }
    })

    const count = await appendExportPageRows(load, append)

    expect(count).toBe(1_001)
    expect(order).toEqual(['load:first', 'append:1000', 'load:cursor-1000', 'append:1'])
    expect(first).toHaveLength(0)
    expect(second).toHaveLength(0)
  })

  it('creates a filesystem-safe filename from the Korean calendar day regardless of the runtime timezone', () => {
    expect(exportFilename(new Date('2026-07-16T15:20:00.000Z'))).toBe('PHOTO_NEXT_students_2026-07-17.xlsx')
  })
})

describe('administrator XLSX export flow', () => {
  const job = {
    id: 7,
    status: 'created' as const,
    createdAt: '2026-07-16T01:00:00.000Z',
    filterSnapshot: {},
  }

  it('guards duplicate starts, completes without a download flag, downloads, then acknowledges once', async () => {
    let resolveCreate!: (value: unknown) => void
    const loadExcel = vi.fn(async () => ({ Workbook: ExcelJS.Workbook }))
    const download = vi.fn()
    const fetcher = vi.fn(async (url: string, options?: { method?: string }) => {
      if (url === '/api/admin/export' && options?.method === 'POST') return new Promise(resolve => { resolveCreate = resolve })
      if (url.endsWith('/students')) return { data: { items: [student()], nextCursor: null }, requestId: 'students' }
      if (url.endsWith('/assessments')) return { data: { items: [assessment()], nextCursor: null }, requestId: 'assessments' }
      if (url.endsWith('/counseling')) return { data: { items: [counseling()], nextCursor: null }, requestId: 'counseling' }
      if (url.endsWith('/complete')) return { data: { ...job, status: 'completed' }, requestId: 'complete' }
      return {
        data: {
          ...job,
          status: 'completed',
          downloadedAt: '2026-07-16T02:06:00.000Z',
        },
        requestId: 'downloaded',
      }
    })
    const exporter = useXlsxExport({
      download,
      fetcher,
      getAuthorizationHeaders: () => ({ Authorization: 'Bearer token' }),
      loadExcel,
      now: () => new Date('2026-07-16T08:00:00+09:00'),
      recoverAuth: vi.fn(),
    })

    expect(loadExcel).not.toHaveBeenCalled()
    const firstRun = exporter.start({})
    const duplicateRun = exporter.start({})
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/admin/export')).toHaveLength(1)
    resolveCreate({ data: job, requestId: 'create' })
    await Promise.all([firstRun, duplicateRun])

    expect(loadExcel).toHaveBeenCalledTimes(1)
    expect(exporter.state.value.rows).toEqual({ students: 1, assessments: 1, counseling: 1 })
    const terminalIndex = fetcher.mock.calls.findIndex(([url]) => url === '/api/admin/export/7/complete')
    const acknowledgeIndex = fetcher.mock.calls.findIndex(([url]) => url === '/api/admin/export/7/downloaded')
    expect(terminalIndex).toBeGreaterThan(-1)
    expect(fetcher.mock.calls[terminalIndex]?.[1]).toEqual(expect.objectContaining({
      body: expect.objectContaining({ status: 'completed', downloaded: false }),
    }))
    expect(download).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.invocationCallOrder[terminalIndex]).toBeLessThan(download.mock.invocationCallOrder[0]!)
    expect(download.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[acknowledgeIndex]!)
    expect(exporter.state.value.phase).toBe('completed')
  })

  it('keeps a completed job unacknowledged when browser download fails and retries only download plus acknowledgement', async () => {
    const download = vi.fn()
      .mockRejectedValueOnce(new Error('browser-download-failed'))
      .mockResolvedValueOnce(undefined)
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/admin/export') return { data: job, requestId: 'create' }
      if (url.endsWith('/students') || url.endsWith('/assessments') || url.endsWith('/counseling')) {
        return { data: { items: [], nextCursor: null }, requestId: 'page' }
      }
      if (url.endsWith('/complete')) return { data: { ...job, status: 'completed' }, requestId: 'complete' }
      return {
        data: {
          ...job,
          status: 'completed',
          downloadedAt: '2026-07-16T02:06:00.000Z',
        },
        requestId: 'downloaded',
      }
    })
    const exporter = useXlsxExport({
      download,
      fetcher,
      getAuthorizationHeaders: () => ({ Authorization: 'Bearer token' }),
      loadExcel: vi.fn(async () => ({ Workbook: ExcelJS.Workbook })),
      now: () => new Date('2026-07-16T08:00:00+09:00'),
      recoverAuth: vi.fn(),
    })

    await exporter.start({})
    expect(exporter.state.value).toMatchObject({
      phase: 'failed',
      canRetry: true,
    })
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/admin/export/7/complete')).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/admin/export/7/downloaded')).toHaveLength(0)

    await exporter.start({})
    expect(download).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/admin/export')).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/admin/export/7/complete')).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/admin/export/7/downloaded')).toHaveLength(1)
    expect(exporter.state.value.phase).toBe('completed')
  })

  it('retries only the acknowledgement when the browser download succeeded before an ack transport failure', async () => {
    const download = vi.fn()
    let acknowledgeAttempt = 0
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/admin/export') return { data: job, requestId: 'create' }
      if (url.endsWith('/students') || url.endsWith('/assessments') || url.endsWith('/counseling')) {
        return { data: { items: [], nextCursor: null }, requestId: 'page' }
      }
      if (url.endsWith('/complete')) return { data: { ...job, status: 'completed' }, requestId: 'complete' }
      acknowledgeAttempt += 1
      if (acknowledgeAttempt === 1) throw new Error('ack-transport-failed')
      return {
        data: {
          ...job,
          status: 'completed',
          downloadedAt: '2026-07-16T02:06:00.000Z',
        },
        requestId: 'downloaded',
      }
    })
    const exporter = useXlsxExport({
      download,
      fetcher,
      getAuthorizationHeaders: () => ({ Authorization: 'Bearer token' }),
      loadExcel: vi.fn(async () => ({ Workbook: ExcelJS.Workbook })),
      now: () => new Date('2026-07-16T08:00:00+09:00'),
      recoverAuth: vi.fn(),
    })

    await exporter.start({})
    expect(download).toHaveBeenCalledTimes(1)
    expect(exporter.state.value).toMatchObject({ phase: 'failed', canRetry: true })
    expect(exporter.state.value.error).toContain('완료 확인')

    await exporter.start({})
    expect(download).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/admin/export/7/downloaded')).toHaveLength(2)
    expect(exporter.state.value.phase).toBe('completed')
  })

  it('rejects a non-completed completion response before browser download or acknowledgement', async () => {
    const download = vi.fn()
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/admin/export') return { data: job, requestId: 'create' }
      if (url.endsWith('/students') || url.endsWith('/assessments') || url.endsWith('/counseling')) {
        return { data: { items: [], nextCursor: null }, requestId: 'page' }
      }
      return { data: { ...job, status: 'failed' }, requestId: 'wrong-terminal' }
    })
    const exporter = useXlsxExport({
      download,
      fetcher,
      getAuthorizationHeaders: () => ({ Authorization: 'Bearer token' }),
      loadExcel: vi.fn(async () => ({ Workbook: ExcelJS.Workbook })),
      now: () => new Date(),
      recoverAuth: vi.fn(),
    })

    await exporter.start({})

    expect(download).not.toHaveBeenCalled()
    expect(fetcher.mock.calls.some(([url]) => url === '/api/admin/export/7/downloaded')).toBe(false)
    expect(exporter.state.value.phase).toBe('failed')
  })

  it('best-effort terminates a failed job and offers only a retryable failed state', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/admin/export') return { data: job, requestId: 'create' }
      if (url.endsWith('/students')) throw new TypeError('network-private-detail')
      return { data: { ...job, status: 'failed' }, requestId: 'failed' }
    })
    const exporter = useXlsxExport({
      download: vi.fn(),
      fetcher,
      getAuthorizationHeaders: () => ({ Authorization: 'Bearer token' }),
      loadExcel: vi.fn(async () => ({ Workbook: ExcelJS.Workbook })),
      now: () => new Date(),
      recoverAuth: vi.fn(),
    })

    await exporter.start({})

    expect(fetcher).toHaveBeenCalledWith('/api/admin/export/7/complete', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ status: 'failed', errorCode: 'EXPORT_FETCH_FAILED' }),
    }))
    expect(exporter.state.value).toMatchObject({ phase: 'failed', canRetry: true })
    expect(exporter.state.value.error).not.toContain('network-private-detail')
    expect(exporter.state.value.error).toContain('인터넷 연결')
  })

  it.each(['MFA_REQUIRED', 'REAUTH_REQUIRED', 'ADMIN_REQUIRED', 'ADMIN_SESSION_REQUIRED'])('recovers %s through the fixed local login redirect', async (code) => {
    const recoverAuth = vi.fn()
    const fetcher = vi.fn(async () => { throw { data: { error: { code } } } })
    const exporter = useXlsxExport({
      download: vi.fn(),
      fetcher,
      getAuthorizationHeaders: () => ({ Authorization: 'Bearer token' }),
      loadExcel: vi.fn(async () => ({ Workbook: ExcelJS.Workbook })),
      now: () => new Date(),
      recoverAuth,
    })

    await exporter.start({})

    expect(recoverAuth).toHaveBeenCalledWith('/admin/login?redirect=/admin/export')
    expect(exporter.state.value.phase).toBe('failed')
  })

  it('does not mutate state or download after disposal', async () => {
    let resolveCreate!: (value: unknown) => void
    const download = vi.fn()
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/admin/export') return new Promise(resolve => { resolveCreate = resolve })
      return { data: { items: [], nextCursor: null }, requestId: 'page' }
    })
    const exporter = useXlsxExport({
      download,
      fetcher,
      getAuthorizationHeaders: () => ({ Authorization: 'Bearer token' }),
      loadExcel: vi.fn(async () => ({ Workbook: ExcelJS.Workbook })),
      now: () => new Date(),
      recoverAuth: vi.fn(),
    })
    const run = exporter.start({})
    const snapshot = JSON.parse(JSON.stringify(exporter.state.value)) as typeof exporter.state.value
    exporter.dispose()
    resolveCreate({ data: job, requestId: 'create' })
    await run

    expect(JSON.parse(JSON.stringify(exporter.state.value))).toEqual(snapshot)
    expect(download).not.toHaveBeenCalled()
  })

  it('aborts an in-flight page fetch on disposal and never appends or requests the next cursor', async () => {
    let resolvePage!: (value: unknown) => void
    const fetcher = vi.fn(async (url: string, options?: { signal?: AbortSignal }) => {
      if (url === '/api/admin/export') return { data: job, requestId: 'create' }
      if (url.endsWith('/students')) {
        return new Promise((resolve, reject) => {
          resolvePage = resolve
          options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      }
      return { data: { items: [], nextCursor: null }, requestId: 'page' }
    })
    const exporter = useXlsxExport({
      download: vi.fn(),
      fetcher,
      getAuthorizationHeaders: () => ({ Authorization: 'Bearer token' }),
      loadExcel: vi.fn(async () => ({ Workbook: ExcelJS.Workbook })),
      now: () => new Date(),
      recoverAuth: vi.fn(),
    })

    const run = exporter.start({})
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/students'))).toBe(true))
    const studentFetch = fetcher.mock.calls.find(([url]) => url.endsWith('/students'))!
    const signal = (studentFetch[1] as { signal?: AbortSignal }).signal
    exporter.dispose()
    expect(signal?.aborted).toBe(true)
    resolvePage({
      data: { items: [student()], nextCursor: 'students-1000' },
      requestId: 'late-page',
    })
    await run

    expect(fetcher.mock.calls.some(([url]) => String(url).includes('cursor=students-1000'))).toBe(false)
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/assessments'))).toHaveLength(0)
    expect(exporter.state.value.rows.students).toBe(0)
  })
})
