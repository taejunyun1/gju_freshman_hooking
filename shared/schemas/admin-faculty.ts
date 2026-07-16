import { z } from 'zod'

import { resultFacultySchema } from './result'
import { trackLabels } from '../types/domain'

export const adminFacultyEmploymentTypes = ['full_time', 'adjunct', 'practitioner'] as const
export const adminFacultyConsultationRoles = ['primary', 'specialist'] as const
export const adminFacultyStatuses = ['draft', 'active', 'archived'] as const
export const adminFacultyTagCategories = ['track', 'activity', 'result', 'career', 'specialist'] as const
export const adminFacultyContactVisibilities = ['public', 'admin_only', 'hidden'] as const
export const adminFacultyTrackPairs = {
  documentary: trackLabels.documentary,
  art_photo: trackLabels.art_photo,
  commercial: trackLabels.commercial,
  video: trackLabels.video,
} as const

export const adminFacultyEmploymentTypeSchema = z.enum(adminFacultyEmploymentTypes)
export const adminFacultyConsultationRoleSchema = z.enum(adminFacultyConsultationRoles)
export const adminFacultyStatusSchema = z.enum(adminFacultyStatuses)
export const adminFacultyTagCategorySchema = z.enum(adminFacultyTagCategories)

const hasNoControlCharacters = (value: string) => [...value].every((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
})
const hasOnlyPairedSurrogates = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) return false
      index += 1
    }
    else if (code >= 0xDC00 && code <= 0xDFFF) return false
  }
  return true
}
const cleanText = (minimum: number, maximum: number) => z.string().min(minimum).max(maximum)
  .refine(value => value === value.trim()).refine(hasNoControlCharacters).refine(hasOnlyPairedSurrogates)
const legacyMultilineText = (minimum: number, maximum: number) => z.string().min(minimum).max(maximum)
  .refine(value => value === value.trim())
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint === 0x0A || (codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F))
  }))
  .refine(hasOnlyPairedSurrogates)
const safeIdSchema = z.number().int().positive().safe()
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
  .refine(value => /T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value))
  .refine(value => Number.isFinite(Date.parse(value)))
const tagKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)
const safeImagePathSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u)
  .refine(path => !/(^|\/)(?:\.{1,2})(?:\/|$)|\/\//u.test(path))
const publicHttpsUrlSchema = cleanText(8, 500).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === ''
  }
  catch { return false }
})

export const adminFacultyContactVisibilitySchema = z.object({
  office: z.enum(adminFacultyContactVisibilities),
  phone: z.enum(adminFacultyContactVisibilities),
  email: z.enum(adminFacultyContactVisibilities),
  website: z.enum(adminFacultyContactVisibilities),
}).strict()

const profileListSchema = z.array(cleanText(1, 1000)).max(100)
const boundedJson = (value: unknown, bytes: number) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= bytes
export const adminFacultyProfileSectionsSchema = z.object({
  recommendationRole: cleanText(1, 1000),
  education: profileListSchema,
  careers: profileListSchema,
  teachingFields: profileListSchema,
  studentProjects: profileListSchema,
  careerPaths: profileListSchema,
  institutionProjects: profileListSchema,
  majorWorks: profileListSchema,
}).strict().refine(value => boundedJson(value, 65_536))

export const adminFacultyTagSchema = z.object({
  key: tagKeySchema,
  label: cleanText(1, 100),
  category: adminFacultyTagCategorySchema,
  weight: z.number().int().min(0).max(3),
  isPrimary: z.boolean(),
}).strict()

export const adminFacultySpecialistLinkSchema = z.object({
  primaryFacultyId: safeIdSchema.nullable(),
  tagKey: tagKeySchema,
  priority: z.number().int().min(0).max(32767),
  explanationTemplate: cleanText(1, 1000).refine(value => !/배정 완료|담당 교수/u.test(value)),
}).strict()

const facultyBaseShape = {
  name: cleanText(1, 100),
  title: cleanText(1, 100),
  employmentType: adminFacultyEmploymentTypeSchema,
  consultationRole: adminFacultyConsultationRoleSchema,
  office: cleanText(1, 200).nullable(),
  phone: cleanText(1, 40).regex(/^[+0-9(). -]+$/u).nullable(),
  email: z.email().max(254).nullable(),
  website: publicHttpsUrlSchema.nullable(),
  contactVisibility: adminFacultyContactVisibilitySchema,
  expertiseSummary: cleanText(1, 1000),
  bio: legacyMultilineText(1, 8000),
  profileSections: adminFacultyProfileSectionsSchema,
  weeklyCapacity: z.number().int().min(0).max(32767),
  priority: z.number().int().min(0).max(32767),
  sourceDate: z.iso.date(),
  lastVerifiedAt: timestampSchema.nullable(),
  imagePath: safeImagePathSchema.nullable(),
  tags: z.array(adminFacultyTagSchema).max(100).refine(value => boundedJson(value, 65_536)),
  specialistLinks: z.array(adminFacultySpecialistLinkSchema).max(64).refine(value => boundedJson(value, 65_536)),
}

export const adminFacultyReadShapeSchema = z.object(facultyBaseShape).strict()

export const adminFacultyWriteSchema = z.object({
  ...facultyBaseShape,
  bio: legacyMultilineText(1, 8000),
  tags: z.array(adminFacultyTagSchema).min(1).max(100).refine(value => boundedJson(value, 65_536)),
}).strict().superRefine((faculty, context) => {
  const isValidRole = faculty.employmentType === 'full_time'
    ? faculty.consultationRole === 'primary'
    : faculty.consultationRole === 'specialist'
  if (!isValidRole) context.addIssue({ code: 'custom', path: ['consultationRole'], message: 'invalid role' })

  const identities = faculty.tags.map(tag => `${tag.key}|${tag.category}`)
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: 'custom', path: ['tags'], message: 'duplicate tag' })
  }
  for (const category of adminFacultyTagCategories) {
    if (faculty.tags.filter(tag => tag.category === category && tag.isPrimary).length > 1) {
      context.addIssue({ code: 'custom', path: ['tags'], message: 'duplicate category primary' })
    }
  }
  for (const [index, tag] of faculty.tags.entries()) {
    if (tag.category === 'track'
      && adminFacultyTrackPairs[tag.key as keyof typeof adminFacultyTrackPairs] !== tag.label) {
      context.addIssue({ code: 'custom', path: ['tags', index], message: 'invalid track taxonomy' })
    }
  }

  if (faculty.consultationRole === 'primary' && faculty.specialistLinks.length > 0) {
    context.addIssue({ code: 'custom', path: ['specialistLinks'], message: 'primary owns no specialist links' })
  }
  const specialistKeys = new Set(faculty.tags.filter(tag => tag.category === 'specialist').map(tag => tag.key))
  const links = new Set<string>()
  for (const [index, link] of faculty.specialistLinks.entries()) {
    const identity = `${link.primaryFacultyId ?? ''}|${link.tagKey}`
    if (!specialistKeys.has(link.tagKey) || links.has(identity)) {
      context.addIssue({ code: 'custom', path: ['specialistLinks', index], message: 'invalid specialist link' })
    }
    links.add(identity)
  }

  if (faculty.name === '윤태준') {
    const summary = faculty.expertiseSummary
    const keys = new Set(faculty.tags.filter(tag => tag.category !== 'specialist').map(tag => tag.key))
    if (!['예술사진', '영상', 'AI', '기술적 이미지'].every(value => summary.includes(value))
      || !['art_photo', 'video', 'ai'].every(key => keys.has(key))) {
      context.addIssue({ code: 'custom', path: ['expertiseSummary'], message: 'Yoon scope required' })
    }
  }
})

export const adminFacultySchema = z.object({
  id: safeIdSchema,
  ...facultyBaseShape,
  status: adminFacultyStatusSchema,
  openAssignedCount: z.number().int().nonnegative().safe(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

export const adminFacultyListItemSchema = z.object({
  id: safeIdSchema,
  name: cleanText(1, 100),
  title: cleanText(1, 100),
  employmentType: adminFacultyEmploymentTypeSchema,
  consultationRole: adminFacultyConsultationRoleSchema,
  status: adminFacultyStatusSchema,
  weeklyCapacity: z.number().int().min(0).max(32767),
  openAssignedCount: z.number().int().nonnegative().safe(),
  lastVerifiedAt: timestampSchema.nullable(),
  primaryTags: z.array(adminFacultyTagSchema).max(100),
  updatedAt: timestampSchema,
}).strict()

export const adminFacultyUpdateSchema = z.object({
  expectedUpdatedAt: timestampSchema,
  faculty: adminFacultyWriteSchema,
}).strict()
export const adminFacultyTransitionSchema = z.object({ expectedUpdatedAt: timestampSchema }).strict()
export const adminFacultyPreviewInputSchema = z.object({ faculty: adminFacultyWriteSchema }).strict()

const previewScenarioSchema = z.object({
  key: z.enum(['social_photo_story', 'local_archive', 'video_drone', 'commercial_fashion']),
  label: z.enum(['사회 포토스토리', '지역 아카이브', '영상·드론', '광고·패션']),
  trackEvidence: z.enum(['documentary', 'art_photo', 'video', 'commercial']),
  recommendation: resultFacultySchema.extend({ facultyFit: z.number().finite().min(0).max(100) }).strict(),
}).strict()
export const adminFacultyPreviewSchema = z.object({ scenarios: z.array(previewScenarioSchema).length(4) }).strict()

export type AdminFacultyWrite = z.infer<typeof adminFacultyWriteSchema>
export type AdminFaculty = z.infer<typeof adminFacultySchema>
export type AdminFacultyListItem = z.infer<typeof adminFacultyListItemSchema>
export type AdminFacultyPreview = z.infer<typeof adminFacultyPreviewSchema>
