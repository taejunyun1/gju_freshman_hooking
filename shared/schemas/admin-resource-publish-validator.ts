import { z } from 'zod'

import type {
  AdminEquipmentInventoryItem,
  AdminResourceWrite,
} from './admin-resources'

const offsetTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
const stableKey = /^[a-z][a-z0-9_]{0,63}$/u
const validOffsetTimestamp = z.iso.datetime({ offset: true }).max(40)

const hasControlCharacter = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
})

const isCleanText = (value: unknown, minimum: number, maximum: number): value is string => (
  typeof value === 'string'
  && value === value.trim()
  && [...value].length >= minimum
  && [...value].length <= maximum
  && !hasControlCharacter(value)
)

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= minimum
  && value <= maximum
)

const timestampState = (value: unknown, now: Date): 'valid' | 'future' | 'invalid' => {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || !offsetTimestamp.test(value)
    || !validOffsetTimestamp.safeParse(value).success
  ) {
    return 'invalid'
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'invalid'
  return timestamp > now.getTime() ? 'future' : 'valid'
}

/**
 * Mirrors the database's publish transition preconditions for the editable
 * resource types. Draft writes stay permissive; this validator is publish-only.
 */
export const getAdminResourcePublishIssues = (
  resource: AdminResourceWrite,
  inventory: readonly AdminEquipmentInventoryItem[],
  now = new Date(),
): string[] => {
  const issues: string[] = []
  if (!resource.sourceDate) issues.push('출처 기준일을 입력해 주세요.')
  if (resource.tags.filter(tag => tag.isPrimary).length !== 1) {
    issues.push('기본 태그는 하나여야 합니다.')
  }

  if (resource.type === 'course') {
    const metadata = resource.metadata as Record<string, unknown>
    if (
      !isIntegerInRange(metadata.academic_year, 2000, 2100)
      || !isIntegerInRange(metadata.grade_year, 1, 4)
      || !isCleanText(metadata.term, 1, 40)
      || !isIntegerInRange(metadata.credits, 0, 30)
      || !isCleanText(metadata.goal, 1, 1000)
      || (metadata.requirement_type !== 'major_required' && metadata.requirement_type !== 'major_elective')
    ) {
      issues.push('교과의 학년도·학년·학기·학점·목표를 모두 올바르게 입력해 주세요.')
    }
  }

  if (resource.type === 'student_work') {
    const metadata = resource.metadata as Record<string, unknown>
    const consentState = timestampState(metadata.consent_at, now)
    if (consentState === 'invalid') issues.push('학생 작품 게시 동의 일시가 필요합니다.')
    if (consentState === 'future') issues.push('학생 작품 동의 일시는 미래일 수 없습니다.')
    if (!resource.imagePath || !isCleanText(metadata.image_alt, 1, 200)) {
      issues.push('학생 작품 이미지와 대체 텍스트가 필요합니다.')
    }
    if (
      !isCleanText(metadata.related_course, 1, 200)
      || !isIntegerInRange(metadata.related_year, 1, 4)
      || typeof metadata.related_track !== 'string'
      || !stableKey.test(metadata.related_track)
    ) {
      issues.push('학생 작품의 연계 교과·학년·전공을 모두 올바르게 입력해 주세요.')
    }
  }

  if (resource.type === 'equipment' && !inventory.some(item => item.dataQualityStatus === 'verified')) {
    issues.push('검증된 기자재 원본 행이 하나 이상 필요합니다.')
  }

  if (resource.type === 'facility') {
    const metadata = resource.metadata as Record<string, unknown>
    const operationNote = metadata.operation_note ?? metadata.operationNote
    const verifiedAt = metadata.last_verified_at ?? metadata.lastVerifiedAt
    const activities = metadata.activities
    const verifiedState = timestampState(verifiedAt, now)
    if (
      !isCleanText(metadata.location_label, 1, 120)
      || !isCleanText(operationNote, 1, 1000)
      || !Array.isArray(activities)
      || activities.length < 1
      || activities.length > 30
      || activities.some(activity => !isCleanText(activity, 1, 200))
      || verifiedState === 'invalid'
    ) {
      issues.push('시설의 위치·운영 안내·활동·검증 일시를 모두 올바르게 입력해 주세요.')
    }
    if (verifiedState === 'future') issues.push('시설 검증 일시는 미래일 수 없습니다.')
  }

  return issues
}
