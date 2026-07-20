import { z } from 'zod'
import { resultResourceSchema } from '../../../shared/schemas/result'
import { equipmentCategoryOf } from '../../../shared/utils/equipment-category'
import {
  equipmentCategories,
  type CareerResultResource,
  type CourseResultResource,
  type EmptyDisplayMetadata,
  type EquipmentCategory,
  type EquipmentResultResource,
  type ExtracurricularResultResource,
  type FacilityResultResource,
  type ProjectDisplayMetadata,
  type ProjectResultResource,
  type ResultResource,
  type StudentWorkResultResource,
  type SupportResultResource,
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
  readonly category?: EquipmentCategory
  readonly [key: string]: unknown
}

interface FacilityCandidateMetadata {
  readonly locationLabel: string
  readonly operationNote: string
  readonly lastVerifiedAt: string
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
const tagKeyPattern = /^[a-z][a-z0-9_]{0,63}$/u
const verifiedAtSchema = z.iso.datetime({ offset: true }).max(32)
const equipmentCategorySet = new Set<unknown>(equipmentCategories)

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
    && typeof tag.key === 'string'
    && tagKeyPattern.test(tag.key)
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
  && metadata.credits >= 0
  && metadata.credits <= 30
  && isNonEmptyString(metadata.goalSummary)
)

const hasEquipmentMetadata = (metadata: Record<string, unknown>): boolean => (
  isNonEmptyString(metadata.locationLabel)
  && typeof metadata.confirmedQuantity === 'number'
  && Number.isSafeInteger(metadata.confirmedQuantity)
  && metadata.confirmedQuantity >= 1
  && metadata.confirmedQuantity <= 999
  && metadata.reservationUrl === 'https://gjureserve.co.kr'
  && (metadata.category === undefined || equipmentCategorySet.has(metadata.category))
  && ((metadata.accessMode === 'reservation' && metadata.accessLabel === '예약 가능')
    || (metadata.accessMode === 'inquiry' && metadata.accessLabel === '문의 전용'))
)

const hasFacilityMetadata = (metadata: Record<string, unknown>): boolean => (
  isNonEmptyString(metadata.locationLabel)
  && isNonEmptyString(metadata.operationNote)
  && verifiedAtSchema.safeParse(metadata.lastVerifiedAt).success
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
    || (value.priority as number) < 0
    || (value.priority as number) > 32767
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

const assertCandidateIntegrity = (candidates: readonly ResourceCandidate[]): void => {
  const ids = new Set<number>()
  for (const value of candidates as readonly unknown[]) {
    if (!isRecord(value) || !Number.isSafeInteger(value.id)) continue
    const id = value.id as number
    if (ids.has(id)) throw new Error('Duplicate candidate resource ID')
    ids.add(id)
  }

  for (const value of candidates as readonly unknown[]) {
    if (!isRecord(value) || !Array.isArray(value.tags)) continue
    const keys = new Set<string>()
    for (const tag of value.tags) {
      if (!isRecord(tag) || typeof tag.key !== 'string') continue
      if (keys.has(tag.key)) throw new Error('Duplicate resource tag key')
      keys.add(tag.key)
    }
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

const projectDisplayMetadata = (
  metadata: Readonly<Record<string, unknown>>,
): ProjectDisplayMetadata => Object.freeze({
  ...(metadata.displayTier === 'current' || metadata.displayTier === 'experience'
    ? { displayTier: metadata.displayTier }
    : {}),
  ...(typeof metadata.projectYear === 'number' && Number.isInteger(metadata.projectYear)
    ? { projectYear: metadata.projectYear }
    : {}),
  ...(isNonEmptyString(metadata.periodLabel) ? { periodLabel: metadata.periodLabel } : {}),
  ...(isNonEmptyString(metadata.statusLabel) ? { statusLabel: metadata.statusLabel } : {}),
  ...(isNonEmptyString(metadata.programGroup) ? { programGroup: metadata.programGroup } : {}),
})

const canonicalResult = (result: ResultResource): ResultResource | null => (
  resultResourceSchema.safeParse(result).success ? result : null
)

const toResultResource = (
  candidate: ResourceCandidate,
  rawAffinity: number,
  tag: ResourceMatchTag,
  input: Pick<RankResourcesInput, 'interestVector' | 'selectedInterests'>,
): ResultResource | null => {
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
    case 'course': return canonicalResult(Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: Object.freeze({
        gradeYear: candidate.metadata.gradeYear,
        term: candidate.metadata.term,
        credits: candidate.metadata.credits,
      }),
    }))
    case 'equipment': return canonicalResult(Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: Object.freeze({
        locationLabel: candidate.metadata.locationLabel,
        confirmedQuantity: candidate.metadata.confirmedQuantity,
        reservationUrl: candidate.metadata.reservationUrl,
        accessMode: candidate.metadata.accessMode,
        accessLabel: candidate.metadata.accessLabel,
        ...(candidate.metadata.category === undefined
          ? {}
          : { category: candidate.metadata.category }),
      }),
    }) as EquipmentResultResource)
    case 'facility': return canonicalResult(Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: Object.freeze({
        locationLabel: candidate.metadata.locationLabel,
        operationNote: candidate.metadata.operationNote,
      }),
    }))
    case 'student_work': return canonicalResult(Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: Object.freeze({
        imagePath: candidate.metadata.imagePath,
        imageAlt: candidate.metadata.imageAlt,
      }),
    }))
    case 'project': return canonicalResult(Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: projectDisplayMetadata(candidate.metadata),
    }))
    case 'extracurricular':
    case 'career':
    case 'support': return canonicalResult(Object.freeze({
      ...base,
      type: candidate.type,
      displayMetadata: emptyDisplayMetadata(),
    }))
  }
}

interface RankedCandidate {
  readonly candidate: ResourceCandidate
  readonly rawAffinity: number
  readonly primaryTag: ResourceMatchTag
  readonly result: ResultResource
}

type CameraBrand = 'sony' | 'canon' | 'other'

const compareRankedCandidates = (left: RankedCandidate, right: RankedCandidate): number => (
  right.rawAffinity - left.rawAffinity
  || right.candidate.priority - left.candidate.priority
  || compareText(right.candidate.sourceDate, left.candidate.sourceDate)
  || left.candidate.id - right.candidate.id
)

const cameraBrand = (title: string): CameraBrand => {
  const normalized = title.trim().toLocaleLowerCase('ko-KR')
  if (/^(소니|sony)(?:\s|$)/u.test(normalized)) return 'sony'
  if (/^(캐논|canon)(?:\s|$)/u.test(normalized)) return 'canon'
  return 'other'
}

const maxInterest = (
  interestVector: Readonly<Record<string, number>>,
  keys: readonly string[],
): number => Math.max(0, ...keys.map(key => interestVector[key] ?? 0))

const cameraPreference = (
  candidate: RankedCandidate,
  interestVector: Readonly<Record<string, number>>,
  preferredLensBrand: CameraBrand | null,
): number => {
  const brand = cameraBrand(candidate.candidate.title)
  const video = maxInterest(interestVector, [
    'video',
    'cinematography',
    'editing',
    'color_grading',
    'post_production',
    'ai',
    'drone',
    'video_360',
    'vr',
  ])
  const film = maxInterest(interestVector, [
    'film',
    'darkroom',
    'black_and_white',
    'analog',
  ])
  const base = film > video
    ? brand === 'canon' && /\bEOS\b/iu.test(candidate.candidate.title)
      ? 4
      : brand === 'canon' ? 3 : 0
    : video > 0
      ? brand === 'sony' && /\b(FX3|A7SII|PXW[\s-]*FS7)\b/iu.test(candidate.candidate.title)
        ? 4
        : brand === 'sony' ? 3 : brand === 'canon' ? 2 : 0
      : brand === 'sony' || brand === 'canon' ? 2 : 0

  return base + (preferredLensBrand !== null && brand === preferredLensBrand ? 1 : 0)
}

const compareCameraCandidates = (
  left: RankedCandidate,
  right: RankedCandidate,
  interestVector: Readonly<Record<string, number>>,
  preferredLensBrand: CameraBrand | null,
): number => (
  right.rawAffinity - left.rawAffinity
  || cameraPreference(right, interestVector, preferredLensBrand)
    - cameraPreference(left, interestVector, preferredLensBrand)
  || compareRankedCandidates(left, right)
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

const selectCapabilityEvidence = (
  ranked: readonly RankedCandidate[],
  interestVector: Readonly<Record<string, number>>,
): readonly RankedCandidate[] => {
  const facilities = ranked.filter(item => item.candidate.type === 'facility').slice(0, 2)
  const equipment = ranked.filter(
    (item): item is RankedCandidate & { result: EquipmentResultResource } => (
      item.candidate.type === 'equipment' && item.result.type === 'equipment'
    ),
  )
  const body = equipment
    .filter(item => equipmentCategoryOf(item.result) === 'body')
    .sort((left, right) => compareCameraCandidates(left, right, interestVector, null))[0]
  const bodyBrand = body === undefined ? null : cameraBrand(body.candidate.title)
  const lens = equipment
    .filter(item => equipmentCategoryOf(item.result) === 'lens')
    .sort((left, right) => compareCameraCandidates(left, right, interestVector, bodyBrand))[0]
  const selected = [...facilities, body, lens]
    .filter((item): item is RankedCandidate => item !== undefined)
  const selectedIds = new Set(selected.map(item => item.candidate.id))
  const filler = equipment.filter(item => !selectedIds.has(item.candidate.id))
  return Object.freeze([...selected, ...filler].slice(0, 4))
}

const isCurrentProject = (candidate: RankedCandidate): boolean => (
  candidate.candidate.type === 'project'
  && candidate.candidate.metadata.displayTier === 'current'
  && candidate.candidate.metadata.projectYear === 2026
)

export const rankResources = (input: RankResourcesInput): RankedResources => {
  assertInterestVector(input.interestVector)
  assertSelectedInterests(input.selectedInterests)
  assertCandidateIntegrity(input.candidates)

  const ranked = input.candidates
    .filter(isValidCandidate)
    .map((candidate): RankedCandidate | null => {
      const rawAffinity = affinity(input.interestVector, candidate.tags)
      if (rawAffinity <= 0) return null
      const tag = primaryTag(candidate.tags)
      const result = toResultResource(candidate, rawAffinity, tag, input)
      if (result === null) return null
      return {
        candidate,
        rawAffinity,
        primaryTag: tag,
        result,
      }
    })
    .filter((candidate): candidate is RankedCandidate => candidate !== null)
    .sort(compareRankedCandidates)

  const course = selectDiverse(ranked.filter(item => item.candidate.type === 'course'), 5)
  const capabilityEvidence = selectCapabilityEvidence(ranked, input.interestVector)
  const currentProjects = selectDiverse(ranked.filter(isCurrentProject), 3)
  const experienceProjects = selectDiverse(ranked.filter(item => (
    item.candidate.type === 'project' && !isCurrentProject(item)
  )), 3)
  const extracurricular = selectDiverse(
    ranked.filter(item => item.candidate.type === 'extracurricular'),
    3,
  )
  const extracurricularProject = Object.freeze([
    ...currentProjects,
    ...experienceProjects,
    ...extracurricular,
  ])
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
