import { describe, expect, it } from 'vitest'
import { renderConnectionReason } from '../../../server/modules/matching/reasons'
import { resultResourceSchema } from '../../../shared/schemas/result'
import { equipmentCategoryOf } from '../../../shared/utils/equipment-category'
import {
  computeEnvironmentScore,
  rankResources,
  type ResourceCandidate,
} from '../../../server/modules/matching/resources'

type CourseCandidate = Extract<ResourceCandidate, { type: 'course' }>
type EquipmentCandidate = Extract<ResourceCandidate, { type: 'equipment' }>
type FacilityCandidate = Extract<ResourceCandidate, { type: 'facility' }>

const tag = (key: string, weight = 3, isPrimary = false) => ({ key, weight, isPrimary })

const course = (id: number, overrides: Partial<CourseCandidate> = {}): CourseCandidate => ({
  id,
  type: 'course',
  title: `교과 ${id}`,
  summary: `교과 ${id} 요약`,
  status: 'active',
  visibility: 'public',
  priority: 0,
  sourceDate: '2026-07-14',
  metadata: { gradeYear: 1, term: '1학기', credits: 3, goalSummary: '기초를 익히는' },
  tags: [tag(`interest_${id}`)],
  ...overrides,
})

const equipment = (
  id: number,
  overrides: Partial<EquipmentCandidate> = {},
): EquipmentCandidate => ({
  id,
  type: 'equipment',
  title: `장비 ${id}`,
  summary: `장비 ${id} 요약`,
  status: 'active',
  visibility: 'public',
  priority: 0,
  sourceDate: '2026-07-14',
  metadata: {
    locationLabel: '판타지랩',
    confirmedQuantity: 2,
    reservationUrl: 'https://gjureserve.co.kr',
    accessMode: 'inquiry',
    accessLabel: '문의 전용',
  },
  tags: [tag(`interest_${id}`)],
  ...overrides,
})

const facility = (
  id: number,
  overrides: Partial<FacilityCandidate> = {},
): FacilityCandidate => ({
  id,
  type: 'facility',
  title: `시설 ${id}`,
  summary: `시설 ${id} 요약`,
  status: 'next_year_confirmed',
  visibility: 'public',
  priority: 0,
  sourceDate: '2026-07-14',
  metadata: {
    locationLabel: '학과',
    operationNote: '학과 확인 필요',
    lastVerifiedAt: '2026-07-14T09:00:00+09:00',
  },
  tags: [tag(`interest_${id}`)],
  ...overrides,
})

const emptyMetadataCandidate = (
  id: number,
  type: 'extracurricular' | 'project' | 'career' | 'support',
  key = `interest_${id}`,
): ResourceCandidate => ({
  id,
  type,
  title: `${type} ${id}`,
  summary: `${type} ${id} 요약`,
  status: 'active',
  visibility: 'public',
  priority: 0,
  sourceDate: '2026-07-14',
  metadata: {},
  tags: [tag(key)],
})

const selected = (keys: readonly string[]) => keys.map(key => ({
  key,
  label: `${key} 선택`,
}))

describe('resource matching', () => {
  it('uses exact affinity and locked sort keys while exposing one decimal', () => {
    const interests = { a: 0.5, b: 0.5, c: 0.5, d: 0.5, raw_high: 0.5004, raw_low: 0.5 }
    const ranked = rankResources({
      interestVector: interests,
      selectedInterests: selected(Object.keys(interests)),
      candidates: [
        course(12, { priority: 5, sourceDate: '2026-07-01', tags: [tag('d')] }),
        course(9, { priority: 5, sourceDate: '2026-07-01', tags: [tag('c')] }),
        course(3, { priority: 5, sourceDate: '2026-07-02', tags: [tag('b')] }),
        course(7, { priority: 10, sourceDate: '2026-06-01', tags: [tag('a')] }),
      ],
    })

    expect(ranked.course.map(item => item.id)).toEqual([7, 3, 9, 12])
    expect(ranked.course.map(item => item.affinity)).toEqual([50, 50, 50, 50])

    const rawRanked = rankResources({
      interestVector: interests,
      selectedInterests: selected(Object.keys(interests)),
      candidates: [
        course(1, { tags: [tag('raw_low')] }),
        course(10, { tags: [tag('raw_high')] }),
      ],
    })
    expect(rawRanked.course.map(item => item.id)).toEqual([10, 1])
    expect(rawRanked.course.map(item => item.affinity)).toEqual([50, 50])

    const weighted = rankResources({
      interestVector: { documentary: 1 },
      selectedInterests: [{ key: 'documentary', label: '다큐멘터리' }],
      candidates: [course(20, { tags: [tag('documentary', 3), tag('unmatched', 1)] })],
    })
    expect(weighted.course[0]?.affinity).toBe(75)
  })

  it('uses no inactive, private, unrelated, or malformed candidate as filler', () => {
    const valid = course(1, { tags: [tag('documentary')] })
    const invalidWeightHigh = course(6, { tags: [tag('documentary', 4)] }) as ResourceCandidate
    const invalidWeightLow = course(7, { tags: [tag('documentary', -0.1)] }) as ResourceCandidate
    const invalidWeightNonFinite = course(8, {
      tags: [tag('documentary', Number.NaN)],
    }) as ResourceCandidate
    const invalidMetadata = course(9, {
      metadata: { gradeYear: 5, term: '1학기', credits: 3, goalSummary: '잘못된' },
    } as unknown as Partial<CourseCandidate>)
    const invalidType = { ...course(10), type: 'unknown' } as unknown as ResourceCandidate
    const invalidEquipment = equipment(13, {
      metadata: { locationLabel: '판타지랩' } as unknown as EquipmentCandidate['metadata'],
      tags: [tag('documentary')],
    })
    const invalidEquipmentCategory = equipment(23, {
      metadata: {
        ...equipment(23).metadata,
        category: 'camera-secret',
      } as unknown as EquipmentCandidate['metadata'],
      tags: [tag('documentary')],
    })
    const invalidFacility = facility(14, {
      metadata: { locationLabel: '학과' } as unknown as FacilityCandidate['metadata'],
      tags: [tag('documentary')],
    })
    const invalidStudentWork = {
      id: 15,
      type: 'student_work',
      title: '근거가 불완전한 작품',
      summary: '이미지 대체 텍스트가 없습니다.',
      status: 'active',
      visibility: 'public',
      priority: 0,
      sourceDate: '2026-07-14',
      metadata: { imagePath: 'works/incomplete.jpg' },
      tags: [tag('documentary')],
    } as unknown as ResourceCandidate

    const ranked = rankResources({
      interestVector: { documentary: 1 },
      selectedInterests: [{ key: 'documentary', label: '다큐멘터리' }],
      candidates: [
        valid,
        course(2, { status: 'draft', tags: [tag('documentary')] }),
        course(3, { status: 'archived', tags: [tag('documentary')] }),
        course(4, { visibility: 'admin_only', tags: [tag('documentary')] }),
        course(5, { visibility: 'hidden', tags: [tag('documentary')] }),
        course(11, { tags: [tag('unrelated')] }),
        course(12, { sourceDate: '07/14/2026', tags: [tag('documentary')] }),
        invalidWeightHigh,
        invalidWeightLow,
        invalidWeightNonFinite,
        invalidMetadata,
        invalidType,
        invalidEquipment,
        invalidEquipmentCategory,
        invalidFacility,
        invalidStudentWork,
      ],
    })

    expect(ranked.course.map(item => item.id)).toEqual([1])
    expect(ranked.capabilityEvidence).toEqual([])
    expect(ranked.studentWork).toEqual([])
  })

  it('preserves verified equipment categories and classifies legacy snapshots compatibly', () => {
    const ranked = rankResources({
      interestVector: { camera: 1, lens: 0.8 },
      selectedInterests: selected(['camera', 'lens']),
      candidates: [
        equipment(2, {
          metadata: { ...equipment(2).metadata, category: 'body' },
          tags: [tag('camera')],
        }),
        equipment(3, { tags: [tag('lens')] }),
      ],
    })

    expect(ranked.capabilityEvidence.find(item => item.id === 2)?.displayMetadata)
      .toMatchObject({ category: 'body' })
    const legacyCameraResource = ranked.capabilityEvidence.find(item => item.id === 2)!
    const legacyLensResource = ranked.capabilityEvidence.find(item => item.id === 3)!
    expect(equipmentCategoryOf({
      ...legacyCameraResource,
      displayMetadata: {
        ...legacyCameraResource.displayMetadata,
        category: undefined,
      },
    })).toBe('body')
    expect(equipmentCategoryOf(legacyLensResource)).toBe('lens')
  })

  it('rejects non-finite or out-of-range student interest scores', () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      expect(() => rankResources({
        interestVector: { documentary: invalid },
        selectedInterests: [{ key: 'documentary', label: '다큐멘터리' }],
        candidates: [course(1, { tags: [tag('documentary')] })],
      })).toThrow(/interest|score|0.*1|finite|관심|점수/iu)
    }
  })

  it('emits only canonical resource snapshots and filters every malformed boundary', () => {
    const canonicalStudentWork = {
      id: 4,
      type: 'student_work',
      title: '학생 작품',
      summary: '안전한 학생 작품',
      status: 'active',
      visibility: 'public',
      priority: 0,
      sourceDate: '2026-07-14',
      metadata: { imagePath: 'works/safe.jpg', imageAlt: '안전한 학생 작품' },
      tags: [tag('edge_4')],
    } as const satisfies ResourceCandidate
    const candidates: ResourceCandidate[] = [
      course(1, {
        metadata: { gradeYear: 1, term: '1학기', credits: 0, goalSummary: '기초를 확인하는' },
        tags: [tag('edge_1')],
      }),
      equipment(2, {
        metadata: {
          locationLabel: '판타지랩',
          confirmedQuantity: 1,
          reservationUrl: 'https://gjureserve.co.kr',
          accessMode: 'inquiry',
          accessLabel: '문의 전용',
        },
        tags: [tag('edge_2')],
      }),
      facility(3, { tags: [tag('edge_3')] }),
      canonicalStudentWork,
      course(10, { title: ' 앞뒤 공백', tags: [tag('edge_10')] }),
      course(11, { summary: '가'.repeat(1001), tags: [tag('edge_11')] }),
      course(12, { priority: -1, tags: [tag('edge_12')] }),
      course(13, { priority: 32768, tags: [tag('edge_13')] }),
      course(14, { tags: [tag('Invalid-Key')] }),
      course(15, {
        metadata: { gradeYear: 1, term: '가'.repeat(21), credits: 3, goalSummary: '기초를 익히는' },
        tags: [tag('edge_15')],
      }),
      course(16, {
        metadata: { gradeYear: 1, term: '1학기', credits: 31, goalSummary: '기초를 익히는' },
        tags: [tag('edge_16')],
      }),
      course(17, {
        metadata: { gradeYear: 1, term: '1학기', credits: 3, goalSummary: '가'.repeat(1000) },
        tags: [tag('edge_17')],
      }),
      equipment(18, {
        metadata: { ...equipment(18).metadata, confirmedQuantity: 0 },
        tags: [tag('edge_18')],
      }),
      equipment(19, {
        metadata: { ...equipment(19).metadata, confirmedQuantity: 1000 },
        tags: [tag('edge_19')],
      }),
      equipment(20, {
        metadata: { ...equipment(20).metadata, locationLabel: '가'.repeat(121) },
        tags: [tag('edge_20')],
      }),
      {
        ...canonicalStudentWork,
        id: 21,
        metadata: { imagePath: '../secret.jpg', imageAlt: '위험한 경로' },
        tags: [tag('edge_21')],
      },
      {
        ...canonicalStudentWork,
        id: 22,
        metadata: { imagePath: 'works/long-alt.jpg', imageAlt: '가'.repeat(201) },
        tags: [tag('edge_22')],
      },
    ]
    const keys = candidates.flatMap(candidate => candidate.tags.map(item => item.key))
    const ranked = rankResources({
      interestVector: Object.fromEntries(keys.map(key => [key, 1])),
      selectedInterests: selected(keys),
      candidates,
    })

    expect(ranked.course.map(item => item.id)).toEqual([1])
    expect(ranked.capabilityEvidence.map(item => item.id)).toEqual([3, 2])
    expect(ranked.studentWork.map(item => item.id)).toEqual([4])
    const displayed = [
      ...ranked.course,
      ...ranked.capabilityEvidence,
      ...ranked.studentWork,
    ]
    expect(displayed.every(item => resultResourceSchema.safeParse(item).success)).toBe(true)
    expect(displayed.every(item => Object.isFrozen(item) && Object.isFrozen(item.displayMetadata)))
      .toBe(true)
  })

  it('requires verified facility evidence but omits verification timestamps from snapshots', () => {
    const valid = facility(30, { tags: [tag('facility_30')] })
    const nullVerification = facility(31, {
      metadata: { ...facility(31).metadata, lastVerifiedAt: null } as unknown as FacilityCandidate['metadata'],
      tags: [tag('facility_31')],
    })
    const invalidVerification = facility(32, {
      metadata: { ...facility(32).metadata, lastVerifiedAt: '확인 필요' },
      tags: [tag('facility_32')],
    })
    const keys = ['facility_30', 'facility_31', 'facility_32']
    const ranked = rankResources({
      interestVector: Object.fromEntries(keys.map(key => [key, 1])),
      selectedInterests: selected(keys),
      candidates: [valid, nullVerification, invalidVerification],
    })

    expect(ranked.capabilityEvidence.map(item => item.id)).toEqual([30])
    expect(ranked.capabilityEvidence[0]?.displayMetadata).toEqual({
      locationLabel: '학과',
      operationNote: '학과 확인 필요',
    })
    expect(JSON.stringify(ranked.capabilityEvidence[0])).not.toContain('lastVerifiedAt')
  })

  it('rejects duplicate candidate IDs and tag keys deterministically across permutations', () => {
    const messageFor = (candidates: readonly ResourceCandidate[]): string | null => {
      try {
        rankResources({
          interestVector: { documentary: 1, portrait: 1 },
          selectedInterests: selected(['documentary', 'portrait']),
          candidates,
        })
        return null
      }
      catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    const duplicateIds: ResourceCandidate[] = [
      course(40, { tags: [tag('documentary')] }),
      equipment(40, { tags: [tag('portrait')] }),
    ]
    const duplicateTags: ResourceCandidate[] = [course(41, {
      tags: [tag('documentary', 3), tag('documentary', 1)],
    })]

    const idMessage = messageFor(duplicateIds)
    expect(idMessage).toMatch(/duplicate.*candidate.*id|candidate.*id.*duplicate/iu)
    expect(messageFor([...duplicateIds].reverse())).toBe(idMessage)

    const tagMessage = messageFor(duplicateTags)
    expect(tagMessage).toMatch(/duplicate.*tag|tag.*duplicate/iu)
    expect(messageFor(duplicateTags.map(candidate => ({
      ...candidate,
      tags: [...candidate.tags].reverse(),
    })))).toBe(tagMessage)
  })

  it('selects primary tags deterministically and enforces diversity per pool', () => {
    const documentary = [1, 2, 3].map(id => course(id, {
      tags: [tag('z_tag', 2, true), tag('documentary', 3), tag('a_tag', 3)],
    }))
    const alternative = course(4, { tags: [tag('portrait', 3)] })
    const ranked = rankResources({
      interestVector: { a_tag: 1, documentary: 1, portrait: 0.8, z_tag: 1 },
      selectedInterests: selected(['a_tag', 'documentary', 'portrait', 'z_tag']),
      candidates: [...documentary, alternative],
    })

    expect(ranked.course.filter(item => item.primaryTag === 'a_tag')).toHaveLength(2)
    expect(ranked.course.map(item => item.id)).toEqual([1, 2, 4])

    const combinedCapability = rankResources({
      interestVector: { documentary: 1, portrait: 0.8 },
      selectedInterests: selected(['documentary', 'portrait']),
      candidates: [
        equipment(11, { tags: [tag('documentary')] }),
        facility(12, { tags: [tag('documentary')] }),
        equipment(13, { tags: [tag('documentary')] }),
        facility(14, { tags: [tag('portrait')] }),
      ],
    })
    expect(combinedCapability.capabilityEvidence.map(item => item.id)).toEqual([12, 14, 11, 13])
    expect(combinedCapability.capabilityEvidence
      .filter(item => item.primaryTag === 'documentary')).toHaveLength(3)
  })

  it('selects two facilities, one body, and one lens before higher-affinity other equipment', () => {
    const ranked = rankResources({
      interestVector: {
        facility_a: 1,
        facility_b: 0.9,
        body: 0.8,
        lens: 0.7,
        lighting: 0.95,
      },
      selectedInterests: selected(['facility_a', 'facility_b', 'body', 'lens', 'lighting']),
      candidates: [
        facility(40, { tags: [tag('facility_a')] }),
        facility(41, { tags: [tag('facility_b')] }),
        equipment(42, {
          metadata: { ...equipment(42).metadata, category: 'body' },
          tags: [tag('body')],
        }),
        equipment(43, {
          metadata: { ...equipment(43).metadata, category: 'lens' },
          tags: [tag('lens')],
        }),
        equipment(44, {
          metadata: { ...equipment(44).metadata, category: 'lighting' },
          tags: [tag('lighting')],
        }),
      ],
    })

    expect(ranked.capabilityEvidence.map(item => item.id)).toEqual([40, 41, 42, 43])
  })

  it('fills unused capability slots with the strongest unselected equipment', () => {
    const ranked = rankResources({
      interestVector: { facility: 1, body: 0.8, lighting: 0.95, audio: 0.7 },
      selectedInterests: selected(['facility', 'body', 'lighting', 'audio']),
      candidates: [
        facility(50, { tags: [tag('facility')] }),
        equipment(51, {
          metadata: { ...equipment(51).metadata, category: 'body' },
          tags: [tag('body')],
        }),
        equipment(52, {
          metadata: { ...equipment(52).metadata, category: 'lighting' },
          tags: [tag('lighting')],
        }),
        equipment(53, {
          metadata: { ...equipment(53).metadata, category: 'audio' },
          tags: [tag('audio')],
        }),
      ],
    })

    expect(ranked.capabilityEvidence.map(item => item.id)).toEqual([50, 51, 52, 53])
  })

  it('combines capability and project pools, applies every cap, and preserves evidence', () => {
    const keys = Array.from({ length: 60 }, (_, index) => `interest_${index + 1}`)
    const capability: ResourceCandidate[] = [
      equipment(1, {
        metadata: {
          locationLabel: '판타지랩',
          confirmedQuantity: 2,
          reservationUrl: 'https://gjureserve.co.kr',
          accessMode: 'inquiry',
          accessLabel: '문의 전용',
          inventoryCode: 'SECRET-01',
        } as EquipmentCandidate['metadata'],
      }),
      facility(2),
      equipment(3),
      facility(4),
      equipment(5),
    ]
    const extracurricularProject = Array.from({ length: 5 }, (_, index) => emptyMetadataCandidate(
      index + 6,
      index % 2 === 0 ? 'extracurricular' : 'project',
    ))
    const studentWork = Array.from({ length: 5 }, (_, index): ResourceCandidate => ({
      id: index + 11,
      type: 'student_work',
      title: `작품 ${index + 1}`,
      summary: '포트폴리오 작품',
      status: 'active',
      visibility: 'public',
      priority: 0,
      sourceDate: '2026-07-14',
      metadata: { imagePath: `works/${index + 1}.jpg`, imageAlt: `작품 ${index + 1}` },
      tags: [tag(`interest_${index + 11}`)],
    }))
    const careers = Array.from({ length: 6 }, (_, index) => emptyMetadataCandidate(
      index + 16,
      'career',
    ))
    const courses = Array.from({ length: 7 }, (_, index) => course(index + 31))

    const ranked = rankResources({
      interestVector: Object.fromEntries(keys.map(key => [key, 1])),
      selectedInterests: selected(keys),
      candidates: [...capability, ...extracurricularProject, ...studentWork, ...careers, ...courses],
    })

    expect(ranked.course).toHaveLength(5)
    expect(ranked.capabilityEvidence).toHaveLength(4)
    expect(ranked.capabilityEvidence.slice(0, 2)).toHaveLength(2)
    expect(ranked.capabilityEvidence.map(item => item.type)).toEqual([
      'facility',
      'facility',
      'equipment',
      'equipment',
    ])
    expect(ranked.capabilityEvidence.find(item => item.id === 1)?.displayMetadata).toEqual({
      locationLabel: '판타지랩',
      confirmedQuantity: 2,
      reservationUrl: 'https://gjureserve.co.kr',
      accessMode: 'inquiry',
      accessLabel: '문의 전용',
    })
    expect(JSON.stringify(ranked.capabilityEvidence.find(item => item.id === 1)))
      .not.toContain('SECRET-01')
    expect(ranked.capabilityEvidence.find(item => item.id === 2)?.displayMetadata).toEqual({
      locationLabel: '학과',
      operationNote: '학과 확인 필요',
    })
    expect(ranked.extracurricularProject).toHaveLength(3)
    expect(ranked.studentWork).toHaveLength(3)
    expect(ranked.studentWork[0]?.displayMetadata).toEqual({
      imagePath: 'works/1.jpg',
      imageAlt: '작품 1',
    })
    expect(ranked.career).toHaveLength(4)
  })

  it('computes category fits from displayed items and excludes support', () => {
    const candidates: ResourceCandidate[] = [
      course(1, { tags: [tag('course_fit', 2)] }),
      equipment(2, { tags: [tag('equipment_fit', 3)] }),
      facility(3, { tags: [tag('facility_fit', 1)] }),
      emptyMetadataCandidate(4, 'project', 'project_fit'),
      {
        id: 5,
        type: 'student_work',
        title: '학생 작품',
        summary: '학생 작품 요약',
        status: 'active',
        visibility: 'public',
        priority: 0,
        sourceDate: '2026-07-14',
        metadata: { imagePath: 'works/one.jpg', imageAlt: '학생 작품' },
        tags: [tag('portfolio_fit', 1)],
      },
      emptyMetadataCandidate(6, 'career', 'career_fit'),
      emptyMetadataCandidate(7, 'support', 'support_fit'),
    ]
    const ranked = rankResources({
      interestVector: {
        course_fit: 0.8,
        equipment_fit: 0.6,
        facility_fit: 0.3,
        project_fit: 0.5,
        portfolio_fit: 0.4,
        career_fit: 1,
        support_fit: 1,
      },
      selectedInterests: selected([
        'course_fit',
        'equipment_fit',
        'facility_fit',
        'project_fit',
        'portfolio_fit',
        'career_fit',
        'support_fit',
      ]),
      candidates,
    })

    expect(ranked.categoryFits).toEqual({
      course: 80,
      equipmentFacility: 52.5,
      extracurricularProject: 50,
      careerPortfolio: 85,
    })
    expect(ranked.support).toHaveLength(1)
    expect(ranked.categoryFits).not.toHaveProperty('support')

    const displayedOnly = rankResources({
      interestVector: {
        cap_1: 1,
        cap_2: 0.9,
        cap_3: 0.8,
        cap_4: 0.7,
        cap_5: 0.6,
        cap_6: 0.1,
      },
      selectedInterests: selected(['cap_1', 'cap_2', 'cap_3', 'cap_4', 'cap_5', 'cap_6']),
      candidates: [1, 2, 3, 4, 5, 6].map(index => course(100 + index, {
        tags: [tag(`cap_${index}`, 1)],
      })),
    })
    expect(displayedOnly.course.map(item => item.id)).toEqual([101, 102, 103, 104, 105])
    expect(displayedOnly.categoryFits.course).toBe(80)

    expect(computeEnvironmentScore({
      course: 80,
      equipmentFacility: 70,
      extracurricularProject: 60,
      faculty: 90,
      careerPortfolio: 50,
      support: 100,
    })).toBe(72)
    expect(computeEnvironmentScore({ course: 100 })).toBe(35)
    expect(computeEnvironmentScore({
      course: 80.1,
      equipmentFacility: 70.2,
      extracurricularProject: 60.3,
      faculty: 90.4,
      careerPortfolio: 50.5,
    })).toBe(72.3)

    for (const category of [
      'course',
      'equipmentFacility',
      'extracurricularProject',
      'faculty',
      'careerPortfolio',
    ] as const) {
      for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 100.1]) {
        expect(() => computeEnvironmentScore({ [category]: invalid }))
          .toThrow(/0.*100|finite/iu)
      }
    }
  })

  it('renders the strongest matched Korean evidence and rejects missing evidence', () => {
    const input = {
      interestVector: { documentary: 0.7, portrait: 0.9 },
      selectedInterests: [
        { key: 'documentary', label: '사람과 사회의 기록' },
        { key: 'portrait', label: '인물 연출' },
      ],
      resourceTags: [tag('documentary', 3), tag('portrait', 2)],
      resourceTitle: '포토 스토리 워크숍',
      goalSummary: '인물 중심의 서사를 제작하는',
    } as const
    expect(renderConnectionReason(input)).toBe(
      '선택한 ‘사람과 사회의 기록’ 관심이 인물 중심의 서사를 제작하는 ‘포토 스토리 워크숍’과 연결됩니다.',
    )

    expect(() => renderConnectionReason({
      ...input,
      selectedInterests: [{ key: 'portrait', label: '인물 연출' }],
    })).toThrow(/label|레이블|evidence|근거/iu)
    expect(() => renderConnectionReason({ ...input, resourceTitle: ' ' })).toThrow(/title|제목/iu)
    expect(() => renderConnectionReason({ ...input, goalSummary: '  ' })).toThrow(/goal|목표/iu)
    expect(() => renderConnectionReason({
      ...input,
      selectedInterests: [
        { key: 'documentary', label: '' },
        { key: 'portrait', label: '인물 연출' },
      ],
    })).toThrow(/label|레이블|evidence|근거/iu)
    expect(() => renderConnectionReason({
      ...input,
      interestVector: { unrelated: 1 },
    })).toThrow(/matched|일치/iu)
  })

  it('is deterministic across candidate, tag, and selected-label permutations', () => {
    const candidates = [
      course(9, { tags: [tag('portrait', 2), tag('documentary', 3)] }),
      course(3, { tags: [tag('portrait', 3), tag('documentary', 2)] }),
    ]
    const first = rankResources({
      interestVector: { documentary: 0.8, portrait: 0.8 },
      selectedInterests: [
        { key: 'documentary', label: '기록' },
        { key: 'portrait', label: '인물' },
      ],
      candidates,
    })
    const second = rankResources({
      interestVector: { portrait: 0.8, documentary: 0.8 },
      selectedInterests: [
        { key: 'portrait', label: '인물' },
        { key: 'documentary', label: '기록' },
      ],
      candidates: [...candidates].reverse().map(candidate => ({
        ...candidate,
        tags: [...candidate.tags].reverse(),
      })),
    })

    expect(second.course.map(item => item.id)).toEqual(first.course.map(item => item.id))
    expect(second.course.map(item => item.connectionReason))
      .toEqual(first.course.map(item => item.connectionReason))
  })
})
