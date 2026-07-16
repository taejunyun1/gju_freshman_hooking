import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  adminFacultyConsultationRoleSchema,
  adminFacultyEmploymentTypeSchema,
  adminFacultyListItemSchema,
  adminFacultyPreviewInputSchema,
  adminFacultyPreviewSchema,
  adminFacultySchema,
  adminFacultyStatusSchema,
  adminFacultyTagCategorySchema,
  adminFacultyTransitionSchema,
  adminFacultyUpdateSchema,
  adminFacultyWriteSchema,
  type AdminFaculty,
  type AdminFacultyListItem,
  type AdminFacultyPreview,
  type AdminFacultyWrite,
} from '../../../shared/schemas/admin-faculty'
import { trackLabels } from '../../../shared/types/domain'
import {
  recommendFaculty as productionRecommendFaculty,
  type FacultyRecommendationCandidate,
  type FacultyRecommendationResult,
  type FacultySpecialistLink,
  type RecommendFacultyInput,
} from '../matching/faculty'
import { AppError, FacultyConflictError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'
import { base64urlEncode } from '../../utils/web-crypto'

const safeIdSchema = z.number().int().positive().safe()
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const storedText = (minimum: number, maximum: number) => z.string().min(minimum).max(maximum)
  .refine(value => value === value.trim())
  .refine(value => [...value].every((character) => {
    const point = character.codePointAt(0) ?? 0
    return point > 0x1F && (point < 0x7F || point > 0x9F)
  }))

const rawFacultyTagSchema = z.object({
  tag_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  tag_label: storedText(1, 100),
  category: adminFacultyTagCategorySchema,
  weight: z.number().int().min(0).max(3),
  is_primary: z.boolean(),
}).strict()
const rawFacultyLinkSchema = z.object({
  primary_faculty_id: safeIdSchema.nullable(),
  tag_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  priority: z.number().int().min(0).max(32767),
  explanation_template: storedText(1, 1000),
}).strict()
const rawFacultyRowSchema = z.object({
  id: safeIdSchema,
  name: storedText(1, 100),
  title: storedText(1, 100),
  employment_type: adminFacultyEmploymentTypeSchema,
  consultation_role: adminFacultyConsultationRoleSchema,
  office: storedText(1, 200).nullable(),
  phone: storedText(1, 40).nullable(),
  email: storedText(3, 254).nullable(),
  website: storedText(8, 500).nullable(),
  contact_visibility: z.object({
    office: z.enum(['public', 'admin_only', 'hidden']),
    phone: z.enum(['public', 'admin_only', 'hidden']),
    email: z.enum(['public', 'admin_only', 'hidden']),
    website: z.enum(['public', 'admin_only', 'hidden']),
  }).strict(),
  expertise_summary: storedText(1, 1000),
  bio: z.string().min(1).max(8000).refine(value => value === value.trim()),
  profile_sections: z.unknown(),
  status: adminFacultyStatusSchema,
  weekly_capacity: z.number().int().min(0).max(32767),
  priority: z.number().int().min(0).max(32767),
  source_date: z.iso.date(),
  last_verified_at: timestampSchema.nullable(),
  image_path: z.string().min(1).max(512).nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  faculty_tags: z.array(rawFacultyTagSchema).max(100),
  faculty_specialist_links: z.array(rawFacultyLinkSchema).max(64),
  counseling_requests: z.array(z.object({
    status: z.enum(['new', 'assigned', 'contacted', 'completed', 'closed']),
  }).strict()).max(100_000),
  matching_tags: z.array(z.object({
    tag_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  }).strict()).max(100).optional(),
}).strict()

export const decodeAdminFacultyRow = (input: unknown): AdminFaculty => {
  try {
    const row = rawFacultyRowSchema.parse(input)
    return adminFacultySchema.parse({
      id: row.id,
      name: row.name,
      title: row.title,
      employmentType: row.employment_type,
      consultationRole: row.consultation_role,
      office: row.office,
      phone: row.phone,
      email: row.email,
      website: row.website,
      contactVisibility: row.contact_visibility,
      expertiseSummary: row.expertise_summary,
      bio: row.bio,
      profileSections: row.profile_sections,
      weeklyCapacity: row.weekly_capacity,
      priority: row.priority,
      sourceDate: row.source_date,
      lastVerifiedAt: row.last_verified_at,
      imagePath: row.image_path,
      tags: row.faculty_tags.map(tag => ({
        key: tag.tag_key,
        label: tag.tag_label,
        category: tag.category,
        weight: tag.weight,
        isPrimary: tag.is_primary,
      })),
      specialistLinks: row.faculty_specialist_links.map(link => ({
        primaryFacultyId: link.primary_faculty_id,
        tagKey: link.tag_key,
        priority: link.priority,
        explanationTemplate: link.explanation_template,
      })),
      status: row.status,
      openAssignedCount: row.counseling_requests.filter(request => (
        request.status === 'assigned' || request.status === 'contacted'
      )).length,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  }
  catch {
    throw new Error('ADMIN_FACULTY_STORE_INVALID')
  }
}

const rawFacultyListRowSchema = z.object({
  id: safeIdSchema,
  name: storedText(1, 100),
  title: storedText(1, 100),
  employment_type: adminFacultyEmploymentTypeSchema,
  consultation_role: adminFacultyConsultationRoleSchema,
  status: adminFacultyStatusSchema,
  weekly_capacity: z.number().int().min(0).max(32767),
  last_verified_at: timestampSchema.nullable(),
  updated_at: timestampSchema,
  faculty_tags: z.array(rawFacultyTagSchema).max(100),
  counseling_requests: z.array(z.object({
    status: z.enum(['new', 'assigned', 'contacted', 'completed', 'closed']),
  }).strict()).max(100_000),
  matching_tags: z.array(z.object({
    tag_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  }).strict()).max(100).optional(),
}).strict()

export const decodeAdminFacultyListRow = (input: unknown): AdminFacultyListItem => {
  try {
    const row = rawFacultyListRowSchema.parse(input)
    return adminFacultyListItemSchema.parse({
      id: row.id,
      name: row.name,
      title: row.title,
      employmentType: row.employment_type,
      consultationRole: row.consultation_role,
      status: row.status,
      weeklyCapacity: row.weekly_capacity,
      openAssignedCount: row.counseling_requests.filter(request => (
        request.status === 'assigned' || request.status === 'contacted'
      )).length,
      lastVerifiedAt: row.last_verified_at,
      primaryTags: row.faculty_tags.filter(tag => tag.is_primary).map(tag => ({
        key: tag.tag_key,
        label: tag.tag_label,
        category: tag.category,
        weight: tag.weight,
        isPrimary: tag.is_primary,
      })),
      updatedAt: row.updated_at,
    })
  }
  catch { throw new Error('ADMIN_FACULTY_STORE_INVALID') }
}

const cursorSchema = z.object({ updatedAt: timestampSchema, id: safeIdSchema }).strict()
export type AdminFacultyCursor = z.infer<typeof cursorSchema>

export const encodeAdminFacultyCursor = (cursor: AdminFacultyCursor): string => (
  base64urlEncode(new TextEncoder().encode(JSON.stringify(cursorSchema.parse(cursor))))
)
const decodeCursor = (encoded: string): AdminFacultyCursor => {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length > 200 || encoded.length % 4 === 1) {
    throw new Error('INVALID_CURSOR')
  }
  try {
    const padded = encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - encoded.length % 4) % 4)
    const binary = atob(padded)
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, character => character.charCodeAt(0)),
    )
    const parsed = cursorSchema.parse(JSON.parse(decoded) as unknown)
    if (encodeAdminFacultyCursor(parsed) !== encoded) throw new Error('INVALID_CURSOR')
    return parsed
  }
  catch { throw new Error('INVALID_CURSOR') }
}

const boundedQuery = z.string().trim().min(1).max(100).refine(value => storedText(1, 100).safeParse(value).success)
const listQuerySchema = z.object({
  query: boundedQuery.optional(),
  employmentType: adminFacultyEmploymentTypeSchema.optional(),
  consultationRole: adminFacultyConsultationRoleSchema.optional(),
  status: adminFacultyStatusSchema.optional(),
  tag: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u).optional(),
  limit: z.string().regex(/^[1-9][0-9]?$/u).transform(Number).pipe(z.number().int().min(1).max(50)).default(20),
  cursor: z.string().min(1).max(200).transform((value, context) => {
    try { return decodeCursor(value) }
    catch {
      context.addIssue({ code: 'custom', message: 'invalid cursor' })
      return z.NEVER
    }
  }).optional(),
}).strict()
export type AdminFacultyListInput = z.infer<typeof listQuerySchema>

export const parseAdminFacultyListQuery = (input: unknown): AdminFacultyListInput => {
  const parsed = listQuerySchema.safeParse(input)
  if (!parsed.success) throw new AppError('FACULTY_INVALID')
  return parsed.data
}
export const parseAdminFacultyId = (input: string | undefined): number => {
  const parsed = z.string().regex(/^[1-9][0-9]{0,15}$/u).transform(Number).pipe(safeIdSchema).safeParse(input)
  if (!parsed.success) throw new AppError('FACULTY_INVALID')
  return parsed.data
}
export const parseAdminFacultyUpdate = (input: unknown) => {
  const parsed = adminFacultyUpdateSchema.safeParse(input)
  if (!parsed.success) throw new AppError('FACULTY_INVALID')
  return parsed.data
}
export const parseAdminFacultyTransition = (input: unknown) => {
  const parsed = adminFacultyTransitionSchema.safeParse(input)
  if (!parsed.success) throw new AppError('FACULTY_INVALID')
  return parsed.data
}
export const parseAdminFacultyPreview = (input: unknown) => {
  const parsed = adminFacultyPreviewInputSchema.safeParse(input)
  if (!parsed.success) throw new AppError('FACULTY_INVALID')
  return parsed.data
}
export const parseAdminFacultyJsonBody = async (
  contentType: string | undefined,
  rawBody: string | undefined,
): Promise<unknown> => {
  if (!contentType || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8\s*)?$/iu.test(contentType)
    || rawBody === undefined || new TextEncoder().encode(rawBody).byteLength > 256 * 1024) {
    throw new AppError('FACULTY_INVALID')
  }
  try { return JSON.parse(rawBody) as unknown }
  catch { throw new AppError('FACULTY_INVALID') }
}

type MutationContext = { adminUserId: string, requestId: string }
type StoreListInput = Omit<AdminFacultyListInput, 'limit'> & { limit: number }
type FacultyOutcome = { kind: 'updated', faculty: AdminFaculty } | { kind: 'conflict', current: AdminFaculty }

export type AdminFacultyServiceDependencies = {
  listFaculty: (input: StoreListInput) => Promise<AdminFacultyListItem[]>
  loadFaculty: (input: { id: number }) => Promise<AdminFaculty | null>
  listRecommendationFaculty: () => Promise<AdminFaculty[]>
  updateFaculty: (input: MutationContext & { id: number, expectedUpdatedAt: string, faculty: AdminFacultyWrite }) => Promise<FacultyOutcome>
  publishFaculty: (input: MutationContext & { id: number, expectedUpdatedAt: string }) => Promise<FacultyOutcome>
  recommendFaculty: (input: RecommendFacultyInput) => FacultyRecommendationResult
  now: () => Date
}

const timestampParts = (value: string): readonly [number, number] => {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value)
  if (match === null) throw new AppError('FACULTY_INVALID')
  const seconds = Date.parse(`${match[1]}${match[3]}`) / 1000
  const microseconds = Number((match[2] ?? '').padEnd(6, '0'))
  if (!Number.isFinite(seconds) || !Number.isSafeInteger(microseconds)) throw new AppError('FACULTY_INVALID')
  return [seconds, microseconds]
}
const isStrictlyNewerInstant = (candidate: string, current: string) => {
  const [candidateSeconds, candidateMicros] = timestampParts(candidate)
  const [currentSeconds, currentMicros] = timestampParts(current)
  return candidateSeconds > currentSeconds
    || (candidateSeconds === currentSeconds && candidateMicros > currentMicros)
}

const validatePublishable = (
  faculty: AdminFacultyWrite,
  current: AdminFaculty,
  facultyId: number,
  candidates: readonly AdminFaculty[],
  now: Date,
): void => {
  if (faculty.consultationRole === 'primary' && faculty.weeklyCapacity <= 0) throw new AppError('FACULTY_CAPACITY_REQUIRED')
  if (faculty.consultationRole === 'specialist') {
    if (faculty.weeklyCapacity !== 0) throw new AppError('FACULTY_CAPACITY_REQUIRED')
    if (!faculty.tags.some(tag => tag.category === 'specialist' && tag.weight > 0)) {
      throw new AppError('FACULTY_SPECIALIST_TAG_REQUIRED')
    }
  }
  const rawContacts = { office: faculty.office, phone: faculty.phone, email: faculty.email, website: faculty.website }
  const currentContacts = { office: current.office, phone: current.phone, email: current.email, website: current.website }
  const hasPublic = Object.entries(faculty.contactVisibility).some(([field, visibility]) => {
    if (visibility !== 'public') return false
    if (!rawContacts[field as keyof typeof rawContacts]) throw new AppError('CONTACT_VERIFICATION_REQUIRED')
    return true
  })
  if (hasPublic && (faculty.lastVerifiedAt === null
    || Date.parse(faculty.lastVerifiedAt) > now.getTime())) throw new AppError('CONTACT_VERIFICATION_REQUIRED')

  if (hasPublic
    && current.lastVerifiedAt !== null
    && faculty.lastVerifiedAt !== null
    && isStrictlyNewerInstant(current.lastVerifiedAt, faculty.lastVerifiedAt)) {
    throw new AppError('CONTACT_VERIFICATION_REQUIRED')
  }

  for (const field of ['office', 'phone', 'email', 'website'] as const) {
    if (faculty.contactVisibility[field] !== 'public') continue
    const requiresReverification = current.contactVisibility[field] !== 'public'
      || currentContacts[field] !== rawContacts[field]
    if (requiresReverification && (
      faculty.lastVerifiedAt === null
      || (current.lastVerifiedAt !== null
        && !isStrictlyNewerInstant(faculty.lastVerifiedAt, current.lastVerifiedAt))
    )) throw new AppError('CONTACT_VERIFICATION_REQUIRED')
  }

  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]))
  for (const link of faculty.specialistLinks) {
    if (link.primaryFacultyId === null) continue
    if (link.primaryFacultyId === facultyId) throw new AppError('FACULTY_LINK_INVALID')
    const primary = byId.get(link.primaryFacultyId)
    if (!primary || primary.status !== 'active' || primary.employmentType !== 'full_time'
      || primary.consultationRole !== 'primary') throw new AppError('FACULTY_LINK_INVALID')
  }
  const hasInboundSpecialistLink = candidates.some(candidate => candidate.specialistLinks.some(link => (
    link.primaryFacultyId === facultyId
  )))
  if (current.status === 'active' && current.employmentType === 'full_time'
    && current.consultationRole === 'primary' && hasInboundSpecialistLink
    && (faculty.employmentType !== 'full_time' || faculty.consultationRole !== 'primary')) {
    throw new AppError('FACULTY_LINK_INVALID')
  }
}

const recommendationCandidate = (faculty: AdminFaculty): FacultyRecommendationCandidate => ({
  id: faculty.id,
  name: faculty.name,
  title: faculty.title,
  expertise: faculty.expertiseSummary,
  status: faculty.status,
  employmentType: faculty.employmentType,
  consultationRole: faculty.consultationRole,
  weeklyCapacity: faculty.weeklyCapacity,
  openAssignedCount: faculty.openAssignedCount,
  priority: faculty.priority,
  contacts: Object.fromEntries(Object.entries({
    office: faculty.office,
    phone: faculty.phone,
    email: faculty.email,
    website: faculty.website,
  }).filter((entry): entry is [string, string] => entry[1] !== null)),
  contactVisibility: faculty.contactVisibility,
  tags: faculty.tags,
})

const previewScenarios = [
  {
    key: 'social_photo_story' as const, label: '사회 포토스토리' as const, trackEvidence: 'documentary' as const,
    student: {
      trackScores: { documentary: 92, art_photo: 0, commercial: 0, video: 0 },
      interestVector: { documentary: 1, social: 1, record: 0.95, photo_communication: 0.9, photo_story: 1 },
      selectedLabels: { documentary: '다큐멘터리 사진', social: '사회와 사람의 기록', record: '기록', photo_communication: '포토커뮤니케이션', photo_story: '포토스토리' },
    },
  },
  {
    key: 'local_archive' as const, label: '지역 아카이브' as const, trackEvidence: 'documentary' as const,
    student: {
      trackScores: { documentary: 90, art_photo: 0, commercial: 0, video: 0 },
      interestVector: { documentary: 1, local: 0.9, local_record: 1, archive: 1, field_research: 1, public_institution: 0.9 },
      selectedLabels: { documentary: '다큐멘터리 사진', local: '지역', local_record: '지역문화 기록', archive: '사진 아카이브', field_research: '현장조사', public_institution: '공공기관 프로젝트' },
    },
  },
  {
    key: 'video_drone' as const, label: '영상·드론' as const, trackEvidence: 'video' as const,
    student: {
      trackScores: { documentary: 0, art_photo: 82, commercial: 0, video: 96 },
      interestVector: { art_photo: 0.82, video: 1, narrative: 0.9, drone: 1, ai: 0.9 },
      selectedLabels: { art_photo: trackLabels.art_photo, video: trackLabels.video, narrative: '내러티브 영상', drone: '드론촬영', ai: 'AI·기술적 이미지' },
    },
  },
  {
    key: 'commercial_fashion' as const, label: '광고·패션' as const, trackEvidence: 'commercial' as const,
    student: {
      trackScores: { documentary: 0, art_photo: 0, commercial: 96, video: 0 },
      interestVector: { commercial: 1, fashion: 0.9, product: 0.8, brand: 0.8, studio: 0.8, lighting: 0.7 },
      selectedLabels: { commercial: '광고사진', fashion: '패션사진', product: '제품사진', brand: '브랜드 이미지', studio: '스튜디오 촬영', lighting: '조명' },
    },
  },
] as const

export const createAdminFacultyService = (dependencies: AdminFacultyServiceDependencies) => ({
  list: async (input: AdminFacultyListInput) => {
    const rows = await dependencies.listFaculty({ ...input, limit: input.limit + 1 })
    const page = rows.slice(0, input.limit)
    return {
      items: page.map(item => adminFacultyListItemSchema.parse(item)),
      nextCursor: rows.length > input.limit && page.length > 0
        ? encodeAdminFacultyCursor({ updatedAt: page.at(-1)!.updatedAt, id: page.at(-1)!.id })
        : null,
    }
  },
  detail: async (id: number) => {
    const faculty = await dependencies.loadFaculty({ id })
    if (faculty === null) throw new AppError('FACULTY_NOT_FOUND')
    return { faculty: adminFacultySchema.parse(faculty) }
  },
  update: async (id: number, rawInput: unknown, context: MutationContext) => {
    const input = parseAdminFacultyUpdate(rawInput)
    const outcome = await dependencies.updateFaculty({ id, ...input, ...context })
    if (outcome.kind === 'conflict') throw new FacultyConflictError(adminFacultySchema.parse(outcome.current))
    return { faculty: adminFacultySchema.parse(outcome.faculty) }
  },
  publish: async (id: number, expectedUpdatedAt: string, context: MutationContext) => {
    const version = adminFacultyTransitionSchema.parse({ expectedUpdatedAt }).expectedUpdatedAt
    const outcome = await dependencies.publishFaculty({ id, expectedUpdatedAt: version, ...context })
    if (outcome.kind === 'conflict') throw new FacultyConflictError(adminFacultySchema.parse(outcome.current))
    return { faculty: adminFacultySchema.parse(outcome.faculty) }
  },
  preview: async (id: number, rawFaculty: unknown): Promise<AdminFacultyPreview> => {
    const parsed = adminFacultyWriteSchema.safeParse(rawFaculty)
    if (!parsed.success) throw new AppError('FACULTY_INVALID')
    const current = await dependencies.loadFaculty({ id })
    if (current === null) throw new AppError('FACULTY_NOT_FOUND')
    const candidates = await dependencies.listRecommendationFaculty()
    validatePublishable(parsed.data, current, id, candidates, dependencies.now())
    const overlay = adminFacultySchema.parse({
      ...current,
      ...parsed.data,
      id,
      status: 'active',
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      openAssignedCount: current.openAssignedCount,
    })
    const faculty = candidates.some(candidate => candidate.id === id)
      ? candidates.map(candidate => candidate.id === id ? overlay : candidate)
      : [...candidates, overlay]
    const links: FacultySpecialistLink[] = faculty.flatMap(candidate => candidate.specialistLinks.map(link => ({
      primaryFacultyId: link.primaryFacultyId,
      specialistFacultyId: candidate.id,
      tagKey: link.tagKey,
      priority: link.priority,
    })))
    try {
      return adminFacultyPreviewSchema.parse({
        scenarios: previewScenarios.map(scenario => ({
          key: scenario.key,
          label: scenario.label,
          trackEvidence: scenario.trackEvidence,
          recommendation: dependencies.recommendFaculty({
            student: scenario.student,
            faculty: faculty.map(recommendationCandidate),
            specialistLinks: links,
          }),
        })),
      })
    }
    catch (error) {
      if (error instanceof Error && error.message === 'FACULTY_CONTENT_NOT_READY') {
        throw new AppError('FACULTY_CONTENT_NOT_READY')
      }
      throw new AppError('INTERNAL_ERROR')
    }
  },
})

const selection = [
  'id,name,title,employment_type,consultation_role,office,phone,email,website',
  'contact_visibility,expertise_summary,bio,profile_sections,status,weekly_capacity,priority',
  'source_date,last_verified_at,image_path,created_at,updated_at',
  'faculty_tags(tag_key,tag_label,category,weight,is_primary)',
  'faculty_specialist_links!faculty_specialist_links_specialist_fk(primary_faculty_id,tag_key,priority,explanation_template)',
  'counseling_requests!counseling_requests_assigned_faculty_fk(status)',
].join(',')
const listSelection = [
  'id,name,title,employment_type,consultation_role,status,weekly_capacity,last_verified_at,updated_at',
  'faculty_tags(tag_key,tag_label,category,weight,is_primary)',
  'counseling_requests!counseling_requests_assigned_faculty_fk(status)',
].join(',')
const escapeLike = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
const quotePostgrest = (value: string) => `"${value.replaceAll('"', '\\"')}"`
const storeError = (): never => { throw new Error('ADMIN_FACULTY_STORE_FAILED') }
const facultyMutationErrorSchema = z.enum([
  'FACULTY_INVALID', 'FACULTY_STATUS_INVALID', 'FACULTY_ROLE_INVALID', 'FACULTY_CAPACITY_REQUIRED',
  'CONTACT_VERIFICATION_REQUIRED', 'FACULTY_SPECIALIST_TAG_REQUIRED', 'FACULTY_TAG_INVALID',
  'FACULTY_LINK_INVALID', 'FACULTY_TAXONOMY_INVALID', 'FACULTY_YOON_SCOPE_REQUIRED',
])
const outcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('updated'), facultyUpdatedAt: timestampSchema }).strict(),
  z.object({ status: z.literal('conflict'), facultyUpdatedAt: timestampSchema }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('validation_error'), code: facultyMutationErrorSchema }).strict(),
])
const timestampToken = (value: string) => {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value)
  if (match === null) return storeError()
  const seconds = Date.parse(`${match[1]}${match[3]}`) / 1000
  if (!Number.isFinite(seconds)) storeError()
  return `${seconds}:${(match[2] ?? '').replace(/0+$/u, '')}`
}

export const createSupabaseAdminFacultyDependencies = (
  client: SupabaseClient,
): Pick<AdminFacultyServiceDependencies, 'listFaculty' | 'loadFaculty' | 'listRecommendationFaculty' | 'updateFaculty' | 'publishFaculty'> => {
  const adapter = {
    listFaculty: async (input: StoreListInput) => {
      const selected = input.tag ? `${listSelection},matching_tags:faculty_tags!inner(tag_key)` : listSelection
      let query = client.from('faculty').select(selected)
      if (input.query) {
        const pattern = quotePostgrest(`%${escapeLike(input.query)}%`)
        query = query.or(`name.ilike.${pattern},expertise_summary.ilike.${pattern}`)
      }
      if (input.employmentType) query = query.eq('employment_type', input.employmentType)
      if (input.consultationRole) query = query.eq('consultation_role', input.consultationRole)
      if (input.status) query = query.eq('status', input.status)
      if (input.tag) query = query.eq('matching_tags.tag_key', input.tag)
      if (input.cursor) query = query.or(`updated_at.lt.${input.cursor.updatedAt},and(updated_at.eq.${input.cursor.updatedAt},id.lt.${input.cursor.id})`)
      const { data, error } = await query.order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(input.limit)
      if (error) storeError()
      return (data ?? []).map(decodeAdminFacultyListRow)
    },
    loadFaculty: async ({ id }: { id: number }) => {
      const { data, error } = await client.from('faculty').select(selection).eq('id', id).maybeSingle()
      if (error) storeError()
      return data === null ? null : decodeAdminFacultyRow(data)
    },
    listRecommendationFaculty: async () => {
      const { data, error } = await client.from('faculty').select(selection)
        .order('id', { ascending: true }).limit(100)
      if (error) storeError()
      return (data ?? []).map(decodeAdminFacultyRow)
    },
    updateFaculty: async (input: MutationContext & { id: number, expectedUpdatedAt: string, faculty: AdminFacultyWrite }): Promise<FacultyOutcome> => {
      const { tags, specialistLinks, ...faculty } = input.faculty
      const { data, error } = await client.rpc('update_admin_faculty', {
        p_admin_user_id: input.adminUserId,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_faculty_id: input.id,
        p_request_id: input.requestId,
        p_faculty: faculty,
        p_tags: tags,
        p_links: specialistLinks,
      })
      if (error) storeError()
      const parsedOutcome = outcomeSchema.safeParse(data)
      if (!parsedOutcome.success) return storeError()
      const outcome = parsedOutcome.data
      if (outcome.status === 'not_found') throw new AppError('FACULTY_NOT_FOUND')
      if (outcome.status === 'validation_error') throw new AppError(outcome.code)
      const current = await adapter.loadFaculty({ id: input.id })
      if (current === null) throw new AppError('FACULTY_NOT_FOUND')
      return outcome.status === 'updated' && timestampToken(current.updatedAt) === timestampToken(outcome.facultyUpdatedAt)
        ? { kind: 'updated', faculty: current }
        : { kind: 'conflict', current }
    },
    publishFaculty: async (input: MutationContext & { id: number, expectedUpdatedAt: string }): Promise<FacultyOutcome> => {
      const { data, error } = await client.rpc('publish_admin_faculty', {
        p_admin_user_id: input.adminUserId,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_faculty_id: input.id,
        p_request_id: input.requestId,
      })
      if (error) storeError()
      const parsedOutcome = outcomeSchema.safeParse(data)
      if (!parsedOutcome.success) return storeError()
      const outcome = parsedOutcome.data
      if (outcome.status === 'not_found') throw new AppError('FACULTY_NOT_FOUND')
      if (outcome.status === 'validation_error') throw new AppError(outcome.code)
      const current = await adapter.loadFaculty({ id: input.id })
      if (current === null) throw new AppError('FACULTY_NOT_FOUND')
      return outcome.status === 'updated' && timestampToken(current.updatedAt) === timestampToken(outcome.facultyUpdatedAt)
        ? { kind: 'updated', faculty: current }
        : { kind: 'conflict', current }
    },
  }
  return adapter
}

export const getServerAdminFacultyService = () => createAdminFacultyService({
  ...createSupabaseAdminFacultyDependencies(getServerSupabaseClient()),
  recommendFaculty: productionRecommendFaculty,
  now: () => new Date(),
})
