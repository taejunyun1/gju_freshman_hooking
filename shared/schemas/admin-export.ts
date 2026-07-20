import { z } from 'zod'

import { counselingAvailabilitySchema, counselingContactMethodSchema, counselingStatusSchema } from './counseling'
import { applicantStageSchema, regionSchema } from './identity'
import { trackKeys } from '../types/domain'

const safeIdSchema = z.number().int().positive().safe()
export const adminExportSegmentSchema = z.enum([
  'counseling_requested',
  'completed_without_counseling',
  'not_completed',
])
export const adminExportAssignedFacultySchema = z.union([
  safeIdSchema,
  z.literal('unassigned'),
])
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const storedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim())
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }))
const inputText = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }))
const excludesRawPhone = (value: string) => !/(?:010\d{7,8}|8210\d{7,8})/u.test(value.replace(/[^0-9]/gu, ''))

export const adminExportFilterSchema = z.object({
  query: inputText(100).refine(excludesRawPhone).optional(),
  stage: applicantStageSchema.optional(),
  region: regionSchema.optional(),
  school: inputText(40).refine(excludesRawPhone).optional(),
  track: z.enum(trackKeys).optional(),
  counselingStatus: counselingStatusSchema.optional(),
  exportSegment: adminExportSegmentSchema.optional(),
  assignedFaculty: adminExportAssignedFacultySchema.optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
}).strict().superRefine((filters, context) => {
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'date bounds are reversed' })
  }
})

export const adminExportCreateRequestSchema = z.object({
  filters: adminExportFilterSchema,
}).strict()

export const adminExportJobStatusSchema = z.enum(['created', 'fetching', 'completed', 'failed'])

export const adminExportJobSchema = z.object({
  id: safeIdSchema,
  status: adminExportJobStatusSchema,
  createdAt: timestampSchema,
  filterSnapshot: adminExportFilterSchema,
}).strict()

export const adminExportCompletedJobSchema = adminExportJobSchema.extend({
  status: z.literal('completed'),
}).strict()

export const adminExportDownloadedJobSchema = adminExportCompletedJobSchema.extend({
  downloadedAt: timestampSchema,
}).strict()

export const adminExportStudentSchema = z.object({
  nickname: storedText(100),
  phone: z.string().regex(/^010\d{8}$/u),
  schoolName: storedText(40),
  currentStage: applicantStageSchema,
  region: regionSchema,
  primaryCareer: z.enum(trackKeys).nullable(),
  secondaryCareer: z.enum(trackKeys).nullable(),
  totalParticipation: z.number().int().min(0).max(30_000),
  latestResultAt: timestampSchema.nullable(),
  recommendedFaculty: storedText(100).nullable(),
  assignedFaculty: storedText(100).nullable(),
  counselingStatus: counselingStatusSchema.nullable(),
}).strict()

const selectedLabelsSchema = z.array(storedText(200)).max(4)

export const adminExportAssessmentSchema = z.object({
  nickname: storedText(100),
  sequence: z.number().int().min(1).max(30_000),
  participatedAt: timestampSchema,
  selectedWork: selectedLabelsSchema,
  selectedResult: selectedLabelsSchema,
  selectedStyle: selectedLabelsSchema,
  selectedCareer: selectedLabelsSchema,
  documentaryScore: z.number().finite().min(0).max(100),
  artPhotoScore: z.number().finite().min(0).max(100),
  commercialScore: z.number().finite().min(0).max(100),
  videoScore: z.number().finite().min(0).max(100),
  environmentScore: z.number().finite().min(0).max(100),
  recommendedResources: z.array(storedText(200)).max(29),
}).strict()

export const adminExportCounselingSchema = z.object({
  nickname: storedText(100),
  requestedAt: timestampSchema,
  contactMethod: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: storedText(200).nullable(),
  recommendedPrimaryFaculty: storedText(100),
  recommendedBackupFaculty: storedText(100),
  specialistFaculty: z.array(storedText(100)).max(2),
  assignedFaculty: storedText(100).nullable(),
  status: counselingStatusSchema,
  contactedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  result: z.null(),
  adminNote: storedText(2_000).nullable(),
}).strict()

export const adminExportFailureCodeSchema = z.enum([
  'EXPORT_AUTHORIZATION_FAILED',
  'EXPORT_DOWNLOAD_FAILED',
  'EXPORT_FETCH_FAILED',
  'EXPORT_FILTER_REQUIRED',
  'EXPORT_INTERNAL_ERROR',
  'EXPORT_REAUTH_REQUIRED',
  'EXPORT_ROW_LIMIT_EXCEEDED',
  'EXPORT_SESSION_EXPIRED',
  'EXPORT_WORKBOOK_FAILED',
])

const rowCountsShape = {
  studentRowCount: z.number().int().min(0).max(30_000),
  participationRowCount: z.number().int().min(0).max(30_000),
  counselingRowCount: z.number().int().min(0).max(30_000),
}

export const adminExportCompletionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('completed'),
    ...rowCountsShape,
    downloaded: z.literal(false),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    ...rowCountsShape,
    downloaded: z.literal(false),
    errorCode: adminExportFailureCodeSchema,
  }).strict(),
]).superRefine((input, context) => {
  if (input.studentRowCount + input.participationRowCount + input.counselingRowCount > 30_000) {
    context.addIssue({ code: 'custom', message: 'aggregate row limit exceeded' })
  }
})

export type AdminExportFilter = z.infer<typeof adminExportFilterSchema>
export type AdminExportJob = z.infer<typeof adminExportJobSchema>
export type AdminExportCompletedJob = z.infer<typeof adminExportCompletedJobSchema>
export type AdminExportDownloadedJob = z.infer<typeof adminExportDownloadedJobSchema>
export type AdminExportStudent = z.infer<typeof adminExportStudentSchema>
export type AdminExportAssessment = z.infer<typeof adminExportAssessmentSchema>
export type AdminExportCounseling = z.infer<typeof adminExportCounselingSchema>
export type AdminExportCompletion = z.infer<typeof adminExportCompletionSchema>
export type AdminExportFailureCode = z.infer<typeof adminExportFailureCodeSchema>
