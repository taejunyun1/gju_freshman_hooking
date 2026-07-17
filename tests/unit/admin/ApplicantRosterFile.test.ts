import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { parseApplicantRosterFile } from '../../../app/utils/applicant-roster-file'

type RosterFile = {
  name: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
  text: () => Promise<string>
}

const headers = ['이름', '연락처', '출신고교', '학년']

const asFile = (name: string, bytes: Uint8Array, text = ''): RosterFile => ({
  name,
  size: bytes.byteLength,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  text: async () => text,
})

const xlsxFile = async (configure: (workbook: ExcelJS.Workbook) => void): Promise<RosterFile> => {
  const workbook = new ExcelJS.Workbook()
  configure(workbook)
  return asFile('applicants.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()))
}

const validSheet = (workbook: ExcelJS.Workbook) => {
  const sheet = workbook.addWorksheet('지원자')
  sheet.addRow(headers)
  sheet.addRow(['홍길동', '010-1234-5678', '서울사진고', '고3'])
  return sheet
}

describe('applicant roster file parser', () => {
  it('parses the exact Korean headers, normalizes values, and ignores empty rows', async () => {
    const file = await xlsxFile(workbook => {
      const sheet = validSheet(workbook)
      sheet.addRow([null, null, null, null])
    })

    await expect(parseApplicantRosterFile(file)).resolves.toEqual([{
      name: '홍길동', phone: '01012345678', highSchool: '서울사진고', grade: 'high3',
    }])
  })

  it('rejects a workbook with more than one worksheet including a hidden worksheet', async () => {
    const twoSheetFile = await xlsxFile(workbook => {
      validSheet(workbook)
      workbook.addWorksheet('추가')
    })
    const hiddenExtraSheetFile = await xlsxFile(workbook => {
      validSheet(workbook)
      workbook.addWorksheet('숨김').state = 'hidden'
    })

    await expect(parseApplicantRosterFile(twoSheetFile)).rejects.toThrow('ROSTER_FILE_INVALID')
    await expect(parseApplicantRosterFile(hiddenExtraSheetFile)).rejects.toThrow('ROSTER_FILE_INVALID')
  })

  it('rejects formulas, changed headers, and duplicate normalized phones', async () => {
    const formulaFile = await xlsxFile(workbook => {
      const sheet = validSheet(workbook)
      sheet.getCell('A3').value = { formula: '"새 지원자"', result: '새 지원자' }
      sheet.getCell('B3').value = '010-9876-5432'
      sheet.getCell('C3').value = '부산고'
      sheet.getCell('D3').value = '고2'
    })
    const headerFile = await xlsxFile(workbook => {
      const sheet = validSheet(workbook)
      sheet.getCell('B1').value = '전화번호'
    })
    const duplicateFile = await xlsxFile(workbook => {
      const sheet = validSheet(workbook)
      sheet.addRow(['임꺽정', '010 1234 5678', '부산고', '고2'])
    })

    await expect(parseApplicantRosterFile(formulaFile)).rejects.toThrow('ROSTER_FILE_INVALID')
    await expect(parseApplicantRosterFile(headerFile)).rejects.toThrow('ROSTER_FILE_INVALID')
    await expect(parseApplicantRosterFile(duplicateFile)).rejects.toThrow('ROSTER_FILE_INVALID')
  })

  it('maps normalized-row schema failures to the roster file error', async () => {
    const invalidRowFile = await xlsxFile(workbook => {
      const sheet = validSheet(workbook)
      sheet.addRow(['잘못된 전화번호', '010-12', '서울사진고', '고3'])
    })

    await expect(parseApplicantRosterFile(invalidRowFile)).rejects.toThrow('ROSTER_FILE_INVALID')

    const invalidCsv = '이름,연락처,출신고교,학년\n잘못된 전화번호,010-12,서울사진고,고3'
    await expect(parseApplicantRosterFile(asFile(
      'applicants.csv',
      new TextEncoder().encode(invalidCsv),
      invalidCsv,
    ))).rejects.toThrow('ROSTER_FILE_INVALID')
  })

  it('accepts quoted CSV commas and newlines for 200 normalized rows', async () => {
    const records = [headers.join(',')]
    for (let index = 0; index < 200; index++) {
      const phone = `010${String(index).padStart(8, '0')}`
      records.push(`"지원자 ${index + 1}",${phone},"서울, 사진\n고등학교",고3`)
    }
    const text = records.join('\n')
    const file = asFile('applicants.csv', new TextEncoder().encode(text), text)

    const parsed = await parseApplicantRosterFile(file)

    expect(parsed).toHaveLength(200)
    expect(parsed[0]).toMatchObject({ phone: '01000000000', highSchool: '서울, 사진\n고등학교' })
  })

  it('ignores fully empty CSV rows even when they contain trailing commas', async () => {
    const text = [
      headers.join(','),
      ',,,,',
      '홍길동,010-1234-5678,서울사진고,고3',
      ',,,',
    ].join('\n')

    await expect(parseApplicantRosterFile(asFile(
      'applicants.csv',
      new TextEncoder().encode(text),
      text,
    ))).resolves.toEqual([{
      name: '홍길동', phone: '01012345678', highSchool: '서울사진고', grade: 'high3',
    }])
  })

  it('enforces the two MiB source size and 500 normalized row limits', async () => {
    const tooLarge: RosterFile = {
      ...asFile('large.csv', new Uint8Array(1), '이름,연락처,출신고교,학년'),
      size: 2 * 1024 * 1024 + 1,
    }
    const tooManyRows = await xlsxFile(workbook => {
      const sheet = workbook.addWorksheet('지원자')
      sheet.addRow(headers)
      for (let index = 0; index < 501; index++) {
        sheet.addRow([`지원자${index}`, `010${String(index).padStart(8, '0')}`, '사진고', '고3'])
      }
    })

    await expect(parseApplicantRosterFile(tooLarge)).rejects.toThrow('ROSTER_FILE_TOO_LARGE')
    await expect(parseApplicantRosterFile(tooManyRows)).rejects.toThrow('ROSTER_FILE_INVALID')
  })
})
