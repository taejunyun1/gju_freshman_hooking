import type { TrackKey } from '../types/domain'

export type CurriculumTrackKey = TrackKey

export type CurriculumStage = Readonly<{
  year: 1 | 2 | 3 | 4
  phase: string
  kind: 'common' | 'course' | 'outcome'
  items: readonly string[]
  outcome: string
}>

export type CurriculumRoute = Readonly<{
  label: string
  summary: string
  stages: readonly CurriculumStage[]
}>

export const curriculumTrackOrder = Object.freeze([
  'video',
  'art_photo',
  'documentary',
  'commercial',
] as const)

const commonStages = Object.freeze([
  Object.freeze({
    year: 1,
    phase: '사진·영상 언어 기초',
    kind: 'common',
    items: Object.freeze([
      '기초사진실기',
      '영상 에세이 메이킹',
      '영상 프레임과 컷',
    ]),
    outcome: '카메라·프레이밍·촬영의 기초를 익힙니다.',
  }),
  Object.freeze({
    year: 2,
    phase: '제작·후반작업 확장',
    kind: 'common',
    items: Object.freeze([
      '사진커뮤니케이션',
      '다큐멘터리 메이킹&쇼케이스',
    ]),
    outcome: '촬영·편집·발표의 흐름을 경험합니다.',
  }),
] as const satisfies readonly CurriculumStage[])

const createRoute = (
  label: string,
  summary: string,
  juniorItems: readonly string[],
  juniorOutcome: string,
  seniorItems: readonly string[],
  seniorOutcome: string,
  seniorKind: CurriculumStage['kind'] = 'course',
): CurriculumRoute => Object.freeze({
  label,
  summary,
  stages: Object.freeze([
    ...commonStages,
    Object.freeze({
      year: 3,
      phase: '전공심화·프로젝트',
      kind: 'course',
      items: Object.freeze([...juniorItems]),
      outcome: juniorOutcome,
    }),
    Object.freeze({
      year: 4,
      phase: '캡스톤·포트폴리오',
      kind: seniorKind,
      items: Object.freeze([...seniorItems]),
      outcome: seniorOutcome,
    }),
  ]),
})

export const curriculumRoutes: Readonly<Record<CurriculumTrackKey, CurriculumRoute>> = Object.freeze({
  video: createRoute(
    '영상+AI',
    '촬영·편집·AI 이미지와 영상 기술을 결합해 콘텐츠를 제작하는 경로입니다.',
    [
      '영상 인터뷰 내러티브 워크숍',
      '영상 드론 콘텐츠 워크숍',
      '영상 콘텐츠 크리에이터 워크숍',
    ],
    '인터뷰·드론·크리에이터 작업으로 영상 제작 언어를 확장합니다.',
    ['영상·AI 통합 포트폴리오', '졸업전시·캡스톤 제작'],
    '개별 교과목이 아닌 통합 제작 단계로, 나만의 영상·AI 작업을 완성합니다.',
    'outcome',
  ),
  art_photo: createRoute(
    '예술사진',
    '사진의 개념과 장소, 데이터를 탐구해 개인 작업과 전시로 발전시키는 경로입니다.',
    [
      '사물,데이터,이미지 워크숍',
      '사진과 장소 그리고 콘텍스트 워크숍',
    ],
    '사물·장소·데이터를 바탕으로 사진의 주제와 형식을 탐구합니다.',
    ['예술창작 프로젝트 세미나', '예술창작 프로젝트 랩'],
    '연구와 제작을 연결해 전시·포트폴리오로 발전시킵니다.',
  ),
  documentary: createRoute(
    '다큐멘터리',
    '사람과 지역, 사회의 이야기를 사진과 영상으로 기록하고 편집하는 경로입니다.',
    ['포토 스토리 워크숍', '포토에세이 워크숍'],
    '현장 기록을 사진의 서사와 편집으로 구성합니다.',
    ['다큐멘터리 세미나', '포스트 다큐멘터리 랩'],
    '기록의 시선을 심화해 장기 프로젝트와 포트폴리오로 완성합니다.',
  ),
  commercial: createRoute(
    '광고사진',
    '패션·제품·뷰티·브랜드 이미지를 기획하고 조명·촬영으로 구현하는 경로입니다.',
    [
      '커머셜 포토그라피 기초 워크숍',
      '커머셜 포토그라피 심화 워크숍',
    ],
    '조명·세트·브랜드 맥락을 이해하며 상업사진의 기초를 다집니다.',
    ['커머셜 포토그라피 세미나', '커머셜 포토그라피 랩'],
    '기획부터 촬영·후반작업까지 상업 포트폴리오를 완성합니다.',
  ),
})

export const resolveCurriculumTrack = (value: unknown): CurriculumTrackKey => (
  curriculumTrackOrder.includes(value as CurriculumTrackKey)
    ? value as CurriculumTrackKey
    : 'video'
)
