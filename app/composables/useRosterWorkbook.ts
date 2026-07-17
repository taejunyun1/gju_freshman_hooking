import type { Buffer as ExcelBuffer, Workbook } from 'exceljs'

import type { RosterCredential } from '../../shared/schemas/admission-roster'

const TEMPLATE_HEADERS = ['이름', '연락처', '출신고교', '학년']
const CREDENTIAL_HEADERS = ['이름', '연락처', '초기 비밀번호']
const FORMULA_PREFIX = /^[=+\-@]/u

const safeCellText = (value: string): string => FORMULA_PREFIX.test(value) ? `'${value}` : value

const addSheet = (workbook: Workbook, name: string, headers: string[]) => {
  const sheet = workbook.addWorksheet(name)
  sheet.addRow(headers)
  sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }]
  sheet.getRow(1).font = { bold: true }
  return sheet
}

export const createRosterTemplate = (workbook: Workbook): Workbook => {
  addSheet(workbook, '지원자명단', TEMPLATE_HEADERS)
  return workbook
}

export const createCredentialWorkbook = (workbook: Workbook, credentials: RosterCredential[]): Workbook => {
  const sheet = addSheet(workbook, '초기비밀번호', CREDENTIAL_HEADERS)
  for (const credential of credentials) {
    sheet.addRow([
      safeCellText(credential.name),
      safeCellText(credential.phone),
      safeCellText(credential.password),
    ])
  }
  return workbook
}

export const downloadRosterWorkbook = (buffer: ExcelBuffer, filename: string): void => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
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
