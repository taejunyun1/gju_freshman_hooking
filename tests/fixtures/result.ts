import { decodeResultSnapshot } from '../../shared/schemas/result'
import {
  buildCareerNarrativeBrief,
  buildDeterministicCareerNarrativeChoice,
  renderCareerNarrative,
} from '../../server/modules/assessment/career-narrative'
import type { ResultSnapshot, ResultSnapshotCore } from '../../shared/types/result'

const sourceDate = '2026-07-14'
const selectedLabel = '제품·패션·광고 이미지 만들기'
const reason = (title: string) => `선택한 ‘${selectedLabel}’ 관심이 ${title}에서 실제 제작 결과물로 이어집니다.`

const course = (id: number, gradeYear: 1 | 2 | 3 | 4, title: string, term: string) => ({
  id,
  type: 'course' as const,
  title,
  summary: '기초 촬영에서 개인 포트폴리오까지 이어지는 전공 수업입니다.',
  sourceDate,
  affinity: 91,
  primaryTag: 'commercial',
  connectionReason: reason(title),
  displayMetadata: { gradeYear, term, credits: 3 },
})

const courses = [
  course(101, 1, '기초사진실기', '1학기'),
  course(102, 2, '스튜디오 조명 실기', '2학기'),
  course(103, 3, '커머셜 포토그라피 심화 워크숍', '2학기'),
  course(104, 4, '캡스톤 디자인 2', '1학기'),
] as const

const equipment = (
  id: number,
  title: string,
  quantity: number,
  accessMode: 'reservation' | 'inquiry',
) => ({
  id,
  type: 'equipment' as const,
  title,
  summary: '촬영 조명과 무선 제작을 뒷받침하는 학과 장비입니다.',
  sourceDate,
  affinity: 88,
  primaryTag: 'studio',
  connectionReason: reason(title),
  displayMetadata: {
    locationLabel: accessMode === 'reservation'
      ? '사진영상미디어학과 기자재실'
      : '호심관 3층 판타지랩',
    confirmedQuantity: quantity,
    reservationUrl: 'https://gjureserve.co.kr' as const,
    accessMode,
    accessLabel: accessMode === 'reservation' ? '예약 가능' as const : '문의 전용' as const,
  },
})

const facility = (id: number, title: string, locationLabel: string) => ({
  id,
  type: 'facility' as const,
  title,
  summary: '대형 촬영과 편집을 실습하는 학과 시설입니다.',
  sourceDate,
  affinity: 84,
  primaryTag: 'studio',
  connectionReason: reason(title),
  displayMetadata: {
    locationLabel,
    operationNote: '관리자가 조명 장비와 이용 절차를 확인했습니다.',
  },
})

const plainResource = (
  id: number,
  type: 'extracurricular' | 'project' | 'career' | 'support',
  title: string,
) => ({
  id,
  type,
  title,
  summary: '관심 분야를 실제 제작과 진로로 연결하는 학과 자원입니다.',
  sourceDate,
  affinity: 82,
  primaryTag: 'commercial',
  connectionReason: reason(title),
  displayMetadata: {},
})

const studentWork = {
  id: 401,
  type: 'student_work' as const,
  title: '광고사진 포트폴리오',
  summary: '스튜디오 촬영과 브랜드 이미지로 구성한 학생 결과물입니다.',
  sourceDate,
  affinity: 93,
  primaryTag: 'portfolio',
  connectionReason: reason('광고사진 포트폴리오'),
  displayMetadata: {
    imagePath: 'images/student-work/commercial.webp',
    imageAlt: '조명을 활용한 학생 제품사진 작품',
  },
}

const snapshotInput = () => ({
  completedAt: '2026-07-15T11:30:00+09:00',
  selectedInterests: [
    { group: 'work' as const, key: 'work.commercial_image', label: selectedLabel },
    { group: 'result' as const, key: 'result.commercial_fashion', label: '광고·패션 이미지' },
    { group: 'style' as const, key: 'style.studio', label: '스튜디오에서 촬영' },
    { group: 'career' as const, key: 'career.photo', label: '사진 포트폴리오 진로' },
  ],
  trackScores: { documentary: 6.7, art_photo: 50, commercial: 100, video: 20 },
  rankedTracks: ['commercial', 'art_photo', 'video', 'documentary'],
  environmentScore: 92.3,
  learningPath: [
    { year: 1, resources: [courses[0]] },
    { year: 2, resources: [courses[1]] },
    { year: 3, resources: [courses[2]] },
    { year: 4, resources: [courses[3]] },
  ],
  resources: {
    course: [...courses],
    equipment: [
      equipment(201, 'APUTURE 600X', 2, 'reservation'),
      equipment(202, '프로포토 B10', 1, 'inquiry'),
    ],
    facility: [
      facility(203, '스튜디오 A(호리존)', '호심관 스튜디오 A'),
      facility(204, '컴퓨터실', '사진영상미디어학과 컴퓨터실'),
    ],
    extracurricular: [plainResource(301, 'extracurricular', '브랜드 이미지 크리틱')],
    project: [plainResource(302, 'project', '지역 브랜드 캠페인 프로젝트')],
    student_work: [studentWork],
    career: [plainResource(501, 'career', '상업사진가·브랜드 이미지 제작자')],
    support: [plainResource(601, 'support', '학생 포트폴리오 피드백')],
  },
  faculty: {
    primary: {
      role: 'primary',
      id: 701,
      name: '윤태준',
      title: '교수',
      expertise: '현대예술·예술사진·영상·AI·기술적 이미지',
      reason: '스튜디오 기반 사진과 영상 학습경로를 총괄 상담합니다.',
      publicContacts: {
        office: '행정관 8층 12호',
        phone: '062-670-2338',
        email: 'tjyun@gwangju.ac.kr',
        website: 'https://www.taejunyun.com',
      },
    },
    backup: {
      role: 'backup',
      id: 702,
      name: '조대연',
      title: '교수',
      expertise: '포토커뮤니케이션·다큐멘터리·시각커뮤니케이션',
      reason: '이미지 서사와 포트폴리오 편집을 예비 상담합니다.',
      publicContacts: { email: 'dancho@gwangju.ac.kr' },
    },
    specialists: [{
      role: 'specialist',
      id: 703,
      name: '곽동욱',
      title: '겸임교수',
      expertise: '광고사진·패션사진·브랜드 이미지',
      reason: '광고·패션·제품사진 실무와 포트폴리오를 함께 지도합니다.',
      publicContacts: { email: 'kwakdwstudio@naver.com' },
    }],
  },
})

const decodeCoreWithNarrative = (core: ResultSnapshotCore): ResultSnapshot => {
  const brief = buildCareerNarrativeBrief(core)
  return decodeResultSnapshot({
    ...core,
    careerNarrative: renderCareerNarrative(
      brief,
      buildDeterministicCareerNarrativeChoice(brief),
      'deterministic',
    ),
  })
}

export const makeResultSnapshot = (): ResultSnapshot => decodeCoreWithNarrative(snapshotInput())

export const makeEmptyResultSnapshot = (): ResultSnapshot => {
  const snapshot = snapshotInput()
  return decodeCoreWithNarrative({
    ...snapshot,
    learningPath: [
      { year: 1, resources: [] },
      { year: 2, resources: [] },
      { year: 3, resources: [] },
      { year: 4, resources: [] },
    ],
    resources: {
      course: [],
      equipment: [],
      facility: [],
      extracurricular: [],
      project: [],
      student_work: [],
      career: [],
      support: [],
    },
  })
}

export const resultPublicId = '22222222-2222-4222-8222-222222222222'
