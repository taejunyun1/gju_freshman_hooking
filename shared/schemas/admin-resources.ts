import { z } from 'zod'
import { equipmentCategories } from '../types/result'

export const adminResourceTypes = [
  'course',
  'equipment',
  'facility',
  'extracurricular',
  'project',
  'student_work',
  'career',
  'support',
] as const
export const adminResourceStatuses = ['draft', 'active', 'next_year_confirmed', 'archived'] as const
export const adminResourceVisibilities = ['hidden', 'admin_only', 'public'] as const

export const adminResourceTypeSchema = z.enum(adminResourceTypes)
export const adminResourceStatusSchema = z.enum(adminResourceStatuses)
export const adminResourceVisibilitySchema = z.enum(adminResourceVisibilities)

const cleanText = (minimum: number, maximum: number) => z.string().min(minimum).max(maximum)
  .refine(value => value === value.trim(), '앞뒤 공백을 제거해 주세요.')
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }), '제어문자는 사용할 수 없습니다.')

const nullableCleanText = (maximum: number) => cleanText(1, maximum).nullable()
export const adminResourceTagSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  weight: z.number().int().min(0).max(3),
  isPrimary: z.boolean(),
}).strict()

const legacyCourseMetadataShape = {
  seedKey: cleanText(1, 300).optional(),
  former_name: nullableCleanText(200).optional(),
  source_former_label: nullableCleanText(100).optional(),
  fusion_major: nullableCleanText(200).optional(),
  source_goal: nullableCleanText(1000).optional(),
  source_document: nullableCleanText(300).optional(),
}

export const courseAdminResourceMetadataSchema = z.object({
  academic_year: z.number().int().min(2000).max(2100).optional(),
  grade_year: z.number().int().min(1).max(4).optional(),
  term: cleanText(1, 40).optional(),
  credits: z.number().int().min(0).max(30).optional(),
  goal: cleanText(1, 1000).optional(),
  ...legacyCourseMetadataShape,
}).strict()

export const studentWorkAdminResourceMetadataSchema = z.object({
  consent_at: z.iso.datetime({ offset: true }).max(40).nullable().optional(),
  image_alt: z.string().trim().max(200).optional(),
  related_course: z.string().trim().max(200).optional(),
  related_year: z.number().int().min(1).max(4).nullable().optional(),
  related_track: z.string().trim().max(64).optional(),
}).strict()

const archiveTrackSchema = z.enum(['documentary', 'art_photo', 'commercial', 'video'])
const archiveHttpsUrlSchema = z.url().max(500).refine((value) => {
  try {
    return new URL(value).protocol === 'https:'
  }
  catch {
    return false
  }
}, '출처 URL은 HTTPS만 사용할 수 있습니다.')

export const archiveSourceMetadataSchema = z.object({
  sourceUrl: archiveHttpsUrlSchema,
  sourcePageTitle: cleanText(1, 200),
  sourceLastEditedDate: z.iso.date(),
  evidenceStatus: z.enum(['historical', 'verify_required', 'recurring', 'snapshot']),
  trackEvidence: z.array(archiveTrackSchema).min(1).max(4)
    .refine(values => new Set(values).size === values.length),
  interestEvidence: z.array(adminResourceTagSchema.shape.key).min(1).max(30)
    .refine(values => new Set(values).size === values.length),
  verificationNote: cleanText(1, 1000),
}).strict()

const archiveActivityAdminResourceMetadataSchema = z.object({
  seedKey: cleanText(1, 300),
  archive: archiveSourceMetadataSchema,
  periodLabel: nullableCleanText(100),
}).strict()

const projectCatalogMetadataSchema = z.object({
  seedKey: cleanText(1, 300),
  catalogKey: cleanText(1, 100),
  projectYear: z.number().int().min(2000).max(2100),
  displayTier: z.enum(['current', 'experience']),
  displayKind: z.enum(['메인프로젝트', '최근사례', '짧은경험']),
  periodLabel: cleanText(1, 100),
  statusLabel: cleanText(1, 100),
  programGroup: cleanText(1, 200),
  semester: nullableCleanText(100).optional(),
  category: cleanText(1, 100),
  activities: cleanText(1, 1000),
  outcomes: cleanText(1, 1000),
  locations: cleanText(1, 300),
  faculty: z.array(cleanText(1, 100)).min(1).max(10),
  sourcePageTitle: cleanText(1, 200),
  sourceUrl: archiveHttpsUrlSchema.optional(),
  sourceCheckedAt: z.iso.date(),
  verificationNote: cleanText(1, 1000),
}).strict().superRefine((metadata, context) => {
  if ((metadata.displayTier === 'current') !== (metadata.projectYear === 2026)) {
    context.addIssue({
      code: 'custom',
      path: ['displayTier'],
      message: '2026 사업만 현재 우선 프로젝트로 표시할 수 있습니다.',
    })
  }
})

const graduationYearCandidateSchema = z.object({
  year: z.number().int().min(1994).max(2100),
  sourceUrl: archiveHttpsUrlSchema,
}).strict()

export const archiveCareerAdminResourceMetadataSchema = z.object({
  seedKey: cleanText(1, 300),
  archive: archiveSourceMetadataSchema,
  publicName: cleanText(1, 100),
  graduationYear: z.number().int().min(1994).max(2100).nullable(),
  graduationYearStatus: z.enum(['confirmed', 'conflicted']),
  graduationYearCandidates: z.array(graduationYearCandidateSchema).max(2),
  roleAtSource: nullableCleanText(200),
  roleCandidates: z.array(cleanText(1, 200)).max(2),
  roleStatus: z.enum(['title_confirmed', 'body_only', 'conflicted']),
}).strict().superRefine((person, context) => {
  const graduationValid = person.graduationYearStatus === 'confirmed'
    ? person.graduationYear !== null && person.graduationYearCandidates.length === 0
    : person.graduationYear === null
      && person.graduationYearCandidates.length === 2
      && new Set(person.graduationYearCandidates.map(candidate => candidate.year)).size === 2
  if (!graduationValid) {
    context.addIssue({ code: 'custom', path: ['graduationYearStatus'], message: '졸업연도 근거 상태가 일치하지 않습니다.' })
  }
  const roleValid = person.roleStatus === 'conflicted'
    ? person.roleAtSource === null && person.roleCandidates.length === 2
      && new Set(person.roleCandidates).size === 2
    : person.roleAtSource !== null && person.roleCandidates.length === 0
  if (!roleValid) {
    context.addIssue({ code: 'custom', path: ['roleStatus'], message: '직무 근거 상태가 일치하지 않습니다.' })
  }
})

export const facilityAdminResourceMetadataSchema = z.object({
  location_label: z.string().trim().max(120).optional(),
  operation_note: z.string().trim().max(1000).nullable().optional(),
  activities: z.array(cleanText(1, 200)).max(30).optional(),
  last_verified_at: z.iso.datetime({ offset: true }).max(40).nullable().optional(),
  seedKey: cleanText(1, 300).optional(),
  facilityKey: cleanText(1, 100).optional(),
  facilityType: cleanText(1, 100).optional(),
  exampleCourses: z.array(cleanText(1, 200)).max(30).optional(),
  operationNote: nullableCleanText(1000).optional(),
  lastVerifiedAt: z.iso.datetime({ offset: true }).max(40).nullable().optional(),
  supportingEvidence: z.boolean().optional(),
  archive: archiveSourceMetadataSchema.optional(),
}).strict()

const equipmentMetadataCommonShape = {
  seedKey: cleanText(1, 300).optional(),
  locationKey: z.enum(['department_equipment_room', 'fantasy_lab']).optional(),
  locationLabel: cleanText(1, 120).optional(),
  accessMode: z.enum(['reservation', 'inquiry']).optional(),
  accessLabel: cleanText(1, 100).optional(),
  reservationUrl: z.url().max(500).optional(),
  snapshotNotice: cleanText(1, 1000).optional(),
  supportingEvidence: z.boolean().optional(),
}

const equipmentMetadataWriteShape = {
  ...equipmentMetadataCommonShape,
  category: z.enum(equipmentCategories).optional(),
}

export const equipmentAdminResourceWriteMetadataSchema = z.object(equipmentMetadataWriteShape).strict()
export const equipmentAdminResourceMetadataSchema = z.object({
  ...equipmentMetadataCommonShape,
  category: cleanText(1, 100).optional(),
  confirmedQuantity: z.number().int().min(0).max(100_000).optional(),
}).strict()

const emptyMetadataSchema = z.object({}).strict()
const archiveActivityOrEmptyMetadataSchema = z.union([
  emptyMetadataSchema,
  archiveActivityAdminResourceMetadataSchema,
])
const projectActivityMetadataSchema = z.union([
  emptyMetadataSchema,
  archiveActivityAdminResourceMetadataSchema,
  projectCatalogMetadataSchema,
])
const archiveCareerOrEmptyMetadataSchema = z.union([
  emptyMetadataSchema,
  archiveCareerAdminResourceMetadataSchema,
])
const commonWriteShape = {
  title: cleanText(1, 200),
  summary: cleanText(1, 1000),
  connectionTemplate: cleanText(1, 1000),
  sourceDate: z.iso.date().nullable(),
  visibility: adminResourceVisibilitySchema,
  priority: z.number().int().min(0).max(32767),
  tags: z.array(adminResourceTagSchema).min(1).max(100),
  imagePath: z.string().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u)
    .refine(path => !/(^|\/)\.{1,2}(\/|$)/u.test(path)).nullable(),
}

const refineArchiveEvidence = (resource: {
  type: string
  summary: string
  sourceDate: string | null
  tags: Array<{ key: string, isPrimary: boolean }>
  metadata: unknown
}, context: z.RefinementCtx) => {
  const metadata = resource.metadata as {
    archive?: z.infer<typeof archiveSourceMetadataSchema>
    supportingEvidence?: boolean
  }
  const archive = metadata.archive
  if (!archive) return

  const primaryKey = resource.tags.find(tag => tag.isPrimary)?.key
  if (!archive.trackEvidence.some(track => track === primaryKey)) {
    context.addIssue({ code: 'custom', path: ['tags'], message: '아카이브 기본 태그는 근거 트랙이어야 합니다.' })
  }
  if (!archive.interestEvidence.some(interest => resource.tags.some(tag => tag.key === interest))) {
    context.addIssue({ code: 'custom', path: ['tags'], message: '아카이브 관심 근거 태그가 하나 이상 필요합니다.' })
  }
  if (resource.sourceDate !== archive.sourceLastEditedDate) {
    context.addIssue({ code: 'custom', path: ['sourceDate'], message: '아카이브 출처 날짜가 일치하지 않습니다.' })
  }
  if (archive.evidenceStatus === 'historical' && !resource.summary.includes('과거 운영 사례')) {
    context.addIssue({ code: 'custom', path: ['summary'], message: '과거 활동임을 요약에 표시해야 합니다.' })
  }
  if (resource.type === 'facility' && metadata.supportingEvidence !== true) {
    context.addIssue({ code: 'custom', path: ['metadata', 'supportingEvidence'], message: '시설은 보조 근거로만 사용할 수 있습니다.' })
  }
}

export const adminResourceWriteSchema = z.discriminatedUnion('type', [
  z.object({ ...commonWriteShape, type: z.literal('course'), metadata: courseAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('equipment'), metadata: equipmentAdminResourceWriteMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('facility'), metadata: facilityAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('student_work'), metadata: studentWorkAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('extracurricular'), metadata: archiveActivityOrEmptyMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('project'), metadata: projectActivityMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('career'), metadata: archiveCareerOrEmptyMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('support'), metadata: emptyMetadataSchema }).strict(),
]).superRefine((resource, context) => {
  refineArchiveEvidence(resource, context)
  const keys = resource.tags.map(tag => tag.key)
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: 'custom', path: ['tags'], message: '태그는 중복할 수 없습니다.' })
  }
  if (resource.tags.filter(tag => tag.isPrimary).length !== 1) {
    context.addIssue({ code: 'custom', path: ['tags'], message: '기본 태그는 하나여야 합니다.' })
  }
  if (resource.type === 'career' && 'archive' in resource.metadata) {
    const conflicted = resource.metadata.roleStatus === 'conflicted'
      || resource.metadata.graduationYearStatus === 'conflicted'
    if (conflicted && (resource.visibility !== 'admin_only'
      || resource.metadata.archive.evidenceStatus !== 'verify_required')) {
      context.addIssue({
        code: 'custom', path: ['visibility'], message: '충돌한 졸업생 근거는 관리자 검수 전 공개할 수 없습니다.',
      })
    }
  }
})

export const adminResourceUpdateSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }).max(40),
  resource: adminResourceWriteSchema,
}).strict()

export const adminResourceTransitionSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }).max(40),
}).strict()

export const adminEquipmentInventoryItemSchema = z.object({
  id: z.number().int().positive().safe(),
  equipmentResourceId: z.number().int().positive().safe(),
  inventoryCode: cleanText(1, 100),
  sourceRow: z.number().int().min(1).max(1_000_000),
  locationKey: z.enum(['department_equipment_room', 'fantasy_lab']),
  accessMode: z.enum(['reservation', 'inquiry']),
  availabilityState: z.enum(['available', 'unavailable', 'unknown']),
  note: nullableCleanText(1000),
  dataQualityStatus: z.enum(['verified', 'duplicate_code', 'unidentified', 'quantity_check']),
  sourceDate: z.iso.date(),
  updatedAt: z.iso.datetime({ offset: true }).max(40),
}).strict()

export const adminEquipmentInventoryUpdateSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }).max(40),
  inventoryCode: cleanText(1, 100),
  locationKey: z.enum(['department_equipment_room', 'fantasy_lab']),
  accessMode: z.enum(['reservation', 'inquiry']),
  availabilityState: z.enum(['available', 'unavailable', 'unknown']),
  note: nullableCleanText(1000),
  dataQualityStatus: z.enum(['verified', 'duplicate_code', 'unidentified', 'quantity_check']),
}).strict()

const commonResourceShape = {
  id: z.number().int().positive().safe(),
  title: cleanText(1, 200),
  summary: cleanText(1, 1000),
  connectionTemplate: cleanText(1, 1000),
  status: adminResourceStatusSchema,
  visibility: adminResourceVisibilitySchema,
  priority: z.number().int().min(0).max(32767),
  sourceDate: z.iso.date().nullable(),
  imagePath: z.string().min(1).max(512).nullable(),
  createdAt: z.iso.datetime({ offset: true }).max(40),
  updatedAt: z.iso.datetime({ offset: true }).max(40),
  tags: z.array(adminResourceTagSchema).min(1).max(100),
}

export const adminResourceSchema = z.discriminatedUnion('type', [
  z.object({ ...commonResourceShape, type: z.literal('course'), metadata: courseAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('equipment'), metadata: equipmentAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('facility'), metadata: facilityAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('student_work'), metadata: studentWorkAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('extracurricular'), metadata: archiveActivityOrEmptyMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('project'), metadata: projectActivityMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('career'), metadata: archiveCareerOrEmptyMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('support'), metadata: emptyMetadataSchema }).strict(),
]).superRefine((resource, context) => {
  refineArchiveEvidence(resource, context)
  if (resource.type === 'career' && 'archive' in resource.metadata) {
    const conflicted = resource.metadata.roleStatus === 'conflicted'
      || resource.metadata.graduationYearStatus === 'conflicted'
    if (conflicted && (resource.visibility !== 'admin_only'
      || resource.metadata.archive.evidenceStatus !== 'verify_required')) {
      context.addIssue({
        code: 'custom', path: ['visibility'], message: '충돌한 졸업생 근거는 관리자 검수 전 공개할 수 없습니다.',
      })
    }
  }
})

export type AdminResourceWrite = z.infer<typeof adminResourceWriteSchema>
export type AdminResource = z.infer<typeof adminResourceSchema>
export type AdminResourceTransition = z.infer<typeof adminResourceTransitionSchema>
export type AdminEquipmentInventoryItem = z.infer<typeof adminEquipmentInventoryItemSchema>
export type AdminEquipmentInventoryUpdate = z.infer<typeof adminEquipmentInventoryUpdateSchema>
