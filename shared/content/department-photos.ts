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

export const landingDepartmentPhoto: DepartmentPhoto = Object.freeze({
  src: '/images/department/field-activity.webp',
  alt: '카메라를 들고 현장 촬영 활동에 참여한 사진영상미디어학과 학생들',
  label: '현장 활동',
  description: '사진과 영상으로 현장을 경험하는 사진영상미디어학과',
  width: 2048,
  height: 1365,
})

export const departmentPhotosByTrack = Object.freeze({
  documentary: Object.freeze([darkroom, printLab] as const),
  art_photo: Object.freeze([darkroom, printLab] as const),
  commercial: Object.freeze([studioA, studioB] as const),
  video: Object.freeze([computerLab, studioA] as const),
}) satisfies Readonly<Record<TrackKey, readonly [DepartmentPhoto, DepartmentPhoto]>>
