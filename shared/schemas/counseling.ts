import { z } from 'zod'

import { counselingStatuses } from '../types/domain'

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

const inquirySchema = z.union([
  z.string().trim().min(1).max(200)
    .refine(hasNoC0OrC1Controls, '제어문자는 사용할 수 없습니다.'),
  z.null(),
])

export const counselingApplicationSchema = z.object({
  assessmentPublicId: z.string().uuid(),
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

export type CounselingApplication = z.infer<typeof counselingApplicationSchema>
export type CounselingContactMethod = z.infer<typeof counselingContactMethodSchema>
export type CounselingAvailability = z.infer<typeof counselingAvailabilitySchema>
export type CounselingTransition = z.infer<typeof counselingTransitionSchema>
export type CounselingReopen = z.infer<typeof counselingReopenSchema>
