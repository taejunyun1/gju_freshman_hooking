import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { applicantStageSchema, regionSchema } from '../../../shared/schemas/identity'
import {
  counselingAvailabilitySchema,
  counselingContactMethodSchema,
  counselingStatusSchema,
} from '../../../shared/schemas/counseling'
import { trackKeys } from '../../../shared/types/domain'
import { AppError } from '../../utils/app-error'
import { bytesFromPostgresBytea, postgresByteaFromBytes } from '../../utils/postgres-bytea'
import { getServerSupabaseClient } from '../../utils/supabase'
import {
  base64urlEncode,
  decodeBase64urlSecret,
  hmacSha256,
  utf8,
} from '../../utils/web-crypto'
import { normalizeKoreanPhone, revealPhone } from '../identity/phone'

const safeIdSchema = z.number().int().positive().safe()
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const storedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim(), 'stored text must be trimmed')
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }), 'stored text cannot contain control characters')

const cursorPayloadSchema = z.object({
  lastActiveAt: timestampSchema,
  id: safeIdSchema,
}).strict()

export type AdminStudentsCursor = z.infer<typeof cursorPayloadSchema>

const decodeBase64urlText = (encoded: string): string => {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length > 200 || encoded.length % 4 === 1) {
    throw new Error('ADMIN_STUDENT_CURSOR_INVALID')
  }
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/')
    + '='.repeat((4 - encoded.length % 4) % 4)
  try {
    const binary = atob(padded)
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, character => character.charCodeAt(0)),
    )
  }
  catch {
    throw new Error('ADMIN_STUDENT_CURSOR_INVALID')
  }
}

export const encodeAdminStudentsCursor = (rawCursor: AdminStudentsCursor): string => {
  const cursor = cursorPayloadSchema.parse(rawCursor)
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(cursor)))
}

const decodeAdminStudentsCursor = (encoded: string): AdminStudentsCursor => {
  let raw: unknown
  try {
    raw = JSON.parse(decodeBase64urlText(encoded)) as unknown
  }
  catch {
    throw new Error('ADMIN_STUDENT_CURSOR_INVALID')
  }
  const parsed = cursorPayloadSchema.safeParse(raw)
  if (!parsed.success || encodeAdminStudentsCursor(parsed.data) !== encoded) {
    throw new Error('ADMIN_STUDENT_CURSOR_INVALID')
  }
  return parsed.data
}

const noControlText = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }), 'control characters are not allowed')

const positiveIntegerString = z.string().regex(/^[1-9][0-9]{0,15}$/u)
  .transform((value, context) => {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) {
      context.addIssue({ code: 'custom', message: 'integer exceeds safe range' })
      return z.NEVER
    }
    return parsed
  })

const listLimitSchema = z.string().regex(/^[1-9][0-9]?$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(50))

const rawListQuerySchema = z.object({
  campaign: positiveIntegerString.optional(),
  counselingStatus: counselingStatusSchema.optional(),
  cursor: z.string().min(1).max(200).transform((value, context) => {
    try {
      return decodeAdminStudentsCursor(value)
    }
    catch {
      context.addIssue({ code: 'custom', message: 'invalid cursor' })
      return z.NEVER
    }
  }).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  limit: listLimitSchema.default(20),
  query: noControlText(100).optional(),
  region: regionSchema.optional(),
  school: noControlText(40).optional(),
  stage: applicantStageSchema.optional(),
  track: z.enum(trackKeys).optional(),
}).strict().superRefine((query, context) => {
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'date bounds are reversed' })
  }
})

export type AdminStudentsListInput = {
  campaignId?: number
  counselingStatus?: z.infer<typeof counselingStatusSchema>
  cursor?: AdminStudentsCursor
  dateFrom?: string
  dateTo?: string
  limit: number
  query?: string
  region?: z.infer<typeof regionSchema>
  school?: string
  stage?: z.infer<typeof applicantStageSchema>
  track?: typeof trackKeys[number]
}

export const parseAdminStudentsListQuery = (input: unknown): AdminStudentsListInput => {
  const parsed = rawListQuerySchema.safeParse(input)
  if (!parsed.success) throw new AppError('STUDENT_INVALID')
  const { campaign, ...query } = parsed.data
  return { ...query, ...(campaign === undefined ? {} : { campaignId: campaign }) }
}

export const parseAdminStudentId = (input: string | undefined): number => {
  const parsed = positiveIntegerString.safeParse(input)
  if (!parsed.success) throw new AppError('VALIDATION_FAILED')
  return parsed.data
}

const rawStudentRowSchema = z.object({
  id: safeIdSchema,
  nickname: storedText(100),
  phone_ciphertext: z.string().min(1).max(260),
  phone_iv: z.string().min(1).max(64),
  school_name: storedText(40),
  applicant_stage: applicantStageSchema,
  region: regionSchema,
  status: z.enum(['active', 'deleted']),
  last_active_at: timestampSchema,
  created_at: timestampSchema,
}).strict()

const storedStudentSchema = z.object({
  studentId: safeIdSchema,
  nickname: storedText(100),
  phoneCiphertext: z.instanceof(Uint8Array).refine(value => value.byteLength >= 16 && value.byteLength <= 128),
  phoneIv: z.instanceof(Uint8Array).refine(value => value.byteLength === 12),
  schoolName: storedText(40),
  applicantStage: applicantStageSchema,
  region: regionSchema,
  status: z.enum(['active', 'deleted']),
  lastActiveAt: timestampSchema,
  createdAt: timestampSchema,
}).strict()

export type StoredAdminStudent = z.infer<typeof storedStudentSchema>

export const decodeAdminStudentRow = (input: unknown): StoredAdminStudent => {
  try {
    const row = rawStudentRowSchema.parse(input)
    return storedStudentSchema.parse({
      studentId: row.id,
      nickname: row.nickname,
      phoneCiphertext: bytesFromPostgresBytea(row.phone_ciphertext),
      phoneIv: bytesFromPostgresBytea(row.phone_iv),
      schoolName: row.school_name,
      applicantStage: row.applicant_stage,
      region: row.region,
      status: row.status,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
    })
  }
  catch {
    throw new Error('ADMIN_STUDENT_STORE_INVALID')
  }
}

const trackScoresSchema = z.object({
  documentary: z.number().finite().min(0).max(100),
  art_photo: z.number().finite().min(0).max(100),
  commercial: z.number().finite().min(0).max(100),
  video: z.number().finite().min(0).max(100),
}).strict()

const storedResultSchema = z.object({
  publicId: z.string().uuid(),
  completedAt: timestampSchema,
  campaignId: safeIdSchema.nullable(),
  primaryTrack: z.enum(trackKeys),
  secondaryTrack: z.enum(trackKeys),
  trackScores: trackScoresSchema,
}).strict().refine(result => result.primaryTrack !== result.secondaryTrack)

export type StoredAdminStudentResult = z.infer<typeof storedResultSchema>

const assignedFacultySchema = z.object({
  id: safeIdSchema,
  name: storedText(100),
  title: storedText(100),
}).strict()

const storedCounselingSchema = z.object({
  publicId: z.string().uuid(),
  status: counselingStatusSchema,
  contactMethod: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: storedText(200).nullable(),
  assignedFaculty: assignedFacultySchema.nullable(),
  createdAt: timestampSchema,
}).strict()

export type StoredAdminStudentCounseling = z.infer<typeof storedCounselingSchema>

type StoreListInput = Omit<AdminStudentsListInput, 'limit'> & {
  phoneHmac?: Uint8Array
  limit: number
}

export type AdminStudentsServiceDependencies = {
  decryptPhone: (value: { ciphertext: Uint8Array, iv: Uint8Array }) => Promise<string>
  hashPhone: (phone: string) => Promise<Uint8Array>
  listStudents: (input: StoreListInput) => Promise<StoredAdminStudent[]>
  loadStudent: (input: { studentId: number }) => Promise<StoredAdminStudent | null>
  listRecentResults: (input: { studentId: number, limit: number }) => Promise<StoredAdminStudentResult[]>
  listCounselingHistory: (input: { studentId: number }) => Promise<StoredAdminStudentCounseling[]>
  recordSensitiveAccess: (input: {
    action: 'admin_phone_revealed'
    adminUserId: string
    studentId: number
    traceId: string
  }) => Promise<void>
}

const maskPhone = (phone: string): string => {
  const normalized = normalizeKoreanPhone(phone)
  return `010-****-${normalized.slice(-4)}`
}

const toPublicStudent = async (
  dependencies: AdminStudentsServiceDependencies,
  student: StoredAdminStudent,
) => ({
  id: student.studentId,
  nickname: student.nickname,
  phone: maskPhone(await dependencies.decryptPhone({
    ciphertext: student.phoneCiphertext,
    iv: student.phoneIv,
  })),
  schoolName: student.schoolName,
  applicantStage: student.applicantStage,
  region: student.region,
  status: student.status,
  lastActiveAt: student.lastActiveAt,
  createdAt: student.createdAt,
})

const loadActiveStudent = async (
  dependencies: AdminStudentsServiceDependencies,
  studentId: number,
): Promise<StoredAdminStudent> => {
  const rawStudent = await dependencies.loadStudent({ studentId })
  const parsed = storedStudentSchema.safeParse(rawStudent)
  if (!parsed.success || parsed.data.status !== 'active' || parsed.data.studentId !== studentId) {
    if (rawStudent === null || parsed.success) throw new AppError('STUDENT_NOT_FOUND')
    throw new Error('ADMIN_STUDENT_STORE_INVALID')
  }
  return parsed.data
}

const normalizedPhoneOrNull = (value: string | undefined): string | null => {
  if (value === undefined) return null
  try {
    return normalizeKoreanPhone(value)
  }
  catch {
    return null
  }
}

export const createAdminStudentsService = (dependencies: AdminStudentsServiceDependencies) => ({
  list: async (input: AdminStudentsListInput) => {
    const phone = normalizedPhoneOrNull(input.query)
    const { limit, query, ...filters } = input
    const storeInput: StoreListInput = {
      ...filters,
      limit: limit + 1,
      ...(phone === null
        ? (query === undefined ? {} : { query })
        : { phoneHmac: await dependencies.hashPhone(phone) }),
    }
    const stored = await dependencies.listStudents(storeInput)
    if (!Array.isArray(stored) || stored.length > limit + 1) throw new Error('ADMIN_STUDENT_STORE_INVALID')
    const page = stored.slice(0, limit).map((student) => {
      const parsed = storedStudentSchema.safeParse(student)
      if (!parsed.success || parsed.data.status !== 'active') throw new Error('ADMIN_STUDENT_STORE_INVALID')
      return parsed.data
    })
    const items = await Promise.all(page.map(student => toPublicStudent(dependencies, student)))
    const boundary = stored.length > limit ? page.at(-1) : undefined
    return {
      items,
      nextCursor: boundary
        ? encodeAdminStudentsCursor({ lastActiveAt: boundary.lastActiveAt, id: boundary.studentId })
        : null,
    }
  },
  detail: async (studentId: number) => {
    const student = await loadActiveStudent(dependencies, studentId)
    const [publicStudent, recentResults, counseling] = await Promise.all([
      toPublicStudent(dependencies, student),
      dependencies.listRecentResults({ studentId, limit: 3 }),
      dependencies.listCounselingHistory({ studentId }),
    ])
    return {
      student: publicStudent,
      recentResults: z.array(storedResultSchema).max(3).parse(recentResults).map(result => ({
        id: result.publicId,
        completedAt: result.completedAt,
        campaignId: result.campaignId,
        primaryTrack: result.primaryTrack,
        secondaryTrack: result.secondaryTrack,
        trackScores: result.trackScores,
      })),
      counseling: z.array(storedCounselingSchema).max(100).parse(counseling).map(item => ({
        id: item.publicId,
        status: item.status,
        contactMethod: item.contactMethod,
        availability: item.availability,
        inquiry: item.inquiry,
        assignedFaculty: item.assignedFaculty,
        createdAt: item.createdAt,
      })),
    }
  },
  revealPhone: async (studentId: number, context: { adminUserId: string, traceId: string }) => {
    const student = await loadActiveStudent(dependencies, studentId)
    const phone = normalizeKoreanPhone(await dependencies.decryptPhone({
      ciphertext: student.phoneCiphertext,
      iv: student.phoneIv,
    }))
    await dependencies.recordSensitiveAccess({
      action: 'admin_phone_revealed',
      adminUserId: context.adminUserId,
      studentId,
      traceId: context.traceId,
    })
    return phone
  },
})

const studentSelection = `
  id,
  nickname,
  phone_ciphertext,
  phone_iv,
  school_name,
  applicant_stage,
  region,
  status,
  last_active_at,
  created_at
`

const escapeLikePattern = (value: string): string => value
  .replaceAll('\\', '\\\\')
  .replaceAll('%', '\\%')
  .replaceAll('_', '\\_')

const quotePostgrestValue = (value: string): string => (
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
)

const kstDayStart = (date: string): string => new Date(`${date}T00:00:00.000+09:00`).toISOString()

const nextKstDayStart = (date: string): string => new Date(
  new Date(`${date}T00:00:00.000+09:00`).getTime() + 24 * 60 * 60 * 1000,
).toISOString()

const rawStoredResultSchema = z.object({
  public_id: z.string().uuid(),
  completed_at: timestampSchema,
  campaign_id: safeIdSchema.nullable(),
  primary_track: z.enum(trackKeys),
  secondary_track: z.enum(trackKeys),
  track_scores: trackScoresSchema,
}).strict()

const rawAssignedFacultySchema = z.object({
  id: safeIdSchema,
  name: storedText(100),
  title: storedText(100),
}).strict()

const rawStoredCounselingSchema = z.object({
  public_id: z.string().uuid(),
  status: counselingStatusSchema,
  contact_method: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: storedText(200).nullable(),
  assigned_faculty: rawAssignedFacultySchema.nullable(),
  created_at: timestampSchema,
}).strict()

const throwStoreError = (error: { code?: string } | null): never => {
  const storeError = new Error('ADMIN_STUDENT_STORE_OPERATION_FAILED') as Error & { code?: string }
  storeError.code = error?.code
  throw storeError
}

export const createSupabaseAdminStudentsDependencies = (
  client: SupabaseClient,
  cryptoDependencies: Pick<AdminStudentsServiceDependencies, 'decryptPhone' | 'hashPhone'>,
): AdminStudentsServiceDependencies => ({
  ...cryptoDependencies,
  listStudents: async (input) => {
    const assessmentFilter = input.track !== undefined
      || input.campaignId !== undefined
      || input.dateFrom !== undefined
      || input.dateTo !== undefined
    const counselingFilter = input.counselingStatus !== undefined
    const selection = [
      studentSelection,
      ...(assessmentFilter ? ['assessments!inner()'] : []),
      ...(counselingFilter ? ['counseling_requests!inner()'] : []),
    ].join(',')
    let query = client.from('prospects').select(selection).eq('status', 'active')
    if (input.stage !== undefined) query = query.eq('applicant_stage', input.stage)
    if (input.region !== undefined) query = query.eq('region', input.region)
    if (input.phoneHmac !== undefined) query = query.eq('phone_hmac', postgresByteaFromBytes(input.phoneHmac))
    if (input.query !== undefined) {
      const pattern = `%${escapeLikePattern(input.query)}%`
      const quotedPattern = quotePostgrestValue(pattern)
      query = query.or(`nickname.ilike.${quotedPattern},school_name.ilike.${quotedPattern}`)
    }
    if (input.school !== undefined) query = query.ilike('school_name', `%${escapeLikePattern(input.school)}%`)
    if (input.track !== undefined) query = query.eq('assessments.result_snapshot->rankedTracks->>0', input.track)
    if (input.campaignId !== undefined) query = query.eq('assessments.campaign_id', input.campaignId)
    if (assessmentFilter) query = query.eq('assessments.status', 'completed')
    if (input.dateFrom !== undefined) query = query.gte('assessments.completed_at', kstDayStart(input.dateFrom))
    if (input.dateTo !== undefined) query = query.lt('assessments.completed_at', nextKstDayStart(input.dateTo))
    if (input.counselingStatus !== undefined) query = query.eq('counseling_requests.status', input.counselingStatus)
    if (input.cursor !== undefined) {
      query = query.or(
        `last_active_at.lt.${input.cursor.lastActiveAt},and(last_active_at.eq.${input.cursor.lastActiveAt},id.lt.${input.cursor.id})`,
      )
    }
    const { data, error } = await query
      .order('last_active_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.limit)
    if (error) throwStoreError(error)
    return (data ?? []).map(decodeAdminStudentRow)
  },
  loadStudent: async ({ studentId }) => {
    const { data, error } = await client.from('prospects')
      .select(studentSelection)
      .eq('id', studentId)
      .eq('status', 'active')
      .maybeSingle()
    if (error) throwStoreError(error)
    return data === null ? null : decodeAdminStudentRow(data)
  },
  listRecentResults: async ({ studentId, limit }) => {
    const { data, error } = await client.from('assessments')
      .select(`
        public_id,
        completed_at,
        campaign_id,
        primary_track:result_snapshot->rankedTracks->>0,
        secondary_track:result_snapshot->rankedTracks->>1,
        track_scores
      `)
      .eq('prospect_id', studentId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 3))
    if (error) throwStoreError(error)
    return (data ?? []).map((input) => {
      const row = rawStoredResultSchema.parse(input)
      return storedResultSchema.parse({
        publicId: row.public_id,
        completedAt: row.completed_at,
        campaignId: row.campaign_id,
        primaryTrack: row.primary_track,
        secondaryTrack: row.secondary_track,
        trackScores: row.track_scores,
      })
    })
  },
  listCounselingHistory: async ({ studentId }) => {
    const { data, error } = await client.from('counseling_requests')
      .select(`
        public_id,
        status,
        contact_method,
        availability,
        inquiry,
        created_at,
        assigned_faculty:faculty!counseling_requests_assigned_faculty_fk(id,name,title)
      `)
      .eq('prospect_id', studentId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100)
    if (error) throwStoreError(error)
    return (data ?? []).map((input) => {
      const row = rawStoredCounselingSchema.parse(input)
      return storedCounselingSchema.parse({
        publicId: row.public_id,
        status: row.status,
        contactMethod: row.contact_method,
        availability: row.availability,
        inquiry: row.inquiry,
        assignedFaculty: row.assigned_faculty,
        createdAt: row.created_at,
      })
    })
  },
  recordSensitiveAccess: async (input) => {
    const { data, error } = await client.rpc('record_student_sensitive_access', {
      p_action: input.action,
      p_admin_user_id: input.adminUserId,
      p_audit_request_id: input.traceId,
      p_student_id: input.studentId,
    })
    if (error) throwStoreError(error)
    if (data !== true) throw new Error('ADMIN_STUDENT_AUDIT_INVALID')
  },
})

export const getServerAdminStudentsService = () => {
  const runtimeConfig = useRuntimeConfig()
  const encryptionKey = decodeBase64urlSecret(runtimeConfig.phoneEncryptionKey)
  const hmacKey = decodeBase64urlSecret(runtimeConfig.phoneHmacKey)
  return createAdminStudentsService(createSupabaseAdminStudentsDependencies(
    getServerSupabaseClient(),
    {
      decryptPhone: value => revealPhone(value, encryptionKey),
      hashPhone: phone => hmacSha256(utf8(normalizeKoreanPhone(phone)), hmacKey),
    },
  ))
}
