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
import type { TrackKey } from '../../../shared/types/domain'
import {
  renderConnectionReason,
  type ResourceMatchTag,
  type SelectedInterestEvidence,
} from './reasons'

type CandidateStatus = 'draft' | 'active' | 'next_year_confirmed' | 'archived'
type CandidateVisibility = 'public' | 'admin_only' | 'hidden'

interface CourseCandidateMetadata {
  readonly academicYear?: number
  readonly gradeYear: 1 | 2 | 3 | 4
  readonly term: string
  readonly credits: number
  readonly goalSummary: string
  readonly requirementType?: 'major_required' | 'major_elective'
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
  readonly primaryTrack?: TrackKey
  readonly secondaryTrack?: TrackKey
  readonly syntheticPathwayCourseIds?: readonly number[]
  readonly syntheticPathwayEvidenceKeys?: readonly string[]
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

interface PrimaryTrackPathwayCourse {
  readonly title: string
  readonly gradeYear: 3 | 4
}

const pathwayCourse = (title: string, gradeYear: 3 | 4): PrimaryTrackPathwayCourse => ({
  title,
  gradeYear,
})

export const primaryTrackPathwayCourses: Readonly<Record<TrackKey, readonly PrimaryTrackPathwayCourse[]>> = Object.freeze({
  art_photo: Object.freeze([
    pathwayCourse('사물,데이터,이미지 워크숍', 3),
    pathwayCourse('사진과 장소 그리고 콘텍스트 워크숍', 3),
    pathwayCourse('예술창작 프로젝트 세미나', 4),
    pathwayCourse('예술창작 프로젝트 랩', 4),
  ]),
  documentary: Object.freeze([
    pathwayCourse('포토 스토리 워크숍', 3),
    pathwayCourse('포토에세이 워크숍', 3),
    pathwayCourse('다큐멘터리 세미나', 4),
    pathwayCourse('포스트 다큐멘터리 랩', 4),
  ]),
  video: Object.freeze([
    pathwayCourse('영상 인터뷰 내러티브 워크숍', 3),
    pathwayCourse('영상 드론 콘텐츠 워크숍', 3),
    pathwayCourse('영상 콘텐츠 크리에이터 워크숍', 3),
  ]),
  commercial: Object.freeze([
    pathwayCourse('커머셜 포토그라피 기초 워크숍', 3),
    pathwayCourse('커머셜 포토그라피 심화 워크숍', 3),
    pathwayCourse('커머셜 포토그라피 세미나', 4),
    pathwayCourse('커머셜 포토그라피 랩', 4),
  ]),
})

const pathwayEvidenceKey = (track: TrackKey): string => `pathway_${track}`

const matchesPathwayCourse = (
  candidate: Extract<ResourceCandidate, { type: 'course' }>,
  pathwayCourse: PrimaryTrackPathwayCourse,
): boolean => (
  candidate.title === pathwayCourse.title
  && candidate.metadata.gradeYear === pathwayCourse.gradeYear
)

interface SelectedPathwayCourse {
  readonly track: TrackKey
  readonly course: PrimaryTrackPathwayCourse
}

const selectedPathwayCourses = (
  primaryTrack: TrackKey,
  secondaryTrack: TrackKey | undefined,
): readonly SelectedPathwayCourse[] => Object.freeze([
  ...primaryTrackPathwayCourses[primaryTrack].map(course => ({ track: primaryTrack, course })),
  ...(primaryTrack === 'video'
    && secondaryTrack !== undefined
    && secondaryTrack !== primaryTrack
    ? primaryTrackPathwayCourses[secondaryTrack]
        .filter(course => course.gradeYear === 4)
        .map(course => ({ track: secondaryTrack, course }))
    : []),
])

const selectedLabelForTrack = (
  selectedInterests: readonly SelectedInterestEvidence[],
  track: TrackKey,
): string => {
  const label = selectedInterests.find(interest => interest.key === track)?.label
    ?? selectedInterests[0]?.label
  if (label === undefined) throw new Error('Selected interest label evidence is required')
  return label
}

export const withPrimaryTrackPathway = (input: RankResourcesInput): RankResourcesInput => {
  if (input.primaryTrack === undefined) return input

  const selections = selectedPathwayCourses(input.primaryTrack, input.secondaryTrack)
  const selectedTracks = [...new Set(selections.map(selection => selection.track))]
  const evidenceByTrack = new Map(selectedTracks.map(track => [
    track,
    {
      key: pathwayEvidenceKey(track),
      label: selectedLabelForTrack(input.selectedInterests, track),
    },
  ]))
  const interestVector = { ...input.interestVector }
  const selectedInterests = [...input.selectedInterests]
  for (const evidence of evidenceByTrack.values()) {
    interestVector[evidence.key] ??= 1
    if (!selectedInterests.some(item => item.key === evidence.key)) {
      selectedInterests.push(evidence)
    }
  }
  const syntheticPathwayCourseIds = new Set(input.syntheticPathwayCourseIds)
  const syntheticPathwayEvidenceKeys = new Set(input.syntheticPathwayEvidenceKeys)

  return {
    ...input,
    interestVector,
    selectedInterests,
    candidates: input.candidates.map((candidate): ResourceCandidate => {
      if (candidate.type !== 'course') return candidate
      const selection = selections.find(item => matchesPathwayCourse(candidate, item.course))
      if (selection === undefined) return candidate
      const evidenceKey = evidenceByTrack.get(selection.track)!.key
      if (candidate.tags.some(tag => tag.key === evidenceKey)) return candidate
      syntheticPathwayCourseIds.add(candidate.id)
      syntheticPathwayEvidenceKeys.add(evidenceKey)
      return { ...candidate, tags: [...candidate.tags, { key: evidenceKey, weight: 3, isPrimary: true }] }
    }),
    ...(syntheticPathwayCourseIds.size === 0
      ? {}
      : {
          syntheticPathwayCourseIds: Object.freeze(
            [...syntheticPathwayCourseIds].sort((left, right) => left - right),
          ),
          syntheticPathwayEvidenceKeys: Object.freeze(
            [...syntheticPathwayEvidenceKeys].sort(compareText),
          ),
        }),
  }
}

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
  && (metadata.requirementType === undefined
    || metadata.requirementType === 'major_required'
    || metadata.requirementType === 'major_elective')
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

export const isForceIncludedRequiredCourse = (
  candidate: ResourceCandidate,
): boolean => (
  candidate.type === 'course'
  && candidate.status === 'active'
  && candidate.visibility === 'public'
  && candidate.metadata.academicYear === 2026
  && candidate.metadata.requirementType === 'major_required'
)

const toResultResource = (
  candidate: ResourceCandidate,
  rawAffinity: number,
  tag: ResourceMatchTag,
  input: Pick<RankResourcesInput, 'interestVector' | 'selectedInterests'>,
): ResultResource | null => {
  const goalSummary = candidate.type === 'course' ? candidate.metadata.goalSummary : candidate.summary
  const connectionReason = isForceIncludedRequiredCourse(candidate)
    ? `${candidate.title}은(는) 사진영상미디어학과의 공통 제작 기반을 익히는 전공필수 교과입니다.`
    : renderConnectionReason({
    interestVector: input.interestVector,
    selectedInterests: input.selectedInterests,
    resourceTags: candidate.tags,
    resourceTitle: candidate.title,
    goalSummary,
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
        ...(candidate.metadata.requirementType === undefined
          ? {}
          : { requirementType: candidate.metadata.requirementType }),
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

type CameraManufacturer = string

const compareRankedCandidates = (left: RankedCandidate, right: RankedCandidate): number => (
  right.rawAffinity - left.rawAffinity
  || right.candidate.priority - left.candidate.priority
  || compareText(right.candidate.sourceDate, left.candidate.sourceDate)
  || left.candidate.id - right.candidate.id
)

const cameraManufacturer = (title: string): CameraManufacturer | null => {
  const normalized = title.normalize('NFKC').trim().toLocaleLowerCase('ko-KR')
  const token = /^([\p{L}\p{N}][\p{L}\p{N}._+-]{0,31})(?:\s|$)/u.exec(normalized)?.[1]
  if (token === undefined) return null

  if (token === '소니' || token === 'sony') return 'sony'
  if (token === '캐논' || token === 'canon') return 'canon'
  if (token === '니콘' || token === 'nikon') return 'nikon'
  if (token === '후지' || token === '후지필름' || token === 'fuji' || token === 'fujifilm') {
    return 'fujifilm'
  }
  return `manufacturer:${token}`
}

const maxInterest = (
  interestVector: Readonly<Record<string, number>>,
  keys: readonly string[],
): number => Math.max(0, ...keys.map(key => interestVector[key] ?? 0))

const cameraPreference = (
  candidate: RankedCandidate,
  interestVector: Readonly<Record<string, number>>,
): number => {
  const manufacturer = cameraManufacturer(candidate.candidate.title)
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
    ? manufacturer === 'canon' && /\bEOS\b/iu.test(candidate.candidate.title)
      ? 4
      : manufacturer === 'canon' ? 3 : 0
    : video > 0
      ? manufacturer === 'sony' && /\b(FX3|A7SII|PXW[\s-]*FS7)\b/iu.test(candidate.candidate.title)
        ? 4
        : manufacturer === 'sony' ? 3 : manufacturer === 'canon' ? 2 : 0
      : manufacturer === 'sony' || manufacturer === 'canon' ? 2 : 0

  return base
}

const cameraManufacturerMatch = (
  candidate: RankedCandidate,
  preferredLensManufacturer: CameraManufacturer | null,
): number => {
  if (preferredLensManufacturer === null) return 0
  return cameraManufacturer(candidate.candidate.title) === preferredLensManufacturer ? 1 : 0
}

const compareCameraCandidates = (
  left: RankedCandidate,
  right: RankedCandidate,
  interestVector: Readonly<Record<string, number>>,
  preferredLensManufacturer: CameraManufacturer | null,
): number => (
  right.rawAffinity - left.rawAffinity
  || cameraManufacturerMatch(right, preferredLensManufacturer)
    - cameraManufacturerMatch(left, preferredLensManufacturer)
  || cameraPreference(right, interestVector) - cameraPreference(left, interestVector)
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
  const bodyManufacturer = body === undefined ? null : cameraManufacturer(body.candidate.title)
  const lens = equipment
    .filter(item => equipmentCategoryOf(item.result) === 'lens')
    .sort((left, right) => compareCameraCandidates(
      left,
      right,
      interestVector,
      bodyManufacturer,
    ))[0]
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

const isRequiredCourse = (candidate: RankedCandidate): boolean => (
  isForceIncludedRequiredCourse(candidate.candidate)
)

const uniqueCourseCandidates = (
  candidates: readonly RankedCandidate[],
): readonly RankedCandidate[] => {
  const seen = new Set<number>()
  return Object.freeze(candidates.filter((candidate) => {
    if (seen.has(candidate.candidate.id)) return false
    seen.add(candidate.candidate.id)
    return true
  }))
}

const composeCourseCandidates = (
  general: readonly RankedCandidate[],
  required: readonly RankedCandidate[],
  pathway: readonly RankedCandidate[],
): readonly RankedCandidate[] => {
  const protectedCourses = uniqueCourseCandidates([...required, ...pathway])
  const protectedIds = new Set(protectedCourses.map(candidate => candidate.candidate.id))
  const remainingByYear = new Map<number, number>([[1, 5], [2, 5], [3, 5], [4, 5]])
  for (const candidate of protectedCourses) {
    if (candidate.candidate.type !== 'course') continue
    const year = candidate.candidate.metadata.gradeYear
    const remaining = (remainingByYear.get(year) ?? 0) - 1
    if (remaining < 0) throw new Error('RESOURCE_COURSE_YEAR_CAPACITY_EXCEEDED')
    remainingByYear.set(year, remaining)
  }

  const selectedGeneral: RankedCandidate[] = []
  for (const candidate of general) {
    if (protectedIds.has(candidate.candidate.id) || candidate.candidate.type !== 'course') continue
    if (protectedCourses.length + selectedGeneral.length >= 15) break
    const year = candidate.candidate.metadata.gradeYear
    const remaining = remainingByYear.get(year) ?? 0
    if (remaining <= 0) continue
    selectedGeneral.push(candidate)
    remainingByYear.set(year, remaining - 1)
  }
  return Object.freeze([...selectedGeneral, ...protectedCourses])
}

export const rankResources = (input: RankResourcesInput): RankedResources => {
  const matchingInput = withPrimaryTrackPathway(input)
  assertInterestVector(matchingInput.interestVector)
  assertSelectedInterests(matchingInput.selectedInterests)
  assertCandidateIntegrity(matchingInput.candidates)
  const syntheticPathwayCourseIds = new Set(matchingInput.syntheticPathwayCourseIds)
  const syntheticPathwayEvidenceKeys = new Set(matchingInput.syntheticPathwayEvidenceKeys)

  const ranked = matchingInput.candidates
    .filter(isValidCandidate)
    .map((candidate): RankedCandidate | null => {
      const rawAffinity = affinity(matchingInput.interestVector, candidate.tags)
      if (rawAffinity <= 0 && !isForceIncludedRequiredCourse(candidate)) return null
      const tag = primaryTag(candidate.tags.filter(tag => !(
        syntheticPathwayCourseIds.has(candidate.id) && syntheticPathwayEvidenceKeys.has(tag.key)
      )))
      const result = toResultResource(candidate, rawAffinity, tag, matchingInput)
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

  const courseCandidates = ranked.filter((item): item is RankedCandidate & {
    candidate: Extract<ResourceCandidate, { type: 'course' }>
  } => item.candidate.type === 'course')
  const pathwayCandidates = matchingInput.primaryTrack === undefined
    ? []
    : selectedPathwayCourses(
        matchingInput.primaryTrack,
        matchingInput.secondaryTrack,
      ).flatMap(selection => (
        courseCandidates.find(item => matchesPathwayCourse(item.candidate, selection.course)) ?? []
      ))
  const foundationCap = Math.min(5, Math.max(0, 10 - pathwayCandidates.length))
  const protectedIds = new Set([
    ...courseCandidates.filter(isRequiredCourse),
    ...pathwayCandidates,
  ].map(candidate => candidate.candidate.id))
  const generalCourseCandidates = courseCandidates.filter(candidate => (
    !protectedIds.has(candidate.candidate.id)
    && (matchingInput.primaryTrack === undefined || candidate.candidate.metadata.gradeYear <= 2)
  ))
  const general = selectDiverse(
    generalCourseCandidates,
    matchingInput.primaryTrack === undefined ? 5 : foundationCap,
  )
  const course = composeCourseCandidates(
    general,
    courseCandidates.filter(isRequiredCourse),
    pathwayCandidates,
  )
  const capabilityEvidence = selectCapabilityEvidence(ranked, matchingInput.interestVector)
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
