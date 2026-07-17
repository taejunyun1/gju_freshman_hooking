import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  canonicalAssessmentPublicIdSchema,
  careerNarrativeReportInputSchema,
  type CareerNarrativeReportCategory,
  type CareerNarrativeReportResult,
} from '../../../shared/schemas/career-narrative-report'
import { AppError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'
import { createRosterSessionServiceFromSupabase } from '../identity/student-session'

const REPORT_ROUTE = '/api/career-narrative/report' as const

const studentSessionSchema = z.object({
  prospectId: z.number().int().positive().safe(),
  nickname: z.string().min(1).max(100),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict()

const ownedAssessmentSchema = z.object({
  assessmentId: z.number().int().positive().safe(),
  publicId: canonicalAssessmentPublicIdSchema,
}).strict()

const createdReportSchema = z.object({
  accepted: z.literal(true),
  created: z.boolean(),
}).strict()

const rawOwnedAssessmentSchema = z.object({
  id: z.number().int().positive().safe(),
  public_id: canonicalAssessmentPublicIdSchema,
}).strict()

const rawReportSchema = z.object({
  id: z.number().int().positive().safe(),
  assessment_id: z.number().int().positive().safe(),
  prospect_id: z.number().int().positive().safe(),
  status: z.enum([
    'open',
    'resolved_inaccurate',
    'resolved_unsafe',
    'resolved_copy',
    'dismissed',
  ]),
}).strict()

export type CareerNarrativeReportContext = {
  requestId: string
  sessionToken: string
}

type RateLimitInput = {
  key: string
  route: string
  limit: number
  window: string
}

type CreateReportInput = {
  assessmentId: number
  prospectId: number
  category: CareerNarrativeReportCategory
}

export type CareerNarrativeReportDependencies = {
  consumeRateLimit: (input: RateLimitInput) => Promise<boolean>
  createReport: (input: CreateReportInput) => Promise<unknown>
  getStudentSession: (sessionToken: string) => Promise<unknown>
  loadOwnedAssessment: (input: { prospectId: number, publicId: string }) => Promise<unknown>
}

const parseStoreValue = <Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  code: string,
): z.infer<Schema> => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error(code)
  return parsed.data
}

export const createCareerNarrativeReportService = (
  dependencies: CareerNarrativeReportDependencies,
) => {
  const report = async (
    rawInput: unknown,
    context: CareerNarrativeReportContext,
  ): Promise<CareerNarrativeReportResult> => {
    try {
      const rawSession = await dependencies.getStudentSession(context.sessionToken)
      if (rawSession === null) throw new AppError('AUTH_FAILED')
      const session = parseStoreValue(
        studentSessionSchema,
        rawSession,
        'CAREER_NARRATIVE_REPORT_SESSION_INVALID',
      )

      const parsedInput = careerNarrativeReportInputSchema.safeParse(rawInput)
      if (!parsedInput.success) throw new AppError('VALIDATION_FAILED')
      const input = parsedInput.data

      const allowed = await dependencies.consumeRateLimit({
        key: `prospect:${session.prospectId}`,
        route: REPORT_ROUTE,
        limit: 3,
        window: '24 hours',
      })
      if (!allowed) throw new AppError('RATE_LIMITED')

      const rawAssessment = await dependencies.loadOwnedAssessment({
        prospectId: session.prospectId,
        publicId: input.assessmentPublicId,
      })
      if (rawAssessment === null) throw new AppError('RESULT_NOT_FOUND')
      const assessment = parseStoreValue(
        ownedAssessmentSchema,
        rawAssessment,
        'CAREER_NARRATIVE_REPORT_ASSESSMENT_INVALID',
      )
      if (assessment.publicId !== input.assessmentPublicId) {
        throw new Error('CAREER_NARRATIVE_REPORT_ASSESSMENT_INVALID')
      }

      parseStoreValue(createdReportSchema, await dependencies.createReport({
        assessmentId: assessment.assessmentId,
        prospectId: session.prospectId,
        category: input.category,
      }), 'CAREER_NARRATIVE_REPORT_STORE_INVALID')

      return { accepted: true }
    }
    catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_ERROR')
    }
  }

  return { report }
}

export const createSupabaseCareerNarrativeReportDependencies = (
  client: SupabaseClient,
  createSessionReader: typeof createRosterSessionServiceFromSupabase = createRosterSessionServiceFromSupabase,
): CareerNarrativeReportDependencies => {
  let sessionReader: ReturnType<typeof createRosterSessionServiceFromSupabase> | undefined

  return {
    consumeRateLimit: async ({ key, route, limit, window }) => {
      const { data, error } = await client.rpc('consume_rate_limit', {
        p_key: key,
        p_limit: limit,
        p_route: route,
        p_window: window,
      })
      if (error) throw new Error('CAREER_NARRATIVE_REPORT_STORE_UNAVAILABLE')
      return data === true
    },
    createReport: async ({ assessmentId, category, prospectId }) => {
      const { data, error } = await client.from('career_narrative_reports')
        .insert({
          assessment_id: assessmentId,
          prospect_id: prospectId,
          category,
        })
        .select('id,assessment_id,prospect_id,status')
        .single()

      if (!error) {
        const row = parseStoreValue(
          rawReportSchema,
          data,
          'CAREER_NARRATIVE_REPORT_STORE_INVALID',
        )
        if (row.assessment_id !== assessmentId || row.prospect_id !== prospectId) {
          throw new Error('CAREER_NARRATIVE_REPORT_STORE_INVALID')
        }
        return { accepted: true, created: true }
      }

      if (error.code !== '23505') {
        throw new Error('CAREER_NARRATIVE_REPORT_STORE_UNAVAILABLE')
      }

      const existing = await client.from('career_narrative_reports')
        .select('id,assessment_id,prospect_id,status')
        .eq('assessment_id', assessmentId)
        .eq('prospect_id', prospectId)
        .maybeSingle()
      if (existing.error || existing.data === null) {
        throw new Error('CAREER_NARRATIVE_REPORT_STORE_UNAVAILABLE')
      }
      const row = parseStoreValue(
        rawReportSchema,
        existing.data,
        'CAREER_NARRATIVE_REPORT_STORE_INVALID',
      )
      if (row.assessment_id !== assessmentId || row.prospect_id !== prospectId) {
        throw new Error('CAREER_NARRATIVE_REPORT_STORE_INVALID')
      }
      return { accepted: true, created: false }
    },
    getStudentSession: token => (
      sessionReader ??= createSessionReader(client)
    ).getStudentSession(token),
    loadOwnedAssessment: async ({ prospectId, publicId }) => {
      const { data, error } = await client.from('assessments')
        .select('id,public_id')
        .eq('public_id', publicId)
        .eq('prospect_id', prospectId)
        .eq('status', 'completed')
        .maybeSingle()
      if (error) throw new Error('CAREER_NARRATIVE_REPORT_STORE_UNAVAILABLE')
      if (data === null) return null
      const row = parseStoreValue(
        rawOwnedAssessmentSchema,
        data,
        'CAREER_NARRATIVE_REPORT_ASSESSMENT_INVALID',
      )
      return { assessmentId: row.id, publicId: row.public_id }
    },
  }
}

export const getServerCareerNarrativeReportService = () => (
  createCareerNarrativeReportService(
    createSupabaseCareerNarrativeReportDependencies(getServerSupabaseClient()),
  )
)
