import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'

import {
  createCredentialWorkbook,
  createRosterTemplate,
  downloadRosterWorkbook,
} from '../../../app/composables/useRosterWorkbook'

describe('applicant roster workbooks', () => {
  it('creates a one-sheet template with exactly the four source columns', () => {
    const workbook = new ExcelJS.Workbook()

    createRosterTemplate(workbook)

    expect(workbook.worksheets).toHaveLength(1)
    expect(workbook.worksheets[0]!.getRow(1).values).toEqual([
      undefined, '이름', '연락처', '출신고교', '학년',
    ])
  })

  it('creates credential rows without formulas and escapes formula-injection prefixes', () => {
    const workbook = new ExcelJS.Workbook()

    createCredentialWorkbook(workbook, [{
      name: '=HYPERLINK("https://unsafe.example")',
      phone: '+01012345678',
      password: '@password-1',
    }])

    const sheet = workbook.worksheets[0]!
    expect(sheet.getRow(1).values).toEqual([undefined, '이름', '연락처', '초기 비밀번호'])
    expect(sheet.getRow(2).values).toEqual([
      undefined,
      "'=HYPERLINK(\"https://unsafe.example\")",
      "'+01012345678",
      "'@password-1",
    ])
    sheet.eachRow(row => row.eachCell(cell => expect(cell.type).not.toBe(6)))
  })

  it('downloads only the supplied in-memory buffer', () => {
    const createObjectURL = vi.fn(() => 'blob:roster')
    const revokeObjectURL = vi.fn()
    const click = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName)
      if (tagName === 'a') vi.spyOn(element, 'click').mockImplementation(click)
      return element
    })

    downloadRosterWorkbook(new Uint8Array([1, 2, 3]), 'credentials.xlsx')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:roster')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
})

