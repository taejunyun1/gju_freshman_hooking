import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  counselingApplicationSchema,
  counselingAvailabilitySchema,
  counselingContactMethodSchema,
  counselingStatusSchema,
  studentCounselingStatusSchema,
  type CounselingApplication,
  type StudentCounselingStatus,
} from '../../../shared/schemas/counseling'
import { AppError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'
import { createSupabaseStudentSessionReader } from '../identity/service'
import { createEventWriter, type EventWriter } from '../metrics/events'

export type { StudentCounselingStatus } from '../../../shared/schemas/counseling'

const COUNSELING_ROUTE = '/api/counseling' as const
const canonicalUuidSchema = z.string().uuid()
  .refine(value => value === value.toLowerCase(), 'UUID must use canonical lowercase form')
const safeIdSchema = z.number().int().positive().safe()
const versionSchema = z.number().int().nonnegative().max(2_147_483_647)
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const nullableTimestampSchema = timestampSchema.nullable()
const boundedStoredText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim(), 'stored text must already be trimmed')
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }), 'stored text cannot contain control characters')

const studentSessionSchema = z.object({
  prospectId: safeIdSchema,
  nickname: boundedStoredText(100),
  expiresAt: timestampSchema,
}).strict()

const ownedAssessmentSchema = z.object({
  assessmentId: safeIdSchema,
  campaignId: safeIdSchema.nullable(),
  publicId: canonicalUuidSchema,
}).strict()

const createdRequestSchema = z.object({
  requestId: safeIdSchema,
  publicId: canonicalUuidSchema,
  created: z.boolean(),
}).strict()

const facultyRecommendationSchema = z.object({
  name: boundedStoredText(100),
  title: boundedStoredText(100),
  expertise: boundedStoredText(1_000),
  reason: boundedStoredText(1_000),
  role: z.enum(['primary', 'backup', 'specialist']),
  rank: z.number().int().min(1).max(2),
}).strict()

const assignedFacultySchema = z.object({
  name: boundedStoredText(100),
  title: boundedStoredText(100),
  expertise: boundedStoredText(1_000),
}).strict()

const storedRequestSchema = z.object({
  requestId: safeIdSchema,
  publicId: canonicalUuidSchema,
  prospectId: safeIdSchema,
  assessmentPublicId: canonicalUuidSchema,
  status: counselingStatusSchema,
  contactMethod: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: z.union([boundedStoredText(200), z.null()]),
  consentedAt: timestampSchema,
  assignedAt: nullableTimestampSchema,
  contactedAt: nullableTimestampSchema,
  completedAt: nullableTimestampSchema,
  closedAt: nullableTimestampSchema,
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  assignedFaculty: assignedFacultySchema.nullable(),
  recommendations: z.array(facultyRecommendationSchema).min(2).max(4),
}).strict().superRefine((request, context) => {
  if ((request.assignedAt === null) !== (request.assignedFaculty === null)) {
    context.addIssue({ code: 'custom', message: 'assigned faculty shape is inconsistent' })
  }
  const identities = new Set<string>()
  let primaryCount = 0
  let backupCount = 0
  for (const recommendation of request.recommendations) {
    const identity = `${recommendation.role}:${recommendation.rank}`
    if (identities.has(identity)) {
      context.addIssue({ code: 'custom', message: 'recommendation role and rank are duplicated' })
    }
    identities.add(identity)
    if (recommendation.role === 'primary') primaryCount += 1
    if (recommendation.role === 'backup') backupCount += 1
    if (recommendation.role !== 'specialist' && recommendation.rank !== 1) {
      context.addIssue({ code: 'custom', message: 'primary and backup ranks must be one' })
    }
  }
  if (primaryCount !== 1 || backupCount !== 1) {
    context.addIssue({ code: 'custom', message: 'primary and backup recommendations are required' })
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
          : request.completedAt === null && request.closedAt !== null
  if (!stateShapeIsValid) {
    context.addIssue({ code: 'custom', message: 'status timestamps are inconsistent' })
  }
})

const rawOwnedAssessmentSchema = z.object({
  campaign_id: safeIdSchema.nullable(),
  id: safeIdSchema,
  public_id: canonicalUuidSchema,
}).strict()

const rawCreateRequestSchema = z.object({
  counseling_request_id: safeIdSchema,
  public_id: canonicalUuidSchema,
  created: z.boolean(),
}).strict()

const rawRecommendationSchema = z.object({
  faculty_name_snapshot: boundedStoredText(100),
  faculty_title_snapshot: boundedStoredText(100),
  expertise_snapshot: boundedStoredText(1_000),
  reason_snapshot: boundedStoredText(1_000),
  role: z.enum(['primary', 'backup', 'specialist']),
  rank: z.number().int().min(1).max(2),
}).strict()

const rawRequestSchema = z.object({
  id: safeIdSchema,
  public_id: canonicalUuidSchema,
  prospect_id: safeIdSchema,
  status: counselingStatusSchema,
  contact_method: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: z.union([boundedStoredText(200), z.null()]),
  consented_at: timestampSchema,
  assigned_at: nullableTimestampSchema,
  contacted_at: nullableTimestampSchema,
  completed_at: nullableTimestampSchema,
  closed_at: nullableTimestampSchema,
  version: versionSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  assessment_public_id_snapshot: canonicalUuidSchema,
  assigned_faculty: z.object({
    name: boundedStoredText(100),
    title: boundedStoredText(100),
    expertise_summary: boundedStoredText(1_000),
  }).strict().nullable(),
  recommendations: z.array(rawRecommendationSchema).min(2).max(4),
}).strict()

export type CounselingRequestContext = {
  anonymousId: string
  requestId: string
  sessionToken: string
}

type CreateRequestInput = {
  prospectId: number
  assessmentId: number
  contactMethod: CounselingApplication['contactMethod']
  availability: CounselingApplication['availability']
  inquiry: string | null
  consent: true
}

export type CounselingServiceDependencies = {
  getStudentSession: (sessionToken: string) => Promise<unknown>
  loadOwnedAssessment: (input: { prospectId: number, publicId: string }) => Promise<unknown>
  createRequest: (input: CreateRequestInput) => Promise<unknown>
  loadRequest: (input: { prospectId: number, requestId?: number }) => Promise<unknown>
  recordEvent: EventWriter
}

const parseStoreValue = <Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  errorCode: string,
): z.infer<Schema> => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error(errorCode)
  return parsed.data
}

const publicStatus = (rawValue: unknown): StudentCounselingStatus => {
  const request = parseStoreValue(storedRequestSchema, rawValue, 'COUNSELING_STORE_INVALID')
  const roleOrder = { primary: 0, backup: 1, specialist: 2 } as const
  return parseStoreValue(studentCounselingStatusSchema, {
    id: request.publicId,
    assessmentPublicId: request.assessmentPublicId,
    status: request.status,
    contactMethod: request.contactMethod,
    availability: request.availability,
    inquiry: request.inquiry,
    consentedAt: request.consentedAt,
    assignedAt: request.assignedAt,
    contactedAt: request.contactedAt,
    completedAt: request.completedAt,
    closedAt: request.closedAt,
    version: request.version,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    assignedFaculty: request.assignedFaculty,
    recommendations: [...request.recommendations].sort((left, right) => (
      roleOrder[left.role] - roleOrder[right.role] || left.rank - right.rank
    )),
  }, 'COUNSELING_PUBLIC_STATUS_INVALID')
}

const authenticate = async (
  dependencies: CounselingServiceDependencies,
  sessionToken: string,
) => {
  const session = await dependencies.getStudentSession(sessionToken)
  const parsed = studentSessionSchema.safeParse(session)
  if (!parsed.success) {
    if (session === null) throw new AppError('AUTH_FAILED')
    throw new Error('COUNSELING_SESSION_INVALID')
  }
  return parsed.data
}

const recordSafely = async (writer: EventWriter, event: Parameters<EventWriter>[0]) => {
  try {
    await writer(event)
  }
  catch {
    // Product analytics is best-effort after the authoritative request commit succeeds.
  }
}

const toInternalError = (error: unknown): AppError => (
  error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
)

export const createCounselingService = (dependencies: CounselingServiceDependencies) => {
  const requestCounseling = async (
    rawInput: unknown,
    context: CounselingRequestContext,
  ): Promise<StudentCounselingStatus> => {
    try {
      const session = await authenticate(dependencies, context.sessionToken)
      const parsedInput = counselingApplicationSchema.safeParse(rawInput)
      if (!parsedInput.success) throw new AppError('COUNSELING_INVALID')
      const input = parsedInput.data

      const rawAssessment = await dependencies.loadOwnedAssessment({
        prospectId: session.prospectId,
        publicId: input.assessmentPublicId,
      })
      if (rawAssessment === null) throw new AppError('RESULT_NOT_FOUND')
      const assessment = parseStoreValue(
        ownedAssessmentSchema,
        rawAssessment,
        'COUNSELING_ASSESSMENT_STORE_INVALID',
      )
      if (assessment.publicId !== input.assessmentPublicId) {
        throw new Error('COUNSELING_ASSESSMENT_STORE_INVALID')
      }

      const created = parseStoreValue(createdRequestSchema, await dependencies.createRequest({
        prospectId: session.prospectId,
        assessmentId: assessment.assessmentId,
        contactMethod: input.contactMethod,
        availability: input.availability,
        inquiry: input.inquiry,
        consent: input.consent,
      }), 'COUNSELING_RPC_INVALID')

      const stored = parseStoreValue(storedRequestSchema, await dependencies.loadRequest({
        prospectId: session.prospectId,
        requestId: created.requestId,
      }), 'COUNSELING_STORE_INVALID')
      if (stored.requestId !== created.requestId
        || stored.publicId !== created.publicId
        || stored.prospectId !== session.prospectId
        || (created.created && stored.assessmentPublicId !== assessment.publicId)) {
        throw new Error('COUNSELING_STORE_INVALID')
      }

      if (created.created) {
        await recordSafely(dependencies.recordEvent, {
          anonymousId: context.anonymousId,
          campaignId: assessment.campaignId,
          eventName: 'counseling_requested',
          path: COUNSELING_ROUTE,
          prospectId: session.prospectId,
          properties: {
            assessment_id: assessment.assessmentId,
            counseling_request_id: created.requestId,
          },
          requestId: context.requestId,
        })
      }
      return publicStatus(stored)
    }
    catch (error) {
      throw toInternalError(error)
    }
  }

  const getCurrentCounseling = async (
    context: CounselingRequestContext,
  ): Promise<StudentCounselingStatus | null> => {
    try {
      const session = await authenticate(dependencies, context.sessionToken)
      const stored = await dependencies.loadRequest({ prospectId: session.prospectId })
      if (stored === null) return null
      const request = parseStoreValue(storedRequestSchema, stored, 'COUNSELING_STORE_INVALID')
      if (request.prospectId !== session.prospectId) throw new Error('COUNSELING_STORE_INVALID')
      return publicStatus(request)
    }
    catch (error) {
      throw toInternalError(error)
    }
  }

  return { getCurrentCounseling, requestCounseling }
}

const mapRawRequest = (rawValue: unknown) => {
  const row = parseStoreValue(rawRequestSchema, rawValue, 'COUNSELING_STORE_INVALID')
  return {
    requestId: row.id,
    publicId: row.public_id,
    prospectId: row.prospect_id,
    assessmentPublicId: row.assessment_public_id_snapshot,
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
    assignedFaculty: row.assigned_faculty === null ? null : {
      name: row.assigned_faculty.name,
      title: row.assigned_faculty.title,
      expertise: row.assigned_faculty.expertise_summary,
    },
    recommendations: row.recommendations.map(recommendation => ({
      name: recommendation.faculty_name_snapshot,
      title: recommendation.faculty_title_snapshot,
      expertise: recommendation.expertise_snapshot,
      reason: recommendation.reason_snapshot,
      role: recommendation.role,
      rank: recommendation.rank,
    })),
  }
}

export const createSupabaseCounselingDependencies = (
  client: SupabaseClient,
  createSessionReader: typeof createSupabaseStudentSessionReader = createSupabaseStudentSessionReader,
): CounselingServiceDependencies => {
  let sessionReader: ReturnType<typeof createSupabaseStudentSessionReader> | undefined
  return {
    getStudentSession: token => (
      sessionReader ??= createSessionReader(client)
    ).getStudentSession(token),
    loadOwnedAssessment: async ({ prospectId, publicId }) => {
      const { data, error } = await client.from('assessments')
        .select('id,public_id,campaign_id')
        .eq('public_id', publicId)
        .eq('prospect_id', prospectId)
        .eq('status', 'completed')
        .maybeSingle()
      if (error) throw new Error('COUNSELING_STORE_UNAVAILABLE')
      if (data === null) return null
      const row = parseStoreValue(rawOwnedAssessmentSchema, data, 'COUNSELING_STORE_INVALID')
      return { assessmentId: row.id, campaignId: row.campaign_id, publicId: row.public_id }
    },
    createRequest: async input => {
      const { data, error } = await client.rpc('create_counseling_request', {
        p_prospect_id: input.prospectId,
        p_assessment_id: input.assessmentId,
        p_contact_method: input.contactMethod,
        p_availability: input.availability,
        p_inquiry: input.inquiry,
        p_consent_given: input.consent,
      })
      if (error) {
        if (error.code === 'P0002') throw new AppError('RESULT_NOT_FOUND')
        throw new Error('COUNSELING_STORE_UNAVAILABLE')
      }
      if (!Array.isArray(data) || data.length !== 1) throw new Error('COUNSELING_RPC_INVALID')
      const row = parseStoreValue(rawCreateRequestSchema, data[0], 'COUNSELING_RPC_INVALID')
      return {
        requestId: row.counseling_request_id,
        publicId: row.public_id,
        created: row.created,
      }
    },
    loadRequest: async ({ prospectId, requestId }) => {
      let query = client.from('counseling_requests').select(`
        id,
        public_id,
        prospect_id,
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
        assessment_public_id_snapshot,
        assigned_faculty:faculty!counseling_requests_assigned_faculty_fk(name,title,expertise_summary),
        recommendations:counseling_faculty_recommendations(
          faculty_name_snapshot,
          faculty_title_snapshot,
          expertise_snapshot,
          reason_snapshot,
          role,
          rank
        )
      `).eq('prospect_id', prospectId)
      if (requestId === undefined) {
        query = query
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
      }
      else {
        query = query.eq('id', requestId)
      }
      const { data, error } = await query.maybeSingle()
      if (error) throw new Error('COUNSELING_STORE_UNAVAILABLE')
      return data === null ? null : mapRawRequest(data)
    },
    recordEvent: createEventWriter(client),
  }
}

export const getServerCounselingService = () => {
  const client = getServerSupabaseClient()
  return createCounselingService(createSupabaseCounselingDependencies(client))
}
