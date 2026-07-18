import { describe, expect, it } from 'vitest'

import {
  computeEnvironmentScore,
  type EnvironmentScoreInput,
} from '../../../server/modules/matching/environment-score'
import type {
  CourseResultResource,
  EquipmentResultResource,
  FacilityResultResource,
} from '../../../shared/types/result'

const course = (year: 1 | 2 | 3 | 4): CourseResultResource => ({
  id: year,
  type: 'course',
  title: `${year}학년 교과`,
  summary: `${year}학년 교과 요약`,
  sourceDate: '2026-07-18',
  affinity: 100,
  primaryTag: 'photography',
  connectionReason: `${year}학년 교과 연결 근거`,
  displayMetadata: { gradeYear: year, term: '1학기', credits: 3 },
})

const equipment = (category: 'body' | 'lens'): EquipmentResultResource => ({
  id: category === 'body' ? 10 : 11,
  type: 'equipment',
  title: category === 'body' ? '카메라 바디' : '교환 렌즈',
  summary: '검증된 기자재',
  sourceDate: '2026-07-18',
  affinity: 100,
  primaryTag: category === 'body' ? 'camera' : 'lens',
  connectionReason: '기자재 연결 근거',
  displayMetadata: {
    locationLabel: '기자재실',
    confirmedQuantity: 1,
    reservationUrl: 'https://gjureserve.co.kr',
    accessMode: 'reservation',
    accessLabel: '예약 가능',
    category,
  },
})

const facility: FacilityResultResource = {
  id: 20,
  type: 'facility',
  title: '호리존 스튜디오',
  summary: '검증된 실습 시설',
  sourceDate: '2026-07-18',
  affinity: 100,
  primaryTag: 'studio',
  connectionReason: '시설 연결 근거',
  displayMetadata: { locationLabel: '스튜디오 A', operationNote: '예약 후 사용' },
}

const fullEvidence = (): EnvironmentScoreInput => ({
  facility: [facility],
  equipment: [equipment('body'), equipment('lens')],
  learningPath: ([1, 2, 3, 4] as const).map(year => ({
    year,
    resources: [course(year)],
  })) as EnvironmentScoreInput['learningPath'],
  hasPrimaryFaculty: true,
})

const without = (
  evidence: 'facility' | 'body' | 'lens' | 'faculty',
): EnvironmentScoreInput => {
  const input = fullEvidence()
  if (evidence === 'facility') return { ...input, facility: [] }
  if (evidence === 'faculty') return { ...input, hasPrimaryFaculty: false }
  return {
    ...input,
    equipment: input.equipment.filter(item => item.displayMetadata.category !== evidence),
  }
}

const withoutCourseYear = (missingYear: 1 | 2 | 3 | 4): EnvironmentScoreInput => {
  const input = fullEvidence()
  return {
    ...input,
    learningPath: input.learningPath.map(year => (
      year.year === missingYear ? { ...year, resources: [] } : year
    )) as EnvironmentScoreInput['learningPath'],
  }
}

describe('education environment readiness score', () => {
  it('시설·바디·렌즈·4개 학년·총괄교수가 있으면 100점이다', () => {
    expect(computeEnvironmentScore(fullEvidence())).toBe(100)
  })

  it.each([
    ['facility', without('facility'), 65],
    ['body', without('body'), 85],
    ['lens', without('lens'), 85],
    ['one course year', withoutCourseYear(4), 93.8],
    ['faculty', without('faculty'), 90],
  ] as const)('%s 근거가 없으면 해당 배점만 제외한다', (_name, input, expected) => {
    expect(computeEnvironmentScore(input)).toBe(expected)
  })

  it('예시 콘텐츠 필드를 입력으로 받지 않는다', () => {
    expect(Object.keys(fullEvidence()).sort()).toEqual([
      'equipment',
      'facility',
      'hasPrimaryFaculty',
      'learningPath',
    ])
  })
})
