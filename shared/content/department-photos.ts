import type { TrackKey } from '../types/domain'

export interface DepartmentPhoto {
  readonly src: string
  readonly alt: string
  readonly label: string
  readonly description: string
  readonly width: number
  readonly height: number
}

const darkroom = { src: '/images/department/darkroom.webp', alt: '붉은 안전등 아래 확대기가 놓인 사진영상미디어학과 암실', label: '학과 암실', description: '필름 현상과 인화로 기록 이미지의 물성을 익힙니다.', width: 2048, height: 1536 } as const
const printLab = { src: '/images/department/print-lab.webp', alt: '대형 사진 출력 장비가 설치된 사진영상미디어학과 프린트랩', label: '프린트랩', description: '작품과 포트폴리오를 전시 가능한 출력물로 완성합니다.', width: 2048, height: 1365 } as const
const studioA = { src: '/images/department/studio-a.webp', alt: '호리존과 조명 장비가 설치된 사진영상미디어학과 스튜디오 A', label: '스튜디오 A', description: '호리존과 조명을 활용해 사진과 영상을 촬영합니다.', width: 1220, height: 700 } as const
const studioB = { src: '/images/department/studio-b.webp', alt: '배경지와 조명 장비가 설치된 사진영상미디어학과 스튜디오 B', label: '스튜디오 B', description: '제품·인물·패션 촬영을 반복해 실습합니다.', width: 2048, height: 1463 } as const
const computerLab = { src: '/images/department/computer-lab.webp', alt: '학생들이 아이맥으로 작업하는 사진영상미디어학과 컴퓨터실', label: '컴퓨터실', description: '사진 보정과 영상 편집, AI 기반 후반작업을 수행합니다.', width: 2048, height: 1365 } as const

export const landingDepartmentPhotos = Object.freeze([
  Object.freeze({
    src: '/images/department/event-shooting-1.webp',
    alt: '광주 예술의 거리 행사 현장에서 촬영 활동을 마친 사진영상미디어학과 학생들',
    label: '지역문화 현장 촬영',
    description: '학생들이 카메라를 들고 지역의 행사와 사람을 직접 기록합니다.',
    width: 1600,
    height: 1067,
  }),
  Object.freeze({
    src: '/images/department/event-shooting-2.webp',
    alt: '산간 지역 마을에서 주민들과 현장 기록 프로젝트에 참여한 사진영상미디어학과 학생들',
    label: '다큐멘터리 현장',
    description: '낯선 장소의 삶과 풍경을 관찰하며 다큐멘터리 작업을 이어갑니다.',
    width: 1600,
    height: 1068,
  }),
  Object.freeze({
    src: '/images/department/event-shooting-3.webp',
    alt: '기념 조형물 앞에서 카메라를 들고 현장 답사에 참여한 사진영상미디어학과 학생들',
    label: '지역 기록 답사',
    description: '지역의 장소와 기억을 조사하고 사진과 영상의 이야기로 발전시킵니다.',
    width: 1600,
    height: 1200,
  }),
  Object.freeze({
    src: '/images/department/event-shooting-4.webp',
    alt: '금샘미술관 앞에서 전시 관람과 촬영 활동에 참여한 사진영상미디어학과 학생들',
    label: '문화기관 현장 학습',
    description: '전시와 문화기관을 경험하며 작품 제작의 시야를 넓힙니다.',
    width: 1600,
    height: 900,
  }),
] as const) satisfies readonly [DepartmentPhoto, DepartmentPhoto, DepartmentPhoto, DepartmentPhoto]

export const landingDepartmentPhoto: DepartmentPhoto = landingDepartmentPhotos[0]

export const departmentPhotosByTrack = Object.freeze({
  documentary: Object.freeze([darkroom, printLab] as const),
  art_photo: Object.freeze([darkroom, printLab] as const),
  commercial: Object.freeze([studioA, studioB] as const),
  video: Object.freeze([computerLab, studioA] as const),
}) satisfies Readonly<Record<TrackKey, readonly [DepartmentPhoto, DepartmentPhoto]>>
