import type {
  FacultyRole,
  QuestionGroup,
  ResourceType,
  TrackKey,
} from './domain'
import type { CareerNarrative } from './career-narrative'

export type SelectedInterest = {
  readonly [Group in QuestionGroup]: {
    readonly group: Group
    readonly key: `${Group}.${string}`
    readonly label: string
  }
}[QuestionGroup]

export interface CourseDisplayMetadata {
  readonly gradeYear: 1 | 2 | 3 | 4
  readonly term: string
  readonly credits: number
  readonly requirementType?: 'major_required' | 'major_elective'
}

export const equipmentCategories = ['body', 'lens', 'lighting', 'audio', 'drone', 'other'] as const
export type EquipmentCategory = typeof equipmentCategories[number]
export const equipmentCategoryLabels: Readonly<Record<EquipmentCategory, string>> = Object.freeze({
  body: '카메라 바디',
  lens: '렌즈',
  lighting: '조명',
  audio: '오디오',
  drone: '드론',
  other: '기타',
})

interface EquipmentDisplayMetadataBase {
  readonly locationLabel: string
  readonly confirmedQuantity: number
  readonly reservationUrl: 'https://gjureserve.co.kr'
  readonly category?: EquipmentCategory
}

export type EquipmentDisplayMetadata = Readonly<EquipmentDisplayMetadataBase & (
  | { readonly accessMode: 'reservation', readonly accessLabel: '예약 가능' }
  | { readonly accessMode: 'inquiry', readonly accessLabel: '문의 전용' }
)>

export interface FacilityDisplayMetadata {
  readonly locationLabel: string
  readonly operationNote: string
}

export interface StudentWorkDisplayMetadata {
  readonly imagePath: string
  readonly imageAlt: string
}

export interface ProjectDisplayMetadata {
  readonly displayTier?: 'current' | 'experience'
  readonly projectYear?: number
  readonly periodLabel?: string
  readonly statusLabel?: string
  readonly programGroup?: string
  readonly category?: string
  readonly activities?: string
  readonly outcomes?: string
  readonly locations?: string
}

export type EmptyDisplayMetadata = Readonly<Record<string, never>>

interface ResultResourceBase<Type extends ResourceType, Metadata> {
  readonly id: number
  readonly type: Type
  readonly title: string
  readonly summary: string
  readonly sourceDate: string
  readonly affinity: number
  readonly primaryTag: string
  readonly connectionReason: string
  readonly displayMetadata: Readonly<Metadata>
}

export type CourseResultResource = ResultResourceBase<'course', CourseDisplayMetadata>
export type EquipmentResultResource = ResultResourceBase<'equipment', EquipmentDisplayMetadata>
export type FacilityResultResource = ResultResourceBase<'facility', FacilityDisplayMetadata>
export type ExtracurricularResultResource = ResultResourceBase<'extracurricular', EmptyDisplayMetadata>
export type ProjectResultResource = ResultResourceBase<'project', ProjectDisplayMetadata>
export type StudentWorkResultResource = ResultResourceBase<'student_work', StudentWorkDisplayMetadata>
export type CareerResultResource = ResultResourceBase<'career', EmptyDisplayMetadata>
export type SupportResultResource = ResultResourceBase<'support', EmptyDisplayMetadata>

export type ResultResource =
  | CourseResultResource
  | EquipmentResultResource
  | FacilityResultResource
  | ExtracurricularResultResource
  | ProjectResultResource
  | StudentWorkResultResource
  | CareerResultResource
  | SupportResultResource

export interface LearningPathYear {
  readonly year: 1 | 2 | 3 | 4
  readonly resources: readonly CourseResultResource[]
}

export interface ResultResources {
  readonly course: readonly CourseResultResource[]
  readonly equipment: readonly EquipmentResultResource[]
  readonly facility: readonly FacilityResultResource[]
  readonly extracurricular: readonly ExtracurricularResultResource[]
  readonly project: readonly ProjectResultResource[]
  readonly student_work: readonly StudentWorkResultResource[]
  readonly career: readonly CareerResultResource[]
  readonly support: readonly SupportResultResource[]
}

export interface FacultyPublicContacts {
  readonly office?: string
  readonly phone?: string
  readonly email?: string
  readonly website?: string
}

export interface FacultyResult<Role extends FacultyRole = FacultyRole> {
  readonly role: Role
  readonly id: number
  readonly name: string
  readonly title: string
  readonly expertise: string
  readonly reason: string
  readonly publicContacts: FacultyPublicContacts
}

export interface ResultFaculty {
  readonly primary: FacultyResult<'primary'>
  readonly backup: FacultyResult<'backup'>
  readonly specialists: readonly FacultyResult<'specialist'>[]
}

export interface ResultSnapshot {
  readonly completedAt: string
  readonly selectedInterests: readonly SelectedInterest[]
  readonly trackScores: Readonly<Record<TrackKey, number>>
  readonly rankedTracks: readonly [TrackKey, TrackKey, TrackKey, TrackKey]
  readonly environmentScore: number
  readonly learningPath: readonly [
    LearningPathYear,
    LearningPathYear,
    LearningPathYear,
    LearningPathYear,
  ]
  readonly resources: ResultResources
  readonly faculty: ResultFaculty
  readonly careerNarrative: CareerNarrative
}

export type ResultSnapshotCore = Omit<ResultSnapshot, 'careerNarrative'>
