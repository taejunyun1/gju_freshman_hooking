import { z } from 'zod'
import { normalizeKoreanPhone } from '../utils/applicant-normalization'

export const phoneSchema = z.string().transform(normalizeKoreanPhone)

export const applicantStageSchema = z.enum(['high1', 'high2', 'high3', 'graduate', 'ged', 'other'])
export const regionSchema = z.enum([
  'gwangju',
  'jeonbuk',
  'capital',
  'chungcheong',
  'gyeongsang',
  'gangwon_jeju',
  'overseas',
  'other',
])

export type ApplicantStage = z.infer<typeof applicantStageSchema>
export type Region = z.infer<typeof regionSchema>

export const registerSchema = z.object({
  phone: phoneSchema,
  schoolName: z.string().trim().min(1).max(40),
  applicantStage: applicantStageSchema,
  region: regionSchema,
})

export const rosterPasswordSchema = z.string().regex(/^(?:\d{6}|\d{4}[A-Z]{2})$/u)

export const studentPinChangeSchema = z.object({
  currentPin: z.string().regex(/^\d{6}$/u),
  nextPin: z.string().regex(/^\d{6}$/u),
  nextPinConfirm: z.string().regex(/^\d{6}$/u),
}).strict().refine(input => input.nextPin === input.nextPinConfirm, {
  message: 'PIN_CONFIRMATION_MISMATCH',
  path: ['nextPinConfirm'],
})

export const studentPinResetSchema = z.object({
  phone: phoneSchema,
  deleteInterestHistory: z.literal(true),
}).strict()

export const loginSchema = z.object({
  phone: phoneSchema,
  password: rosterPasswordSchema,
})
