import { describe, expect, it } from 'vitest'

import { decodeResultSnapshot } from '../../../shared/schemas/result'

const course = (id: number, gradeYear: 1 | 2 | 3 | 4) => ({
  id,
  type: 'course' as const,
  title: `${gradeYear}학년 사진 수업 ${id}`,
  summary: '관심 분야를 기초부터 결과물까지 연결하는 전공 수업입니다.',
  sourceDate: '2026-07-14',
  affinity: 92,
  primaryTag: 'art_photo',
  connectionReason: `${gradeYear}학년 사진 수업 ${id}에서 선택한 관심사를 작품으로 발전시킬 수 있습니다.`,
  displayMetadata: { gradeYear, term: '1학기', credits: 3 },
})

const resource = (
  id: number,
  type: 'equipment' | 'facility' | 'extracurricular' | 'project' | 'student_work' | 'career' | 'support',
) => ({
  id,
  type,
  title: `${type} 추천 ${id}`,
  summary: '선택한 관심사를 실제 활동과 결과물로 연결하도록 돕습니다.',
  sourceDate: '2026-07-14',
  affinity: 81,
  primaryTag: 'visual_story',
  connectionReason: `${type} 추천 ${id}은 선택한 관심 분야의 실습을 뒷받침합니다.`,
  displayMetadata: type === 'equipment' || type === 'facility'
    ? { locationLabel: '호심관', accessLabel: '예약 또는 문의' }
    : type === 'student_work'
      ? { imagePath: 'images/student-work/sample.webp', imageAlt: '학생 작품 예시' }
      : {},
})

const makeValidSnapshot = () => {
  const firstCourse = course(1, 1)
  const secondCourse = course(2, 2)

  return {
    completedAt: '2026-07-15T08:30:00+09:00',
    selectedInterests: [
      { group: 'work', key: 'work.art_photo', label: '예술사진을 만들고 싶다' },
      { group: 'result', key: 'result.exhibition', label: '전시 결과물을 만들고 싶다' },
      { group: 'style', key: 'style.experimental', label: '실험적인 표현이 좋다' },
      { group: 'career', key: 'career.artist', label: '작가로 활동하고 싶다' },
    ],
    trackScores: { documentary: 30, art_photo: 96, commercial: 52, video: 45 },
    rankedTracks: ['art_photo', 'commercial', 'video', 'documentary'],
    environmentScore: 87,
    learningPath: [
      { year: 1, resources: [firstCourse] },
      { year: 2, resources: [secondCourse] },
      { year: 3, resources: [] },
      { year: 4, resources: [] },
    ],
    resources: {
      course: [firstCourse, secondCourse],
      equipment: [resource(3, 'equipment')],
      facility: [resource(4, 'facility')],
      extracurricular: [resource(5, 'extracurricular')],
      project: [resource(6, 'project')],
      student_work: [resource(7, 'student_work')],
      career: [resource(8, 'career')],
      support: [resource(9, 'support')],
    },
    faculty: {
      primary: {
        role: 'primary',
        id: 101,
        name: '윤태준',
        title: '교수',
        expertise: '현대예술·예술사진·영상촬영',
        reason: '예술사진과 개인 창작의 전체 학습경로를 상담합니다.',
        publicContacts: { office: '행정관 8층 12호', email: 'tjyun@gwangju.ac.kr', website: 'https://www.taejunyun.com' },
      },
      backup: {
        role: 'backup',
        id: 102,
        name: '조대연',
        title: '교수',
        expertise: '포토커뮤니케이션·다큐멘터리',
        reason: '시각적 스토리텔링과 기록 분야를 함께 상담합니다.',
        publicContacts: { email: 'dancho@gwangju.ac.kr' },
      },
      specialists: [{
        role: 'specialist',
        id: 103,
        name: '정철호',
        title: '겸임교수',
        expertise: '전시기획·큐레이팅',
        reason: '전시기획과 큐레이팅 실무를 연계합니다.',
        publicContacts: {},
      }],
    },
  }
}

const clone = <T>(value: T): T => structuredClone(value)

describe('result snapshot decoder', () => {
  it('decodes the exact contract and deeply freezes the immutable snapshot', () => {
    const decoded = decodeResultSnapshot(makeValidSnapshot())

    expect(decoded.rankedTracks).toEqual(['art_photo', 'commercial', 'video', 'documentary'])
    expect(Object.isFrozen(decoded)).toBe(true)
    expect(Object.isFrozen(decoded.resources)).toBe(true)
    expect(Object.isFrozen(decoded.resources.course)).toBe(true)
    expect(Object.isFrozen(decoded.resources.course[0]?.displayMetadata)).toBe(true)
    expect(Object.isFrozen(decoded.faculty.primary.publicContacts)).toBe(true)
  })

  it('rejects unknown fields at the root and nested levels', () => {
    expect(() => decodeResultSnapshot({ ...makeValidSnapshot(), unknown: true })).toThrow()

    const nested = clone(makeValidSnapshot())
    Object.assign(nested.resources.course[0]!, { privateNote: '비공개 메모' })
    expect(() => decodeResultSnapshot(nested)).toThrow()
  })

  it('requires exact finite score and rank manifests', () => {
    const missingScore = clone(makeValidSnapshot())
    delete (missingScore.trackScores as Partial<typeof missingScore.trackScores>).video
    expect(() => decodeResultSnapshot(missingScore)).toThrow()

    const infiniteScore = clone(makeValidSnapshot())
    infiniteScore.trackScores.video = Number.POSITIVE_INFINITY
    expect(() => decodeResultSnapshot(infiniteScore)).toThrow()

    const duplicateRank = clone(makeValidSnapshot())
    duplicateRank.rankedTracks = ['art_photo', 'art_photo', 'video', 'documentary']
    expect(() => decodeResultSnapshot(duplicateRank)).toThrow()
  })

  it('requires four ordered year buckets with course-only resources', () => {
    const wrongOrder = clone(makeValidSnapshot())
    wrongOrder.learningPath[0]!.year = 2
    expect(() => decodeResultSnapshot(wrongOrder)).toThrow()

    const nonCourse = clone(makeValidSnapshot())
    nonCourse.learningPath[0]!.resources[0] = resource(1, 'project') as never
    expect(() => decodeResultSnapshot(nonCourse)).toThrow()

    const wrongGrade = clone(makeValidSnapshot())
    wrongGrade.learningPath[0]!.resources[0]!.displayMetadata.gradeYear = 2
    expect(() => decodeResultSnapshot(wrongGrade)).toThrow()
  })

  it('enforces every result display cap, including the combined equipment/facility cap', () => {
    const tooManyCourses = clone(makeValidSnapshot())
    tooManyCourses.resources.course = [1, 2, 3, 4, 5, 6].map(id => course(id, Math.min(id, 4) as 1 | 2 | 3 | 4))
    expect(() => decodeResultSnapshot(tooManyCourses)).toThrow()

    const tooManyPhysicalResources = clone(makeValidSnapshot())
    tooManyPhysicalResources.resources.equipment = [10, 11, 12].map(id => resource(id, 'equipment'))
    tooManyPhysicalResources.resources.facility = [13, 14].map(id => resource(id, 'facility'))
    expect(() => decodeResultSnapshot(tooManyPhysicalResources)).toThrow()

    for (const type of ['extracurricular', 'project', 'student_work'] as const) {
      const snapshot = clone(makeValidSnapshot())
      snapshot.resources[type] = [20, 21, 22, 23].map(id => resource(id, type)) as never
      expect(() => decodeResultSnapshot(snapshot)).toThrow()
    }

    const tooManyCareers = clone(makeValidSnapshot())
    tooManyCareers.resources.career = [30, 31, 32, 33, 34].map(id => resource(id, 'career'))
    expect(() => decodeResultSnapshot(tooManyCareers)).toThrow()

    const tooMuchSupport = clone(makeValidSnapshot())
    tooMuchSupport.resources.support = [40, 41, 42, 43].map(id => resource(id, 'support'))
    expect(() => decodeResultSnapshot(tooMuchSupport)).toThrow()
  })

  it('rejects duplicate resource, learning-path, interest, and faculty IDs', () => {
    const duplicateResource = clone(makeValidSnapshot())
    duplicateResource.resources.facility[0]!.id = duplicateResource.resources.equipment[0]!.id
    expect(() => decodeResultSnapshot(duplicateResource)).toThrow()

    const duplicateLearningPath = clone(makeValidSnapshot())
    duplicateLearningPath.learningPath[1]!.resources[0] = clone(duplicateLearningPath.learningPath[0]!.resources[0]!)
    duplicateLearningPath.learningPath[1]!.resources[0]!.displayMetadata.gradeYear = 2
    expect(() => decodeResultSnapshot(duplicateLearningPath)).toThrow()

    const duplicateInterest = clone(makeValidSnapshot())
    duplicateInterest.selectedInterests.push(clone(duplicateInterest.selectedInterests[0]!))
    expect(() => decodeResultSnapshot(duplicateInterest)).toThrow()

    const duplicateFaculty = clone(makeValidSnapshot())
    duplicateFaculty.faculty.specialists[0]!.id = duplicateFaculty.faculty.primary.id
    expect(() => decodeResultSnapshot(duplicateFaculty)).toThrow()
  })

  it('requires the primary, backup, and specialist role contract', () => {
    const wrongRole = clone(makeValidSnapshot())
    wrongRole.faculty.primary.role = 'backup'
    expect(() => decodeResultSnapshot(wrongRole)).toThrow()

    const tooManySpecialists = clone(makeValidSnapshot())
    tooManySpecialists.faculty.specialists.push(
      { ...clone(tooManySpecialists.faculty.specialists[0]!), id: 104 },
      { ...clone(tooManySpecialists.faculty.specialists[0]!), id: 105 },
    )
    expect(() => decodeResultSnapshot(tooManySpecialists)).toThrow()
  })

  it('rejects unsafe paths, URLs, and unresolved connection templates', () => {
    const pathTraversal = clone(makeValidSnapshot())
    pathTraversal.resources.student_work[0]!.displayMetadata.imagePath = '../private/student.webp'
    expect(() => decodeResultSnapshot(pathTraversal)).toThrow()

    const unsafeWebsite = clone(makeValidSnapshot())
    unsafeWebsite.faculty.primary.publicContacts.website = 'javascript:alert(1)'
    expect(() => decodeResultSnapshot(unsafeWebsite)).toThrow()

    const unresolvedReason = clone(makeValidSnapshot())
    unresolvedReason.resources.project[0]!.connectionReason = '{{interest}}와 연결됩니다.'
    expect(() => decodeResultSnapshot(unresolvedReason)).toThrow()
  })

  it('rejects malformed timestamps, source dates, keys, and type buckets', () => {
    const noTimezone = clone(makeValidSnapshot())
    noTimezone.completedAt = '2026-07-15T08:30:00'
    expect(() => decodeResultSnapshot(noTimezone)).toThrow()

    const impossibleDate = clone(makeValidSnapshot())
    impossibleDate.resources.project[0]!.sourceDate = '2026-02-30'
    expect(() => decodeResultSnapshot(impossibleDate)).toThrow()

    const mismatchedKey = clone(makeValidSnapshot())
    mismatchedKey.selectedInterests[0]!.key = 'career.artist'
    expect(() => decodeResultSnapshot(mismatchedKey)).toThrow()

    const oversizedKey = clone(makeValidSnapshot())
    oversizedKey.selectedInterests[0]!.key = `work.${'a'.repeat(1000)}`
    expect(() => decodeResultSnapshot(oversizedKey)).toThrow()

    const mismatchedBucket = clone(makeValidSnapshot())
    mismatchedBucket.resources.project[0]!.type = 'career'
    expect(() => decodeResultSnapshot(mismatchedBucket)).toThrow()
  })

  it('requires mirrored learning-path courses to match the course result objects', () => {
    const missingCourse = clone(makeValidSnapshot())
    missingCourse.learningPath[0]!.resources[0] = {
      ...missingCourse.learningPath[0]!.resources[0]!,
      id: 999,
    }
    expect(() => decodeResultSnapshot(missingCourse)).toThrow()

    const staleCopy = clone(makeValidSnapshot())
    staleCopy.learningPath[0]!.resources[0] = {
      ...staleCopy.learningPath[0]!.resources[0]!,
      title: '서로 다른 제목',
    }
    expect(() => decodeResultSnapshot(staleCopy)).toThrow()
  })
})
