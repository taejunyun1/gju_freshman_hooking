import type { ApplicantRosterRow } from '../schemas/admission-roster'
import type { CounselingStatus, QuestionGroup, TrackKey, VisualKey } from './domain'
import type { AdminEquipmentInventoryItem, AdminResource } from '../schemas/admin-resources'
import type { AdminFaculty } from '../schemas/admin-faculty'

export type {
  AdmissionCycle,
  ApplicantRosterRow,
  RosterApplyRequest,
  RosterApplyResult,
  RosterCredential,
  RosterPreviewRequest,
  RosterPreviewResult,
} from '../schemas/admission-roster'

export type RegistrationInput = ApplicantRosterRow

export type LoginInput = {
  phone: string
  password: string
}

export type RegistrationResult =
  | { kind: 'created', sessionToken: string, expiresAt: string }
  | { kind: 'existing' }
  | { kind: 'rate_limited' }

export type LoginResult =
  | { kind: 'authenticated', sessionToken: string, expiresAt: string }
  | { kind: 'failed' }

export type StudentSession = {
  csrfToken: string
  prospectId: number
  nickname: string
  expiresAt: string
}

export type PublicAssessmentOption = {
  key: string
  label: string
  description?: string
  visualKey: VisualKey
}

export type PublicAssessmentCatalog = {
  catalogRevision: string
  groups: Array<{
    key: QuestionGroup
    options: PublicAssessmentOption[]
  }>
  limits: Record<QuestionGroup, { min: number, max: number }>
}

export type ScoredAssessment = {
  trackScores: Record<TrackKey, number>
  rankedTracks: TrackKey[]
  interestVector: Record<string, number>
}

export type ApiSuccess<T> = {
  data: T
  requestId: string
}

export type ApiFailure = {
  error: {
    code: 'AUTH_FAILED' | 'VALIDATION_FAILED' | 'RATE_LIMITED' | 'INTERNAL_ERROR' | 'ADMIN_REQUIRED' | 'MFA_REQUIRED' | 'REAUTH_REQUIRED' | 'RECOVERY_INVALID' | 'ASSESSMENT_INVALID' | 'ASSESSMENT_CATALOG_STALE' | 'ASSESSMENT_IDEMPOTENCY_CONFLICT' | 'RESULT_NOT_FOUND' | 'COUNSELING_INVALID' | 'COUNSELING_NOT_FOUND' | 'COUNSELING_CONFLICT' | 'STUDENT_INVALID' | 'STUDENT_NOT_FOUND' | 'ROSTER_INVALID' | 'ROSTER_CONFLICT' | 'RESOURCE_INVALID' | 'RESOURCE_NOT_FOUND' | 'RESOURCE_CONFLICT' | 'RESOURCE_SOURCE_REQUIRED' | 'RESOURCE_PRIMARY_TAG_REQUIRED' | 'RESOURCE_ARCHIVE_VERIFICATION_REQUIRED' | 'RESOURCE_ARCHIVE_IDENTITY_REQUIRED' | 'COURSE_METADATA_REQUIRED' | 'WORK_CONSENT_REQUIRED' | 'WORK_MEDIA_REQUIRED' | 'WORK_RELATION_REQUIRED' | 'EQUIPMENT_INVENTORY_UNVERIFIED' | 'FACILITY_OPERATION_UNVERIFIED' | 'RESOURCE_IMAGE_INVALID' | 'RESOURCE_IMAGE_TOO_LARGE' | 'RESOURCE_IMAGE_UPLOAD_FAILED' | 'EQUIPMENT_IMPORT_INVALID' | 'FACULTY_INVALID' | 'FACULTY_NOT_FOUND' | 'FACULTY_CONFLICT' | 'FACULTY_STATUS_INVALID' | 'FACULTY_ROLE_INVALID' | 'FACULTY_CAPACITY_REQUIRED' | 'CONTACT_VERIFICATION_REQUIRED' | 'FACULTY_SPECIALIST_TAG_REQUIRED' | 'FACULTY_TAG_INVALID' | 'FACULTY_LINK_INVALID' | 'FACULTY_TAXONOMY_INVALID' | 'FACULTY_YOON_SCOPE_REQUIRED' | 'FACULTY_CONTENT_NOT_READY' | 'EXPORT_INVALID' | 'EXPORT_NOT_FOUND' | 'EXPORT_CONFLICT' | 'EXPORT_FILTER_REQUIRED'
    message: string
    current?: AdminResource | AdminEquipmentInventoryItem | AdminFaculty | {
      id: string
      status: CounselingStatus
      version: number
      assignedAt: string | null
      contactedAt: string | null
      completedAt: string | null
      closedAt: string | null
      updatedAt: string
      assignedFaculty: { id: number, name: string, title: string } | null
    }
  }
  requestId: string
}
