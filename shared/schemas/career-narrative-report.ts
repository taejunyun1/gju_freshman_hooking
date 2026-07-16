import { z } from 'zod'

export const careerNarrativeReportCategories = [
  'inaccurate',
  'unsafe',
  'confusing',
] as const

export const careerNarrativeReportCategorySchema = z.enum(careerNarrativeReportCategories)

export const canonicalAssessmentPublicIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
)

export const careerNarrativeReportInputSchema = z.object({
  assessmentPublicId: canonicalAssessmentPublicIdSchema,
  category: careerNarrativeReportCategorySchema,
}).strict()

export const careerNarrativeReportResultSchema = z.object({
  accepted: z.literal(true),
}).strict()

export const careerNarrativeReportApiSuccessSchema = z.object({
  data: careerNarrativeReportResultSchema,
  requestId: z.string().min(1),
}).strict()

export type CareerNarrativeReportCategory = z.infer<typeof careerNarrativeReportCategorySchema>
export type CareerNarrativeReportInput = z.infer<typeof careerNarrativeReportInputSchema>
export type CareerNarrativeReportResult = z.infer<typeof careerNarrativeReportResultSchema>
