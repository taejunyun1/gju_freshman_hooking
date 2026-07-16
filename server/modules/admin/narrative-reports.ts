import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  adminNarrativeReportItemSchema,
  adminNarrativeReportListSchema,
  adminNarrativeReportResolveInputSchema,
  adminNarrativeReportReviewSchema,
  type AdminNarrativeReportItem,
  type AdminNarrativeReportList,
  type AdminNarrativeReportResolveInput,
  type AdminNarrativeReportReview,
} from '../../../shared/schemas/admin-narrative-reports'
import { AppError, NarrativeReportConflictError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'
import { base64urlEncode } from '../../utils/web-crypto'
import { decodeStoredResultSnapshot } from '../assessment/stored-result'

const safeIdSchema = z.number().int().positive().safe()
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const cursorSchema = z.object({
  priority: z.union([z.literal(0), z.literal(1)]),
  createdAt: timestampSchema,
  id: safeIdSchema,
}).strict()

export type AdminNarrativeReportCursor = z.infer<typeof cursorSchema>

const decodeBase64urlText = (encoded: string): string => {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length > 240 || encoded.length % 4 === 1) {
    throw new Error('ADMIN_NARRATIVE_REPORT_CURSOR_INVALID')
  }
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/')
    + '='.repeat((4 - encoded.length % 4) % 4)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(padded), character => character.charCodeAt(0)),
    )
  }
  catch {
    throw new Error('ADMIN_NARRATIVE_REPORT_CURSOR_INVALID')
  }
}

export const encodeAdminNarrativeReportCursor = (
  input: AdminNarrativeReportCursor,
): string => base64urlEncode(
  new TextEncoder().encode(JSON.stringify(cursorSchema.parse(input))),
)

const decodeAdminNarrativeReportCursor = (encoded: string): AdminNarrativeReportCursor => {
  let raw: unknown
  try {
    raw = JSON.parse(decodeBase64urlText(encoded)) as unknown
  }
  catch {
    throw new Error('ADMIN_NARRATIVE_REPORT_CURSOR_INVALID')
  }
  const parsed = cursorSchema.safeParse(raw)
  if (!parsed.success || encodeAdminNarrativeReportCursor(parsed.data) !== encoded) {
    throw new Error('ADMIN_NARRATIVE_REPORT_CURSOR_INVALID')
  }
  return parsed.data
}

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(240).transform((value, context) => {
    try {
      return decodeAdminNarrativeReportCursor(value)
    }
    catch {
      context.addIssue({ code: 'custom', message: 'invalid cursor' })
      return z.NEVER
    }
  }).optional(),
  limit: z.string().regex(/^[1-9][0-9]?$/u).transform(Number)
    .pipe(z.number().int().min(1).max(50)).default(20),
}).strict()

export type AdminNarrativeReportListInput = {
  cursor?: AdminNarrativeReportCursor
  limit: number
}

export const parseAdminNarrativeReportListQuery = (
  input: unknown,
): AdminNarrativeReportListInput => {
  const parsed = listQuerySchema.safeParse(input)
  if (!parsed.success) throw new AppError('NARRATIVE_REPORT_INVALID')
  return parsed.data
}

export const parseAdminNarrativeReportId = (input: string | undefined): number => {
  if (input === undefined || !/^[1-9][0-9]{0,15}$/u.test(input)) {
    throw new AppError('NARRATIVE_REPORT_INVALID')
  }
  const id = Number(input)
  if (!Number.isSafeInteger(id)) throw new AppError('NARRATIVE_REPORT_INVALID')
  return id
}

export const parseAdminNarrativeReportResolveInput = (
  input: unknown,
): AdminNarrativeReportResolveInput => {
  const parsed = adminNarrativeReportResolveInputSchema.safeParse(input)
  if (!parsed.success) throw new AppError('NARRATIVE_REPORT_INVALID')
  return parsed.data
}

const rawListRowSchema = z.object({
  id: safeIdSchema,
  category: z.enum(['inaccurate', 'unsafe', 'confusing']),
  priority: z.union([z.literal(0), z.literal(1)]),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  status: z.enum([
    'open',
    'resolved_inaccurate',
    'resolved_unsafe',
    'resolved_copy',
    'dismissed',
  ]),
  assessments: z.object({
    public_id: z.string().uuid(),
  }).strict(),
}).strict()

const rawDetailRowSchema = z.object({
  id: safeIdSchema,
  assessments: z.object({
    public_id: z.string().uuid(),
    result_snapshot: z.unknown(),
  }).strict(),
}).strict()

const rawRpcSchema = z.object({
  kind: z.enum(['resolved', 'conflict']),
  current: z.object({
    id: safeIdSchema,
    category: z.enum(['inaccurate', 'unsafe', 'confusing']),
    priority: z.union([z.literal(0), z.literal(1)]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    status: z.enum([
      'open',
      'resolved_inaccurate',
      'resolved_unsafe',
      'resolved_copy',
      'dismissed',
    ]),
    assessmentPublicId: z.string().uuid(),
  }).strict(),
}).strict()

const toItem = (input: unknown): AdminNarrativeReportItem => {
  const row = rawListRowSchema.parse(input)
  return adminNarrativeReportItemSchema.parse({
    id: row.id,
    category: row.category,
    priority: row.priority === 0 ? 'urgent' : 'standard',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    assessmentPublicId: row.assessments.public_id,
    resultPath: `/api/admin/narrative-reports/${row.id}/result`,
  })
}

const rpcCurrentToItem = (
  current: z.infer<typeof rawRpcSchema>['current'],
): AdminNarrativeReportItem => adminNarrativeReportItemSchema.parse({
  ...current,
  priority: current.priority === 0 ? 'urgent' : 'standard',
  resultPath: `/api/admin/narrative-reports/${current.id}/result`,
})

export type ResolveNarrativeReportContext = {
  adminUserId: string
  traceId: string
}

export type AdminNarrativeReportsDependencies = {
  listReports: (input: AdminNarrativeReportListInput) => Promise<unknown[]>
  loadResult: (reportId: number) => Promise<unknown | null>
  resolveReport: (input: {
    reportId: number
    expectedUpdatedAt: string
    resolution: AdminNarrativeReportResolveInput['resolution']
    adminUserId: string
    traceId: string
  }) => Promise<unknown>
}

export const createAdminNarrativeReportsService = (
  dependencies: AdminNarrativeReportsDependencies,
) => ({
  list: async (input: AdminNarrativeReportListInput): Promise<AdminNarrativeReportList> => {
    try {
      const rows = await dependencies.listReports(input)
      const items = rows.map(toItem)
      const last = items.at(-1)
      return adminNarrativeReportListSchema.parse({
        items,
        nextCursor: items.length === input.limit && last !== undefined
          ? encodeAdminNarrativeReportCursor({
              priority: last.priority === 'urgent' ? 0 : 1,
              createdAt: last.createdAt,
              id: last.id,
            })
          : null,
      })
    }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_ERROR')
    }
  },
  loadResult: async (reportId: number): Promise<AdminNarrativeReportReview> => {
    try {
      const raw = await dependencies.loadResult(safeIdSchema.parse(reportId))
      if (raw === null) throw new AppError('NARRATIVE_REPORT_NOT_FOUND')
      const row = rawDetailRowSchema.parse(raw)
      const snapshot = decodeStoredResultSnapshot(row.assessments.result_snapshot)
      const courses = [...new Set(snapshot.learningPath.flatMap(year => year.resources)
        .filter(resource => resource.type === 'course')
        .map(resource => resource.title))]
      return adminNarrativeReportReviewSchema.parse({
        reportId: row.id,
        assessmentPublicId: row.assessments.public_id,
        selectedInterests: snapshot.selectedInterests.map(({ group, label }) => ({ group, label })),
        rankedTracks: snapshot.rankedTracks,
        learningCourseTitles: courses,
        faculty: {
          primary: {
            name: snapshot.faculty.primary.name,
            title: snapshot.faculty.primary.title,
            expertise: snapshot.faculty.primary.expertise,
          },
          specialists: snapshot.faculty.specialists.map(({ name, title, expertise }) => ({
            name,
            title,
            expertise,
          })),
        },
        narrativeSentences: snapshot.careerNarrative.sentences.map(sentence => sentence.text),
      })
    }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_ERROR')
    }
  },
  resolve: async (
    reportId: number,
    rawInput: unknown,
    context: ResolveNarrativeReportContext,
  ): Promise<AdminNarrativeReportItem> => {
    try {
      const parsedId = safeIdSchema.parse(reportId)
      const input = parseAdminNarrativeReportResolveInput(rawInput)
      const traceId = z.string().uuid().parse(context.traceId)
      const adminUserId = z.string().uuid().parse(context.adminUserId)
      const rpc = rawRpcSchema.parse(await dependencies.resolveReport({
        reportId: parsedId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        resolution: input.resolution,
        adminUserId,
        traceId,
      }))
      const current = rpcCurrentToItem(rpc.current)
      if (rpc.kind === 'conflict') throw new NarrativeReportConflictError(current)
      return current
    }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_ERROR')
    }
  },
})

export const createSupabaseAdminNarrativeReportsDependencies = (
  client: SupabaseClient,
): AdminNarrativeReportsDependencies => ({
  listReports: async (input) => {
    let query = client.from('career_narrative_reports')
      .select('id,category,priority,created_at,updated_at,status,assessments!inner(public_id)')
      .eq('status', 'open')
    if (input.cursor !== undefined) {
      query = query.or([
        `priority.gt.${input.cursor.priority}`,
        `and(priority.eq.${input.cursor.priority},created_at.gt.${input.cursor.createdAt})`,
        `and(priority.eq.${input.cursor.priority},created_at.eq.${input.cursor.createdAt},id.gt.${input.cursor.id})`,
      ].join(','))
    }
    const { data, error } = await query
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(input.limit)
    if (error) throw new Error('ADMIN_NARRATIVE_REPORT_STORE_UNAVAILABLE')
    return data ?? []
  },
  loadResult: async (reportId) => {
    const { data, error } = await client.from('career_narrative_reports')
      .select('id,assessments!inner(public_id,result_snapshot)')
      .eq('id', reportId)
      .maybeSingle()
    if (error) throw new Error('ADMIN_NARRATIVE_REPORT_STORE_UNAVAILABLE')
    return data
  },
  resolveReport: async input => {
    const { data, error } = await client.rpc('resolve_career_narrative_report', {
      p_admin_user_id: input.adminUserId,
      p_audit_request_id: input.traceId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_report_id: input.reportId,
      p_resolution: input.resolution,
    })
    if (error) throw new Error('ADMIN_NARRATIVE_REPORT_STORE_UNAVAILABLE')
    return data
  },
})

export const getServerAdminNarrativeReportsService = () => (
  createAdminNarrativeReportsService(
    createSupabaseAdminNarrativeReportsDependencies(getServerSupabaseClient()),
  )
)
