import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  adminExportAssessmentSchema,
  adminExportCompletionSchema,
  adminExportCompletedJobSchema,
  adminExportCounselingSchema,
  adminExportCreateRequestSchema,
  adminExportFilterSchema,
  adminExportFailureCodeSchema,
  adminExportJobSchema,
  adminExportDownloadedJobSchema,
  adminExportStudentSchema,
  type AdminExportAssessment,
  type AdminExportCompletion,
  type AdminExportCounseling,
  type AdminExportFilter,
  type AdminExportStudent,
  type AdminExportFailureCode,
} from '../../../shared/schemas/admin-export'
import { decodeResultSnapshot } from '../../../shared/schemas/result'
import { AppError } from '../../utils/app-error'
import { bytesFromPostgresBytea } from '../../utils/postgres-bytea'
import { base64urlEncode, decodeBase64urlSecret } from '../../utils/web-crypto'
import { getServerSupabaseClient } from '../../utils/supabase'
import { normalizeKoreanPhone, revealPhone } from '../identity/phone'

const PAGE_SIZE = 1_000 as const
const ROW_LIMIT = 30_000
const safeIdSchema = z.number().int().positive().safe()
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const cursorSchema = z.object({ createdAt: timestampSchema, id: safeIdSchema }).strict()
export type AdminExportCursor = z.infer<typeof cursorSchema>

const decodeBase64url = (value: string): string => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length > 200 || value.length % 4 === 1) {
    throw new AppError('EXPORT_INVALID')
  }
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(padded), character => character.charCodeAt(0)),
    )
  }
  catch {
    throw new AppError('EXPORT_INVALID')
  }
}

export const encodeExportCursor = (cursor: AdminExportCursor): string => (
  base64urlEncode(new TextEncoder().encode(JSON.stringify(cursorSchema.parse(cursor))))
)

export const decodeExportCursor = (value: string): AdminExportCursor => {
  try {
    const parsed = cursorSchema.parse(JSON.parse(decodeBase64url(value)) as unknown)
    if (encodeExportCursor(parsed) !== value) throw new Error('NON_CANONICAL')
    return parsed
  }
  catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('EXPORT_INVALID')
  }
}

const parseJsonBody = (contentType: string | undefined, rawBody: string | undefined): unknown => {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    || rawBody === undefined || new TextEncoder().encode(rawBody).byteLength > 4_096) {
    throw new AppError('EXPORT_INVALID')
  }
  try { return JSON.parse(rawBody) as unknown }
  catch { throw new AppError('EXPORT_INVALID') }
}

export const parseExportCreateBody = async (
  contentType: string | undefined,
  rawBody: string | undefined,
): Promise<AdminExportFilter> => {
  const parsed = adminExportCreateRequestSchema.safeParse(parseJsonBody(contentType, rawBody))
  if (!parsed.success) throw new AppError('EXPORT_INVALID')
  return parsed.data.filters
}

export const parseExportCompletionBody = async (
  contentType: string | undefined,
  rawBody: string | undefined,
): Promise<AdminExportCompletion> => {
  const parsed = adminExportCompletionSchema.safeParse(parseJsonBody(contentType, rawBody))
  if (!parsed.success) throw new AppError('EXPORT_INVALID')
  return parsed.data
}

export const parseExportJobId = (value: string | undefined): number => {
  const parsed = z.string().regex(/^[1-9][0-9]{0,15}$/u).transform(Number).pipe(safeIdSchema).safeParse(value)
  if (!parsed.success) throw new AppError('EXPORT_INVALID')
  return parsed.data
}

export const parseExportPageQuery = (value: unknown): AdminExportCursor | undefined => {
  const parsed = z.object({ cursor: z.string().min(1).max(200).optional() }).strict().safeParse(value)
  if (!parsed.success) throw new AppError('EXPORT_INVALID')
  return parsed.data.cursor === undefined ? undefined : decodeExportCursor(parsed.data.cursor)
}

export type StoredExportJob = {
  id: number
  createdByAdminId: string
  filterSnapshot: AdminExportFilter
  status: 'created' | 'fetching' | 'completed' | 'failed'
  studentRowCount: number
  participationRowCount: number
  counselingRowCount: number
  errorCode: AdminExportFailureCode | null
  createdAt: string
  completedAt: string | null
  downloadedAt: string | null
}

type ExportRow<Item> = { cursor: AdminExportCursor, item: Item }
type PageInput = {
  adminUserId: string
  cutoff: string
  cursor?: AdminExportCursor
  filters: AdminExportFilter
  jobId: number
  limit: typeof PAGE_SIZE
}

export type AdminExportDependencies = {
  countRows: (filters: AdminExportFilter, context: {
    adminUserId: string, cutoff: string, jobId: number
  }) => Promise<{
    students: number, assessments: number, counseling: number
  }>
  createJob: (input: { adminUserId: string, filterSnapshot: AdminExportFilter }) => Promise<StoredExportJob>
  recordExportAudit: (input: {
    adminUserId: string, filterSnapshot: AdminExportFilter, jobId: number, traceId: string
  }) => Promise<void>
  failJob: (input: { adminUserId: string, errorCode: AdminExportFailureCode, jobId: number }) => Promise<boolean>
  loadOwnedJob: (input: { adminUserId: string, jobId: number }) => Promise<StoredExportJob | null>
  beginJob: (input: { adminUserId: string, jobId: number }) => Promise<boolean>
  listStudents: (input: PageInput) => Promise<ExportRow<AdminExportStudent>[]>
  listAssessments: (input: PageInput) => Promise<ExportRow<AdminExportAssessment>[]>
  listCounseling: (input: PageInput) => Promise<ExportRow<AdminExportCounseling>[]>
  completeJob: (input: {
    adminUserId: string, completion: AdminExportCompletion, jobId: number
  }) => Promise<StoredExportJob | null>
  acknowledgeDownload: (input: {
    adminUserId: string, jobId: number
  }) => Promise<StoredExportJob | null>
}

const storedJobSchema = z.object({
  id: safeIdSchema,
  createdByAdminId: z.string().uuid(),
  filterSnapshot: adminExportFilterSchema,
  status: z.enum(['created', 'fetching', 'completed', 'failed']),
  studentRowCount: z.number().int().min(0).max(ROW_LIMIT),
  participationRowCount: z.number().int().min(0).max(ROW_LIMIT),
  counselingRowCount: z.number().int().min(0).max(ROW_LIMIT),
  errorCode: adminExportFailureCodeSchema.nullable(),
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  downloadedAt: timestampSchema.nullable(),
}).strict()

const validateStoredJob = (raw: StoredExportJob): StoredExportJob => {
  const parsed = storedJobSchema.safeParse(raw)
  if (!parsed.success) throw new Error('ADMIN_EXPORT_STORE_INVALID')
  return parsed.data
}

const hasSameStoredJobIdentity = (left: StoredExportJob, right: StoredExportJob): boolean => (
  left.id === right.id
  && left.createdByAdminId === right.createdByAdminId
  && left.createdAt === right.createdAt
  && JSON.stringify(left.filterSnapshot) === JSON.stringify(right.filterSnapshot)
)

const loadPageJob = async (
  dependencies: AdminExportDependencies,
  jobId: number,
  adminUserId: string,
): Promise<StoredExportJob> => {
  const raw = await dependencies.loadOwnedJob({ jobId, adminUserId })
  if (raw === null) throw new AppError('EXPORT_NOT_FOUND')
  const job = validateStoredJob(raw)
  if (job.createdByAdminId !== adminUserId || job.id !== jobId) throw new Error('ADMIN_EXPORT_STORE_INVALID')
  if (job.status === 'created') {
    if (!await dependencies.beginJob({ jobId, adminUserId })) {
      const reloadedRaw = await dependencies.loadOwnedJob({ jobId, adminUserId })
      if (reloadedRaw === null) throw new AppError('EXPORT_CONFLICT')
      const reloaded = validateStoredJob(reloadedRaw)
      if (!hasSameStoredJobIdentity(job, reloaded)) throw new Error('ADMIN_EXPORT_STORE_INVALID')
      if (reloaded.status !== 'fetching') throw new AppError('EXPORT_CONFLICT')
      return reloaded
    }
  }
  else if (job.status !== 'fetching') throw new AppError('EXPORT_CONFLICT')
  return job
}

const page = async <Item>(
  dependencies: AdminExportDependencies,
  loader: (input: PageInput) => Promise<ExportRow<Item>[]>,
  jobId: number,
  cursor: AdminExportCursor | undefined,
  adminUserId: string,
) => {
  const job = await loadPageJob(dependencies, jobId, adminUserId)
  const rows = await loader({
    adminUserId,
    cutoff: job.createdAt,
    ...(cursor === undefined ? {} : { cursor }),
    filters: job.filterSnapshot,
    jobId,
    limit: PAGE_SIZE,
  })
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE) throw new Error('ADMIN_EXPORT_STORE_INVALID')
  rows.forEach(row => cursorSchema.parse(row.cursor))
  return {
    items: rows.map(row => row.item),
    nextCursor: rows.length === PAGE_SIZE ? encodeExportCursor(rows.at(-1)!.cursor) : null,
  }
}

export const createAdminExportService = (dependencies: AdminExportDependencies) => ({
  create: async (rawFilters: unknown, context: { adminUserId: string, traceId: string }) => {
    const filters = adminExportFilterSchema.parse(rawFilters)
    const job = validateStoredJob(await dependencies.createJob({
      adminUserId: context.adminUserId,
      filterSnapshot: filters,
    }))
    if (job.createdByAdminId !== context.adminUserId || JSON.stringify(job.filterSnapshot) !== JSON.stringify(filters)) {
      throw new Error('ADMIN_EXPORT_STORE_INVALID')
    }
    const response = adminExportJobSchema.parse({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      filterSnapshot: job.filterSnapshot,
    })
    try {
      const counts = await dependencies.countRows(filters, {
        adminUserId: context.adminUserId,
        cutoff: job.createdAt,
        jobId: job.id,
      })
      if (![counts.students, counts.assessments, counts.counseling]
        .every(count => Number.isSafeInteger(count) && count >= 0)) throw new Error('ADMIN_EXPORT_STORE_INVALID')
      if (counts.students + counts.assessments + counts.counseling > ROW_LIMIT) {
        if (!await dependencies.failJob({
          adminUserId: context.adminUserId,
          errorCode: 'EXPORT_ROW_LIMIT_EXCEEDED',
          jobId: job.id,
        })) throw new Error('ADMIN_EXPORT_STORE_INVALID')
        throw new AppError('EXPORT_FILTER_REQUIRED')
      }
      await dependencies.recordExportAudit({
        adminUserId: context.adminUserId,
        filterSnapshot: filters,
        jobId: job.id,
        traceId: context.traceId,
      })
      return response
    }
    catch (error) {
      if (error instanceof AppError && error.code === 'EXPORT_FILTER_REQUIRED') throw error
      await dependencies.failJob({
        adminUserId: context.adminUserId,
        errorCode: 'EXPORT_INTERNAL_ERROR',
        jobId: job.id,
      }).catch(() => false)
      throw error
    }
  },
  students: (jobId: number, cursor: AdminExportCursor | undefined, context: { adminUserId: string }) => (
    page(dependencies, dependencies.listStudents, jobId, cursor, context.adminUserId)
  ),
  assessments: (jobId: number, cursor: AdminExportCursor | undefined, context: { adminUserId: string }) => (
    page(dependencies, dependencies.listAssessments, jobId, cursor, context.adminUserId)
  ),
  counseling: (jobId: number, cursor: AdminExportCursor | undefined, context: { adminUserId: string }) => (
    page(dependencies, dependencies.listCounseling, jobId, cursor, context.adminUserId)
  ),
  complete: async (jobId: number, completion: AdminExportCompletion, context: { adminUserId: string }) => {
    const raw = await dependencies.loadOwnedJob({ jobId, adminUserId: context.adminUserId })
    if (raw === null) throw new AppError('EXPORT_NOT_FOUND')
    const job = validateStoredJob(raw)
    if (job.createdByAdminId !== context.adminUserId || job.id !== jobId) throw new Error('ADMIN_EXPORT_STORE_INVALID')
    if (job.status !== 'fetching') throw new AppError('EXPORT_CONFLICT')
    if (completion.status === 'completed') {
      const authoritative = await dependencies.countRows(job.filterSnapshot, {
        adminUserId: context.adminUserId,
        cutoff: job.createdAt,
        jobId,
      })
      if (completion.studentRowCount !== authoritative.students
        || completion.participationRowCount !== authoritative.assessments
        || completion.counselingRowCount !== authoritative.counseling) {
        throw new AppError('EXPORT_INVALID')
      }
    }
    const completed = await dependencies.completeJob({ jobId, adminUserId: context.adminUserId, completion })
    if (completed === null) throw new AppError('EXPORT_CONFLICT')
    const verified = validateStoredJob(completed)
    const response = {
      id: verified.id,
      status: verified.status,
      createdAt: verified.createdAt,
      filterSnapshot: verified.filterSnapshot,
    }
    return completion.status === 'completed'
      ? adminExportCompletedJobSchema.parse(response)
      : adminExportJobSchema.parse(response)
  },
  downloaded: async (jobId: number, context: { adminUserId: string }) => {
    const raw = await dependencies.loadOwnedJob({ jobId, adminUserId: context.adminUserId })
    if (raw === null) throw new AppError('EXPORT_NOT_FOUND')
    const job = validateStoredJob(raw)
    if (job.createdByAdminId !== context.adminUserId || job.id !== jobId) {
      throw new Error('ADMIN_EXPORT_STORE_INVALID')
    }
    if (job.status !== 'completed') throw new AppError('EXPORT_CONFLICT')
    const acknowledged = job.downloadedAt === null
      ? await dependencies.acknowledgeDownload({ jobId, adminUserId: context.adminUserId })
      : job
    if (acknowledged === null) throw new AppError('EXPORT_CONFLICT')
    const verified = validateStoredJob(acknowledged)
    if (verified.id !== jobId
      || verified.createdByAdminId !== context.adminUserId
      || verified.status !== 'completed'
      || verified.downloadedAt === null
      || !hasSameStoredJobIdentity(job, verified)) {
      throw new Error('ADMIN_EXPORT_STORE_INVALID')
    }
    return adminExportDownloadedJobSchema.parse({
      id: verified.id,
      status: verified.status,
      createdAt: verified.createdAt,
      filterSnapshot: verified.filterSnapshot,
      downloadedAt: verified.downloadedAt,
    })
  },
})

const storedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim())
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }))
const postgresByteaSchema = z.string().regex(/^\\x[0-9a-f]+$/u)
const rawStudentRowSchema = z.object({
  id: safeIdSchema,
  created_at: timestampSchema,
  nickname: storedText(100),
  phone_ciphertext: postgresByteaSchema,
  phone_iv: postgresByteaSchema,
  school_name: storedText(40),
  applicant_stage: z.enum(['high1', 'high2', 'high3', 'graduate', 'ged', 'other']),
  region: z.enum(['gwangju', 'jeonbuk', 'capital', 'chungcheong', 'gyeongsang', 'gangwon_jeju', 'overseas', 'other']),
  total_participation: z.number().int().min(0).max(30_000),
  latest_result_at: timestampSchema.nullable(),
  latest_result_snapshot: z.unknown().nullable(),
  assigned_faculty: storedText(100).nullable(),
  counseling_status: z.enum(['new', 'assigned', 'contacted', 'completed', 'closed']).nullable(),
}).strict().refine(row => (row.latest_result_at === null) === (row.latest_result_snapshot === null))

const decodeStudentExportRow = async (
  raw: unknown,
  decryptPhone: (value: { ciphertext: Uint8Array, iv: Uint8Array }) => Promise<string>,
): Promise<ExportRow<AdminExportStudent>> => {
  try {
    const row = rawStudentRowSchema.parse(raw)
    const snapshot = row.latest_result_snapshot === null ? null : decodeResultSnapshot(row.latest_result_snapshot)
    const phone = normalizeKoreanPhone(await decryptPhone({
      ciphertext: bytesFromPostgresBytea(row.phone_ciphertext),
      iv: bytesFromPostgresBytea(row.phone_iv),
    }))
    return {
      cursor: cursorSchema.parse({ createdAt: row.created_at, id: row.id }),
      item: adminExportStudentSchema.parse({
        nickname: row.nickname,
        phone,
        schoolName: row.school_name,
        currentStage: row.applicant_stage,
        region: row.region,
        primaryCareer: snapshot?.rankedTracks[0] ?? null,
        secondaryCareer: snapshot?.rankedTracks[1] ?? null,
        totalParticipation: row.total_participation,
        latestResultAt: row.latest_result_at,
        recommendedFaculty: snapshot?.faculty.primary.name ?? null,
        assignedFaculty: row.assigned_faculty,
        counselingStatus: row.counseling_status,
      }),
    }
  }
  catch {
    throw new Error('ADMIN_EXPORT_STORE_INVALID')
  }
}

const rawAssessmentRowSchema = z.object({
  id: safeIdSchema,
  created_at: timestampSchema,
  completed_at: timestampSchema,
  result_snapshot: z.unknown(),
  sequence: z.number().int().min(1).max(30_000).optional(),
  prospect: z.object({
    id: safeIdSchema,
    nickname: storedText(100),
    assessments: z.array(z.object({ id: safeIdSchema, created_at: timestampSchema }).strict()).max(100).optional(),
  }).strict(),
}).strict().refine(row => row.sequence !== undefined || row.prospect.assessments !== undefined)

export const decodeAssessmentExportRow = (raw: unknown): ExportRow<AdminExportAssessment> => {
  try {
    const row = rawAssessmentRowSchema.parse(raw)
    const snapshot = decodeResultSnapshot(row.result_snapshot)
    const sequence = row.sequence ?? [...row.prospect.assessments!]
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id - right.id)
      .findIndex(assessment => assessment.id === row.id) + 1
    if (sequence < 1) throw new Error('MISSING_SEQUENCE')
    const selected = (group: 'work' | 'result' | 'style' | 'career') => (
      snapshot.selectedInterests.filter(interest => interest.group === group).map(interest => interest.label)
    )
    return {
      cursor: cursorSchema.parse({ createdAt: row.created_at, id: row.id }),
      item: adminExportAssessmentSchema.parse({
        nickname: row.prospect.nickname,
        sequence,
        participatedAt: row.completed_at,
        selectedWork: selected('work'),
        selectedResult: selected('result'),
        selectedStyle: selected('style'),
        selectedCareer: selected('career'),
        documentaryScore: snapshot.trackScores.documentary,
        artPhotoScore: snapshot.trackScores.art_photo,
        commercialScore: snapshot.trackScores.commercial,
        videoScore: snapshot.trackScores.video,
        environmentScore: snapshot.environmentScore,
        recommendedResources: Object.values(snapshot.resources).flat().map(resource => resource.title),
      }),
    }
  }
  catch {
    throw new Error('ADMIN_EXPORT_STORE_INVALID')
  }
}

const rawCounselingRecommendationSchema = z.object({
  role: z.enum(['primary', 'backup', 'specialist']),
  rank: z.number().int().min(1).max(2),
  faculty_name_snapshot: storedText(100),
}).strict()
const rawCounselingRowSchema = z.object({
  id: safeIdSchema,
  created_at: timestampSchema,
  contact_method: z.enum(['phone', 'text', 'visit']),
  availability: z.enum(['weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend']),
  inquiry: storedText(200).nullable(),
  status: z.enum(['new', 'assigned', 'contacted', 'completed', 'closed']),
  contacted_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
  admin_note: storedText(2_000).nullable(),
  prospect: z.object({ nickname: storedText(100) }).strict(),
  assigned_faculty: z.object({ name: storedText(100) }).strict().nullable(),
  recommendations: z.array(rawCounselingRecommendationSchema).min(2).max(4),
}).strict()

export const decodeCounselingExportRow = (raw: unknown): ExportRow<AdminExportCounseling> => {
  try {
    const row = rawCounselingRowSchema.parse(raw)
    const primary = row.recommendations.filter(item => item.role === 'primary' && item.rank === 1)
    const backup = row.recommendations.filter(item => item.role === 'backup' && item.rank === 1)
    const specialists = row.recommendations.filter(item => item.role === 'specialist')
      .sort((left, right) => left.rank - right.rank)
    if (primary.length !== 1 || backup.length !== 1
      || specialists.some((item, index) => item.rank !== index + 1)
      || new Set(row.recommendations.map(item => `${item.role}:${item.rank}`)).size !== row.recommendations.length) {
      throw new Error('INVALID_RECOMMENDATIONS')
    }
    return {
      cursor: cursorSchema.parse({ createdAt: row.created_at, id: row.id }),
      item: adminExportCounselingSchema.parse({
        nickname: row.prospect.nickname,
        requestedAt: row.created_at,
        contactMethod: row.contact_method,
        availability: row.availability,
        inquiry: row.inquiry,
        recommendedPrimaryFaculty: primary[0]!.faculty_name_snapshot,
        recommendedBackupFaculty: backup[0]!.faculty_name_snapshot,
        specialistFaculty: specialists.map(item => item.faculty_name_snapshot),
        assignedFaculty: row.assigned_faculty?.name ?? null,
        status: row.status,
        contactedAt: row.contacted_at,
        completedAt: row.completed_at,
        result: null,
        adminNote: row.admin_note,
      }),
    }
  }
  catch {
    throw new Error('ADMIN_EXPORT_STORE_INVALID')
  }
}

const rawJobRowSchema = z.object({
  id: safeIdSchema,
  created_by_admin_id: z.string().uuid(),
  filter_snapshot: adminExportFilterSchema,
  status: z.enum(['created', 'fetching', 'completed', 'failed']),
  student_row_count: z.number().int().min(0).max(30_000),
  participation_row_count: z.number().int().min(0).max(30_000),
  counseling_row_count: z.number().int().min(0).max(30_000),
  error_code: adminExportFailureCodeSchema.nullable(),
  created_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
  downloaded_at: timestampSchema.nullable(),
}).strict()

const decodeJobRow = (raw: unknown): StoredExportJob => {
  try {
    const row = rawJobRowSchema.parse(raw)
    return storedJobSchema.parse({
      id: row.id,
      createdByAdminId: row.created_by_admin_id,
      filterSnapshot: row.filter_snapshot,
      status: row.status,
      studentRowCount: row.student_row_count,
      participationRowCount: row.participation_row_count,
      counselingRowCount: row.counseling_row_count,
      errorCode: row.error_code,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      downloadedAt: row.downloaded_at,
    })
  }
  catch {
    throw new Error('ADMIN_EXPORT_STORE_INVALID')
  }
}

const jobSelection = `
  id,
  created_by_admin_id,
  filter_snapshot,
  status,
  student_row_count,
  participation_row_count,
  counseling_row_count,
  error_code,
  created_at,
  completed_at,
  downloaded_at
`

const throwStoreError = (error: { code?: string, message?: string } | null): never => {
  const storeError = new Error('ADMIN_EXPORT_STORE_OPERATION_FAILED') as Error & { code?: string }
  storeError.code = error?.code
  throw storeError
}

const rpcRowsSchema = z.array(z.object({ payload: z.unknown() }).strict()).max(PAGE_SIZE)

export const createSupabaseAdminExportDependencies = (
  client: SupabaseClient,
  decryptPhone: (value: { ciphertext: Uint8Array, iv: Uint8Array }) => Promise<string>,
): AdminExportDependencies => {
  const pageArguments = (input: PageInput) => ({
    p_admin_id: input.adminUserId,
    p_cursor_created_at: input.cursor?.createdAt ?? null,
    p_cursor_id: input.cursor?.id ?? null,
    p_job_id: input.jobId,
    p_limit: input.limit,
  })
  return {
    createJob: async (input) => {
      const { data, error } = await client.from('export_jobs').insert({
        created_by_admin_id: input.adminUserId,
        filter_snapshot: input.filterSnapshot,
      }).select(jobSelection).single()
      if (error || data === null) throwStoreError(error)
      return decodeJobRow(data)
    },
    countRows: async (_filters, context) => {
      const { data, error } = await client.rpc('admin_export_counts', {
        p_admin_id: context.adminUserId,
        p_job_id: context.jobId,
      })
      if (error) throwStoreError(error)
      const parsed = z.array(z.object({
        student_count: z.number().int().min(0),
        assessment_count: z.number().int().min(0),
        counseling_count: z.number().int().min(0),
      }).strict()).length(1).safeParse(data)
      if (!parsed.success) throw new Error('ADMIN_EXPORT_STORE_INVALID')
      return {
        students: parsed.data[0]!.student_count,
        assessments: parsed.data[0]!.assessment_count,
        counseling: parsed.data[0]!.counseling_count,
      }
    },
    recordExportAudit: async (input) => {
      const { data, error } = await client.rpc('record_admin_export_created', {
        p_admin_id: input.adminUserId,
        p_audit_request_id: input.traceId,
        p_job_id: input.jobId,
      })
      if (error) throwStoreError(error)
      if (data !== true) throw new Error('ADMIN_EXPORT_STORE_INVALID')
    },
    failJob: async (input) => {
      const { data, error } = await client.from('export_jobs').update({
        completed_at: new Date().toISOString(),
        error_code: input.errorCode,
        status: 'failed',
      }).eq('id', input.jobId)
        .eq('created_by_admin_id', input.adminUserId)
        .eq('status', 'created')
        .select('id')
        .maybeSingle()
      if (error) throwStoreError(error)
      return data !== null
    },
    loadOwnedJob: async (input) => {
      const { data, error } = await client.from('export_jobs').select(jobSelection)
        .eq('id', input.jobId)
        .eq('created_by_admin_id', input.adminUserId)
        .maybeSingle()
      if (error) throwStoreError(error)
      return data === null ? null : decodeJobRow(data)
    },
    beginJob: async (input) => {
      const { data, error } = await client.from('export_jobs').update({ status: 'fetching' })
        .eq('id', input.jobId)
        .eq('created_by_admin_id', input.adminUserId)
        .eq('status', 'created')
        .select('id')
        .maybeSingle()
      if (error) throwStoreError(error)
      return data !== null
    },
    listStudents: async (input) => {
      const { data, error } = await client.rpc('admin_export_student_rows', pageArguments(input))
      if (error) throwStoreError(error)
      const rows = rpcRowsSchema.safeParse(data)
      if (!rows.success) throw new Error('ADMIN_EXPORT_STORE_INVALID')
      return Promise.all(rows.data.map(row => decodeStudentExportRow(row.payload, decryptPhone)))
    },
    listAssessments: async (input) => {
      const { data, error } = await client.rpc('admin_export_assessment_rows', pageArguments(input))
      if (error) throwStoreError(error)
      const rows = rpcRowsSchema.safeParse(data)
      if (!rows.success) throw new Error('ADMIN_EXPORT_STORE_INVALID')
      return rows.data.map(row => decodeAssessmentExportRow(row.payload))
    },
    listCounseling: async (input) => {
      const { data, error } = await client.rpc('admin_export_counseling_rows', pageArguments(input))
      if (error) throwStoreError(error)
      const rows = rpcRowsSchema.safeParse(data)
      if (!rows.success) throw new Error('ADMIN_EXPORT_STORE_INVALID')
      return rows.data.map(row => decodeCounselingExportRow(row.payload))
    },
    completeJob: async (input) => {
      const completedAt = new Date().toISOString()
      const values = input.completion.status === 'completed'
        ? {
            completed_at: completedAt,
            counseling_row_count: input.completion.counselingRowCount,
            downloaded_at: input.completion.downloaded ? completedAt : null,
            participation_row_count: input.completion.participationRowCount,
            status: 'completed',
            student_row_count: input.completion.studentRowCount,
          }
        : {
            completed_at: completedAt,
            counseling_row_count: input.completion.counselingRowCount,
            error_code: input.completion.errorCode,
            participation_row_count: input.completion.participationRowCount,
            status: 'failed',
            student_row_count: input.completion.studentRowCount,
          }
      const { data, error } = await client.from('export_jobs').update(values)
        .eq('id', input.jobId)
        .eq('created_by_admin_id', input.adminUserId)
        .eq('status', 'fetching')
        .select(jobSelection)
        .maybeSingle()
      if (error) throwStoreError(error)
      return data === null ? null : decodeJobRow(data)
    },
    acknowledgeDownload: async (input) => {
      const { data, error } = await client.rpc('record_admin_export_downloaded', {
        p_admin_id: input.adminUserId,
        p_job_id: input.jobId,
      })
      if (error) throwStoreError(error)
      if (data !== true) throw new Error('ADMIN_EXPORT_STORE_INVALID')
      const { data: job, error: loadError } = await client.from('export_jobs').select(jobSelection)
        .eq('id', input.jobId)
        .eq('created_by_admin_id', input.adminUserId)
        .maybeSingle()
      if (loadError) throwStoreError(loadError)
      return job === null ? null : decodeJobRow(job)
    },
  }
}

export const getServerAdminExportService = () => {
  const runtimeConfig = useRuntimeConfig()
  const encryptionKey = decodeBase64urlSecret(runtimeConfig.phoneEncryptionKey)
  return createAdminExportService(createSupabaseAdminExportDependencies(
    getServerSupabaseClient(),
    value => revealPhone(value, encryptionKey),
  ))
}
