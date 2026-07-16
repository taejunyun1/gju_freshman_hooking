import { z } from 'zod'

import { careerNarrativeReportCategorySchema } from './career-narrative-report'
import { questionGroups, trackKeys } from '../types/domain'

export const adminNarrativeReportStatuses = [
  'open',
  'resolved_inaccurate',
  'resolved_unsafe',
  'resolved_copy',
  'dismissed',
] as const

export const adminNarrativeReportResolutions = [
  'resolved_inaccurate',
  'resolved_unsafe',
  'resolved_copy',
  'dismissed',
] as const

export const adminNarrativeReportStatusSchema = z.enum(adminNarrativeReportStatuses)
export const adminNarrativeReportResolutionSchema = z.enum(adminNarrativeReportResolutions)

const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const canonicalUuidSchema = z.string().uuid()
const cleanText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim())
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }))

export const adminNarrativeReportItemSchema = z.object({
  id: z.number().int().positive().safe(),
  category: careerNarrativeReportCategorySchema,
  priority: z.enum(['urgent', 'standard']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  status: adminNarrativeReportStatusSchema,
  assessmentPublicId: canonicalUuidSchema,
  resultPath: z.string().regex(/^\/api\/admin\/narrative-reports\/[1-9][0-9]{0,15}\/result$/u),
}).strict()

export const adminNarrativeReportListSchema = z.object({
  items: z.array(adminNarrativeReportItemSchema).max(50),
  nextCursor: z.string().min(1).max(240).nullable(),
}).strict()

export const adminNarrativeReportResolveInputSchema = z.object({
  expectedUpdatedAt: timestampSchema,
  resolution: adminNarrativeReportResolutionSchema,
}).strict()

export const adminNarrativeReportReviewSchema = z.object({
  reportId: z.number().int().positive().safe(),
  assessmentPublicId: canonicalUuidSchema,
  selectedInterests: z.array(z.object({
    group: z.enum(questionGroups),
    label: cleanText(200),
  }).strict()).min(4).max(11),
  rankedTracks: z.tuple([
    z.enum(trackKeys),
    z.enum(trackKeys),
    z.enum(trackKeys),
    z.enum(trackKeys),
  ]).refine(values => new Set(values).size === 4),
  learningCourseTitles: z.array(cleanText(200)).max(16),
  faculty: z.object({
    primary: z.object({
      name: cleanText(100),
      title: cleanText(100),
      expertise: cleanText(500),
    }).strict(),
    specialists: z.array(z.object({
      name: cleanText(100),
      title: cleanText(100),
      expertise: cleanText(500),
    }).strict()).max(8),
  }).strict(),
  narrativeSentences: z.tuple([
    cleanText(520),
    cleanText(520),
    cleanText(520),
    cleanText(520),
  ]),
}).strict()

export type AdminNarrativeReportItem = z.infer<typeof adminNarrativeReportItemSchema>
export type AdminNarrativeReportList = z.infer<typeof adminNarrativeReportListSchema>
export type AdminNarrativeReportResolveInput = z.infer<typeof adminNarrativeReportResolveInputSchema>
export type AdminNarrativeReportResolution = z.infer<typeof adminNarrativeReportResolutionSchema>
export type AdminNarrativeReportReview = z.infer<typeof adminNarrativeReportReviewSchema>
