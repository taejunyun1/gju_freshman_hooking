import fs from 'node:fs/promises'
import { dirname } from 'node:path'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const inputPath = process.argv[2]
const outputPath = process.argv[3]

if (!inputPath || !outputPath) {
  throw new Error('Usage: generate-project-catalog.mjs <input.xlsx> <output.json>')
}

const asText = (value) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
const excelDateToIso = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000)
  return date.toISOString().slice(0, 10)
}
const splitSemicolon = (value) => asText(value).split(';').map(item => item.trim()).filter(Boolean)
const yearOf = (periodLabel, startDate) => {
  const matched = /20\d{2}/u.exec(periodLabel)
  if (matched) return Number(matched[0])
  return startDate ? Number(startDate.slice(0, 4)) : 2024
}

const commonCurrent = {
  sourcePageTitle: 'K-컬처리딩센터 3+1 전략 기반 학과별 세부프로그램 수요조사서',
  sourceUrl: null,
  sourceCheckedAt: '2026-07-19',
  programGroup: 'K-컬처리딩센터',
  displayTier: 'current',
  displayKind: '메인프로젝트',
  cancelled: false,
}

const currentProgram = ({
  key,
  category,
  title,
  semester,
  status = '예정',
  statusLabel = '2026 운영 예정',
  summary,
  activities,
  outcomes,
  primaryTrack,
  secondaryTracks = [],
  tags,
  connectionText,
  locations,
  faculty,
  priority = 200,
  verificationNote = '사용자 제공 수요조사 화면 기준입니다. 실제 일정과 운영 여부는 학과 확인이 필요합니다.',
}) => ({
  ...commonCurrent,
  key,
  category,
  title,
  year: 2026,
  status,
  statusLabel,
  startDate: null,
  endDate: null,
  semester,
  periodLabel: `2026년 ${semester}`,
  summary,
  activities,
  outcomes,
  primaryTrack,
  secondaryTracks,
  tags,
  connectionText,
  locations,
  faculty,
  priority,
  verificationNote,
})

const currentPrograms = [
  currentProgram({
    key: 'photo_next_2026_projection_mapping_acc',
    category: '전문가강좌',
    title: '프로젝션 매핑 집중교육',
    semester: '1학기 · 30시간',
    summary: '국립아시아문화전당과 연계해 프로젝션 매핑의 기획부터 제작까지 30시간 실습으로 진행하는 프로그램입니다.',
    activities: '공간 조사, 영상·이미지 제작, 프로젝션 매핑 기획과 설치 실습',
    outcomes: '프로젝션 매핑 시안과 공간 기반 영상 결과물',
    primaryTrack: 'art_photo',
    secondaryTracks: ['video'],
    tags: ['media_art', 'installation', 'digital_image', 'planning', 'production', 'exhibition'],
    connectionText: '공간과 이미지를 결합해 전시형 미디어 작업으로 확장하는 경험',
    locations: '국립아시아문화전당',
    faculty: ['김사라'],
  }),
  currentProgram({
    key: 'photo_next_2026_fieldtrip_busan',
    category: '현장탐방',
    title: 'K-컬처 기관탐방: 부산 금정문화회관·금샘미술관',
    semester: '1학기',
    summary: '문화기관의 전시와 운영 방식을 현장에서 살피며 사진·영상 작업의 발표 환경을 이해하는 기관탐방입니다.',
    activities: '기관 리서치, 전시 관람, 현장 기록과 운영 방식 조사',
    outcomes: '기관 리서치 노트와 현장 기록',
    primaryTrack: 'art_photo',
    secondaryTracks: ['documentary'],
    tags: ['cultural_institution', 'exhibition', 'research', 'field', 'photography'],
    connectionText: '문화기관의 전시와 기록 방식을 자신의 작업 기획으로 연결하는 경험',
    locations: '부산 금정문화회관·금샘미술관',
    faculty: ['김사라'],
  }),
  currentProgram({
    key: 'photo_next_2026_fieldtrip_518_archive',
    category: '현장탐방',
    title: 'K-컬처 기관탐방: 5·18민주화운동기록관·전일빌딩245',
    semester: '1학기',
    summary: '광주의 역사적 장소와 기록기관을 방문해 공공 아카이브와 사진·영상 기록의 역할을 살피는 프로그램입니다.',
    activities: '기관 리서치, 기록물 관찰, 장소 조사와 현장 기록',
    outcomes: '지역 기록 리서치와 사진·영상 기록 시안',
    primaryTrack: 'documentary',
    secondaryTracks: ['art_photo'],
    tags: ['archive', 'local_culture', 'field', 'research', 'public_content', 'photography'],
    connectionText: '지역의 역사와 장소를 조사해 공공 기록 콘텐츠로 연결하는 경험',
    locations: '5·18민주화운동기록관·전일빌딩245',
    faculty: ['김사라'],
  }),
  currentProgram({
    key: 'photo_next_2026_518_eve_festival',
    category: '현장탐방·촬영',
    title: '5·18 전야제 현장탐방·촬영',
    semester: '1학기',
    summary: '5·18 전야제 현장을 관찰하고 사진·영상으로 기록하며 공공 행사 촬영의 역할과 윤리를 익히는 프로그램입니다.',
    activities: '행사 동선 파악, 현장 사진·영상 촬영과 기록 편집',
    outcomes: '행사 사진·영상 기록물',
    primaryTrack: 'documentary',
    secondaryTracks: ['video'],
    tags: ['local_culture', 'field', 'documentary', 'video', 'public_content', 'team'],
    connectionText: '공공 행사의 현장성과 사람을 책임 있게 기록하는 경험',
    locations: '광주 5·18 전야제 현장',
    faculty: ['조대연'],
  }),
  currentProgram({
    key: 'photo_next_2026_ai_generation_club',
    category: '동아리',
    title: 'AI 생성 동아리',
    semester: '2학기',
    summary: '북구관리공단과 연계해 생성형 AI를 사진·영상 기반 콘텐츠 제작에 적용해 보는 실습형 동아리입니다.',
    activities: 'AI 이미지·영상 생성, 프롬프트 설계, 콘텐츠 기획과 결과물 제작',
    outcomes: 'AI 기반 이미지·영상 콘텐츠',
    primaryTrack: 'video',
    secondaryTracks: ['art_photo'],
    tags: ['ai', 'digital_image', 'media_art', 'video', 'production', 'portfolio'],
    connectionText: 'AI 기술을 사진·영상 작업의 새로운 제작 도구로 연결하는 경험',
    locations: '광주대학교·북구관리공단 연계 현장',
    faculty: ['윤태준'],
  }),
  currentProgram({
    key: 'photo_next_2026_photo_video_contest',
    category: '출품지원',
    title: '사진·영상 공모전 출품 지원',
    semester: '1학기~2학기',
    summary: '사진과 영상 결과물을 공모전 출품 형식으로 다듬으며 포트폴리오의 완성도와 발표 경험을 높이는 지원 프로그램입니다.',
    activities: '작품 선별, 편집, 출품 기획과 포트폴리오 정리',
    outcomes: '공모전 출품작과 포트폴리오',
    primaryTrack: 'art_photo',
    secondaryTracks: ['video'],
    tags: ['portfolio', 'photography', 'video', 'editing', 'exhibition', 'planning'],
    connectionText: '개인 작업을 외부 발표와 포트폴리오 형식으로 완성하는 경험',
    locations: '광주대학교',
    faculty: ['윤태준'],
  }),
  currentProgram({
    key: 'photo_next_2026_gwangju_310_reenactment',
    category: '콘텐츠개발·이벤트',
    title: '광주 3·10 독립만세운동 재현행사 촬영',
    semester: '1학기',
    summary: '광주 3·10 독립만세운동 재현행사를 사진과 영상으로 기록해 지역 역사 콘텐츠로 제작하는 프로그램입니다.',
    activities: '행사 리서치, 촬영 동선 설계, 현장 사진·영상 기록과 편집',
    outcomes: '지역 역사 행사 사진·영상 콘텐츠',
    primaryTrack: 'documentary',
    secondaryTracks: ['video'],
    tags: ['local_culture', 'field', 'documentary', 'video', 'public_content', 'team'],
    connectionText: '지역의 역사적 장면을 사진과 영상으로 기록해 공공 콘텐츠로 연결하는 경험',
    locations: '광주 남구청 연계 행사 현장',
    faculty: ['조대연'],
  }),
  currentProgram({
    key: 'photo_next_2026_527_dawn_square',
    category: '콘텐츠개발·이벤트',
    title: '5·27 승리의 날 새벽광장 촬영',
    semester: '1학기',
    summary: '5·27 승리의 날 새벽광장을 사진과 영상으로 기록하며 지역 공동체의 기억을 시각 콘텐츠로 만드는 프로그램입니다.',
    activities: '행사 현장 촬영, 인물과 공간 기록, 사진·영상 편집',
    outcomes: '새벽광장 사진·영상 기록물',
    primaryTrack: 'documentary',
    secondaryTracks: ['video'],
    tags: ['local_culture', 'field', 'documentary', 'video', 'public_content', 'team'],
    connectionText: '사람과 장소의 기억을 현장 기록과 영상 콘텐츠로 연결하는 경험',
    locations: '광주 5·27 승리의 날 행사 현장',
    faculty: ['김사라'],
  }),
  currentProgram({
    key: 'photo_next_2026_documentary_film_acc',
    category: '콘텐츠개발',
    title: '다큐멘터리 영화 제작',
    semester: '1학기~2학기',
    summary: '국립아시아문화전당과 연계해 기획·촬영·편집을 거쳐 다큐멘터리 영화를 제작하는 프로젝트입니다.',
    activities: '주제 조사, 인터뷰, 영상촬영, 편집과 상영 준비',
    outcomes: '단편 다큐멘터리 영화',
    primaryTrack: 'video',
    secondaryTracks: ['documentary'],
    tags: ['documentary', 'interview', 'video', 'editing', 'production', 'portfolio'],
    connectionText: '사람과 주제를 조사해 영상 서사와 완성된 다큐멘터리로 만드는 경험',
    locations: '국립아시아문화전당',
    faculty: ['윤태준'],
  }),
  currentProgram({
    key: 'photo_next_2026_projection_mapping_north',
    category: '콘텐츠개발·이벤트',
    title: '프로젝션 매핑 기획·편집·쇼케이스',
    semester: '2학기',
    summary: '북구시설관리공단과 연계해 프로젝션 매핑 콘텐츠를 기획·편집하고 쇼케이스로 발표하는 프로그램입니다.',
    activities: '공간 리서치, 콘텐츠 기획, 이미지·영상 편집, 쇼케이스 설치와 운영',
    outcomes: '프로젝션 매핑 쇼케이스와 전시형 콘텐츠',
    primaryTrack: 'art_photo',
    secondaryTracks: ['video'],
    tags: ['media_art', 'installation', 'digital_image', 'video', 'planning', 'exhibition'],
    connectionText: '공간의 특성을 읽어 이미지와 영상을 전시형 작업으로 구현하는 경험',
    locations: '북구시설관리공단 연계 공간',
    faculty: ['김사라'],
  }),
  currentProgram({
    key: 'photo_next_2026_center_content_request',
    category: '콘텐츠개발·이벤트',
    title: 'K-컬처리딩센터 요청 콘텐츠·이벤트 제작',
    semester: '2학기',
    summary: 'K-컬처리딩센터의 실제 요청에 맞춰 사진·영상 콘텐츠와 이벤트 기록물을 제작하는 실무형 프로젝트입니다.',
    activities: '요청 분석, 촬영 기획, 사진·영상 제작과 현장 기록',
    outcomes: '기관 요청형 사진·영상 콘텐츠',
    primaryTrack: 'video',
    secondaryTracks: ['commercial', 'documentary'],
    tags: ['content', 'video', 'photography', 'production', 'field', 'team'],
    connectionText: '실제 기관의 요구를 분석해 사진·영상 제작 결과물로 완성하는 경험',
    locations: 'K-컬처리딩센터 연계 현장',
    faculty: ['윤태준'],
  }),
  currentProgram({
    key: 'photo_next_2026_documentary_bitgoeul',
    category: '이벤트',
    title: '다큐멘터리 영화촬영: 빛고을노인건강타운',
    semester: '1학기~2학기',
    status: '검토중',
    statusLabel: '2026 계획 검토',
    summary: '빛고을노인건강타운을 배경으로 다큐멘터리 영화촬영을 검토 중인 현장 기록 프로그램입니다.',
    activities: '현장 조사, 인터뷰와 영상촬영 계획 수립',
    outcomes: '다큐멘터리 촬영 계획과 영상 기록',
    primaryTrack: 'documentary',
    secondaryTracks: ['video'],
    tags: ['documentary', 'interview', 'field', 'video', 'local_culture', 'research'],
    connectionText: '사람의 삶을 인터뷰와 영상 기록으로 연결하는 다큐멘터리 제작 경험',
    locations: '빛고을노인건강타운',
    faculty: ['윤태준'],
    priority: 170,
    verificationNote: '사용자 제공 수요조사 화면에서 인사이트 프로그램 이동 검토 메모가 확인되어 계획 검토 상태로 표시합니다.',
  }),
  currentProgram({
    key: 'photo_next_2026_openlab_photo_exhibitions',
    category: '이벤트',
    title: 'K-컬처 오픈랩 연계 사진전시 2회',
    semester: '2학기',
    summary: 'K-컬처 오픈랩과 연계해 사진전시 두 차례를 기획하고 운영하며 작품 발표와 전시 실무를 경험하는 프로그램입니다.',
    activities: '작품 선별, 전시 기획, 설치, 홍보물 제작과 운영',
    outcomes: '사진전시와 전시 운영 기록',
    primaryTrack: 'art_photo',
    secondaryTracks: ['documentary', 'video'],
    tags: ['exhibition', 'photography', 'portfolio', 'curating', 'planning', 'team'],
    connectionText: '개인 작업을 전시 공간과 관객에게 전달하는 발표 경험',
    locations: 'K-컬처 오픈랩',
    faculty: ['윤태준', '김사라'],
  }),
]

const source = await FileBlob.load(inputPath)
const workbook = await SpreadsheetFile.importXlsx(source)
const sheet = workbook.worksheets.getItem('프로젝트_입력')
const sourceValues = sheet.getRange('A1:U205').values
const [headers, ...rawRows] = sourceValues
const indexOf = (header) => headers.indexOf(header)
const cell = (row, header) => row[indexOf(header)]

const historicalRows = rawRows
  .filter(row => row.some(value => value !== null && value !== ''))
  .map((row) => {
    const startDate = excelDateToIso(cell(row, '시작일'))
    const endDate = excelDateToIso(cell(row, '종료일'))
    const periodLabel = asText(cell(row, '기간표시'))
    const year = yearOf(periodLabel, startDate)
    return {
      key: asText(cell(row, '프로젝트키')),
      category: asText(cell(row, '구분')),
      title: asText(cell(row, '프로젝트명')),
      year,
      status: asText(cell(row, '진행상태')),
      statusLabel: year === 2025 ? '2025년 완료 사례' : '이전 운영 경험',
      startDate,
      endDate,
      semester: null,
      periodLabel,
      summary: asText(cell(row, '핵심내용')),
      activities: asText(cell(row, '학생이 한 활동')),
      outcomes: asText(cell(row, '주요 결과물')),
      primaryTrack: asText(cell(row, '대표트랙')),
      secondaryTracks: splitSemicolon(cell(row, '보조트랙')),
      tags: splitSemicolon(cell(row, '관심태그')),
      connectionText: asText(cell(row, '연계문구')),
      locations: asText(cell(row, '참여기관·장소')),
      faculty: splitSemicolon(cell(row, '관련교수')),
      sourcePageTitle: asText(cell(row, '출처페이지명')),
      sourceUrl: asText(cell(row, '출처URL')) || null,
      sourceCheckedAt: excelDateToIso(cell(row, '출처확인일')),
      verificationNote: asText(cell(row, '검증메모')),
      priority: Number(cell(row, '우선순위') ?? 0),
      programGroup: year === 2025 ? 'RISE 사업' : '스마트 드론·3D 인력양성',
      displayTier: 'experience',
      displayKind: year === 2025 ? '최근사례' : '짧은경험',
      cancelled: false,
    }
  })

const catalog = [...currentPrograms, ...historicalRows]
const keys = new Set()
for (const row of catalog) {
  if (!row.key) throw new Error('Project key is required')
  if (keys.has(row.key)) throw new Error(`Duplicate project key: ${row.key}`)
  keys.add(row.key)
}
if (catalog.length !== 43) throw new Error(`Expected 43 catalog rows, received ${catalog.length}`)
if (catalog.some(row => /사진단오제/u.test(row.title))) throw new Error('Cancelled project must not be catalogued')
if (catalog.filter(row => row.displayTier === 'current').length !== 13) {
  throw new Error('Expected exactly 13 current programmes')
}

await fs.mkdir(dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath, rows: catalog.length, current: 13 }, null, 2))
