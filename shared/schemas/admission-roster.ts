import { z } from 'zod'

import {
  normalizeApplicantName,
  normalizeApplicantStage,
  normalizeKoreanPhone,
} from '../utils/applicant-normalization'
import { applicantStageSchema, rosterPasswordSchema } from './identity'

export const MAX_APPLICANT_ROSTER_ROWS = 500

export const admissionCycleSchema = z.object({
  id: z.string().uuid(),
  year: z.number().int().min(2000).max(9999),
  status: z.enum(['current', 'archived']),
  rosterVersion: z.number().int().nonnegative(),
  passwordKeyVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
}).strict()

export type AdmissionCycle = z.infer<typeof admissionCycleSchema>

export const applicantRosterRowSchema = z.object({
  name: z.string().transform(normalizeApplicantName),
  phone: z.string().transform(normalizeKoreanPhone),
  highSchool: z.string().trim().min(1).max(40),
  grade: z.string().transform(normalizeApplicantStage).pipe(applicantStageSchema),
}).strict()

export type ApplicantRosterRow = z.infer<typeof applicantRosterRowSchema>

const rosterRowsSchema = z.array(applicantRosterRowSchema).min(1).max(MAX_APPLICANT_ROSTER_ROWS)

export const rosterPreviewRequestSchema = z.object({
  cycleId: z.string().uuid(),
  rows: rosterRowsSchema,
}).strict()

export type RosterPreviewRequest = z.infer<typeof rosterPreviewRequestSchema>

export const rosterPreviewActionSchema = z.enum(['add', 'update', 'unchanged'])
export const rosterChangedFieldSchema = z.enum(['name', 'highSchool', 'grade'])

export const rosterPreviewResultSchema = z.object({
  cycleId: z.string().uuid(),
  rosterVersion: z.number().int().nonnegative(),
  counts: z.object({
    add: z.number().int().nonnegative(),
    update: z.number().int().nonnegative(),
    inactive: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  }).strict(),
  rows: z.array(z.object({
    rowNumber: z.number().int().positive(),
    action: rosterPreviewActionSchema,
    row: applicantRosterRowSchema,
    changedFields: z.array(rosterChangedFieldSchema),
  }).strict()),
  inactiveApplicantIds: z.array(z.number().int().positive()),
}).strict()

export type RosterPreviewResult = z.infer<typeof rosterPreviewResultSchema>

export const rosterApplyRequestSchema = z.object({
  cycleId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
  rows: rosterRowsSchema,
}).strict()

export type RosterApplyRequest = z.infer<typeof rosterApplyRequestSchema>

export const rosterCredentialSchema = z.object({
  name: z.string().transform(normalizeApplicantName),
  phone: z.string().transform(normalizeKoreanPhone),
  password: rosterPasswordSchema,
}).strict()

export type RosterCredential = z.infer<typeof rosterCredentialSchema>

export const rosterApplyResultSchema = z.object({
  cycleId: z.string().uuid(),
  previousVersion: z.number().int().nonnegative(),
  rosterVersion: z.number().int().positive(),
  counts: z.object({
    add: z.number().int().nonnegative(),
    update: z.number().int().nonnegative(),
    inactive: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  }).strict(),
  credentials: z.array(rosterCredentialSchema).max(MAX_APPLICANT_ROSTER_ROWS),
}).strict()

export type RosterApplyResult = z.infer<typeof rosterApplyResultSchema>
