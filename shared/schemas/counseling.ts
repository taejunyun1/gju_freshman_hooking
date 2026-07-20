import { z } from 'zod'

import { applicantStageSchema, regionSchema } from './identity'
import { counselingStatuses, trackKeys } from '../types/domain'

export { counselingStatuses } from '../types/domain'

export const counselingContactMethods = ['phone', 'text', 'visit'] as const
export const counselingAvailabilities = [
  'weekday_morning',
  'weekday_afternoon',
  'weekday_evening',
  'weekend',
] as const

export const counselingStatusSchema = z.enum(counselingStatuses)
export const counselingContactMethodSchema = z.enum(counselingContactMethods)
export const counselingAvailabilitySchema = z.enum(counselingAvailabilities)

const hasNoC0OrC1Controls = (value: string) => [...value].every((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
})

const postgresVersionSchema = z.number().int().min(0).max(2_147_483_647)
const safeStoredText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim(), '저장된 텍스트는 앞뒤 공백을 포함할 수 없습니다.')
  .refine(hasNoC0OrC1Controls, '제어문자는 사용할 수 없습니다.')
const counselingTimestampSchema = z.iso.datetime({ offset: true }).max(40)
const storedInquirySchema = z.union([safeStoredText(200), z.null()])

const inquirySchema = z.union([
  z.string().trim().min(1).max(200)
    .refine(hasNoC0OrC1Controls, '제어문자는 사용할 수 없습니다.'),
  z.null(),
])

export const counselingApplicationSchema = z.object({
  assessmentPublicId: z.string().uuid().transform(value => value.toLowerCase()),
  contactMethod: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: inquirySchema,
  consent: z.literal(true),
}).strict()

export const counselingTransitionSchema = z.object({
  to: z.enum(['assigned', 'contacted', 'completed', 'closed']),
  expectedVersion: postgresVersionSchema,
}).strict()

export const counselingReopenSchema = z.object({
  expectedVersion: postgresVersionSchema,
  reason: z.string().trim().min(1).max(1000)
    .refine(hasNoC0OrC1Controls, '제어문자는 사용할 수 없습니다.'),
}).strict()

export const adminCounselingAssignSchema = z.object({
  assignedFacultyId: z.number().int().positive().safe(),
  expectedVersion: postgresVersionSchema,
}).strict()

export const adminCounselingTransitionSchema = z.object({
  expectedVersion: postgresVersionSchema,
  to: z.enum(['contacted', 'completed', 'closed']),
}).strict()

export const adminCounselingReopenSchema = counselingReopenSchema

const adminFacultySummarySchema = z.object({
  id: z.number().int().positive().safe(),
  name: safeStoredText(100),
  title: safeStoredText(100),
}).strict()

const adminRecommendationSchema = adminFacultySummarySchema.extend({
  role: z.enum(['primary', 'backup', 'specialist']),
  rank: z.number().int().min(1).max(2),
}).strict()

const storedLabelListSchema = z.array(safeStoredText(200)).min(1).max(4)

export const adminCounselingCurrentSchema = z.object({
  id: z.string().uuid(),
  status: counselingStatusSchema,
  version: postgresVersionSchema,
  assignedAt: counselingTimestampSchema.nullable(),
  contactedAt: counselingTimestampSchema.nullable(),
  completedAt: counselingTimestampSchema.nullable(),
  closedAt: counselingTimestampSchema.nullable(),
  updatedAt: counselingTimestampSchema,
  assignedFaculty: adminFacultySummarySchema.nullable(),
}).strict()

export const adminCounselingQueueItemSchema = adminCounselingCurrentSchema.extend({
  assessmentPublicId: z.string().uuid(),
  primaryTrack: z.enum(trackKeys),
  secondaryTrack: z.enum(trackKeys),
  selectedWorkLabels: storedLabelListSchema.max(4),
  selectedCareerLabels: storedLabelListSchema.max(2),
  nickname: safeStoredText(100),
  maskedPhone: z.string().regex(/^010-\*{4}-\d{4}$/u),
  schoolName: safeStoredText(40),
  applicantStage: applicantStageSchema,
  region: regionSchema,
  contactMethod: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  consentedAt: counselingTimestampSchema,
  createdAt: counselingTimestampSchema,
  recommendations: z.array(adminRecommendationSchema).min(2).max(4),
}).strict()

export const adminCounselingQueueSchema = z.object({
  faculty: z.array(adminFacultySummarySchema).max(100),
  items: z.array(adminCounselingQueueItemSchema).max(50),
  nextCursor: z.string().min(1).max(200).nullable(),
}).strict()

const studentCounselingFacultySchema = z.object({
  name: safeStoredText(100),
  title: safeStoredText(100),
  expertise: safeStoredText(1_000),
}).strict()

const studentCounselingRecommendationSchema = studentCounselingFacultySchema.extend({
  reason: safeStoredText(1_000),
  role: z.enum(['primary', 'backup', 'specialist']),
  rank: z.number().int().min(1).max(2),
}).strict()

const studentCounselingRecommendationsSchema = z.array(studentCounselingRecommendationSchema)
  .min(2)
  .max(4)
  .superRefine((recommendations, context) => {
    const roleRanks = new Set<string>()
    const specialistRanks: number[] = []
    let primaryCount = 0
    let backupCount = 0
    let specialistCount = 0
    for (const recommendation of recommendations) {
      const roleRank = `${recommendation.role}:${recommendation.rank}`
      if (roleRanks.has(roleRank)) {
        context.addIssue({ code: 'custom', message: '추천 역할과 순위는 중복될 수 없습니다.' })
      }
      roleRanks.add(roleRank)
      if (recommendation.role === 'primary') primaryCount += 1
      if (recommendation.role === 'backup') backupCount += 1
      if (recommendation.role === 'specialist') {
        specialistCount += 1
        specialistRanks.push(recommendation.rank)
      }
      if (recommendation.role !== 'specialist' && recommendation.rank !== 1) {
        context.addIssue({ code: 'custom', message: '총괄·예비 추천 순위는 1이어야 합니다.' })
      }
    }
    if (primaryCount !== 1 || backupCount !== 1) {
      context.addIssue({ code: 'custom', message: '총괄·예비 추천은 각각 하나여야 합니다.' })
    }
    if (specialistCount > 2) {
      context.addIssue({ code: 'custom', message: '전문분야 추천은 최대 두 명입니다.' })
    }
    specialistRanks.sort((left, right) => left - right)
    if (specialistRanks.some((rank, index) => rank !== index + 1)) {
      context.addIssue({ code: 'custom', message: '전문분야 추천 순위는 1부터 이어져야 합니다.' })
    }
  })

export const studentCounselingStatusSchema = z.object({
  id: z.string().uuid(),
  assessmentPublicId: z.string().uuid(),
  status: counselingStatusSchema,
  contactMethod: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: storedInquirySchema,
  consentedAt: counselingTimestampSchema,
  assignedAt: counselingTimestampSchema.nullable(),
  contactedAt: counselingTimestampSchema.nullable(),
  completedAt: counselingTimestampSchema.nullable(),
  closedAt: counselingTimestampSchema.nullable(),
  version: postgresVersionSchema,
  createdAt: counselingTimestampSchema,
  updatedAt: counselingTimestampSchema,
  assignedFaculty: studentCounselingFacultySchema.nullable(),
  recommendations: studentCounselingRecommendationsSchema,
}).strict().superRefine((request, context) => {
  const hasAssignment = request.assignedAt !== null
  if (hasAssignment !== (request.assignedFaculty !== null)) {
    context.addIssue({ code: 'custom', message: '교수 배정 시점과 담당 교수는 함께 있어야 합니다.' })
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
          : request.closedAt !== null
            && request.completedAt === null
            && (request.assignedAt !== null || request.contactedAt === null)

  if (!stateShapeIsValid) {
    context.addIssue({ code: 'custom', message: '상담 상태와 처리 시점이 일치하지 않습니다.' })
  }
})

export type CounselingApplication = z.infer<typeof counselingApplicationSchema>
export type CounselingContactMethod = z.infer<typeof counselingContactMethodSchema>
export type CounselingAvailability = z.infer<typeof counselingAvailabilitySchema>
export type CounselingTransition = z.infer<typeof counselingTransitionSchema>
export type CounselingReopen = z.infer<typeof counselingReopenSchema>
export type StudentCounselingStatus = z.infer<typeof studentCounselingStatusSchema>
export type AdminCounselingAssign = z.infer<typeof adminCounselingAssignSchema>
export type AdminCounselingTransition = z.infer<typeof adminCounselingTransitionSchema>
export type AdminCounselingReopen = z.infer<typeof adminCounselingReopenSchema>
export type AdminCounselingCurrent = z.infer<typeof adminCounselingCurrentSchema>
export type AdminCounselingQueueItem = z.infer<typeof adminCounselingQueueItemSchema>
export type AdminCounselingQueue = z.infer<typeof adminCounselingQueueSchema>
