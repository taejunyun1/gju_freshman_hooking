import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  adminCounselingCurrentSchema,
  adminCounselingQueueSchema,
  counselingAvailabilitySchema,
  counselingContactMethodSchema,
  counselingStatusSchema,
  type AdminCounselingCurrent,
  type AdminCounselingQueue,
} from '../../../shared/schemas/counseling'
import { applicantStageSchema, regionSchema } from '../../../shared/schemas/identity'
import { trackKeys, trackLabels } from '../../../shared/types/domain'
import { AppError, CounselingConflictError } from '../../utils/app-error'
import { bytesFromPostgresBytea } from '../../utils/postgres-bytea'
import { getServerSupabaseClient } from '../../utils/supabase'
import { base64urlEncode, decodeBase64urlSecret } from '../../utils/web-crypto'
import { normalizeKoreanPhone, revealPhone } from '../identity/phone'
import { revealApplicantName } from '../identity/applicant-name'

const safeIdSchema = z.number().int().positive().safe()
const versionSchema = z.number().int().nonnegative().max(2_147_483_647)
const canonicalUuidSchema = z.string().uuid()
  .refine(value => value === value.toLowerCase(), 'UUID must use canonical lowercase form')
const inputUuidSchema = z.string().uuid().transform(value => value.toLowerCase())
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const nullableTimestampSchema = timestampSchema.nullable()
const maxApplicantNameCiphertextBytes = 40 * 4 + 16
const storedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim(), 'stored text must be trimmed')
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }), 'stored text cannot contain control characters')

const cursorPayloadSchema = z.object({
  createdAt: timestampSchema,
  id: safeIdSchema,
}).strict()

export type CounselingCursor = z.infer<typeof cursorPayloadSchema>

const decodeBase64urlText = (encoded: string): string => {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length > 200 || encoded.length % 4 === 1) {
    throw new Error('COUNSELING_CURSOR_INVALID')
  }
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/')
    + '='.repeat((4 - encoded.length % 4) % 4)
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  catch {
    throw new Error('COUNSELING_CURSOR_INVALID')
  }
}

export const encodeCounselingCursor = (rawCursor: CounselingCursor): string => {
  const cursor = cursorPayloadSchema.parse(rawCursor)
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(cursor)))
}

const decodeCounselingCursor = (encoded: string): CounselingCursor => {
  let raw: unknown
  try {
    raw = JSON.parse(decodeBase64urlText(encoded)) as unknown
  }
  catch {
    throw new Error('COUNSELING_CURSOR_INVALID')
  }
  const parsed = cursorPayloadSchema.safeParse(raw)
  if (!parsed.success || encodeCounselingCursor(parsed.data) !== encoded) {
    throw new Error('COUNSELING_CURSOR_INVALID')
  }
  return parsed.data
}

const positiveIntegerString = z.string().regex(/^[1-9][0-9]{0,15}$/u)
  .transform((value, context) => {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) {
      context.addIssue({ code: 'custom', message: 'integer exceeds the safe range' })
      return z.NEVER
    }
    return parsed
  })
const queueLimitSchema = z.string().regex(/^[1-9][0-9]?$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(50))
const rawQueueQuerySchema = z.object({
  assignedFacultyId: positiveIntegerString.optional(),
  createdFrom: timestampSchema.optional(),
  createdTo: timestampSchema.optional(),
  cursor: z.string().min(1).max(200).transform((value, context) => {
    try {
      return decodeCounselingCursor(value)
    }
    catch {
      context.addIssue({ code: 'custom', message: 'invalid cursor' })
      return z.NEVER
    }
  }).optional(),
  limit: queueLimitSchema.default(20),
  primaryTrack: z.enum(trackKeys).optional(),
  status: counselingStatusSchema.optional(),
}).strict().superRefine((query, context) => {
  if (query.createdFrom && query.createdTo
    && new Date(query.createdFrom).getTime() > new Date(query.createdTo).getTime()) {
    context.addIssue({ code: 'custom', message: 'created date bounds are reversed' })
  }
})

export type AdminCounselingQueueQuery = {
  assignedFacultyId?: number
  createdFrom?: string
  createdTo?: string
  cursor?: CounselingCursor
  limit: number
  primaryTrack?: typeof trackKeys[number]
  status?: z.infer<typeof counselingStatusSchema>
}

export const parseAdminCounselingQueueQuery = (input: unknown): AdminCounselingQueueQuery => {
  const parsed = rawQueueQuerySchema.safeParse(input)
  if (!parsed.success) throw new AppError('COUNSELING_INVALID')
  return parsed.data
}

const bodyEncoder = new TextEncoder()

export const parseAdminCounselingPublicId = (input: string | undefined): string => {
  const parsed = inputUuidSchema.safeParse(input)
  if (!parsed.success) throw new AppError('VALIDATION_FAILED')
  return parsed.data
}

export const parseAdminCounselingJsonBody = <Schema extends z.ZodType>(input: {
  contentType: string | undefined
  rawBody: string | undefined
  schema: Schema
}): z.infer<Schema> => {
  const mediaType = input.contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json'
    || !input.rawBody
    || bodyEncoder.encode(input.rawBody).byteLength > 4_096) {
    throw new AppError('COUNSELING_INVALID')
  }
  let raw: unknown
  try {
    raw = JSON.parse(input.rawBody) as unknown
  }
  catch {
    throw new AppError('COUNSELING_INVALID')
  }
  const parsed = input.schema.safeParse(raw)
  if (!parsed.success) throw new AppError('COUNSELING_INVALID')
  return parsed.data
}

const facultySchema = z.object({
  id: safeIdSchema,
  name: storedText(100),
  title: storedText(100),
}).strict()

const recommendationSchema = facultySchema.extend({
  role: z.enum(['primary', 'backup', 'specialist']),
  rank: z.number().int().min(1).max(2),
}).strict()

const storedRequestSchema = z.object({
  requestId: safeIdSchema,
  publicId: canonicalUuidSchema,
  prospectId: safeIdSchema,
  assessmentPublicId: canonicalUuidSchema,
  campaignId: safeIdSchema.nullable(),
  primaryTrack: z.enum(trackKeys),
  secondaryTrack: z.enum(trackKeys),
  selectedWorkLabels: z.array(storedText(200)).min(1).max(4),
  selectedCareerLabels: z.array(storedText(200)).min(1).max(2),
  status: counselingStatusSchema,
  contactMethod: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: storedText(200).nullable(),
  consentedAt: timestampSchema,
  assignedAt: nullableTimestampSchema,
  contactedAt: nullableTimestampSchema,
  completedAt: nullableTimestampSchema,
  closedAt: nullableTimestampSchema,
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  prospect: z.object({
    nickname: storedText(128),
    schoolName: storedText(40),
    applicantStage: applicantStageSchema,
    region: regionSchema,
    nameCiphertext: z.instanceof(Uint8Array)
      .refine(value => value.byteLength >= 16 && value.byteLength <= maxApplicantNameCiphertextBytes)
      .optional(),
    nameIv: z.instanceof(Uint8Array).refine(value => value.byteLength === 12).optional(),
    phoneCiphertext: z.instanceof(Uint8Array),
    phoneIv: z.instanceof(Uint8Array),
  }).strict(),
  assignedFaculty: facultySchema.nullable(),
  recommendations: z.array(recommendationSchema).min(2).max(4),
}).strict().superRefine((request, context) => {
  if (request.primaryTrack === request.secondaryTrack) {
    context.addIssue({ code: 'custom', message: 'top tracks must differ' })
  }
  const roleRanks = new Set<string>()
  let primaries = 0
  let backups = 0
  for (const recommendation of request.recommendations) {
    const roleRank = `${recommendation.role}:${recommendation.rank}`
    if (roleRanks.has(roleRank)) context.addIssue({ code: 'custom', message: 'recommendation rank is duplicated' })
    roleRanks.add(roleRank)
    if (recommendation.role === 'primary') primaries += 1
    if (recommendation.role === 'backup') backups += 1
  }
  if (primaries !== 1 || backups !== 1) {
    context.addIssue({ code: 'custom', message: 'primary and backup recommendations are required' })
  }
  if ((request.assignedAt === null) !== (request.assignedFaculty === null)) {
    context.addIssue({ code: 'custom', message: 'assigned faculty shape is inconsistent' })
  }
  const stateShapeIsValid = request.status === 'new'
    ? request.assignedAt === null
      && request.contactedAt === null
      && request.completedAt === null
      && request.closedAt === null
    : request.status === 'assigned'
      ? request.assignedAt !== null
        && request.contactedAt === null
        && request.completedAt === null
        && request.closedAt === null
      : request.status === 'contacted'
        ? request.assignedAt !== null
          && request.contactedAt !== null
          && request.completedAt === null
          && request.closedAt === null
        : request.status === 'completed'
          ? request.assignedAt !== null
            && request.contactedAt !== null
            && request.completedAt !== null
            && request.closedAt === null
          : request.completedAt === null
            && request.closedAt !== null
            && (request.assignedAt !== null || request.contactedAt === null)
  if (!stateShapeIsValid) context.addIssue({ code: 'custom', message: 'counseling status timestamps are inconsistent' })
})

type StoredRequest = z.infer<typeof storedRequestSchema>

const mutationResultSchema = z.object({
  requestId: safeIdSchema,
  status: counselingStatusSchema,
  version: versionSchema,
  assignedFacultyId: safeIdSchema.nullable(),
  assignedAt: nullableTimestampSchema,
  contactedAt: nullableTimestampSchema,
  completedAt: nullableTimestampSchema,
  closedAt: nullableTimestampSchema,
  updatedAt: timestampSchema,
}).strict()

const reopenResultSchema = z.object({
  requestId: safeIdSchema,
  status: z.literal('new'),
  version: versionSchema,
  updatedAt: timestampSchema,
}).strict()

export type AdminCounselingListStoreInput = Omit<AdminCounselingQueueQuery, 'limit'> & { limit: number }

export type AdminCounselingServiceDependencies = {
  decryptName?: (value: { ciphertext: Uint8Array, iv: Uint8Array }) => Promise<string>
  decryptPhone: (value: { ciphertext: Uint8Array, iv: Uint8Array }) => Promise<string>
  listAssignableFaculty: () => Promise<unknown>
  listRequests: (input: AdminCounselingListStoreInput) => Promise<unknown>
  loadRequest: (input: { publicId: string }) => Promise<unknown>
  recordSensitiveAccess: (input: {
    action: 'phone_reveal' | 'summary'
    adminUserId: string
    requestId: number
    traceId: string
  }) => Promise<void>
  reopenRequest: (input: {
    adminUserId: string
    expectedVersion: number
    reason: string
    requestId: number
    traceId: string
  }) => Promise<unknown>
  transitionRequest: (input: {
    adminUserId: string
    assignedFacultyId: number | null
    expectedVersion: number
    requestId: number
    to: 'assigned' | 'contacted' | 'completed' | 'closed'
    traceId: string
  }) => Promise<unknown>
}

export type AdminCounselingActionContext = {
  adminUserId: string
  traceId: string
}

class CounselingStoreError extends Error {
  readonly code: string

  constructor(code: string) {
    super('COUNSELING_STORE_OPERATION_FAILED')
    this.name = 'CounselingStoreError'
    this.code = code
  }
}

const parseStoreValue = <Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> => {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new Error('COUNSELING_ADMIN_STORE_INVALID')
  return parsed.data
}

const loadStoredRequest = async (
  dependencies: AdminCounselingServiceDependencies,
  publicId: string,
): Promise<StoredRequest> => {
  const rawRequest = await dependencies.loadRequest({ publicId })
  if (rawRequest === null) throw new AppError('COUNSELING_NOT_FOUND')
  const request = parseStoreValue(storedRequestSchema, rawRequest)
  if (request.publicId !== publicId) throw new Error('COUNSELING_ADMIN_STORE_INVALID')
  return request
}

const toCurrent = (request: StoredRequest): AdminCounselingCurrent => adminCounselingCurrentSchema.parse({
  id: request.publicId,
  status: request.status,
  version: request.version,
  assignedAt: request.assignedAt,
  contactedAt: request.contactedAt,
  completedAt: request.completedAt,
  closedAt: request.closedAt,
  updatedAt: request.updatedAt,
  assignedFaculty: request.assignedFaculty,
})

const conflictCode = (error: unknown): boolean => {
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  return code === '40001'
    || code === 'COUNSELING_VERSION_CONFLICT'
    || code === 'COUNSELING_TRANSITION_INVALID'
    || code === 'COUNSELING_OPEN_REQUEST_EXISTS'
    || (error instanceof Error && /COUNSELING_(VERSION_CONFLICT|TRANSITION_INVALID|OPEN_REQUEST_EXISTS)/u.test(error.message))
}

const notFoundCode = (error: unknown): boolean => Boolean(
  error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P0002',
)

const invalidCode = (error: unknown): boolean => Boolean(
  error && typeof error === 'object' && 'code' in error
  && ['22023', '23514', '23503'].includes(String((error as { code?: unknown }).code)),
)

const withMutationErrorMapping = async <Value>(
  dependencies: AdminCounselingServiceDependencies,
  publicId: string,
  operation: () => Promise<Value>,
): Promise<Value> => {
  try {
    return await operation()
  }
  catch (error) {
    if (conflictCode(error)) {
      const current = await loadStoredRequest(dependencies, publicId)
      throw new CounselingConflictError(toCurrent(current))
    }
    if (notFoundCode(error)) throw new AppError('COUNSELING_NOT_FOUND')
    if (invalidCode(error)) throw new AppError('COUNSELING_INVALID')
    throw error
  }
}

const maskPhone = (phone: string): string => {
  const normalized = normalizeKoreanPhone(phone)
  return `010-****-${normalized.slice(-4)}`
}

const applicantNameSchema = storedText(100)
const unavailableApplicantName = '학생 이름 확인 필요' as const

const namePresentation = async (
  dependencies: AdminCounselingServiceDependencies,
  request: StoredRequest,
): Promise<
  | { nickname: string, nameStatus: 'available' }
  | { nickname: typeof unavailableApplicantName, nameStatus: 'verification_required' }
> => {
  const encryptedName = request.prospect.nameCiphertext && request.prospect.nameIv && dependencies.decryptName
    ? {
        ciphertext: request.prospect.nameCiphertext,
        iv: request.prospect.nameIv,
      }
    : null
  if (encryptedName !== null) {
    try {
      return {
        nickname: applicantNameSchema.parse(await dependencies.decryptName!(encryptedName)),
        nameStatus: 'available',
      }
    }
    catch {
      // A roster placeholder must never become a public display name.
    }
  }
  if (request.prospect.nickname.startsWith('roster:')) {
    return { nickname: unavailableApplicantName, nameStatus: 'verification_required' }
  }
  return {
    nickname: applicantNameSchema.parse(request.prospect.nickname),
    nameStatus: 'available',
  }
}

const phonePresentation = async (
  dependencies: AdminCounselingServiceDependencies,
  request: StoredRequest,
): Promise<
  | { maskedPhone: string, phoneStatus: 'available' }
  | { maskedPhone: null, phoneStatus: 'verification_required' }
> => {
  try {
    return {
      maskedPhone: maskPhone(await dependencies.decryptPhone({
        ciphertext: request.prospect.phoneCiphertext,
        iv: request.prospect.phoneIv,
      })),
      phoneStatus: 'available',
    }
  }
  catch {
    return { maskedPhone: null, phoneStatus: 'verification_required' }
  }
}

const publicQueueItem = async (
  dependencies: AdminCounselingServiceDependencies,
  request: StoredRequest,
) => {
  const roleOrder = { primary: 0, backup: 1, specialist: 2 } as const
  const [name, phone] = await Promise.all([
    namePresentation(dependencies, request),
    phonePresentation(dependencies, request),
  ])
  return {
    ...toCurrent(request),
    assessmentPublicId: request.assessmentPublicId,
    primaryTrack: request.primaryTrack,
    secondaryTrack: request.secondaryTrack,
    selectedWorkLabels: request.selectedWorkLabels,
    selectedCareerLabels: request.selectedCareerLabels,
    ...name,
    ...phone,
    schoolName: request.prospect.schoolName,
    applicantStage: request.prospect.applicantStage,
    region: request.prospect.region,
    contactMethod: request.contactMethod,
    availability: request.availability,
    consentedAt: request.consentedAt,
    createdAt: request.createdAt,
    recommendations: [...request.recommendations].sort((left, right) => (
      roleOrder[left.role] - roleOrder[right.role] || left.rank - right.rank
    )),
  }
}

const stageLabels = {
  high1: '고1',
  high2: '고2',
  high3: '고3',
  graduate: '고교 졸업',
  ged: '검정고시',
  other: '기타',
} as const

const regionLabels = {
  gwangju: '광주광역시',
  jeonbuk: '전북',
  capital: '수도권',
  chungcheong: '충청권',
  gyeongsang: '경상권',
  gangwon_jeju: '강원·제주',
  overseas: '해외',
  other: '기타',
} as const

const contactMethodLabels = { phone: '전화', text: '문자', visit: '방문' } as const
const availabilityLabels = {
  weekday_morning: '평일 오전',
  weekday_afternoon: '평일 오후',
  weekday_evening: '평일 저녁',
  weekend: '주말',
} as const

const recommendationLine = (request: StoredRequest, role: 'primary' | 'backup' | 'specialist'): string => {
  const recommendations = request.recommendations
    .filter(recommendation => recommendation.role === role)
    .sort((left, right) => left.rank - right.rank)
    .map(recommendation => `${recommendation.name} ${recommendation.title}`)
  return recommendations.length === 0 ? '없음' : recommendations.join(', ')
}

const buildSummary = (request: StoredRequest, nickname: string, phone: string): string => [
  `상담 학생: ${nickname}`,
  `연락처: ${phone}`,
  `학교: ${request.prospect.schoolName}`,
  `지원 단계: ${stageLabels[request.prospect.applicantStage]}`,
  `지역: ${regionLabels[request.prospect.region]}`,
  `관심 트랙: ${trackLabels[request.primaryTrack]}, ${trackLabels[request.secondaryTrack]}`,
  `선택한 활동: ${request.selectedWorkLabels.join(', ')}`,
  `선택한 진로: ${request.selectedCareerLabels.join(', ')}`,
  `상담 방법: ${contactMethodLabels[request.contactMethod]}`,
  `연락 가능 시간: ${availabilityLabels[request.availability]}`,
  `문의 내용: ${request.inquiry ?? '없음'}`,
  `추천 총괄교수: ${recommendationLine(request, 'primary')}`,
  `추천 예비교수: ${recommendationLine(request, 'backup')}`,
  `연계 전문교수: ${recommendationLine(request, 'specialist')}`,
  `실제 배정교수: ${request.assignedFaculty === null ? '미배정' : `${request.assignedFaculty.name} ${request.assignedFaculty.title}`}`,
].join('\n')

export const createAdminCounselingService = (dependencies: AdminCounselingServiceDependencies) => {
  const list = async (query: AdminCounselingQueueQuery): Promise<AdminCounselingQueue> => {
    try {
      const rawRequests = await dependencies.listRequests({ ...query, limit: query.limit + 1 })
      if (!Array.isArray(rawRequests) || rawRequests.length > query.limit + 1) {
        throw new Error('COUNSELING_ADMIN_STORE_INVALID')
      }
      const requests = rawRequests.map(value => parseStoreValue(storedRequestSchema, value))
      const hasNext = requests.length > query.limit
      const visibleRequests = hasNext ? requests.slice(0, query.limit) : requests
      const rawFaculty = await dependencies.listAssignableFaculty()
      if (!Array.isArray(rawFaculty)) throw new Error('COUNSELING_ADMIN_STORE_INVALID')
      const faculty = rawFaculty.map(value => parseStoreValue(facultySchema, value))
      const items = await Promise.all(visibleRequests.map(request => publicQueueItem(dependencies, request)))
      const last = items.at(-1)
      return adminCounselingQueueSchema.parse({
        faculty,
        items,
        nextCursor: hasNext && last ? encodeCounselingCursor({ createdAt: last.createdAt, id: visibleRequests.at(-1)!.requestId }) : null,
      })
    }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_ERROR')
    }
  }

  const mutate = async (
    publicId: string,
    input: { assignedFacultyId: number | null, expectedVersion: number, to: 'assigned' | 'contacted' | 'completed' | 'closed' },
    context: AdminCounselingActionContext,
  ): Promise<AdminCounselingCurrent> => {
    try {
      const before = await loadStoredRequest(dependencies, publicId)
      await withMutationErrorMapping(dependencies, publicId, async () => {
        const result = parseStoreValue(mutationResultSchema, await dependencies.transitionRequest({
          adminUserId: context.adminUserId,
          assignedFacultyId: input.assignedFacultyId,
          expectedVersion: input.expectedVersion,
          requestId: before.requestId,
          to: input.to,
          traceId: context.traceId,
        }))
        if (result.requestId !== before.requestId || result.status !== input.to) {
          throw new Error('COUNSELING_ADMIN_RPC_INVALID')
        }
      })
      return toCurrent(await loadStoredRequest(dependencies, publicId))
    }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_ERROR')
    }
  }

  const reopen = async (
    publicId: string,
    input: { expectedVersion: number, reason: string },
    context: AdminCounselingActionContext,
  ): Promise<AdminCounselingCurrent> => {
    try {
      const before = await loadStoredRequest(dependencies, publicId)
      await withMutationErrorMapping(dependencies, publicId, async () => {
        const result = parseStoreValue(reopenResultSchema, await dependencies.reopenRequest({
          adminUserId: context.adminUserId,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          requestId: before.requestId,
          traceId: context.traceId,
        }))
        if (result.requestId !== before.requestId) throw new Error('COUNSELING_ADMIN_RPC_INVALID')
      })
      return toCurrent(await loadStoredRequest(dependencies, publicId))
    }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_ERROR')
    }
  }

  const reveal = async (publicId: string, context: AdminCounselingActionContext): Promise<string> => {
    try {
      const request = await loadStoredRequest(dependencies, publicId)
      const phone = normalizeKoreanPhone(await dependencies.decryptPhone({
        ciphertext: request.prospect.phoneCiphertext,
        iv: request.prospect.phoneIv,
      }))
      await dependencies.recordSensitiveAccess({
        action: 'phone_reveal',
        adminUserId: context.adminUserId,
        requestId: request.requestId,
        traceId: context.traceId,
      })
      return phone
    }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_ERROR')
    }
  }

  const summary = async (publicId: string, context: AdminCounselingActionContext): Promise<string> => {
    try {
      const request = await loadStoredRequest(dependencies, publicId)
      const [name, phone] = await Promise.all([
        namePresentation(dependencies, request),
        dependencies.decryptPhone({
          ciphertext: request.prospect.phoneCiphertext,
          iv: request.prospect.phoneIv,
        }).then(normalizeKoreanPhone),
      ])
      const text = buildSummary(request, name.nickname, phone)
      await dependencies.recordSensitiveAccess({
        action: 'summary',
        adminUserId: context.adminUserId,
        requestId: request.requestId,
        traceId: context.traceId,
      })
      return text
    }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_ERROR')
    }
  }

  return {
    assign: (publicId: string, input: { assignedFacultyId: number, expectedVersion: number }, context: AdminCounselingActionContext) => (
      mutate(publicId, { ...input, to: 'assigned' }, context)
    ),
    list,
    reopen,
    revealPhone: reveal,
    summary,
    transition: (publicId: string, input: { expectedVersion: number, to: 'contacted' | 'completed' | 'closed' }, context: AdminCounselingActionContext) => (
      mutate(publicId, { ...input, assignedFacultyId: null }, context)
    ),
  }
}

const rawFacultySchema = z.object({
  id: safeIdSchema,
  name: storedText(100),
  title: storedText(100),
}).strict()

const rawRecommendationSchema = z.object({
  faculty_id: safeIdSchema,
  faculty_name_snapshot: storedText(100),
  faculty_title_snapshot: storedText(100),
  role: z.enum(['primary', 'backup', 'specialist']),
  rank: z.number().int().min(1).max(2),
}).strict()

const postgresByteaSchema = z.string().regex(/^\\x[0-9a-f]+$/u)
const rawRequestSchema = z.object({
  id: safeIdSchema,
  public_id: canonicalUuidSchema,
  prospect_id: safeIdSchema,
  assessment_public_id_snapshot: canonicalUuidSchema,
  campaign_id_snapshot: safeIdSchema.nullable(),
  primary_track_snapshot: z.enum(trackKeys),
  secondary_track_snapshot: z.enum(trackKeys),
  selected_work_labels_snapshot: z.array(storedText(200)).min(1).max(4),
  selected_career_labels_snapshot: z.array(storedText(200)).min(1).max(2),
  status: counselingStatusSchema,
  contact_method: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: storedText(200).nullable(),
  consented_at: timestampSchema,
  assigned_at: nullableTimestampSchema,
  contacted_at: nullableTimestampSchema,
  completed_at: nullableTimestampSchema,
  closed_at: nullableTimestampSchema,
  version: versionSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  prospect: z.object({
    nickname: storedText(128),
    school_name: storedText(40),
    applicant_stage: applicantStageSchema,
    region: regionSchema,
    name_ciphertext: postgresByteaSchema.nullish(),
    name_iv: postgresByteaSchema.nullish(),
    phone_ciphertext: postgresByteaSchema,
    phone_iv: postgresByteaSchema,
  }).strict(),
  assigned_faculty: rawFacultySchema.nullable(),
  recommendations: z.array(rawRecommendationSchema).min(2).max(4),
}).strict()

const rawMutationSchema = z.object({
  counseling_request_id: safeIdSchema,
  status: counselingStatusSchema,
  version: versionSchema,
  assigned_faculty_id: safeIdSchema.nullable(),
  assigned_at: nullableTimestampSchema,
  contacted_at: nullableTimestampSchema,
  completed_at: nullableTimestampSchema,
  closed_at: nullableTimestampSchema,
  updated_at: timestampSchema,
}).strict()

const rawReopenSchema = z.object({
  counseling_request_id: safeIdSchema,
  status: z.literal('new'),
  version: versionSchema,
  updated_at: timestampSchema,
}).strict()

const requestSelection = `
  id,
  public_id,
  prospect_id,
  assessment_public_id_snapshot,
  campaign_id_snapshot,
  primary_track_snapshot,
  secondary_track_snapshot,
  selected_work_labels_snapshot,
  selected_career_labels_snapshot,
  status,
  contact_method,
  availability,
  inquiry,
  consented_at,
  assigned_at,
  contacted_at,
  completed_at,
  closed_at,
  version,
  created_at,
  updated_at,
  prospect:prospects!inner(nickname,name_ciphertext,name_iv,school_name,applicant_stage,region,phone_ciphertext,phone_iv),
  assigned_faculty:faculty!counseling_requests_assigned_faculty_fk(id,name,title),
  recommendations:counseling_faculty_recommendations(
    faculty_id,
    faculty_name_snapshot,
    faculty_title_snapshot,
    role,
    rank
  )
`

export const decodeAdminCounselingRow = (input: unknown): StoredRequest => {
  const row = parseStoreValue(rawRequestSchema, input)
  return parseStoreValue(storedRequestSchema, {
    requestId: row.id,
    publicId: row.public_id,
    prospectId: row.prospect_id,
    assessmentPublicId: row.assessment_public_id_snapshot,
    campaignId: row.campaign_id_snapshot,
    primaryTrack: row.primary_track_snapshot,
    secondaryTrack: row.secondary_track_snapshot,
    selectedWorkLabels: row.selected_work_labels_snapshot,
    selectedCareerLabels: row.selected_career_labels_snapshot,
    status: row.status,
    contactMethod: row.contact_method,
    availability: row.availability,
    inquiry: row.inquiry,
    consentedAt: row.consented_at,
    assignedAt: row.assigned_at,
    contactedAt: row.contacted_at,
    completedAt: row.completed_at,
    closedAt: row.closed_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    prospect: {
      nickname: row.prospect.nickname,
      schoolName: row.prospect.school_name,
      applicantStage: row.prospect.applicant_stage,
      region: row.prospect.region,
      ...(row.prospect.name_ciphertext === null || row.prospect.name_ciphertext === undefined
        ? {}
        : { nameCiphertext: bytesFromPostgresBytea(row.prospect.name_ciphertext) }),
      ...(row.prospect.name_iv === null || row.prospect.name_iv === undefined
        ? {}
        : { nameIv: bytesFromPostgresBytea(row.prospect.name_iv) }),
      phoneCiphertext: bytesFromPostgresBytea(row.prospect.phone_ciphertext),
      phoneIv: bytesFromPostgresBytea(row.prospect.phone_iv),
    },
    assignedFaculty: row.assigned_faculty,
    recommendations: row.recommendations.map(recommendation => ({
      id: recommendation.faculty_id,
      name: recommendation.faculty_name_snapshot,
      title: recommendation.faculty_title_snapshot,
      role: recommendation.role,
      rank: recommendation.rank,
    })),
  })
}

const throwStoreError = (error: { code?: string, message?: string } | null): never => {
  const semanticConflicts = ['COUNSELING_TRANSITION_INVALID', 'COUNSELING_OPEN_REQUEST_EXISTS']
  const code = error?.code === 'P0001' && semanticConflicts.includes(error.message ?? '')
    ? error.message!
    : error?.code ?? 'UNKNOWN'
  throw new CounselingStoreError(code)
}

export const createSupabaseAdminCounselingDependencies = (
  client: SupabaseClient,
  decrypt: AdminCounselingServiceDependencies['decryptPhone'],
  decryptName?: NonNullable<AdminCounselingServiceDependencies['decryptName']>,
): AdminCounselingServiceDependencies => ({
  ...(decryptName === undefined ? {} : { decryptName }),
  decryptPhone: decrypt,
  listAssignableFaculty: async () => {
    const { data, error } = await client.from('faculty')
      .select('id,name,title')
      .eq('status', 'active')
      .order('priority', { ascending: false })
      .order('id', { ascending: true })
      .limit(100)
    if (error) throwStoreError(error)
    return (data ?? []).map(row => parseStoreValue(rawFacultySchema, row))
  },
  listRequests: async (input) => {
    let query = client.from('counseling_requests').select(requestSelection)
    if (input.status !== undefined) query = query.eq('status', input.status)
    if (input.primaryTrack !== undefined) query = query.eq('primary_track_snapshot', input.primaryTrack)
    if (input.assignedFacultyId !== undefined) query = query.eq('assigned_faculty_id', input.assignedFacultyId)
    if (input.createdFrom !== undefined) query = query.gte('created_at', input.createdFrom)
    if (input.createdTo !== undefined) query = query.lte('created_at', input.createdTo)
    if (input.cursor !== undefined) {
      query = query.or(`created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`)
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.limit)
    if (error) throwStoreError(error)
    return (data ?? []).map(decodeAdminCounselingRow)
  },
  loadRequest: async ({ publicId }) => {
    const { data, error } = await client.from('counseling_requests')
      .select(requestSelection)
      .eq('public_id', publicId)
      .maybeSingle()
    if (error) throwStoreError(error)
    return data === null ? null : decodeAdminCounselingRow(data)
  },
  recordSensitiveAccess: async input => {
    const { data, error } = await client.rpc('record_counseling_sensitive_access', {
      p_action: input.action,
      p_admin_user_id: input.adminUserId,
      p_audit_request_id: input.traceId,
      p_request_id: input.requestId,
    })
    if (error) throwStoreError(error)
    if (data !== true) throw new Error('COUNSELING_ADMIN_RPC_INVALID')
  },
  reopenRequest: async input => {
    const { data, error } = await client.rpc('reopen_counseling_request', {
      p_admin_user_id: input.adminUserId,
      p_audit_request_id: input.traceId,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
      p_request_id: input.requestId,
    })
    if (error) throwStoreError(error)
    if (!Array.isArray(data) || data.length !== 1) throw new Error('COUNSELING_ADMIN_RPC_INVALID')
    const row = parseStoreValue(rawReopenSchema, data[0])
    return {
      requestId: row.counseling_request_id,
      status: row.status,
      version: row.version,
      updatedAt: row.updated_at,
    }
  },
  transitionRequest: async input => {
    const { data, error } = await client.rpc('admin_transition_counseling_request', {
      p_admin_user_id: input.adminUserId,
      p_assigned_faculty_id: input.assignedFacultyId,
      p_audit_request_id: input.traceId,
      p_expected_version: input.expectedVersion,
      p_request_id: input.requestId,
      p_to_status: input.to,
    })
    if (error) throwStoreError(error)
    if (!Array.isArray(data) || data.length !== 1) throw new Error('COUNSELING_ADMIN_RPC_INVALID')
    const row = parseStoreValue(rawMutationSchema, data[0])
    return {
      requestId: row.counseling_request_id,
      status: row.status,
      version: row.version,
      assignedFacultyId: row.assigned_faculty_id,
      assignedAt: row.assigned_at,
      contactedAt: row.contacted_at,
      completedAt: row.completed_at,
      closedAt: row.closed_at,
      updatedAt: row.updated_at,
    }
  },
})

export const getServerAdminCounselingService = () => {
  const runtimeConfig = useRuntimeConfig()
  const encryptionKey = decodeBase64urlSecret(runtimeConfig.phoneEncryptionKey)
  return createAdminCounselingService(createSupabaseAdminCounselingDependencies(
    getServerSupabaseClient(),
    value => revealPhone(value, encryptionKey),
    value => revealApplicantName(value, encryptionKey),
  ))
}
