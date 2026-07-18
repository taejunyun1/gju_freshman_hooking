import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  deriveContentSeed,
  parseContentSeedInputs,
} from '../../../scripts/seed-content'
import { parseAssessmentCatalog } from '../../../scripts/seed-assessment-options'
import { scoreAssessment } from '../../../server/modules/assessment/scoring'
import {
  recommendFaculty,
  type FacultyRecommendationCandidate,
  type FacultySpecialistLink,
  type FacultyStudentEvidence,
  type RecommendFacultyInput,
} from '../../../server/modules/matching/faculty'
import type { AssessmentOption, AssessmentSelections, QuestionGroup } from '../../../shared/types/domain'

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown

const contentSeed = deriveContentSeed(parseContentSeedInputs({
  curriculum: readJson('supabase/seed/curriculum-2026.json'),
  faculty: readJson('supabase/seed/faculty-2026.json'),
  equipment: readJson('supabase/seed/equipment-inventory-2026-07-14.json'),
  facilities: readJson('supabase/seed/facilities-2026.json'),
  departmentArchive: readJson('supabase/seed/department-archive-2026-05-26.json'),
}))

const catalog = parseAssessmentCatalog(readJson('supabase/seed/assessment-options.json'))
const facultyIds = new Map(contentSeed.faculty.map((person, index) => [person.name, index + 1]))
const priorities = new Map([
  ['조대연', 300],
  ['윤태준', 200],
  ['김사라', 100],
  ['박재웅', 90],
  ['정철호', 80],
  ['곽동욱', 70],
])

/** Mirrors migration 202607180026, including the production-only contemporary_art transform. */
const activeFaculty = (): FacultyRecommendationCandidate[] => contentSeed.faculty.map(person => ({
  id: facultyIds.get(person.name)!,
  name: person.name,
  title: person.title,
  expertise: person.expertiseSummary,
  status: 'active',
  employmentType: person.employmentType,
  consultationRole: person.consultationRole,
  weeklyCapacity: person.consultationRole === 'primary' ? 4 : 0,
  openAssignedCount: 0,
  priority: priorities.get(person.name)!,
  contacts: {},
  contactVisibility: {
    office: 'admin_only',
    phone: 'admin_only',
    email: 'admin_only',
    website: 'admin_only',
  },
  tags: contentSeed.facultyTags
    .filter(tag => tag.facultyName === person.name)
    .map(tag => ({
      key: tag.tagKey,
      label: tag.tagKey === 'documentary'
        ? '다큐멘터리 사진'
        : tag.tagKey === 'video'
          ? '영상과 기술(AI·편집·드론)'
          : tag.tagLabel,
      category: tag.category === 'track' && tag.tagKey === 'contemporary_art'
        ? 'activity'
        : tag.category,
      weight: tag.weight,
      isPrimary: tag.isPrimary,
    })),
}))

const activeLinks = (): FacultySpecialistLink[] => contentSeed.specialistLinks.map(link => ({
  primaryFacultyId: link.primaryFacultyName === null
    ? null
    : facultyIds.get(link.primaryFacultyName)!,
  specialistFacultyId: facultyIds.get(link.specialistFacultyName)!,
  tagKey: link.tagKey,
  priority: link.priority,
}))

const selectedLabels = (
  selections: AssessmentSelections,
  interestVector: Readonly<Record<string, number>>,
): Record<string, string> => {
  const selectedKeys = new Set([
    ...selections.work,
    ...selections.result,
    ...selections.style,
    ...selections.career,
  ])
  const labels: Record<string, string> = {}
  for (const option of catalog) {
    if (!selectedKeys.has(option.optionKey)) continue
    for (const tag of option.interestTags) labels[tag] ??= option.label
  }
  for (const [key, score] of Object.entries(interestVector)) {
    if (score > 0 && labels[key] === undefined) throw new Error(`missing test label: ${key}`)
  }
  return labels
}

const evidenceFor = (selections: AssessmentSelections): FacultyStudentEvidence => {
  const scored = scoreAssessment(catalog, selections)
  return {
    trackScores: scored.trackScores,
    interestVector: scored.interestVector,
    selectedLabels: selectedLabels(selections, scored.interestVector),
  }
}

const selections = (
  work: string,
  result: string,
  style: string,
  career: string,
): AssessmentSelections => ({
  work: [work],
  result: [result],
  style: [style],
  career: [career],
  careerOther: null,
})

const recommendation = (
  assessmentSelections: AssessmentSelections,
  distributionKey: number,
  faculty = activeFaculty(),
) => recommendationForEvidence(evidenceFor(assessmentSelections), distributionKey, faculty)

const recommendationForEvidence = (
  student: FacultyStudentEvidence,
  distributionKey: number,
  faculty = activeFaculty(),
  specialistLinks = activeLinks(),
) => recommendFaculty({
  student,
  faculty,
  specialistLinks,
  distributionKey,
})

const optionsByGroup = Object.fromEntries(
  (['work', 'result', 'style', 'career'] as const).map(group => [
    group,
    catalog.filter(option => option.group === group),
  ]),
) as Record<QuestionGroup, AssessmentOption[]>

describe('canonical faculty recommendation balance', () => {
  it('routes the three clear questionnaire expertise paths independently of distribution key', () => {
    const clearPaths = [
      {
        selections: selections(
          'work.interview_life',
          'result.documentary',
          'style.interview',
          'career.video',
        ),
        professor: '조대연',
      },
      {
        selections: selections(
          'work.video_post',
          'result.video_showreel',
          'style.post',
          'career.video',
        ),
        professor: '윤태준',
      },
      {
        selections: selections(
          'work.brand_region',
          'result.documentary',
          'style.field',
          'career.planning',
        ),
        professor: '김사라',
      },
    ] as const

    for (const path of clearPaths) {
      for (const distributionKey of [1, 2, 3, 197, Number.MAX_SAFE_INTEGER]) {
        expect(recommendation(path.selections, distributionKey).primary.name).toBe(path.professor)
      }
    }
  })

  it('does not dilute a professor expertise match when biography tags grow', () => {
    const faculty = activeFaculty()
    const jo = faculty.find(person => person.name === '조대연')!
    for (let index = 0; index < 36; index += 1) {
      jo.tags.push({
        key: `unrelated_${index}`,
        label: `선택하지 않은 약력 ${index}`,
        category: index % 3 === 0 ? 'activity' : index % 3 === 1 ? 'result' : 'career',
        weight: 3,
        isPrimary: false,
      })
    }

    const result = recommendation(selections(
      'work.interview_life',
      'result.documentary',
      'style.interview',
      'career.video',
    ), 29, faculty)

    expect(result.primary.name).toBe('조대연')
  })

  it('canonicalizes direct field support to the 김사라 field-research ownership anchor', () => {
    const evidence: FacultyStudentEvidence = {
      trackScores: { documentary: 100, art_photo: 0, commercial: 0, video: 0 },
      interestVector: { field: 0.4 },
      selectedLabels: { field: '현장에서 촬영' },
    }

    for (const distributionKey of [1, 2, 3, Number.MAX_SAFE_INTEGER]) {
      expect(recommendationForEvidence(evidence, distributionKey).primary.name).toBe('김사라')
    }
  })

  it('does not treat a generic professor matching tag as verified department ownership', () => {
    const faculty = activeFaculty()
    const generic = faculty.find(person => person.name === '윤태준')!
    generic.name = '가상교수'
    generic.tags = [{
      key: 'social',
      label: '사회 기록 지원',
      category: 'activity',
      weight: 3,
      isPrimary: true,
    }]
    const evidence: FacultyStudentEvidence = {
      trackScores: { documentary: 0, art_photo: 0, commercial: 0, video: 0 },
      interestVector: { people: 1 },
      selectedLabels: { people: '사람의 삶을 기록하기' },
    }

    for (const distributionKey of [1, 2, 3]) {
      expect(recommendationForEvidence(evidence, distributionKey, faculty).primary.name).toBe('조대연')
    }
  })

  it('uses canonical max signals so repeated video aliases do not shrink a clear contextual lead', () => {
    const faculty = activeFaculty().slice(0, 3)
    faculty[0]!.name = '후보 A'
    faculty[0]!.tags = [{
      key: 'video', label: '영상', category: 'activity', weight: 3, isPrimary: true,
    }]
    faculty[1]!.name = '후보 B'
    faculty[1]!.tags = [{
      key: 'other_signal', label: '기타', category: 'activity', weight: 3, isPrimary: true,
    }]
    faculty[2]!.name = '후보 C'
    faculty[2]!.tags = [{
      key: 'unused_signal', label: '미선택', category: 'activity', weight: 3, isPrimary: true,
    }]
    const evidence: FacultyStudentEvidence = {
      trackScores: { documentary: 0, art_photo: 0, commercial: 0, video: 0 },
      interestVector: { video: 0.4, editing: 0.4, color_grading: 0.4, other_signal: 0.1 },
      selectedLabels: {
        video: '영상',
        editing: '영상 편집',
        color_grading: '색보정',
        other_signal: '기타',
      },
    }

    for (const distributionKey of [1, 2, 3]) {
      expect(recommendationForEvidence(evidence, distributionKey, faculty, []).primary.name).toBe('후보 A')
    }
  })

  it('keeps candidate tag strength when routing contextual support', () => {
    const faculty = activeFaculty().slice(0, 3)
    faculty[0]!.name = '강한 후보'
    faculty[0]!.tags = [{
      key: 'custom_signal', label: '핵심 지원', category: 'activity', weight: 3, isPrimary: true,
    }]
    faculty[1]!.name = '약한 후보'
    faculty[1]!.tags = [{
      key: 'custom_signal', label: '보조 지원', category: 'activity', weight: 1, isPrimary: false,
    }]
    faculty[2]!.name = '미연계 후보'
    faculty[2]!.tags = [{
      key: 'unused_signal', label: '미선택', category: 'activity', weight: 3, isPrimary: true,
    }]
    const evidence: FacultyStudentEvidence = {
      trackScores: { documentary: 0, art_photo: 0, commercial: 0, video: 0 },
      interestVector: { custom_signal: 1 },
      selectedLabels: { custom_signal: '맞춤 관심' },
    }

    for (const distributionKey of [1, 2, 3]) {
      expect(recommendationForEvidence(evidence, distributionKey, faculty, []).primary.name).toBe('강한 후보')
    }
  })

  it('keeps a local-culture fit primary even when the commercial track has no full-time owner', () => {
    const evidence: FacultyStudentEvidence = {
      trackScores: { documentary: 0, art_photo: 0, commercial: 100, video: 0 },
      interestVector: { local_culture: 0.4 },
      selectedLabels: { local_culture: '지역을 위한 콘텐츠 만들기' },
    }

    for (const distributionKey of [1, 2, 3]) {
      expect(recommendationForEvidence(evidence, distributionKey).primary.name).toBe('김사라')
    }
  })

  it('never rotates zero-evidence candidates into a commercial path with local evidence', () => {
    const evidence: FacultyStudentEvidence = {
      trackScores: { documentary: 0, art_photo: 0, commercial: 100, video: 0 },
      interestVector: { local_culture: 0.4, unrelated: 0.2 },
      selectedLabels: {
        local_culture: '지역을 위한 콘텐츠 만들기',
        unrelated: '아직 정하지 않은 관심',
      },
    }

    for (const distributionKey of [1, 2, 3, 4, 5, 6, Number.MAX_SAFE_INTEGER]) {
      expect(recommendationForEvidence(evidence, distributionKey).primary.name).toBe('김사라')
    }
  })

  it('does not reward non-dominant art and video tracks when commercial has no primary owner', () => {
    const evidence: FacultyStudentEvidence = {
      trackScores: { documentary: 40, art_photo: 70, commercial: 100, video: 60 },
      interestVector: {},
      selectedLabels: { commercial: '광고사진' },
    }
    const primaries = activeFaculty().filter(person => person.consultationRole === 'primary')
    const names = [1, 2, 3].map(distributionKey => (
      recommendationForEvidence(evidence, distributionKey, primaries, []).primary.name
    ))

    expect(new Set(names)).toEqual(new Set(['조대연', '윤태준', '김사라']))
  })

  it('does not treat a non-dominant art-photo anchor as commercial-track ownership', () => {
    const evidence: FacultyStudentEvidence = {
      trackScores: { documentary: 40, art_photo: 70, commercial: 100, video: 60 },
      interestVector: { art_photo: 0.4 },
      selectedLabels: { art_photo: '예술사진' },
    }
    const primaries = activeFaculty().filter(person => person.consultationRole === 'primary')
    const names = [1, 2, 3].map(distributionKey => (
      recommendationForEvidence(evidence, distributionKey, primaries, []).primary.name
    ))

    expect(new Set(names)).toEqual(new Set(['조대연', '윤태준', '김사라']))
  })

  it('lets strong local context beat a five-point art-track lead while preserving clear art', () => {
    const mixedEvidence: FacultyStudentEvidence = {
      trackScores: { documentary: 55, art_photo: 60, commercial: 20, video: 10 },
      interestVector: { art_photo: 0.4, local_culture: 0.4 },
      selectedLabels: { art_photo: '예술사진', local_culture: '지역문화 기록' },
    }
    const clearArtEvidence: FacultyStudentEvidence = {
      trackScores: { documentary: 20, art_photo: 90, commercial: 10, video: 10 },
      interestVector: { art_photo: 0.4 },
      selectedLabels: { art_photo: '예술사진' },
    }

    for (const distributionKey of [1, 2, 3, Number.MAX_SAFE_INTEGER]) {
      expect(recommendationForEvidence(mixedEvidence, distributionKey).primary.name).toBe('김사라')
      expect(recommendationForEvidence(clearArtEvidence, distributionKey).primary.name).toBe('윤태준')
    }
  })

  it('varies the full-time coordinator for canonical commercial choices while keeping 곽동욱 linked', () => {
    const input = selections(
      'work.commercial_image',
      'result.commercial_fashion',
      'style.studio',
      'career.photo',
    )
    const results = [1, 2, 3].map(distributionKey => recommendation(input, distributionKey))

    expect(new Set(results.map(result => result.primary.name)))
      .toEqual(new Set(['조대연', '윤태준', '김사라']))
    for (const result of results) {
      expect(result.specialists.map(person => person.name)).toContain('곽동욱')
    }
  })

  it('keeps every professor between 15% and 65% while respecting verified expertise', () => {
    const counts = new Map<string, number>()
    let distributionKey = 1

    for (const work of optionsByGroup.work) {
      for (const result of optionsByGroup.result) {
        for (const style of optionsByGroup.style) {
          for (const career of optionsByGroup.career) {
            const primary = recommendation(selections(
              work.optionKey,
              result.optionKey,
              style.optionKey,
              career.optionKey,
            ), distributionKey).primary.name
            counts.set(primary, (counts.get(primary) ?? 0) + 1)
            distributionKey += 1
          }
        }
      }
    }

    expect(distributionKey - 1).toBe(1_920)
    expect([...counts.keys()].sort()).toEqual(['김사라', '윤태준', '조대연'])
    // Preserve expertise-led routing while preventing either monopoly or token representation.
    expect(Math.max(...counts.values())).toBeLessThan(1_920 * 0.65)
    expect(Math.min(...counts.values())).toBeGreaterThanOrEqual(1_920 * 0.15)
  })

  it('keeps commercial questionnaire choices linked to 곽동욱', () => {
    const result = recommendation(selections(
      'work.commercial_image',
      'result.commercial_fashion',
      'style.studio',
      'career.photo',
    ), 11)

    expect(result.specialists.map(person => person.name)).toContain('곽동욱')
  })

  it('returns the same recommendation for the same student key and answers', () => {
    const input = selections(
      'work.photo_everyday',
      'result.photo_portfolio',
      'style.solo',
      'career.explore',
    )

    expect(recommendation(input, 71)).toEqual(recommendation(input, 71))
  })

  it('accepts only optional positive safe integer distribution keys', () => {
    const base: Omit<RecommendFacultyInput, 'distributionKey'> = {
      student: evidenceFor(selections(
        'work.photo_everyday',
        'result.photo_portfolio',
        'style.solo',
        'career.explore',
      )),
      faculty: activeFaculty(),
      specialistLinks: activeLinks(),
    }

    expect(() => recommendFaculty(base)).not.toThrow()
    expect(() => recommendFaculty({ ...base, distributionKey: 1 })).not.toThrow()
    for (const distributionKey of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => recommendFaculty({ ...base, distributionKey })).toThrowError('FACULTY_INPUT_INVALID')
    }
  })
})
