import { z } from 'zod'
import { assessmentSelectionsSchema } from './assessment'

export const publicExploreSchema = z.object({
  catalogRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  visitorSeed: z.number().int().min(1).max(2_147_483_647),
  selections: assessmentSelectionsSchema,
}).strict()

export const publicCounselingSchema = publicExploreSchema.extend({
  name: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{M} .'-]+$/u),
  phone: z.string().max(20).regex(/^[0-9 -]+$/u)
    .transform(value => value.replace(/[ -]/gu, '')).pipe(z.string().regex(/^010\d{8}$/u)),
  question: z.string().trim().max(1000).refine(value => !value.includes('\u0000')),
  consent: z.literal(true),
  website: z.literal(''),
}).strict()

export type PublicExploreInput = z.infer<typeof publicExploreSchema>
export const PUBLIC_COUNSELING_RECIPIENT = 'photographygju@gmail.com'
