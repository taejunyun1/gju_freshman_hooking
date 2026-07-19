import fs from 'node:fs/promises'
import { dirname } from 'node:path'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const [inputPath, catalogPath, outputPath, previewDir] = process.argv.slice(2)
if (!inputPath || !catalogPath || !outputPath || !previewDir) {
  throw new Error('Usage: build-project-master-workbook.mjs <input.xlsx> <catalog.json> <output.xlsx> <preview-dir>')
}

const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
const source = await FileBlob.load(inputPath)
const workbook = await SpreadsheetFile.importXlsx(source)
const sheet = workbook.worksheets.getItem('프로젝트_입력')
sheet.name = '프로젝트_통합'
sheet.showGridLines = false

const rowFor = (entry) => [
  entry.key,
  entry.category,
  entry.title,
  entry.status,
  entry.startDate ? new Date(`${entry.startDate}T00:00:00Z`) : null,
  entry.endDate ? new Date(`${entry.endDate}T00:00:00Z`) : null,
  entry.periodLabel,
  entry.summary,
  entry.activities,
  entry.outcomes,
  entry.primaryTrack,
  entry.secondaryTracks.join(';'),
  entry.tags.join(';'),
  entry.connectionText,
  entry.locations,
  entry.faculty.join(';'),
  entry.sourcePageTitle,
  entry.sourceUrl ?? '',
  entry.sourceCheckedAt ? new Date(`${entry.sourceCheckedAt}T00:00:00Z`) : null,
  entry.verificationNote,
  entry.priority,
  entry.year,
  entry.year === 2026 ? '현재_우선' : entry.year === 2025 ? '최근_사례' : '축적_경험',
  entry.programGroup,
  entry.semester ?? '',
  entry.displayKind,
]

sheet.getRange('A2:Z205').clear({ applyTo: 'contents' })
sheet.getRange('V1:Z1').values = [[
  '사업연도', '노출단계', '사업그룹', '운영학기', '표시분류',
]]
sheet.getRange(`A2:Z${catalog.length + 1}`).values = catalog.map(rowFor)
sheet.getRange('V1:Z1').format = {
  fill: '#1D4ED8',
  font: { bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  wrapText: true,
}
sheet.getRange(`A1:Z${catalog.length + 1}`).format.wrapText = true
sheet.getRange(`E2:F${catalog.length + 1}`).format.numberFormat = 'yyyy-mm-dd'
sheet.getRange(`S2:S${catalog.length + 1}`).format.numberFormat = 'yyyy-mm-dd'
sheet.getRange(`U2:V${catalog.length + 1}`).format.numberFormat = '0'
sheet.getRange(`A1:Z${catalog.length + 1}`).format.borders = {
  preset: 'inside', style: 'thin', color: '#D6E2FA',
}
sheet.getRange(`A1:Z${catalog.length + 1}`).format.rowHeight = 34
sheet.getRange('A:A').format.columnWidth = 28
sheet.getRange('B:B').format.columnWidth = 15
sheet.getRange('C:C').format.columnWidth = 34
sheet.getRange('D:D').format.columnWidth = 12
sheet.getRange('E:F').format.columnWidth = 13
sheet.getRange('G:G').format.columnWidth = 22
sheet.getRange('H:J').format.columnWidth = 38
sheet.getRange('K:Q').format.columnWidth = 22
sheet.getRange('R:R').format.columnWidth = 32
sheet.getRange('S:S').format.columnWidth = 14
sheet.getRange('T:T').format.columnWidth = 45
sheet.getRange('U:Z').format.columnWidth = 18
sheet.freezePanes.freezeRows(1)

const summary = workbook.worksheets.add('노출_요약')
summary.showGridLines = false
summary.getRange('A1:E1').merge()
summary.getRange('A1').values = [['PHOTO:NEXT 프로젝트 노출 요약']]
summary.getRange('A1:E1').format = {
  fill: '#1D4ED8',
  font: { bold: true, color: '#FFFFFF', size: 14 },
  horizontalAlignment: 'left',
  verticalAlignment: 'center',
}
summary.getRange('A3:C3').values = [['구분', '건수', '화면 역할']]
summary.getRange('A4:C6').values = [
  ['2026 현재 우선', null, '관심사에 맞는 메인 프로젝트 최대 3개'],
  ['2025 최근 사례', null, '학과가 축적한 경험 카드 후보'],
  ['2024 이전 경험', null, '학과가 축적한 경험 카드 후보'],
]
summary.getRange('B4').formulas = [["=COUNTIF('프로젝트_통합'!$W$2:$W$44,\"현재_우선\")"]]
summary.getRange('B5').formulas = [["=COUNTIF('프로젝트_통합'!$W$2:$W$44,\"최근_사례\")"]]
summary.getRange('B6').formulas = [["=COUNTIF('프로젝트_통합'!$W$2:$W$44,\"축적_경험\")"]]
summary.getRange('A8:E8').merge()
summary.getRange('A8').values = [['2026 프로그램은 수요조사 근거를 기준으로 표시하며, 실제 운영 일정은 학과 확인이 필요합니다.']]
summary.getRange('A3:C6').format = { borders: { preset: 'all', style: 'thin', color: '#BFD2FF' } }
summary.getRange('A3:C3').format = { fill: '#EAF1FF', font: { bold: true, color: '#18345F' } }
summary.getRange('A4:A6').format.font = { bold: true, color: '#1D4ED8' }
summary.getRange('A8:E8').format = { fill: '#F5F8FF', font: { color: '#43526D', italic: true }, wrapText: true }
summary.getRange('A:A').format.columnWidth = 24
summary.getRange('B:B').format.columnWidth = 12
summary.getRange('C:C').format.columnWidth = 44
summary.getRange('A1:E1').format.rowHeight = 30
summary.getRange('A8:E8').format.rowHeight = 28

const guide = workbook.worksheets.getItem('작성_가이드')
guide.getRange('A20:D20').merge()
guide.getRange('A20').values = [['연도별 화면 노출 규칙']]
guide.getRange('A21:D23').values = [
  ['2026', '현재_우선', '메인프로젝트', '관심사에 맞는 최대 3개'],
  ['2025', '최근_사례', '최근사례', '학과가 축적한 경험 카드 후보'],
  ['2024 이전', '축적_경험', '짧은경험', '학과가 축적한 경험 카드 후보'],
]
guide.getRange('A20:D20').format = { fill: '#1D4ED8', font: { bold: true, color: '#FFFFFF' } }
guide.getRange('A21:D23').format = { borders: { preset: 'all', style: 'thin', color: '#D6E2FA' }, wrapText: true }
guide.getRange('A21:A23').format.font = { bold: true, color: '#1D4ED8' }
guide.getRange('A:D').format.columnWidth = 27

await fs.mkdir(dirname(outputPath), { recursive: true })
await fs.mkdir(previewDir, { recursive: true })
const xlsx = await SpreadsheetFile.exportXlsx(workbook)
await xlsx.save(outputPath)

for (const sheetName of ['프로젝트_통합', '노출_요약', '작성_가이드', '태그_목록']) {
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 0.8, format: 'png' })
  await fs.writeFile(`${previewDir}/${sheetName}.png`, new Uint8Array(await preview.arrayBuffer()))
}

console.log(JSON.stringify({ outputPath, rows: catalog.length, sheets: 4 }, null, 2))
