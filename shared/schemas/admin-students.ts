import { z } from 'zod'

import { counselingAvailabilitySchema, counselingContactMethodSchema, counselingStatusSchema } from './counseling'
import { applicantStageSchema, regionSchema } from './identity'
import { trackKeys } from '../types/domain'

const safeIdSchema = z.number().int().positive().safe()
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const safeStoredText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim(), '저장된 텍스트는 앞뒤 공백을 포함할 수 없습니다.')
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }), '제어문자는 사용할 수 없습니다.')

export const adminStudentListItemSchema = z.object({
  id: safeIdSchema,
  nickname: safeStoredText(100),
  phone: z.string().regex(/^010-\*{4}-\d{4}$/u),
  schoolName: safeStoredText(40),
  applicantStage: applicantStageSchema,
  region: regionSchema,
  status: z.enum(['active', 'inactive']),
  cycleId: z.string().uuid().optional(),
  isTest: z.boolean().optional(),
  passwordGeneration: safeIdSchema.optional(),
  lastActiveAt: timestampSchema,
  createdAt: timestampSchema,
}).strict()

export const adminStudentsListSchema = z.object({
  items: z.array(adminStudentListItemSchema).max(50),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]+$/u).min(1).max(200).nullable(),
}).strict()

const trackScoresSchema = z.object({
  documentary: z.number().finite().min(0).max(100),
  art_photo: z.number().finite().min(0).max(100),
  commercial: z.number().finite().min(0).max(100),
  video: z.number().finite().min(0).max(100),
}).strict()

const resultSchema = z.object({
  id: z.string().uuid(),
  completedAt: timestampSchema,
  primaryTrack: z.enum(trackKeys),
  secondaryTrack: z.enum(trackKeys),
  trackScores: trackScoresSchema,
}).strict().refine(result => result.primaryTrack !== result.secondaryTrack)

const assignedFacultySchema = z.object({
  id: safeIdSchema,
  name: safeStoredText(100),
  title: safeStoredText(100),
}).strict()

const counselingSchema = z.object({
  id: z.string().uuid(),
  status: counselingStatusSchema,
  contactMethod: counselingContactMethodSchema,
  availability: counselingAvailabilitySchema,
  inquiry: safeStoredText(200).nullable(),
  assignedFaculty: assignedFacultySchema.nullable(),
  createdAt: timestampSchema,
}).strict()

export const adminStudentDetailSchema = z.object({
  student: adminStudentListItemSchema,
  recentResults: z.array(resultSchema).max(3),
  counseling: z.array(counselingSchema).max(100),
}).strict()

export const adminStudentPhoneRevealSchema = z.object({
  phone: z.string().regex(/^010\d{8}$/u),
}).strict()

export const adminStudentFilterKeys = [
  'query',
  'stage',
  'region',
  'school',
  'track',
  'counselingStatus',
  'dateFrom',
  'dateTo',
] as const

export type AdminStudentListItem = z.infer<typeof adminStudentListItemSchema>
export type AdminStudentsList = z.infer<typeof adminStudentsListSchema>
export type AdminStudentDetail = z.infer<typeof adminStudentDetailSchema>
export type AdminStudentPhoneReveal = z.infer<typeof adminStudentPhoneRevealSchema>
export type AdminStudentFilterKey = typeof adminStudentFilterKeys[number]
export type AdminStudentFilters = Record<AdminStudentFilterKey, string>
