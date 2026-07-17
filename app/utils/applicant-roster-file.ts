import type { CellValue, Workbook, Worksheet } from 'exceljs'

import {
  MAX_APPLICANT_ROSTER_ROWS,
  applicantRosterRowSchema,
  type ApplicantRosterRow,
} from '../../shared/schemas/admission-roster'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const ROSTER_HEADERS = ['이름', '연락처', '출신고교', '학년'] as const

export type ApplicantRosterFile = Pick<File, 'name' | 'size' | 'arrayBuffer' | 'text'>

const invalid = (): never => {
  throw new Error('ROSTER_FILE_INVALID')
}

const textCell = (value: CellValue): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return invalid()
}

const isFormula = (value: CellValue): boolean => (
  typeof value === 'object' && value !== null && 'formula' in value
)

const parseCsv = (source: string): string[][] => {
  const records: string[][] = []
  let record: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          value += '"'
          index++
        }
        else quoted = false
      }
      else value += character
      continue
    }
    if (character === '"') {
      if (value !== '') invalid()
      quoted = true
    }
    else if (character === ',') {
      record.push(value)
      value = ''
    }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index++
      record.push(value)
      records.push(record)
      record = []
      value = ''
    }
    else value += character
  }
  if (quoted) invalid()
  if (value !== '' || record.length > 0) {
    record.push(value)
    records.push(record)
  }
  return records
}

const validateRows = (rows: string[][]): ApplicantRosterRow[] => {
  const [header, ...data] = rows
  if (
    !header
    || header.length !== ROSTER_HEADERS.length
    || header.some((value, index) => value !== ROSTER_HEADERS[index])
  ) invalid()

  const parsed: ApplicantRosterRow[] = []
  const phones = new Set<string>()
  for (const row of data) {
    const trimmedRow = [...row]
    while (trimmedRow.length > 0 && trimmedRow.at(-1)?.trim() === '') trimmedRow.pop()
    if (trimmedRow.length === 0) continue
    if (trimmedRow.length > ROSTER_HEADERS.length) invalid()
    const fields = ROSTER_HEADERS.map((_, index) => trimmedRow[index] ?? '')
    let candidate: ReturnType<typeof applicantRosterRowSchema.safeParse>
    try {
      candidate = applicantRosterRowSchema.safeParse({
        name: fields[0],
        phone: fields[1],
        highSchool: fields[2],
        grade: fields[3],
      })
    }
    catch {
      return invalid()
    }
    if (!candidate.success) invalid()
    const normalized = candidate.data
    if (normalized === undefined) return invalid()
    if (phones.has(normalized.phone)) invalid()
    phones.add(normalized.phone)
    parsed.push(normalized)
    if (parsed.length > MAX_APPLICANT_ROSTER_ROWS) invalid()
  }
  if (parsed.length === 0) invalid()
  return parsed
}

const rowsFromWorksheet = (worksheet: Worksheet): string[][] => {
  const rows: string[][] = []
  const columnCount = Math.max(worksheet.columnCount, ROSTER_HEADERS.length)
  worksheet.eachRow({ includeEmpty: true }, row => {
    const values: string[] = []
    for (let column = 1; column <= columnCount; column++) {
      const cell = row.getCell(column)
      if (isFormula(cell.value)) invalid()
      values.push(textCell(cell.value))
    }
    while (values.length > ROSTER_HEADERS.length && values.at(-1) === '') values.pop()
    rows.push(values)
  })
  return rows
}

const loadWorkbook = async (): Promise<Workbook> => {
  const module = await import('exceljs')
  const direct = module as unknown as { Workbook?: new () => Workbook }
  const fallback = (module as unknown as { default?: { Workbook?: new () => Workbook } }).default
  const WorkbookConstructor = direct.Workbook ?? fallback?.Workbook
  if (!WorkbookConstructor) return invalid()
  return new WorkbookConstructor()
}

export const parseApplicantRosterFile = async (file: ApplicantRosterFile): Promise<ApplicantRosterRow[]> => {
  if (file.size > MAX_FILE_BYTES) throw new Error('ROSTER_FILE_TOO_LARGE')
  if (file.name.toLowerCase().endsWith('.csv')) return validateRows(parseCsv(await file.text()))

  try {
    const workbook = await loadWorkbook()
    await workbook.xlsx.load(await file.arrayBuffer())
    if (workbook.worksheets.length !== 1 || workbook.worksheets[0]?.state !== 'visible') invalid()
    return validateRows(rowsFromWorksheet(workbook.worksheets[0]!))
  }
  catch (error) {
    if (error instanceof Error && error.message === 'ROSTER_FILE_INVALID') throw error
    return invalid()
  }
}
