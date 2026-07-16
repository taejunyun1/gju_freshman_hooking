import { z } from 'zod'

import type { CareerNarrative, CareerNarrativeSlot } from '../types/career-narrative'

export const careerNarrativeMaxBytes = 4_096

const evidenceIdSchema = z.string().max(160).regex(
  /^(?:interest:[a-z]+(?:\.[a-z][a-z0-9_]*)?|track:(?:documentary|art_photo|commercial|video)|resource:[1-9]\d*|faculty:(?:primary|specialist):[1-9]\d*:(?:name|title|expertise))$/u,
)

const safeSentenceTextSchema = z.string()
  .min(20)
  .max(140)
  .refine(value => value === value.trim(), '문장 앞뒤 공백을 제거해 주세요.')
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }), '한 줄 문장만 허용됩니다.')

const sentenceSchema = <Slot extends CareerNarrativeSlot>(slot: Slot) => z.object({
  slot: z.literal(slot),
  text: safeSentenceTextSchema,
  evidenceIds: z.array(evidenceIdSchema).min(1).max(6)
    .refine(values => new Set(values).size === values.length, '문장 근거 ID는 중복할 수 없습니다.'),
}).strict()

export const careerNarrativeSchema = z.object({
  source: z.enum(['openai', 'deterministic']),
  sentences: z.tuple([
    sentenceSchema('direction'),
    sentenceSchema('learning_path'),
    sentenceSchema('career_direction'),
    sentenceSchema('faculty_connection'),
  ]),
}).strict().superRefine((narrative, context) => {
  const serialized = JSON.stringify(narrative)
  if (new TextEncoder().encode(serialized).byteLength > careerNarrativeMaxBytes) {
    context.addIssue({
      code: 'custom',
      message: `진로 제안은 UTF-8 ${careerNarrativeMaxBytes}바이트 이하여야 합니다.`,
    })
  }
})

export const decodeCareerNarrative = (input: unknown): CareerNarrative => (
  careerNarrativeSchema.parse(input) as CareerNarrative
)
