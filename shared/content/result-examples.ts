import { trackKeys } from '../types/domain'
import type { TrackKey, VisualKey } from '../types/domain'

export interface ResultExample {
  readonly key: string
  readonly title: string
  readonly description: string
  readonly visualKey: VisualKey
}

type ResultExampleKind = 'specialty' | 'portfolio'
type ResultExampleTuple = readonly [string, string, string, VisualKey]

const catalog = {
  documentary: {
    specialty: [
      ['documentary-interview', '인터뷰·구술기록', '사람의 목소리와 삶을 사진·영상 기록으로 구성합니다.', 'interview_strip'],
      ['documentary-archive', '지역문화 아카이브', '장소와 공동체의 변화를 조사하고 시각 자료로 축적합니다.', 'location_board'],
      ['documentary-story', '포토스토리 편집', '여러 장의 사진과 글을 하나의 이야기 흐름으로 엮습니다.', 'photobook_spread'],
    ],
    portfolio: [
      ['documentary-essay', '인물 인터뷰 포토에세이', '인터뷰와 인물사진을 결합한 짧은 기록 연작입니다.', 'interview_strip'],
      ['documentary-book', '지역 기록 사진집', '지역의 장소와 사람을 조사해 사진집으로 편집합니다.', 'photobook_spread'],
      ['documentary-public', '공공 아카이브 프로젝트', '공공·문화기관과 연결할 수 있는 기록 포트폴리오입니다.', 'location_board'],
    ],
  },
  art_photo: {
    specialty: [
      ['art-research', '개인 창작 리서치', '개인의 관심을 자료 조사와 이미지 실험으로 발전시킵니다.', 'contact_sheet'],
      ['art-installation', '사진·영상 설치', '사진과 영상이 공간에서 만나는 전시 형태를 탐색합니다.', 'gallery_grid'],
      ['art-book', '포토북·전시 구성', '이미지 순서와 공간 배치로 작업의 의미를 전달합니다.', 'photobook_spread'],
    ],
    portfolio: [
      ['art-series', '개인 주제 사진 연작', '하나의 주제를 일관된 시각 언어로 완성한 연작입니다.', 'photo_frame'],
      ['art-exhibition', '사진·영상 설치전', '사진과 영상, 공간 구성을 결합한 전시 예시입니다.', 'gallery_grid'],
      ['art-ai', 'AI 이미지 실험 포트폴리오', '촬영 이미지와 생성 기술을 결합한 기술적 이미지 실험입니다.', 'edit_timeline'],
    ],
  },
  commercial: {
    specialty: [
      ['commercial-product', '제품·패션 촬영', '제품의 특성과 스타일을 조명과 구도로 표현합니다.', 'studio_still'],
      ['commercial-lighting', '스튜디오 조명', '빛의 방향과 질감을 설계해 상업 이미지를 완성합니다.', 'photo_frame'],
      ['commercial-brand', '브랜드 이미지 기획', '브랜드 메시지를 사진·영상 캠페인으로 구성합니다.', 'project_board'],
    ],
    portfolio: [
      ['commercial-product-work', '제품 광고 이미지', '제품 세팅과 조명, 보정을 보여주는 광고사진 예시입니다.', 'studio_still'],
      ['commercial-fashion', '패션·뷰티 화보', '인물 연출과 스타일링을 결합한 에디토리얼 예시입니다.', 'photo_frame'],
      ['commercial-campaign', '브랜드 캠페인 포트폴리오', '기획안부터 촬영 결과까지 묶은 캠페인 예시입니다.', 'project_board'],
    ],
  },
  video: {
    specialty: [
      ['video-post', '영상편집·색보정', '촬영한 장면의 리듬과 색을 다듬어 완성도를 높입니다.', 'edit_timeline'],
      ['video-ai', 'AI 이미지·영상', '촬영과 생성 기술을 결합해 기술적 이미지를 실험합니다.', 'contact_sheet'],
      ['video-drone', '드론·360 콘텐츠', '공중 촬영과 몰입형 화면으로 공간을 새롭게 기록합니다.', 'video_frame'],
    ],
    portfolio: [
      ['video-short', '시네마틱 단편', '프레임과 컷, 사운드를 설계한 짧은 영상 작품입니다.', 'video_frame'],
      ['video-reel', '촬영·편집 쇼릴', '촬영과 편집 역량을 짧게 모아 보여주는 영상 포트폴리오입니다.', 'edit_timeline'],
      ['video-fusion', '드론·AI 융합 영상', '드론 촬영과 AI 후반작업을 결합한 기술 프로젝트 예시입니다.', 'music_cuts'],
    ],
  },
} as const satisfies Record<TrackKey, Record<ResultExampleKind, readonly ResultExampleTuple[]>>

const toExamples = (tuples: readonly ResultExampleTuple[]): readonly ResultExample[] => Object.freeze(
  tuples.map(([key, title, description, visualKey]) => Object.freeze({ key, title, description, visualKey })),
)

const commonExplorationExamples = Object.freeze({
  specialty: toExamples([
    ['common-visual-story', '시각 스토리 구성', '사진과 영상으로 하나의 주제와 이야기 흐름을 탐색합니다.', 'photobook_spread'],
    ['common-production', '촬영·제작 기초', '카메라와 조명, 공간을 활용해 아이디어를 결과물로 발전시킵니다.', 'studio_still'],
    ['common-post', '디지털 후반작업', '촬영한 이미지와 영상을 편집하고 다듬어 완성도를 높입니다.', 'edit_timeline'],
  ]),
  portfolio: toExamples([
    ['common-series', '주제 사진·영상 연작', '관심 있는 주제를 여러 장면으로 발전시킨 탐색 결과물입니다.', 'photo_frame'],
    ['common-process-book', '프로젝트 과정 기록', '조사와 기획, 제작 과정을 한눈에 볼 수 있도록 정리한 기록입니다.', 'project_board'],
    ['common-showreel', '사진·영상 통합 쇼릴', '촬영과 편집 결과를 짧게 묶어 보여주는 포트폴리오 예시입니다.', 'video_frame'],
  ]),
}) satisfies Readonly<Record<ResultExampleKind, readonly ResultExample[]>>

const examplesByTrack = Object.fromEntries(trackKeys.map(track => [
  track,
  Object.freeze({
    specialty: toExamples(catalog[track].specialty),
    portfolio: toExamples(catalog[track].portfolio),
  }),
])) as Readonly<Record<TrackKey, Readonly<Record<ResultExampleKind, readonly ResultExample[]>>>>

export const resultExamplesFor = (
  track: TrackKey,
  kind: ResultExampleKind,
): readonly ResultExample[] => examplesByTrack[track]?.[kind] ?? commonExplorationExamples[kind]
