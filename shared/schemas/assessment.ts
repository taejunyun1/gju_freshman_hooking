import { z } from 'zod'
import {
  questionGroups,
  trackKeys,
  visualKeys,
} from '../types/domain'

export { questionGroups, trackKeys, trackLabels, visualKeys } from '../types/domain'

export const selectionLimits = {
  work: { min: 1, max: 4, weight: 0.40 },
  result: { min: 1, max: 3, weight: 0.30 },
  style: { min: 1, max: 2, weight: 0.10 },
  career: { min: 1, max: 2, weight: 0.20 },
} as const

const trackWeightSchema = z.number().int().min(0).max(3)
const optionKeySchemas = {
  work: z.string().regex(/^work\.[a-z][a-z0-9_]*$/u),
  result: z.string().regex(/^result\.[a-z][a-z0-9_]*$/u),
  style: z.string().regex(/^style\.[a-z][a-z0-9_]*$/u),
  career: z.string().regex(/^career\.[a-z][a-z0-9_]*$/u),
} as const

const uniqueLimitedSelection = <T extends z.ZodType<string>>(
  schema: T,
  limits: { min: number, max: number },
) => z.array(schema)
  .min(limits.min)
  .max(limits.max)
  .refine(values => new Set(values).size === values.length, '선택지는 중복할 수 없습니다.')

const emailPattern = /[^\s@]+@[^\s@]+\.[^\s@]+/u
const phonePattern = /(?:(?:\+?82)[-.\s]?(?:0)?\d{1,2}|0\d{1,2})[-.\s)]?\d{3,4}[-.\s]?\d{4}/u
const containsControlCharacter = (value: string) => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
})
const careerOtherSchema = z.union([z.string(), z.null()])
  .superRefine((value, context) => {
    if (typeof value === 'string' && containsControlCharacter(value)) {
      context.addIssue({
        code: 'custom',
        message: '줄바꿈이나 제어문자는 입력할 수 없습니다.',
      })
    }
  })
  .transform(value => value === null || value.trim() === '' ? null : value.trim())

export const assessmentSelectionsSchema = z.object({
  work: uniqueLimitedSelection(optionKeySchemas.work, selectionLimits.work),
  result: uniqueLimitedSelection(optionKeySchemas.result, selectionLimits.result),
  style: uniqueLimitedSelection(optionKeySchemas.style, selectionLimits.style),
  career: uniqueLimitedSelection(optionKeySchemas.career, selectionLimits.career),
  careerOther: careerOtherSchema,
}).strict().superRefine((selections, context) => {
  if (selections.careerOther === null) {
    return
  }

  if (!selections.career.includes('career.explore')) {
    context.addIssue({
      code: 'custom',
      message: '기타 관심사는 가능성 탐색을 선택한 경우에만 입력할 수 있습니다.',
      path: ['careerOther'],
    })
  }

  if (selections.careerOther.length > 30) {
    context.addIssue({
      code: 'too_big',
      maximum: 30,
      origin: 'string',
      inclusive: true,
      message: '기타 관심사는 30자 이하로 입력해 주세요.',
      path: ['careerOther'],
    })
  }

  if (
    emailPattern.test(selections.careerOther)
    || phonePattern.test(selections.careerOther)
  ) {
    context.addIssue({
      code: 'custom',
      message: '전화번호나 이메일 주소는 입력할 수 없습니다.',
      path: ['careerOther'],
    })
  }
})

export const assessmentSubmissionSchema = z.object({
  catalogRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  selections: assessmentSelectionsSchema,
}).strict()

export const assessmentCatalogOptionSchema = z.object({
  group: z.enum(questionGroups),
  optionKey: z.string(),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500).optional(),
  visualKey: z.enum(visualKeys),
  trackWeights: z.object({
    documentary: trackWeightSchema,
    art_photo: trackWeightSchema,
    commercial: trackWeightSchema,
    video: trackWeightSchema,
  }).strict().refine(
    weights => trackKeys.some(track => weights[track] > 0),
    'track weights must have a positive total',
  ),
  interestTags: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)).min(1).max(8)
    .refine(tags => new Set(tags).size === tags.length, 'interest tags must be unique'),
  status: z.enum(['draft', 'active', 'archived']),
  sortOrder: z.number().int().min(1).max(100),
}).strict()
