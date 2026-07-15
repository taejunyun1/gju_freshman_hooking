import { z } from 'zod'

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

export const facilityAdminResourceMetadataSchema = z.object({
  location_label: z.string().trim().max(120).optional(),
  operation_note: z.string().trim().max(1000).optional(),
  activities: z.array(cleanText(1, 200)).max(30).optional(),
  last_verified_at: z.iso.datetime({ offset: true }).max(40).nullable().optional(),
  seedKey: cleanText(1, 300).optional(),
  facilityKey: cleanText(1, 100).optional(),
  facilityType: cleanText(1, 100).optional(),
  exampleCourses: z.array(cleanText(1, 200)).max(30).optional(),
  operationNote: cleanText(1, 1000).optional(),
  lastVerifiedAt: z.iso.datetime({ offset: true }).max(40).nullable().optional(),
  supportingEvidence: z.boolean().optional(),
}).strict()

const equipmentMetadataWriteShape = {
  seedKey: cleanText(1, 300).optional(),
  category: cleanText(1, 100).optional(),
  locationKey: z.enum(['department_equipment_room', 'fantasy_lab']).optional(),
  locationLabel: cleanText(1, 120).optional(),
  accessMode: z.enum(['reservation', 'inquiry']).optional(),
  accessLabel: cleanText(1, 100).optional(),
  reservationUrl: z.url().max(500).optional(),
  snapshotNotice: cleanText(1, 1000).optional(),
  supportingEvidence: z.boolean().optional(),
}

export const equipmentAdminResourceWriteMetadataSchema = z.object(equipmentMetadataWriteShape).strict()
export const equipmentAdminResourceMetadataSchema = z.object({
  ...equipmentMetadataWriteShape,
  confirmedQuantity: z.number().int().min(0).max(100_000).optional(),
}).strict()

const emptyMetadataSchema = z.object({}).strict()
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

export const adminResourceWriteSchema = z.discriminatedUnion('type', [
  z.object({ ...commonWriteShape, type: z.literal('course'), metadata: courseAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('equipment'), metadata: equipmentAdminResourceWriteMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('facility'), metadata: facilityAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('student_work'), metadata: studentWorkAdminResourceMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('extracurricular'), metadata: emptyMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('project'), metadata: emptyMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('career'), metadata: emptyMetadataSchema }).strict(),
  z.object({ ...commonWriteShape, type: z.literal('support'), metadata: emptyMetadataSchema }).strict(),
]).superRefine((resource, context) => {
  const keys = resource.tags.map(tag => tag.key)
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: 'custom', path: ['tags'], message: '태그는 중복할 수 없습니다.' })
  }
  if (resource.tags.filter(tag => tag.isPrimary).length !== 1) {
    context.addIssue({ code: 'custom', path: ['tags'], message: '기본 태그는 하나여야 합니다.' })
  }
})

export const adminResourceUpdateSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }).max(40),
  resource: adminResourceWriteSchema,
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
  z.object({ ...commonResourceShape, type: z.literal('extracurricular'), metadata: emptyMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('project'), metadata: emptyMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('career'), metadata: emptyMetadataSchema }).strict(),
  z.object({ ...commonResourceShape, type: z.literal('support'), metadata: emptyMetadataSchema }).strict(),
])

export type AdminResourceWrite = z.infer<typeof adminResourceWriteSchema>
export type AdminResource = z.infer<typeof adminResourceSchema>
export type AdminEquipmentInventoryItem = z.infer<typeof adminEquipmentInventoryItemSchema>
export type AdminEquipmentInventoryUpdate = z.infer<typeof adminEquipmentInventoryUpdateSchema>
