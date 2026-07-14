import { z } from 'zod'
import { normalizeKoreanPhone } from '../../server/modules/identity/phone'

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

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(7).max(128),
})
