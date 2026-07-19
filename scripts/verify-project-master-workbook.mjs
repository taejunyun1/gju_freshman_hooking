import fs from 'node:fs/promises'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const inputPath = process.argv[2]
if (!inputPath) throw new Error('Usage: verify-project-master-workbook.mjs <workbook.xlsx>')

const source = await FileBlob.load(inputPath)
const workbook = await SpreadsheetFile.importXlsx(source)
const summary = await workbook.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 8_000,
  tableMaxRows: 6,
  tableMaxCols: 12,
})
const projectSheet = workbook.worksheets.getItem('프로젝트_통합')
const summarySheet = workbook.worksheets.getItem('노출_요약')
const values = projectSheet.getRange('A1:Z44').values
const headers = values[0]
const rows = values.slice(1).filter(row => row.some(value => value !== null && value !== ''))
const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'formula errors',
})
const overview = {
  sheets: workbook.worksheets.items.map(sheet => sheet.name),
  headers,
  rowCount: rows.length,
  currentCount: rows.filter(row => row[22] === '현재_우선').length,
  recentCount: rows.filter(row => row[22] === '최근_사례').length,
  legacyCount: rows.filter(row => row[22] === '축적_경험').length,
  cancelledCount: rows.filter(row => row.some(value => String(value).includes('사진단오제'))).length,
  summaryCounts: summarySheet.getRange('A3:C6').values,
  inspect: summary.ndjson,
  formulaErrors: errors.ndjson,
}
console.log(JSON.stringify(overview, null, 2))
await fs.writeFile(`${inputPath}.verify.json`, `${JSON.stringify(overview, null, 2)}\n`, 'utf8')
