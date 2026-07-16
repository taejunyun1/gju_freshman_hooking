import type { Buffer as ExcelBuffer, CellValue, Workbook, Worksheet } from 'exceljs'
import { ref, type Ref } from 'vue'
import { z } from 'zod'

import {
  adminExportAssessmentSchema,
  adminExportCompletedJobSchema,
  adminExportCounselingSchema,
  adminExportDownloadedJobSchema,
  adminExportFilterSchema,
  adminExportJobSchema,
  adminExportStudentSchema,
  type AdminExportAssessment,
  type AdminExportCounseling,
  type AdminExportFailureCode,
  type AdminExportFilter,
  type AdminExportStudent,
} from '../../shared/schemas/admin-export'
import { useAdminSessionStore } from '../stores/admin-session'

const DATE_FORMAT = 'yyyy-mm-dd hh:mm'
const HEADER_FILL = 'FF17151D'
const HEADER_TEXT = 'FFFFFFFF'
const PAGE_SIZE = 1_000
const AUTH_CODES = new Set(['MFA_REQUIRED', 'REAUTH_REQUIRED', 'ADMIN_REQUIRED', 'ADMIN_SESSION_REQUIRED'])

type FetchOptions = {
  body?: unknown
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  query?: Record<string, string>
  signal?: AbortSignal
}
type Fetcher = (url: string, options?: FetchOptions) => Promise<unknown>
type ExcelModule = { Workbook: new () => Workbook }
type Page<Item> = { items: Item[], nextCursor: string | null }
type ExportPhase = 'idle' | 'checking' | 'authenticating' | 'collecting' | 'building' | 'finalizing' | 'completed' | 'failed'
type ExportSheetKey = 'students' | 'assessments' | 'counseling'

export type XlsxExportState = {
  busy: boolean
  canRetry: boolean
  currentSheet: string | null
  error: string
  filename: string
  message: string
  phase: ExportPhase
  rows: Record<ExportSheetKey, number>
}

export type XlsxExportDependencies = {
  download: (buffer: ExcelBuffer, filename: string) => void | Promise<void>
  fetcher: Fetcher
  getAuthorizationHeaders: () => Record<string, string>
  loadExcel: () => Promise<ExcelModule>
  now: () => Date
  recoverAuth: (redirect: string) => void | Promise<void>
}

const pageSchema = <Item extends z.ZodType>(item: Item) => z.object({
  items: z.array(item).max(PAGE_SIZE),
  nextCursor: z.string().min(1).max(200).nullable(),
}).strict()
const envelope = <Data extends z.ZodType>(data: Data) => z.object({
  data,
  requestId: z.string().min(1).max(200),
}).strict()
const jobEnvelopeSchema = envelope(adminExportJobSchema)
const completedJobEnvelopeSchema = envelope(adminExportCompletedJobSchema)
const downloadedJobEnvelopeSchema = envelope(adminExportDownloadedJobSchema)
const studentPageEnvelopeSchema = envelope(pageSchema(adminExportStudentSchema))
const assessmentPageEnvelopeSchema = envelope(pageSchema(adminExportAssessmentSchema))
const counselingPageEnvelopeSchema = envelope(pageSchema(adminExportCounselingSchema))

type ColumnDefinition = {
  header: string
  key: string
  numberFormat?: string
  width: number
  wrap?: boolean
}

const studentColumns: ColumnDefinition[] = [
  { header: '닉네임', key: 'nickname', width: 18 },
  { header: '휴대전화', key: 'phone', numberFormat: '@', width: 16 },
  { header: '학교', key: 'schoolName', width: 22 },
  { header: '지원자 단계', key: 'currentStage', width: 14 },
  { header: '지역', key: 'region', width: 14 },
  { header: '1순위 관심 분야', key: 'primaryCareer', width: 18 },
  { header: '2순위 관심 분야', key: 'secondaryCareer', width: 18 },
  { header: '총 참여 횟수', key: 'totalParticipation', numberFormat: '#,##0', width: 14 },
  { header: '최근 검사 일시', key: 'latestResultAt', numberFormat: DATE_FORMAT, width: 20 },
  { header: '추천 교수', key: 'recommendedFaculty', width: 18 },
  { header: '배정 교수', key: 'assignedFaculty', width: 18 },
  { header: '상담 상태', key: 'counselingStatus', width: 14 },
]

const assessmentColumns: ColumnDefinition[] = [
  { header: '닉네임', key: 'nickname', width: 18 },
  { header: '참여 순번', key: 'sequence', numberFormat: '#,##0', width: 12 },
  { header: '참여 일시', key: 'participatedAt', numberFormat: DATE_FORMAT, width: 20 },
  { header: '선택한 작업', key: 'selectedWork', width: 24, wrap: true },
  { header: '선택한 결과', key: 'selectedResult', width: 24, wrap: true },
  { header: '선택한 스타일', key: 'selectedStyle', width: 24, wrap: true },
  { header: '선택한 진로', key: 'selectedCareer', width: 24, wrap: true },
  { header: '다큐멘터리 점수', key: 'documentaryScore', numberFormat: '0.0', width: 16 },
  { header: '예술사진 점수', key: 'artPhotoScore', numberFormat: '0.0', width: 16 },
  { header: '광고사진 점수', key: 'commercialScore', numberFormat: '0.0', width: 16 },
  { header: '영상과 기술 점수', key: 'videoScore', numberFormat: '0.0', width: 18 },
  { header: '환경 적합도', key: 'environmentScore', numberFormat: '0.0', width: 14 },
  { header: '추천 학과 자원', key: 'recommendedResources', width: 36, wrap: true },
]

const counselingColumns: ColumnDefinition[] = [
  { header: '닉네임', key: 'nickname', width: 18 },
  { header: '상담 신청 일시', key: 'requestedAt', numberFormat: DATE_FORMAT, width: 20 },
  { header: '연락 방법', key: 'contactMethod', width: 14 },
  { header: '가능 시간', key: 'availability', width: 18 },
  { header: '문의', key: 'inquiry', width: 40, wrap: true },
  { header: '1순위 추천 교수', key: 'recommendedPrimaryFaculty', width: 20 },
  { header: '예비 추천 교수', key: 'recommendedBackupFaculty', width: 20 },
  { header: '연계 전문 교수', key: 'specialistFaculty', width: 24, wrap: true },
  { header: '배정 교수', key: 'assignedFaculty', width: 18 },
  { header: '상태', key: 'status', width: 14 },
  { header: '연락 일시', key: 'contactedAt', numberFormat: DATE_FORMAT, width: 20 },
  { header: '완료 일시', key: 'completedAt', numberFormat: DATE_FORMAT, width: 20 },
  { header: '상담 결과', key: 'result', width: 18, wrap: true },
  { header: '관리자 메모', key: 'adminNote', width: 42, wrap: true },
]

const KOREA_STANDARD_TIME_OFFSET_MS = 9 * 60 * 60 * 1_000

// Asia/Seoul is fixed at UTC+09:00 and does not observe daylight-saving time.
export const asKoreanExcelDate = (value: string | null): Date | null => {
  if (value === null) return null
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) throw new Error('EXPORT_DATE_INVALID')
  return new Date(instant.getTime() + KOREA_STANDARD_TIME_OFFSET_MS)
}
const joined = (values: string[]): string => values.join(' · ')
const displayPhone = (value: string): string => `${value.slice(0, 3)}-${value.slice(3, 7)}-${value.slice(7)}`

const configureSheet = (sheet: Worksheet, columns: ColumnDefinition[]): void => {
  sheet.columns = columns.map(column => ({ header: column.header, key: column.key, width: column.width }))
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, activeCell: 'A2', showGridLines: false }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  }
  const header = sheet.getRow(1)
  header.height = 28
  header.font = { name: 'Pretendard', size: 10, bold: true, color: { argb: HEADER_TEXT } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  header.alignment = { vertical: 'middle', horizontal: 'left' }
  header.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF6B43B5' } } }
  })
  columns.forEach((column, index) => {
    if (column.numberFormat) sheet.getColumn(index + 1).numFmt = column.numberFormat
  })
}

const appendRows = (
  sheet: Worksheet,
  columns: ColumnDefinition[],
  rows: Array<Record<string, CellValue>>,
): void => {
  for (const values of rows) {
    const row = sheet.addRow(values)
    row.alignment = { vertical: 'top' }
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1)
      cell.alignment = { vertical: 'top', wrapText: column.wrap === true }
      if (column.numberFormat) cell.numFmt = column.numberFormat
    })
  }
}

export const createAdminExportWorkbook = (workbook: Workbook) => {
  workbook.creator = 'PHOTO:NEXT'
  workbook.subject = '관리자 학생 데이터 내보내기'
  const students = workbook.addWorksheet('학생목록')
  const assessments = workbook.addWorksheet('최근참여이력')
  const counseling = workbook.addWorksheet('상담현황')
  configureSheet(students, studentColumns)
  configureSheet(assessments, assessmentColumns)
  configureSheet(counseling, counselingColumns)

  return {
    appendStudents(items: AdminExportStudent[]): void {
      appendRows(students, studentColumns, items.map(item => ({
        nickname: item.nickname,
        phone: displayPhone(item.phone),
        schoolName: item.schoolName,
        currentStage: item.currentStage,
        region: item.region,
        primaryCareer: item.primaryCareer,
        secondaryCareer: item.secondaryCareer,
        totalParticipation: item.totalParticipation,
        latestResultAt: asKoreanExcelDate(item.latestResultAt),
        recommendedFaculty: item.recommendedFaculty,
        assignedFaculty: item.assignedFaculty,
        counselingStatus: item.counselingStatus,
      })))
    },
    appendAssessments(items: AdminExportAssessment[]): void {
      appendRows(assessments, assessmentColumns, items.map(item => ({
        nickname: item.nickname,
        sequence: item.sequence,
        participatedAt: asKoreanExcelDate(item.participatedAt),
        selectedWork: joined(item.selectedWork),
        selectedResult: joined(item.selectedResult),
        selectedStyle: joined(item.selectedStyle),
        selectedCareer: joined(item.selectedCareer),
        documentaryScore: item.documentaryScore,
        artPhotoScore: item.artPhotoScore,
        commercialScore: item.commercialScore,
        videoScore: item.videoScore,
        environmentScore: item.environmentScore,
        recommendedResources: joined(item.recommendedResources),
      })))
    },
    appendCounseling(items: AdminExportCounseling[]): void {
      appendRows(counseling, counselingColumns, items.map(item => ({
        nickname: item.nickname,
        requestedAt: asKoreanExcelDate(item.requestedAt),
        contactMethod: item.contactMethod,
        availability: item.availability,
        inquiry: item.inquiry,
        recommendedPrimaryFaculty: item.recommendedPrimaryFaculty,
        recommendedBackupFaculty: item.recommendedBackupFaculty,
        specialistFaculty: joined(item.specialistFaculty),
        assignedFaculty: item.assignedFaculty,
        status: item.status,
        contactedAt: asKoreanExcelDate(item.contactedAt),
        completedAt: asKoreanExcelDate(item.completedAt),
        result: item.result,
        adminNote: item.adminNote,
      })))
    },
  }
}

export const appendExportPageRows = async <Item>(
  load: (cursor: string | null) => Promise<Page<Item>>,
  append: (items: Item[]) => void,
  onBatch?: (batchSize: number, total: number) => void,
  requireCurrent: () => void = () => undefined,
): Promise<number> => {
  let cursor: string | null = null
  let total = 0
  const seen = new Set<string>()
  do {
    requireCurrent()
    const page = await load(cursor)
    requireCurrent()
    if (page.items.length > PAGE_SIZE) throw new Error('EXPORT_PAGE_INVALID')
    const batchSize = page.items.length
    try {
      requireCurrent()
      append(page.items)
      requireCurrent()
      total += batchSize
      onBatch?.(batchSize, total)
    }
    finally {
      page.items.length = 0
    }
    if (page.nextCursor !== null) {
      if (seen.has(page.nextCursor)) throw new Error('EXPORT_CURSOR_LOOP')
      seen.add(page.nextCursor)
    }
    requireCurrent()
    cursor = page.nextCursor
  } while (cursor !== null)
  return total
}

export const exportFilename = (date: Date): string => {
  const koreanWallClock = new Date(date.getTime() + KOREA_STANDARD_TIME_OFFSET_MS)
  const year = koreanWallClock.getUTCFullYear().toString().padStart(4, '0')
  const month = (koreanWallClock.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = koreanWallClock.getUTCDate().toString().padStart(2, '0')
  return `PHOTO_NEXT_students_${year}-${month}-${day}.xlsx`
}

const browserDownload = (buffer: ExcelBuffer, filename: string): void => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer)
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.hidden = true
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }
  finally {
    URL.revokeObjectURL(url)
  }
}

const defaultLoadExcel = async (): Promise<ExcelModule> => {
  const module = await import('exceljs')
  const direct = module as unknown as Partial<ExcelModule>
  const fallback = (module as unknown as { default?: Partial<ExcelModule> }).default
  const WorkbookConstructor = direct.Workbook ?? fallback?.Workbook
  if (!WorkbookConstructor) throw new Error('EXPORT_WORKBOOK_MODULE_INVALID')
  return { Workbook: WorkbookConstructor }
}

const getNuxtFetch = (): Fetcher => $fetch as unknown as Fetcher

const defaultDependencies = (): XlsxExportDependencies => ({
  download: browserDownload,
  fetcher: (url, options) => getNuxtFetch()(url, options),
  getAuthorizationHeaders: () => useAdminSessionStore().authorizationHeaders(),
  loadExcel: defaultLoadExcel,
  now: () => new Date(),
  recoverAuth: async () => {
    useAdminSessionStore().clear()
    await navigateTo({ path: '/admin/login', query: { redirect: '/admin/export' } }, { replace: true })
  },
})

const initialState = (): XlsxExportState => ({
  busy: false,
  canRetry: false,
  currentSheet: null,
  error: '',
  filename: '',
  message: '내보낼 범위를 확인해 주세요.',
  phase: 'idle',
  rows: { students: 0, assessments: 0, counseling: 0 },
})

const errorCode = (error: unknown): string => {
  if (error instanceof Error && AUTH_CODES.has(error.message)) return error.message
  if (typeof error !== 'object' || error === null) return ''
  const payload = error as { data?: { error?: { code?: unknown } }, message?: unknown }
  if (typeof payload.data?.error?.code === 'string') return payload.data.error.code
  return typeof payload.message === 'string' ? payload.message : ''
}

class ExportDisposed extends Error {}

type PendingDownload = {
  browserDownloaded: boolean
  buffer: ExcelBuffer
  filename: string
  jobId: number
  rows: Record<ExportSheetKey, number>
}

export const useXlsxExport = (
  overrides: Partial<XlsxExportDependencies> = {},
): { dispose: () => void, start: (filters: AdminExportFilter) => Promise<void>, state: Ref<XlsxExportState> } => {
  const dependencies = { ...defaultDependencies(), ...overrides }
  const state = ref<XlsxExportState>(initialState())
  let active = true
  let activeController: AbortController | null = null
  let generation = 0
  let pendingDownload: PendingDownload | null = null
  let running: Promise<void> | null = null

  const isCurrent = (version: number): boolean => active && generation === version
  const patchState = (version: number, patch: Partial<XlsxExportState>): void => {
    if (!isCurrent(version)) return
    state.value = {
      ...state.value,
      ...patch,
      rows: patch.rows ? { ...patch.rows } : { ...state.value.rows },
    }
  }
  const requireCurrent = (version: number): void => {
    if (!isCurrent(version)) throw new ExportDisposed()
  }
  const headers = (): Record<string, string> => dependencies.getAuthorizationHeaders()
  const loadPage = async <Item>(
    url: string,
    cursor: string | null,
    schema: z.ZodType<{ data: Page<Item>, requestId: string }>,
    signal: AbortSignal,
    version: number,
  ): Promise<Page<Item>> => {
    requireCurrent(version)
    const response = await dependencies.fetcher(url, {
      headers: headers(),
      signal,
      ...(cursor === null ? {} : { query: { cursor } }),
    })
    requireCurrent(version)
    const page = schema.parse(response).data
    requireCurrent(version)
    return page
  }

  const recoverOrPatchFailure = async (
    error: unknown,
    version: number,
    options: { pending: PendingDownload | null },
  ): Promise<void> => {
    if (error instanceof ExportDisposed || !isCurrent(version)) return
    const code = errorCode(error)
    const authFailure = AUTH_CODES.has(code)
    if (authFailure) await dependencies.recoverAuth('/admin/login?redirect=/admin/export')
    if (!isCurrent(version)) return
    const pending = options.pending
    patchState(version, {
      busy: false,
      canRetry: !authFailure,
      currentSheet: null,
      error: authFailure
        ? '최근 인증이 필요합니다. 로그인 화면에서 다시 인증해 주세요.'
        : pending?.browserDownloaded
          ? '파일은 다운로드됐지만 서버 확인을 완료하지 못했습니다. 다시 시도해 주세요.'
          : pending
            ? '완성된 파일 다운로드를 시작하지 못했습니다. 다시 시도해 주세요.'
            : '내보내기를 완료하지 못했습니다. 필터를 확인한 뒤 다시 시도해 주세요.',
      message: pending?.browserDownloaded
        ? '다운로드 확인을 다시 시도할 수 있습니다.'
        : pending
          ? '서버 작업은 완료됐으며 파일 다운로드만 다시 시도할 수 있습니다.'
          : '서버 작업을 종료했습니다.',
      phase: 'failed',
    })
  }

  const deliverPendingDownload = async (
    version: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const pending = pendingDownload
    if (pending === null) throw new Error('EXPORT_DOWNLOAD_PENDING_MISSING')
    requireCurrent(version)
    if (!pending.browserDownloaded) {
      patchState(version, {
        busy: true,
        canRetry: false,
        message: '완성된 XLSX 다운로드를 시작하고 있습니다.',
        phase: 'finalizing',
      })
      await dependencies.download(pending.buffer, pending.filename)
      requireCurrent(version)
      pending.browserDownloaded = true
    }
    patchState(version, {
      busy: true,
      canRetry: false,
      message: '다운로드 완료를 서버에 확인하고 있습니다.',
      phase: 'finalizing',
    })
    requireCurrent(version)
    downloadedJobEnvelopeSchema.parse(await dependencies.fetcher(
      `/api/admin/export/${pending.jobId}/downloaded`,
      {
        method: 'POST',
        headers: headers(),
        signal,
      },
    ))
    requireCurrent(version)
    pendingDownload = null
    patchState(version, {
      busy: false,
      canRetry: false,
      filename: pending.filename,
      message: `${pending.filename} 다운로드를 완료했습니다.`,
      phase: 'completed',
      rows: { ...pending.rows },
    })
  }

  const run = async (
    rawFilters: AdminExportFilter,
    version: number,
    signal: AbortSignal,
  ): Promise<void> => {
    let failureCode: AdminExportFailureCode = 'EXPORT_FETCH_FAILED'
    let jobId: number | null = null
    let terminalSent = false
    try {
      patchState(version, {
        ...initialState(),
        busy: true,
        message: '필터 범위를 검증하고 있습니다.',
        phase: 'checking',
      })
      const filters = adminExportFilterSchema.parse(rawFilters)
      requireCurrent(version)
      patchState(version, { message: '최근 15분 내 인증 상태를 확인하고 있습니다.', phase: 'authenticating' })
      const create = jobEnvelopeSchema.parse(await dependencies.fetcher('/api/admin/export', {
        method: 'POST',
        headers: headers(),
        body: { filters },
        signal,
      })).data
      jobId = create.id
      requireCurrent(version)

      failureCode = 'EXPORT_WORKBOOK_FAILED'
      const { Workbook: WorkbookConstructor } = await dependencies.loadExcel()
      requireCurrent(version)
      const workbook = new WorkbookConstructor()
      const writer = createAdminExportWorkbook(workbook)

      failureCode = 'EXPORT_FETCH_FAILED'
      const rows = { students: 0, assessments: 0, counseling: 0 }
      patchState(version, { currentSheet: '학생목록', message: '학생목록 행을 수집하고 있습니다.', phase: 'collecting' })
      rows.students = await appendExportPageRows(
        cursor => loadPage(`/api/admin/export/${jobId}/students`, cursor, studentPageEnvelopeSchema, signal, version),
        writer.appendStudents,
        (_batch, total) => patchState(version, { rows: { ...rows, students: total }, message: `학생목록 ${total.toLocaleString('ko-KR')}행 수집` }),
        () => requireCurrent(version),
      )
      requireCurrent(version)
      patchState(version, { currentSheet: '최근참여이력', message: '최근참여이력 행을 수집하고 있습니다.', rows: { ...rows } })
      rows.assessments = await appendExportPageRows(
        cursor => loadPage(`/api/admin/export/${jobId}/assessments`, cursor, assessmentPageEnvelopeSchema, signal, version),
        writer.appendAssessments,
        (_batch, total) => patchState(version, { rows: { ...rows, assessments: total }, message: `최근참여이력 ${total.toLocaleString('ko-KR')}행 수집` }),
        () => requireCurrent(version),
      )
      requireCurrent(version)
      patchState(version, { currentSheet: '상담현황', message: '상담현황 행을 수집하고 있습니다.', rows: { ...rows } })
      rows.counseling = await appendExportPageRows(
        cursor => loadPage(`/api/admin/export/${jobId}/counseling`, cursor, counselingPageEnvelopeSchema, signal, version),
        writer.appendCounseling,
        (_batch, total) => patchState(version, { rows: { ...rows, counseling: total }, message: `상담현황 ${total.toLocaleString('ko-KR')}행 수집` }),
        () => requireCurrent(version),
      )
      requireCurrent(version)

      failureCode = 'EXPORT_WORKBOOK_FAILED'
      patchState(version, { currentSheet: null, message: '워크북 파일을 생성하고 있습니다.', phase: 'building', rows: { ...rows } })
      const buffer = await workbook.xlsx.writeBuffer()
      requireCurrent(version)

      failureCode = 'EXPORT_FETCH_FAILED'
      patchState(version, { message: '서버 작업을 완료 상태로 확정하고 있습니다.', phase: 'finalizing' })
      completedJobEnvelopeSchema.parse(await dependencies.fetcher(`/api/admin/export/${jobId}/complete`, {
        method: 'POST',
        headers: headers(),
        signal,
        body: {
          status: 'completed',
          studentRowCount: rows.students,
          participationRowCount: rows.assessments,
          counselingRowCount: rows.counseling,
          downloaded: false,
        },
      }))
      terminalSent = true
      requireCurrent(version)

      failureCode = 'EXPORT_DOWNLOAD_FAILED'
      const filename = exportFilename(dependencies.now())
      pendingDownload = {
        browserDownloaded: false,
        buffer,
        filename,
        jobId,
        rows: { ...rows },
      }
      await deliverPendingDownload(version, signal)
    }
    catch (error) {
      if (error instanceof ExportDisposed || !isCurrent(version)) return
      const code = errorCode(error)
      const authFailure = AUTH_CODES.has(code)
      if (jobId !== null && !terminalSent) {
        try {
          await dependencies.fetcher(`/api/admin/export/${jobId}/complete`, {
            method: 'POST',
            headers: headers(),
            signal,
            body: {
              status: 'failed',
              studentRowCount: state.value.rows.students,
              participationRowCount: state.value.rows.assessments,
              counselingRowCount: state.value.rows.counseling,
              downloaded: false,
              errorCode: authFailure ? 'EXPORT_REAUTH_REQUIRED' : failureCode,
            },
          })
        }
        catch { /* best-effort terminal when auth or transport is already unavailable */ }
      }
      await recoverOrPatchFailure(error, version, {
        pending: terminalSent ? pendingDownload : null,
      })
    }
  }

  const start = (filters: AdminExportFilter): Promise<void> => {
    if (running !== null) return running
    const version = ++generation
    const controller = new AbortController()
    activeController = controller
    const promise = (
      pendingDownload === null
        ? run(filters, version, controller.signal)
        : deliverPendingDownload(version, controller.signal).catch(error => (
            recoverOrPatchFailure(error, version, { pending: pendingDownload })
          ))
    ).finally(() => {
      if (running === promise) running = null
      if (activeController === controller) activeController = null
    })
    running = promise
    return promise
  }

  const dispose = (): void => {
    active = false
    generation += 1
    activeController?.abort()
    activeController = null
    pendingDownload = null
    running = null
  }

  return { dispose, start, state }
}
