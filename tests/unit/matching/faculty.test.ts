import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { parseAssessmentCatalog } from '../../../scripts/seed-assessment-options'
import { scoreAssessment } from '../../../server/modules/assessment/scoring'
import { recommendFaculty } from '../../../server/modules/matching/faculty'
import type { AssessmentSelections } from '../../../shared/types/domain'

type TrackKey = 'documentary' | 'art_photo' | 'commercial' | 'video'
type TagCategory = 'track' | 'activity' | 'result' | 'career' | 'specialist'
type ContactField = 'office' | 'phone' | 'email' | 'website'
type ContactVisibility = 'public' | 'admin_only' | 'hidden'

type FacultyTag = {
  key: string
  label: string
  category: TagCategory
  weight: number
  isPrimary: boolean
}

type FacultyCandidate = {
  id: number
  name: string
  title: string
  expertise: string
  status: 'active' | 'draft' | 'archived'
  employmentType: 'full_time' | 'adjunct' | 'practitioner'
  consultationRole: 'primary' | 'specialist'
  weeklyCapacity: number
  openAssignedCount: number
  priority: number
  contacts: Partial<Record<ContactField, string>>
  contactVisibility: Record<ContactField, ContactVisibility>
  tags: FacultyTag[]
}

type SpecialistLink = {
  primaryFacultyId: number | null
  specialistFacultyId: number
  tagKey: string
  priority: number
}

type StudentEvidence = {
  trackScores: Record<TrackKey, number>
  interestVector: Record<string, number>
  selectedLabels: Record<string, string>
}

const tag = (
  key: string,
  label: string,
  category: TagCategory,
  weight = 3,
  isPrimary = true,
): FacultyTag => ({ key, label, category, weight, isPrimary })

const visibility = (
  overrides: Partial<Record<ContactField, ContactVisibility>> = {},
): Record<ContactField, ContactVisibility> => ({
  office: 'admin_only',
  phone: 'admin_only',
  email: 'admin_only',
  website: 'admin_only',
  ...overrides,
})

const facultyFixture = (): FacultyCandidate[] => [
  {
    id: 1,
    name: '조대연',
    title: '교수',
    expertise: '포토커뮤니케이션·다큐멘터리·시각커뮤니케이션',
    status: 'active',
    employmentType: 'full_time',
    consultationRole: 'primary',
    weeklyCapacity: 10,
    openAssignedCount: 1,
    priority: 30,
    contacts: {
      office: '호심관 19층',
      phone: '062-670-2670',
      email: 'dancho@gwangju.ac.kr',
    },
    contactVisibility: visibility({ office: 'public', phone: 'hidden' }),
    tags: [
      tag('documentary', '다큐멘터리', 'track'),
      tag('social', '사회와 사람의 기록', 'activity'),
      tag('record', '기록', 'activity'),
      tag('photo_communication', '포토커뮤니케이션', 'activity'),
      tag('photo_story', '포토스토리', 'result'),
      tag('public_content', '공공 콘텐츠', 'result'),
      tag('documentary', '다큐멘터리 진로', 'career'),
      tag('public_content', '공공콘텐츠 진로', 'career'),
    ],
  },
  {
    id: 2,
    name: '윤태준',
    title: '교수',
    expertise: '현대예술·예술사진·영상·AI·기술적 이미지',
    status: 'active',
    employmentType: 'full_time',
    consultationRole: 'primary',
    weeklyCapacity: 10,
    openAssignedCount: 2,
    priority: 20,
    contacts: {
      office: '행정관 8층 12호',
      phone: '062-670-2338',
      email: 'tjyun@gwangju.ac.kr',
      website: 'https://www.taejunyun.com',
    },
    contactVisibility: visibility({ website: 'public', email: 'hidden' }),
    tags: [
      tag('art_photo', '예술사진', 'track'),
      tag('video', '영상촬영', 'track'),
      tag('contemporary_art', '현대예술', 'track'),
      tag('narrative', '내러티브 영상', 'activity'),
      tag('ai', 'AI 이미지·영상', 'activity'),
      tag('installation', '설치·미디어아트', 'activity'),
      tag('exhibition', '전시 프로젝트', 'result'),
      tag('portfolio', '포트폴리오', 'result'),
      tag('video', '영상 작품', 'result', 2),
      tag('video', '영상 진로', 'career'),
      tag('exhibition', '전시·미디어 진로', 'career'),
    ],
  },
  {
    id: 3,
    name: '김사라',
    title: '교수',
    expertise: '다큐멘터리·지역기록·사진아카이브',
    status: 'active',
    employmentType: 'full_time',
    consultationRole: 'primary',
    weeklyCapacity: 10,
    openAssignedCount: 2,
    priority: 25,
    contacts: {
      office: '호심관 18층 28호',
      phone: '062-670-2441',
      email: 'sarahkim@gwangju.ac.kr',
    },
    contactVisibility: visibility({ email: 'public', office: 'hidden' }),
    tags: [
      tag('documentary', '다큐멘터리', 'track'),
      tag('local_record', '지역문화 기록', 'activity'),
      tag('public_institution', '공공기관 프로젝트', 'activity'),
      tag('field_research', '현장조사', 'activity'),
      tag('interview', '인터뷰와 구술기록', 'activity'),
      tag('archive', '사진 아카이브', 'result'),
      tag('cultural_heritage', '문화유산 기록', 'result', 2),
      tag('archive', '아카이브 진로', 'career'),
      tag('cultural_institution', '문화기관 진로', 'career'),
    ],
  },
  {
    id: 4,
    name: '박재웅',
    title: '겸임교수',
    expertise: '영상콘텐츠·드론·VR·360 영상',
    status: 'active',
    employmentType: 'practitioner',
    consultationRole: 'specialist',
    weeklyCapacity: 0,
    openAssignedCount: 0,
    priority: 30,
    contacts: {
      office: '호심관 3층 판타지랩',
      phone: '062-670-2534',
      email: 'hyunbin2001@naver.com',
      website: 'https://imagecraft8.wixsite.com/imagecraft',
    },
    contactVisibility: visibility({ phone: 'hidden', website: 'hidden' }),
    tags: [
      tag('video', '영상촬영', 'specialist'),
      tag('drone', '드론촬영', 'specialist'),
      tag('vr', 'VR 콘텐츠', 'specialist'),
      tag('video_360', '360도 영상', 'specialist'),
      tag('video', '영상 프로젝트', 'result', 2),
      tag('drone', '드론 영상', 'result', 2),
    ],
  },
  {
    id: 5,
    name: '정철호',
    title: '겸임교수',
    expertise: '현대예술·예술이론·전시기획',
    status: 'active',
    employmentType: 'adjunct',
    consultationRole: 'specialist',
    weeklyCapacity: 0,
    openAssignedCount: 0,
    priority: 20,
    contacts: { office: '극기관 3층 사진영상학과 사무실', email: 'jngchulho@gmail.com' },
    contactVisibility: visibility({ email: 'public' }),
    tags: [
      tag('exhibition', '전시기획', 'specialist'),
      tag('curating', '큐레이팅', 'specialist'),
      tag('art_theory', '예술이론', 'specialist'),
      tag('exhibition', '전시 프로젝트', 'result', 2),
      tag('curating', '큐레이팅 프로젝트', 'result', 2),
    ],
  },
  {
    id: 6,
    name: '곽동욱',
    title: '겸임교수',
    expertise: '광고사진·패션사진·브랜드 이미지',
    status: 'active',
    employmentType: 'practitioner',
    consultationRole: 'specialist',
    weeklyCapacity: 0,
    openAssignedCount: 0,
    priority: 10,
    contacts: { email: 'kwakdwstudio@naver.com' },
    contactVisibility: visibility({ email: 'hidden' }),
    tags: [
      tag('commercial', '광고사진', 'specialist'),
      tag('fashion', '패션사진', 'specialist'),
      tag('product', '제품사진', 'specialist'),
      tag('beauty', '뷰티사진', 'specialist'),
      tag('brand', '브랜드 이미지', 'specialist'),
      tag('studio', '스튜디오 촬영', 'specialist'),
      tag('lighting', '조명', 'specialist'),
      tag('commercial_portfolio', '상업포트폴리오', 'specialist'),
      tag('commercial', '광고 포트폴리오', 'result', 2),
      tag('product', '제품광고 촬영', 'result', 2),
      tag('fashion', '패션 화보', 'result', 2),
      tag('beauty', '뷰티 화보', 'result', 2),
      tag('brand', '브랜드 캠페인', 'result', 2),
      tag('studio', '스튜디오 조명 프로젝트', 'result', 2),
      tag('lighting', '스튜디오 조명 프로젝트', 'result', 2),
      tag('portfolio', '광고사진 포트폴리오', 'result', 2),
      tag('photography', '광고사진 포트폴리오', 'result', 2),
    ],
  },
]

const specialistLinksFixture = (): SpecialistLink[] => [
  { primaryFacultyId: 2, specialistFacultyId: 4, tagKey: 'video', priority: 40 },
  { primaryFacultyId: 2, specialistFacultyId: 4, tagKey: 'drone', priority: 39 },
  { primaryFacultyId: 2, specialistFacultyId: 4, tagKey: 'vr', priority: 38 },
  { primaryFacultyId: 2, specialistFacultyId: 4, tagKey: 'video_360', priority: 37 },
  { primaryFacultyId: 2, specialistFacultyId: 5, tagKey: 'exhibition', priority: 30 },
  { primaryFacultyId: 2, specialistFacultyId: 5, tagKey: 'curating', priority: 29 },
  { primaryFacultyId: 2, specialistFacultyId: 5, tagKey: 'art_theory', priority: 28 },
  { primaryFacultyId: null, specialistFacultyId: 6, tagKey: 'commercial', priority: 20 },
  { primaryFacultyId: null, specialistFacultyId: 6, tagKey: 'fashion', priority: 19 },
  { primaryFacultyId: null, specialistFacultyId: 6, tagKey: 'product', priority: 18 },
  { primaryFacultyId: null, specialistFacultyId: 6, tagKey: 'beauty', priority: 17 },
  { primaryFacultyId: null, specialistFacultyId: 6, tagKey: 'brand', priority: 16 },
  { primaryFacultyId: null, specialistFacultyId: 6, tagKey: 'studio', priority: 15 },
  { primaryFacultyId: null, specialistFacultyId: 6, tagKey: 'lighting', priority: 14 },
]

const student = (
  trackScores: StudentEvidence['trackScores'],
  interestVector: StudentEvidence['interestVector'],
  selectedLabels: StudentEvidence['selectedLabels'],
): StudentEvidence => ({ trackScores, interestVector, selectedLabels })

const zeroTracks = (): StudentEvidence['trackScores'] => ({
  documentary: 0,
  art_photo: 0,
  commercial: 0,
  video: 0,
})

const socialDocumentaryStudent = (): StudentEvidence =>
  student(
    { ...zeroTracks(), documentary: 92 },
    { documentary: 1, social: 1, record: 0.95, photo_communication: 0.9, photo_story: 1 },
    {
      documentary: '다큐멘터리',
      social: '사회와 사람의 기록',
      record: '기록',
      photo_communication: '포토커뮤니케이션',
      photo_story: '포토스토리',
    },
  )

const videoDroneStudent = (): StudentEvidence =>
  student(
    { ...zeroTracks(), art_photo: 82, video: 96 },
    { art_photo: 0.82, video: 1, narrative: 0.9, drone: 1, exhibition: 0.5 },
    {
      art_photo: '예술사진',
      video: '영상촬영',
      narrative: '내러티브 영상',
      drone: '드론촬영',
      exhibition: '전시',
    },
  )

const canonicalAssessmentCatalog = () => parseAssessmentCatalog(
  JSON.parse(readFileSync('supabase/seed/assessment-options.json', 'utf8')) as unknown,
)

const commercialAssessmentStudent = (): StudentEvidence => {
  const catalog = canonicalAssessmentCatalog()
  const selections: AssessmentSelections = {
    work: ['work.commercial_image'],
    result: ['result.commercial_fashion'],
    style: ['style.studio'],
    career: ['career.photo'],
    careerOther: null,
  }
  const scored = scoreAssessment(catalog, selections)
  const selectedOptionKeys = new Set([
    ...selections.work,
    ...selections.result,
    ...selections.style,
    ...selections.career,
  ])
  const selectedLabels: Record<string, string> = {}
  for (const option of catalog) {
    if (!selectedOptionKeys.has(option.optionKey)) continue
    for (const key of option.interestTags) selectedLabels[key] ??= option.label
  }
  return student(scored.trackScores, scored.interestVector, selectedLabels)
}

const mixedCommercialVideoFixture = () => {
  const faculty = facultyFixture()
  faculty.push({
    ...clone(facultyFixture()[4]!),
    id: 7,
    name: '김태현',
    expertise: '다큐멘터리·영상제작·예술사진',
    tags: [
      tag('video', '영상', 'specialist'),
      tag('art_photo', '예술사진', 'specialist'),
    ],
  })
  return {
    student: student(
      { documentary: 0, art_photo: 100, commercial: 80, video: 80 },
      { video: 0.8, art_photo: 1 },
      { video: '팀으로 제작', art_photo: '예술사진 작업' },
    ),
    faculty,
    specialistLinks: [
      { primaryFacultyId: 2, specialistFacultyId: 7, tagKey: 'video', priority: 100 },
      { primaryFacultyId: 2, specialistFacultyId: 7, tagKey: 'art_photo', priority: 100 },
    ],
  }
}

const exhibitionCuratingFixture = () => {
  const faculty = facultyFixture()
  faculty.push({
    ...clone(facultyFixture()[4]!),
    id: 7,
    name: '넓은 예술사진 강사',
    priority: 99,
    tags: [
      tag('art_photo', '예술사진', 'specialist'),
      tag('art_portfolio', '예술사진 포트폴리오', 'result'),
    ],
  }, {
    ...clone(facultyFixture()[4]!),
    id: 8,
    name: '또 다른 예술사진 강사',
    priority: 98,
    tags: [
      tag('art_photo', '예술사진', 'specialist'),
      tag('art_portfolio', '예술사진 포트폴리오', 'result'),
    ],
  })
  return {
    student: student(
      { documentary: 0, art_photo: 100, commercial: 0, video: 0 },
      { exhibition: 1, curating: 1, art_photo: 1, art_portfolio: 1 },
      {
        exhibition: '전시기획',
        curating: '큐레이팅',
        art_photo: '예술사진',
        art_portfolio: '예술사진 포트폴리오',
      },
    ),
    faculty,
    specialistLinks: [
      { primaryFacultyId: 2, specialistFacultyId: 5, tagKey: 'exhibition', priority: 100 },
      { primaryFacultyId: 2, specialistFacultyId: 5, tagKey: 'curating', priority: 90 },
      { primaryFacultyId: 2, specialistFacultyId: 7, tagKey: 'art_photo', priority: 100 },
      { primaryFacultyId: 2, specialistFacultyId: 8, tagKey: 'art_photo', priority: 100 },
    ],
  }
}

const recommend = (
  evidence: StudentEvidence,
  faculty = facultyFixture(),
  specialistLinks = specialistLinksFixture(),
) => recommendFaculty({ student: evidence, faculty, specialistLinks })

const clone = <T>(value: T): T => structuredClone(value)

const expectDeepFrozen = (value: unknown): void => {
  if (value === null || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeepFrozen(child)
}

describe('recommendFaculty', () => {
  it('사회·사람·포토스토리 다큐멘터리는 조대연을 총괄, 김사라를 예비로 추천한다', () => {
    const result = recommend(socialDocumentaryStudent())

    expect([result.primary.id, result.backup.id]).toEqual([1, 3])
    expect([result.primary.role, result.backup.role]).toEqual(['primary', 'backup'])
    expect(result.primary.reason).toContain('다큐멘터리')
    expect(result.primary.reason).toContain('조대연')
    expect(result.primary.reason).toContain('포토커뮤니케이션·다큐멘터리·시각커뮤니케이션')
  })

  it('지역·아카이브·현장조사 다큐멘터리는 김사라를 총괄로 추천한다', () => {
    const result = recommend(
      student(
        { ...zeroTracks(), documentary: 90 },
        { documentary: 1, local_record: 1, archive: 1, field_research: 1, public_institution: 0.9 },
        {
          documentary: '다큐멘터리',
          local_record: '지역문화 기록',
          archive: '사진 아카이브',
          field_research: '현장조사',
          public_institution: '공공기관 프로젝트',
        },
      ),
    )

    expect(result.primary.id).toBe(3)
    expect(result.primary.name).toBe('김사라')
  })

  it('영상예술·드론은 윤태준 총괄과 박재웅 전문 연계로 추천한다', () => {
    const result = recommend(videoDroneStudent())

    expect(result.primary.id).toBe(2)
    expect(result.specialists.map(({ id }) => id)).toContain(4)
    const park = result.specialists.find(({ id }) => id === 4)
    expect(park?.role).toBe('specialist')
    expect(park?.reason).toContain('드론촬영')
    expect(park?.reason).toContain('박재웅')
    expect(park?.reason).toContain('영상콘텐츠·드론·VR·360 영상')
    expect(park?.reason).not.toMatch(/배정 완료|담당 교수/)
  })

  it('공식 광고·패션 설문 선택은 career 태그가 없는 곽동욱과 null 링크로 연계한다', () => {
    const evidence = commercialAssessmentStudent()
    const result = recommend(evidence)

    expect(evidence.interestVector).toMatchObject({
      commercial: 1,
      studio: 0.8,
      fashion: 0.7,
      brand: 0.7,
      lighting: 0.5,
      product: 0.4,
    })
    expect(result.specialists.map(({ id }) => id)).toContain(6)
    expect(result.specialists.find(({ id }) => id === 6)?.reason)
      .toContain('제품·패션·광고 이미지 만들기')
  })

  it('uses the same specialist link tag for eligibility, ranking, and displayed reason', () => {
    const result = recommendFaculty(mixedCommercialVideoFixture())
    const kim = result.specialists.find(person => person.name === '김태현')

    expect(kim?.reason).not.toContain('팀으로 제작')
    expect(kim?.reason).toContain('예술사진 작업')
  })

  it('does not qualify a linked specialist from a stronger unrelated candidate tag', () => {
    const faculty = facultyFixture().slice(0, 3)
    faculty.push(
      {
        ...clone(facultyFixture()[4]!),
        id: 70,
        name: '미연결 태그 강사',
        priority: 99,
        tags: [
          tag('linked_signal', '약한 연결', 'specialist'),
          tag('unlinked_bonus', '미연결 강점', 'specialist'),
        ],
      },
      {
        ...clone(facultyFixture()[4]!),
        id: 71,
        name: '연결 강사',
        tags: [tag('linked_peer', '연결 근거', 'specialist')],
      },
    )
    const result = recommend(
      student(
        { ...zeroTracks(), video: 100 },
        { linked_signal: 0.4, linked_peer: 0.5, unlinked_bonus: 1 },
        {
          linked_signal: '약한 연결',
          linked_peer: '연결 근거',
          unlinked_bonus: '미연결 강점',
        },
      ),
      faculty,
      [
        { primaryFacultyId: 2, specialistFacultyId: 70, tagKey: 'linked_signal', priority: 100 },
        { primaryFacultyId: 2, specialistFacultyId: 71, tagKey: 'linked_peer', priority: 1 },
      ],
    )

    expect(result.specialists.map(person => person.name)).toEqual(['연결 강사'])
    expect(result.specialists[0]?.reason).toContain('연결 근거')
  })

  it('prioritizes a specific exhibition link over a broad art-photo link', () => {
    const result = recommendFaculty(exhibitionCuratingFixture())

    expect(result.specialists.map(person => person.name)).toContain('정철호')
    expect(result.specialists).toHaveLength(2)
  })

  it('uses the coordinator-path explanation for an unowned commercial track', () => {
    const result = recommend(commercialAssessmentStudent())

    expect(result.primary.reason).toContain('전체 학습경로와 상담을 총괄')
    expect(result.primary.reason).toContain(result.primary.name)
    expect(result.primary.reason).toContain('곽동욱')
    expect(result.primary.reason).toContain('광고·패션·제품')
    expect(result.primary.reason).not.toContain(`${result.primary.expertise} 전문분야와 연결`)
  })

  it('총괄 후보의 점수 공식·부하·동점 순서를 적용하고 facultyFit에서는 부하를 제외한다', () => {
    const controlled = facultyFixture().slice(0, 2).map((candidate, index) => ({
      ...candidate,
      id: 101 + index,
      name: index === 0 ? '후보 A' : '후보 B',
      weeklyCapacity: index === 0 ? 10 : 20,
      openAssignedCount: index === 0 ? 1 : 2,
      priority: index === 0 ? 1 : 999,
      tags: [
        tag('documentary', '다큐멘터리', 'track', 3),
        tag('custom_track', '개인 탐색', 'track', 1),
        tag('social', '사회기록', 'activity', 2),
        tag('photo_story', '포토스토리', 'result', 2),
        tag('public_content', '공공콘텐츠', 'career', 3),
      ],
    }))
    const evidence = student(
      { ...zeroTracks(), documentary: 80 },
      { documentary: 0.1, custom_track: 0.6, social: 0.6, photo_story: 0.4, public_content: 0.2 },
      {
        documentary: '다큐멘터리',
        custom_track: '개인 탐색',
        social: '사회기록',
        photo_story: '포토스토리',
        public_content: '공공콘텐츠',
      },
    )

    const loadTie = recommend(evidence, controlled, [])
    expect([loadTie.primary.id, loadTie.backup.id]).toEqual([101, 102])
    expect(loadTie.facultyFit).toBe(56.8)

    const priorityTie = recommend(evidence, controlled.map((candidate, index) => ({
      ...candidate,
      weeklyCapacity: 10,
      openAssignedCount: 1,
      priority: index === 0 ? 1 : 9,
    })), [])
    expect(priorityTie.primary.id).toBe(102)

    const idTie = recommend(evidence, controlled.map((candidate) => ({
      ...candidate,
      weeklyCapacity: 10,
      openAssignedCount: 1,
      priority: 9,
    })).reverse(), [])
    expect(idTie.primary.id).toBe(101)
  })

  it('capacity-zero·draft·wrong-role을 제외하고 2명 미만이면 정확한 닫힌 오류를 보낸다', () => {
    const [jo, yun, kim] = facultyFixture()
    const invalid: FacultyCandidate[] = [
      { ...jo, weeklyCapacity: 0 },
      { ...yun, status: 'draft' },
      { ...kim, consultationRole: 'specialist' },
    ]

    expect(() => recommend(socialDocumentaryStudent(), invalid, [])).toThrowError(
      'FACULTY_CONTENT_NOT_READY',
    )
    expect(() => recommend(socialDocumentaryStudent(), facultyFixture().slice(0, 1), [])).toThrowError(
      'FACULTY_CONTENT_NOT_READY',
    )
  })

  it('링크 신호가 정확히 50인 후보를 인정하고 50 미만과 다른 총괄 링크를 제외한다', () => {
    const faculty = facultyFixture()
    const template = faculty[4]
    faculty.push(
      {
        ...clone(template),
        id: 7,
        name: '50점 전문가 A',
        priority: 5,
        tags: [tag('exact', '정확히 50', 'specialist')],
      },
      {
        ...clone(template),
        id: 8,
        name: '50점 전문가 B',
        priority: 40,
        tags: [tag('exact', '정확히 50', 'specialist')],
      },
      {
        ...clone(template),
        id: 9,
        name: '49.9점 전문가',
        priority: 100,
        tags: [tag('below', '50 미만', 'specialist')],
      },
      {
        ...clone(template),
        id: 10,
        name: '다른 총괄교수 전용',
        priority: 100,
        tags: [tag('exact', '정확히 50', 'specialist')],
      },
    )
    const links = [
      ...specialistLinksFixture(),
      { primaryFacultyId: 2, specialistFacultyId: 7, tagKey: 'exact', priority: 1 },
      { primaryFacultyId: 2, specialistFacultyId: 8, tagKey: 'exact', priority: 1 },
      { primaryFacultyId: 2, specialistFacultyId: 9, tagKey: 'below', priority: 1 },
      { primaryFacultyId: 1, specialistFacultyId: 10, tagKey: 'exact', priority: 1 },
    ]
    const evidence = videoDroneStudent()
    evidence.interestVector.exact = 0.5
    evidence.interestVector.below = 0.499
    evidence.selectedLabels.exact = '정확히 50'
    evidence.selectedLabels.below = '50 미만'

    const result = recommend(evidence, faculty, links)
    expect(result.specialists.map(({ id }) => id)).toEqual([4, 5])
    expect(result.specialists.map(({ id }) => id)).not.toContain(9)
    expect(result.specialists.map(({ id }) => id)).not.toContain(10)
  })

  it('선택하지 않은 후보 result 범주가 링크 근거를 희석하지 않는다', () => {
    const faculty = facultyFixture().slice(0, 3)
    faculty.push({
      ...clone(facultyFixture()[4]),
      id: 71,
      name: '미선택 결과 범주 전문가',
      tags: [
        tag('linked_signal', '연계 신호', 'specialist'),
        tag('unselected_result', '미선택 결과', 'result'),
      ],
    })
    const evidence = student(
      { ...zeroTracks(), video: 100 },
      { linked_signal: 0.6 },
      { linked_signal: '연계 신호' },
    )
    const result = recommend(
      evidence,
      faculty,
      [{ primaryFacultyId: 2, specialistFacultyId: 71, tagKey: 'linked_signal', priority: 1 }],
    )

    expect(result.primary.id).toBe(2)
    expect(result.specialists.map(({ id }) => id)).toContain(71)
  })

  it('전문가의 선택하지 않은 세부 태그가 가장 강한 검증 분야를 희석하지 않는다', () => {
    const faculty = facultyFixture().slice(0, 3)
    faculty.push({
      ...clone(facultyFixture()[4]),
      id: 72,
      name: '복합분야 전문가',
      tags: [
        tag('focused_specialist', '선택한 전문분야', 'specialist'),
        tag('weak_specialist_a', '선택하지 않은 전문분야 A', 'specialist'),
        tag('weak_specialist_b', '선택하지 않은 전문분야 B', 'specialist'),
        tag('weak_specialist_c', '선택하지 않은 전문분야 C', 'specialist'),
      ],
    })
    const evidence = student(
      { ...zeroTracks(), video: 100 },
      { focused_specialist: 0.8 },
      { focused_specialist: '선택한 전문분야' },
    )

    const verifiedEvidenceKeys = new Set(faculty[3]!.tags
      .filter(candidateTag => (evidence.interestVector[candidateTag.key] ?? 0) > 0
        && evidence.selectedLabels[candidateTag.key] !== undefined)
      .map(candidateTag => candidateTag.key))

    const result = recommend(
      evidence,
      faculty,
      [{ primaryFacultyId: 2, specialistFacultyId: 72, tagKey: 'focused_specialist', priority: 1 }],
    )

    expect([...verifiedEvidenceKeys]).toEqual(['focused_specialist'])
    expect(result.primary.id).toBe(2)
    expect(result.specialists.map(({ id }) => id)).toContain(72)
  })

  it('결과는 canonical 필드와 public 연락처만 노출하고 배정 표현을 쓰지 않는다', () => {
    const result = recommend(videoDroneStudent())

    for (const recommendation of [result.primary, result.backup, ...result.specialists]) {
      expect(Object.keys(recommendation).sort()).toEqual(
        ['role', 'id', 'name', 'title', 'expertise', 'reason', 'publicContacts'].sort(),
      )
      expect(recommendation.reason).not.toMatch(/배정 완료|담당 교수/)
    }
    expect(result.primary.publicContacts).toEqual({ website: 'https://www.taejunyun.com' })
    expect(JSON.stringify(result)).not.toMatch(
      /062-670-2338|tjyun@gwangju\.ac\.kr|hyunbin2001@naver\.com/,
    )
  })

  it('중복 교수·태그·링크와 모른 참조를 결정적으로 거부한다', () => {
    const evidence = socialDocumentaryStudent()
    const duplicateFaculty = facultyFixture()
    duplicateFaculty[1].id = duplicateFaculty[0].id
    expect(() => recommend(evidence, duplicateFaculty)).toThrow()

    const duplicateTag = facultyFixture()
    duplicateTag[0].tags.push(clone(duplicateTag[0].tags[0]))
    expect(() => recommend(evidence, duplicateTag)).toThrow()

    const duplicateLink = specialistLinksFixture()
    duplicateLink.push(clone(duplicateLink[0]))
    expect(() => recommend(evidence, facultyFixture(), duplicateLink)).toThrow()

    const unknownReference = specialistLinksFixture()
    unknownReference.push({ primaryFacultyId: 999, specialistFacultyId: 4, tagKey: 'drone', priority: 1 })
    expect(() => recommend(evidence, facultyFixture(), unknownReference)).toThrow()
  })

  it('범위·키·문자열·한국어 라벨이 깨진 입력을 거부한다', () => {
    const malformedTag = facultyFixture()
    malformedTag[0].tags[0] = tag('Bad Tag', '다큐멘터리', 'track', 4)
    expect(() => recommend(socialDocumentaryStudent(), malformedTag)).toThrow()

    const badTrack = socialDocumentaryStudent()
    badTrack.trackScores.documentary = 101
    expect(() => recommend(badTrack)).toThrow()

    const badVector = socialDocumentaryStudent()
    badVector.interestVector.social = Number.NaN
    expect(() => recommend(badVector)).toThrow()

    const missingLabel = socialDocumentaryStudent()
    delete missingLabel.selectedLabels.social
    expect(() => recommend(missingLabel)).toThrow()

    const malformedName = facultyFixture()
    malformedName[0].name = ''
    expect(() => recommend(socialDocumentaryStudent(), malformedName)).toThrow()
  })

  it('선택하지 않은 교차 트랙 점수의 라벨을 요구하지 않고 실제 social 선택 근거를 사용한다', () => {
    const result = recommend(student(
      { documentary: 80, art_photo: 70, commercial: 60, video: 50 },
      { social: 1 },
      { social: '사회와 사람의 기록' },
    ))

    expect(result.primary.id).toBe(1)
    expect(result.primary.reason).toContain('사회와 사람의 기록')
    expect(result.backup.reason).toContain('사회와 사람의 기록')
  })

  it('표준 트랙 점수로 전문 링크를 열고 별도 result·career 신호로 50점 전문가를 연계한다', () => {
    const faculty = facultyFixture().slice(0, 3)
    faculty.push({
      ...clone(facultyFixture()[4]),
      id: 70,
      name: '트랙 링크 전문가',
      tags: [
        tag('video', '영상촬영', 'specialist'),
        tag('project_signal', '프로젝트 제작', 'result'),
        tag('career_signal', '콘텐츠 진로', 'career'),
      ],
    })
    const result = recommend(
      student(
        { ...zeroTracks(), video: 100 },
        { project_signal: 1, career_signal: 1 },
        { project_signal: '프로젝트 제작', career_signal: '콘텐츠 진로' },
      ),
      faculty,
      [{ primaryFacultyId: 2, specialistFacultyId: 70, tagKey: 'video', priority: 1 }],
    )

    expect(result.primary.id).toBe(2)
    expect(result.specialists.map(({ id }) => id)).toContain(70)
  })

  it('교수·태그·링크·라벨 입력 순서가 바뀌어도 ID와 사유가 같다', () => {
    const evidence = videoDroneStudent()
    const baseline = recommend(evidence)
    const permutedFaculty = facultyFixture()
      .reverse()
      .map((candidate) => ({ ...candidate, tags: [...candidate.tags].reverse() }))
    const permutedEvidence: StudentEvidence = {
      ...evidence,
      interestVector: Object.fromEntries(Object.entries(evidence.interestVector).reverse()),
      selectedLabels: Object.fromEntries(Object.entries(evidence.selectedLabels).reverse()),
    }
    const permuted = recommend(permutedEvidence, permutedFaculty, specialistLinksFixture().reverse())

    expect({
      primary: [permuted.primary.id, permuted.primary.reason],
      backup: [permuted.backup.id, permuted.backup.reason],
      specialists: permuted.specialists.map(({ id, reason }) => [id, reason]),
      facultyFit: permuted.facultyFit,
    }).toEqual({
      primary: [baseline.primary.id, baseline.primary.reason],
      backup: [baseline.backup.id, baseline.backup.reason],
      specialists: baseline.specialists.map(({ id, reason }) => [id, reason]),
      facultyFit: baseline.facultyFit,
    })
  })

  it('입력을 변경하지 않고 반환값 전체를 깊게 불변으로 만든다', () => {
    const evidence = videoDroneStudent()
    const faculty = facultyFixture()
    const links = specialistLinksFixture()
    const before = clone({ evidence, faculty, links })

    const result = recommend(evidence, faculty, links)

    expect({ evidence, faculty, links }).toEqual(before)
    expectDeepFrozen(result)
    expect(() => {
      Object.assign(result.primary, { name: '변경' })
    }).toThrow(TypeError)
    expect(() => {
      ;(result.specialists as unknown as Array<(typeof result.specialists)[number]>).push(
        result.specialists[0],
      )
    }).toThrow(TypeError)
  })
})
