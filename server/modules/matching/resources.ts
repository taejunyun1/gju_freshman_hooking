import type {
  CareerResultResource,
  CourseResultResource,
  EmptyDisplayMetadata,
  EquipmentResultResource,
  ExtracurricularResultResource,
  FacilityResultResource,
  ProjectResultResource,
  ResultResource,
  StudentWorkResultResource,
  SupportResultResource,
} from '../../../shared/types/result'
import {
  renderConnectionReason,
  type ResourceMatchTag,
  type SelectedInterestEvidence,
} from './reasons'

type CandidateStatus = 'draft' | 'active' | 'next_year_confirmed' | 'archived'
type CandidateVisibility = 'public' | 'admin_only' | 'hidden'

interface CourseCandidateMetadata {
  readonly gradeYear: 1 | 2 | 3 | 4
  readonly term: string
  readonly credits: number
  readonly goalSummary: string
}

interface EquipmentCandidateMetadata {
  readonly locationLabel: string
  readonly confirmedQuantity: number
  readonly reservationUrl: 'https://gjureserve.co.kr'
  readonly accessMode: 'reservation' | 'inquiry'
  readonly accessLabel: '예약 가능' | '문의 전용'
  readonly [key: string]: unknown
}

interface FacilityCandidateMetadata {
  readonly locationLabel: string
  readonly operationNote: string
  readonly [key: string]: unknown
}

interface StudentWorkCandidateMetadata {
  readonly imagePath: string
  readonly imageAlt: string
  readonly [key: string]: unknown
}

interface ResourceCandidateBase<Type extends ResultResource['type'], Metadata> {
  readonly id: number
  readonly type: Type
  readonly title: string
  readonly summary: string
  readonly status: CandidateStatus
  readonly visibility: CandidateVisibility
  readonly priority: number
  readonly sourceDate: string
  readonly metadata: Readonly<Metadata>
  readonly tags: readonly ResourceMatchTag[]
}

export type ResourceCandidate =
  | ResourceCandidateBase<'course', CourseCandidateMetadata>
  | ResourceCandidateBase<'equipment', EquipmentCandidateMetadata>
  | ResourceCandidateBase<'facility', FacilityCandidateMetadata>
  | ResourceCandidateBase<'extracurricular', Readonly<Record<string, unknown>>>
  | ResourceCandidateBase<'project', Readonly<Record<string, unknown>>>
  | ResourceCandidateBase<'student_work', StudentWorkCandidateMetadata>
  | ResourceCandidateBase<'career', Readonly<Record<string, unknown>>>
  | ResourceCandidateBase<'support', Readonly<Record<string, unknown>>>

export interface RankResourcesInput {
  readonly interestVector: Readonly<Record<string, number>>
  readonly selectedInterests: readonly SelectedInterestEvidence[]
  readonly candidates: readonly ResourceCandidate[]
}

export interface ResourceCategoryFits {
  readonly course: number
  readonly equipmentFacility: number
  readonly extracurricularProject: number
  readonly careerPortfolio: number
}

export interface RankedResources {
  readonly course: readonly CourseResultResource[]
  readonly capabilityEvidence: readonly (EquipmentResultResource | FacilityResultResource)[]
  readonly extracurricularProject: readonly (
    ExtracurricularResultResource | ProjectResultResource
  )[]
  readonly studentWork: readonly StudentWorkResultResource[]
  readonly career: readonly CareerResultResource[]
  readonly support: readonly SupportResultResource[]
  readonly categoryFits: ResourceCategoryFits
}

export interface EnvironmentCategoryScores {
  readonly course?: number
  readonly equipmentFacility?: number
  readonly extracurricularProject?: number
  readonly faculty?: number
  readonly careerPortfolio?: number
  readonly support?: number
}

const allowedTypes = new Set<ResultResource['type']>([
  'course',
  'equipment',
  'facility',
  'extracurricular',
  'project',
  'student_work',
  'career',
  'support',
])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

const hasValidTags = (value: unknown): value is readonly ResourceMatchTag[] => (
  Array.isArray(value)
  && value.length > 0
  && value.every(tag => (
    isRecord(tag)
    && isNonEmptyString(tag.key)
    && typeof tag.weight === 'number'
    && Number.isFinite(tag.weight)
    && tag.weight >= 0
    && tag.weight <= 3
    && typeof tag.isPrimary === 'boolean'
  ))
)

const hasCourseMetadata = (metadata: Record<string, unknown>): boolean => (
  (metadata.gradeYear === 1
    || metadata.gradeYear === 2
    || metadata.gradeYear === 3
    || metadata.gradeYear === 4)
  && isNonEmptyString(metadata.term)
  && typeof metadata.credits === 'number'
  && Number.isInteger(metadata.credits)
  && metadata.credits > 0
  && isNonEmptyString(metadata.goalSummary)
)

const hasEquipmentMetadata = (metadata: Record<string, unknown>): boolean => (
  isNonEmptyString(metadata.locationLabel)
  && typeof metadata.confirmedQuantity === 'number'
  && Number.isSafeInteger(metadata.confirmedQuantity)
  && metadata.confirmedQuantity >= 0
  && metadata.reservationUrl === 'https://gjureserve.co.kr'
  && ((metadata.accessMode === 'reservation' && metadata.accessLabel === '예약 가능')
    || (metadata.accessMode === 'inquiry' && metadata.accessLabel === '문의 전용'))
)

const hasFacilityMetadata = (metadata: Record<string, unknown>): boolean => (
  isNonEmptyString(metadata.locationLabel) && isNonEmptyString(metadata.operationNote)
)

const hasStudentWorkMetadata = (metadata: Record<string, unknown>): boolean => (
  isNonEmptyString(metadata.imagePath) && isNonEmptyString(metadata.imageAlt)
)

const hasValidMetadata = (
  type: ResultResource['type'],
  metadata: Record<string, unknown>,
): boolean => {
  switch (type) {
    case 'course': return hasCourseMetadata(metadata)
    case 'equipment': return hasEquipmentMetadata(metadata)
    case 'facility': return hasFacilityMetadata(metadata)
    case 'student_work': return hasStudentWorkMetadata(metadata)
    case 'extracurricular':
    case 'project':
    case 'career':
    case 'support': return true
  }
}

const isValidCandidate = (value: unknown): value is ResourceCandidate => {
  if (!isRecord(value)
    || typeof value.type !== 'string'
    || !allowedTypes.has(value.type as ResultResource['type'])
    || !Number.isSafeInteger(value.id)
    || (value.id as number) <= 0
    || !isNonEmptyString(value.title)
    || !isNonEmptyString(value.summary)
    || (value.status !== 'active' && value.status !== 'next_year_confirmed')
    || value.visibility !== 'public'
    || !Number.isSafeInteger(value.priority)
    || !isIsoDate(value.sourceDate)
    || !isRecord(value.metadata)
    || !hasValidTags(value.tags)) return false

  return hasValidMetadata(value.type as ResultResource['type'], value.metadata)
}

const assertInterestVector = (interestVector: Readonly<Record<string, number>>): void => {
  for (const [key, score] of Object.entries(interestVector)) {
    if (key.trim().length === 0 || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error('Interest score must be finite and between 0 and 1')
    }
  }
}

const assertSelectedInterests = (selected: readonly SelectedInterestEvidence[]): void => {
  const keys = new Set<string>()
  for (const interest of selected) {
    if (!isNonEmptyString(interest.key) || !isNonEmptyString(interest.label)) {
      throw new Error('Selected interest label evidence is required')
    }
    if (keys.has(interest.key)) throw new Error('Duplicate selected interest evidence')
    keys.add(interest.key)
  }
}

const affinity = (
  interestVector: Readonly<Record<string, number>>,
  tags: readonly ResourceMatchTag[],
): number => {
  const denominator = tags.reduce((sum, item) => sum + item.weight, 0)
  if (denominator === 0) return 0
  return tags.reduce(
    (sum, item) => sum + (interestVector[item.key] ?? 0) * item.weight,
    0,
  ) / denominator * 100
}

const compareText = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
)

const primaryTag = (tags: readonly ResourceMatchTag[]): ResourceMatchTag => [...tags]
  .sort((left, right) => right.weight - left.weight || compareText(left.key, right.key))[0]!

const roundOneDecimal = (value: number): number => Math.round((value + Number.EPSILON) * 10) / 10

const emptyDisplayMetadata = (): EmptyDisplayMetadata => Object.freeze({})

const toResultResource = (
  candidate: ResourceCandidate,
  rawAffinity: number,
  tag: ResourceMatchTag,
  input: Pick<RankResourcesInput, 'interestVector' | 'selectedInterests'>,
): ResultResource => {
  const connectionReason = renderConnectionReason({
    interestVector: input.interestVector,
    selectedInterests: input.selectedInterests,
    resourceTags: candidate.tags,
    resourceTitle: candidate.title,
    goalSummary: candidate.type === 'course' ? candidate.metadata.goalSummary : candidate.summary,
  })
  const base = {
    id: candidate.id,
    title: candidate.title,
    summary: candidate.summary,
    sourceDate: candidate.sourceDate,
    affinity: roundOneDecimal(rawAffinity),
    primaryTag: tag.key,
    connectionReason,
  }

  switch (candidate.type) {
    case 'course': return Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: Object.freeze({
        gradeYear: candidate.metadata.gradeYear,
        term: candidate.metadata.term,
        credits: candidate.metadata.credits,
      }),
    })
    case 'equipment': return Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: Object.freeze({
        locationLabel: candidate.metadata.locationLabel,
        confirmedQuantity: candidate.metadata.confirmedQuantity,
        reservationUrl: candidate.metadata.reservationUrl,
        accessMode: candidate.metadata.accessMode,
        accessLabel: candidate.metadata.accessLabel,
      }),
    }) as EquipmentResultResource
    case 'facility': return Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: Object.freeze({
        locationLabel: candidate.metadata.locationLabel,
        operationNote: candidate.metadata.operationNote,
      }),
    })
    case 'student_work': return Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: Object.freeze({
        imagePath: candidate.metadata.imagePath,
        imageAlt: candidate.metadata.imageAlt,
      }),
    })
    case 'extracurricular':
    case 'project':
    case 'career':
    case 'support': return Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: emptyDisplayMetadata(),
    })
  }
}

interface RankedCandidate {
  readonly candidate: ResourceCandidate
  readonly rawAffinity: number
  readonly primaryTag: ResourceMatchTag
  readonly result: ResultResource
}

const compareRankedCandidates = (left: RankedCandidate, right: RankedCandidate): number => (
  right.rawAffinity - left.rawAffinity
  || right.candidate.priority - left.candidate.priority
  || compareText(right.candidate.sourceDate, left.candidate.sourceDate)
  || left.candidate.id - right.candidate.id
)

const selectDiverse = (
  candidates: readonly RankedCandidate[],
  cap: number,
): readonly RankedCandidate[] => {
  const tagCounts = new Map<string, number>()
  const selected: RankedCandidate[] = []
  for (const candidate of candidates) {
    const count = tagCounts.get(candidate.primaryTag.key) ?? 0
    if (count >= 2) continue
    selected.push(candidate)
    tagCounts.set(candidate.primaryTag.key, count + 1)
    if (selected.length === cap) break
  }
  return Object.freeze(selected)
}

const categoryFit = (candidates: readonly RankedCandidate[]): number => {
  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.primaryTag.weight, 0)
  if (totalWeight === 0) return 0
  const weightedAffinity = candidates.reduce(
    (sum, candidate) => sum + candidate.rawAffinity * candidate.primaryTag.weight,
    0,
  )
  return roundOneDecimal(weightedAffinity / totalWeight)
}

const resultsOf = <Result extends ResultResource>(
  candidates: readonly RankedCandidate[],
): readonly Result[] => Object.freeze(candidates.map(candidate => candidate.result as Result))

export const rankResources = (input: RankResourcesInput): RankedResources => {
  assertInterestVector(input.interestVector)
  assertSelectedInterests(input.selectedInterests)

  const ranked = input.candidates
    .filter(isValidCandidate)
    .map((candidate): RankedCandidate | null => {
      const rawAffinity = affinity(input.interestVector, candidate.tags)
      if (rawAffinity <= 0) return null
      const tag = primaryTag(candidate.tags)
      return {
        candidate,
        rawAffinity,
        primaryTag: tag,
        result: toResultResource(candidate, rawAffinity, tag, input),
      }
    })
    .filter((candidate): candidate is RankedCandidate => candidate !== null)
    .sort(compareRankedCandidates)

  const course = selectDiverse(ranked.filter(item => item.candidate.type === 'course'), 5)
  const capabilityEvidence = selectDiverse(ranked.filter(item => (
    item.candidate.type === 'equipment' || item.candidate.type === 'facility'
  )), 4)
  const extracurricularProject = selectDiverse(ranked.filter(item => (
    item.candidate.type === 'extracurricular' || item.candidate.type === 'project'
  )), 3)
  const studentWork = selectDiverse(ranked.filter(item => item.candidate.type === 'student_work'), 3)
  const career = selectDiverse(ranked.filter(item => item.candidate.type === 'career'), 4)
  const support = selectDiverse(ranked.filter(item => item.candidate.type === 'support'), 4)

  return Object.freeze({
    course: resultsOf<CourseResultResource>(course),
    capabilityEvidence: resultsOf<EquipmentResultResource | FacilityResultResource>(capabilityEvidence),
    extracurricularProject: resultsOf<ExtracurricularResultResource | ProjectResultResource>(
      extracurricularProject,
    ),
    studentWork: resultsOf<StudentWorkResultResource>(studentWork),
    career: resultsOf<CareerResultResource>(career),
    support: resultsOf<SupportResultResource>(support),
    categoryFits: Object.freeze({
      course: categoryFit(course),
      equipmentFacility: categoryFit(capabilityEvidence),
      extracurricularProject: categoryFit(extracurricularProject),
      careerPortfolio: categoryFit(Object.freeze([...career, ...studentWork])),
    }),
  })
}

const environmentWeights = {
  course: 0.35,
  equipmentFacility: 0.20,
  extracurricularProject: 0.15,
  faculty: 0.15,
  careerPortfolio: 0.15,
} as const

export const computeEnvironmentScore = (scores: EnvironmentCategoryScores): number => {
  if (scores.support !== undefined
    && (!Number.isFinite(scores.support) || scores.support < 0 || scores.support > 100)) {
    throw new Error('Environment category score must be finite and between 0 and 100')
  }

  let total = 0
  for (const [category, weight] of Object.entries(environmentWeights) as Array<
    [keyof typeof environmentWeights, number]
  >) {
    const score = scores[category] ?? 0
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error('Environment category score must be finite and between 0 and 100')
    }
    total += score * weight
  }
  return roundOneDecimal(total)
}
