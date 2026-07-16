import { z } from 'zod'

import { facultyResultSchema, resultFacultySchema } from '../../../shared/schemas/result'
import type { FacultyPublicContacts, FacultyResult } from '../../../shared/types/result'

const trackKeys = ['documentary', 'art_photo', 'commercial', 'video'] as const
const tagCategories = ['track', 'activity', 'result', 'career', 'specialist'] as const
const contactFields = ['office', 'phone', 'email', 'website'] as const

type TrackKey = typeof trackKeys[number]
type TagCategory = typeof tagCategories[number]
type ContactField = typeof contactFields[number]
type ContactVisibility = 'public' | 'admin_only' | 'hidden'

export interface FacultyRecommendationTag {
  readonly key: string
  readonly label: string
  readonly category: TagCategory
  readonly weight: number
  readonly isPrimary: boolean
}

export interface FacultyRecommendationCandidate {
  readonly id: number
  readonly name: string
  readonly title: string
  readonly expertise: string
  readonly status: 'active' | 'draft' | 'archived'
  readonly employmentType: 'full_time' | 'adjunct' | 'practitioner'
  readonly consultationRole: 'primary' | 'specialist'
  readonly weeklyCapacity: number
  readonly openAssignedCount: number
  readonly priority: number
  readonly contacts: Partial<Record<ContactField, string>>
  readonly contactVisibility: Record<ContactField, ContactVisibility>
  readonly tags: readonly FacultyRecommendationTag[]
}

export interface FacultySpecialistLink {
  readonly primaryFacultyId: number | null
  readonly specialistFacultyId: number
  readonly tagKey: string
  readonly priority: number
}

export interface FacultyStudentEvidence {
  readonly trackScores: Readonly<Record<TrackKey, number>>
  readonly interestVector: Readonly<Record<string, number>>
  readonly selectedLabels: Readonly<Record<string, string>>
}

export interface RecommendFacultyInput {
  readonly student: FacultyStudentEvidence
  readonly faculty: readonly FacultyRecommendationCandidate[]
  readonly specialistLinks: readonly FacultySpecialistLink[]
}

export interface FacultyRecommendationResult {
  readonly primary: FacultyResult<'primary'>
  readonly backup: FacultyResult<'backup'>
  readonly specialists: readonly FacultyResult<'specialist'>[]
  readonly facultyFit: number
}

const hasOnlyPairedUtf16Surrogates = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (index + 1 >= value.length || next < 0xDC00 || next > 0xDFFF) return false
      index += 1
    }
    else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) return false
  }
  return true
}

const hasNoControlCharacters = (value: string): boolean => [...value].every((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
})

const boundedText = (minimum: number, maximum: number) => z.string()
  .min(minimum)
  .max(maximum)
  .refine(value => value === value.trim())
  .refine(hasOnlyPairedUtf16Surrogates)
  .refine(hasNoControlCharacters)

const safeIdSchema = z.number().int().positive().safe()
const nonnegativeIntegerSchema = z.number().int().nonnegative().safe()
const tagKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)
const selectedLabelSchema = boundedText(1, 200).refine(label => /[가-힣]/u.test(label))
const scoreSchema = z.number().finite().min(0).max(100)
const interestSchema = z.number().finite().min(0).max(1)

const publicHttpsUrlSchema = boundedText(8, 500).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.hash === ''
  }
  catch {
    return false
  }
})

const contactVisibilitySchema = z.object({
  office: z.enum(['public', 'admin_only', 'hidden']),
  phone: z.enum(['public', 'admin_only', 'hidden']),
  email: z.enum(['public', 'admin_only', 'hidden']),
  website: z.enum(['public', 'admin_only', 'hidden']),
}).strict()

const contactsSchema = z.object({
  office: boundedText(1, 200).optional(),
  phone: boundedText(1, 40).regex(/^[+0-9(). -]+$/u).optional(),
  email: z.email().max(254).optional(),
  website: publicHttpsUrlSchema.optional(),
}).strict()

const facultyTagSchema = z.object({
  key: tagKeySchema,
  label: boundedText(1, 200),
  category: z.enum(tagCategories),
  weight: z.number().int().min(0).max(3),
  isPrimary: z.boolean(),
}).strict()

const facultyCandidateSchema = z.object({
  id: safeIdSchema,
  name: boundedText(1, 100),
  title: boundedText(1, 100),
  expertise: boundedText(1, 1000),
  status: z.enum(['active', 'draft', 'archived']),
  employmentType: z.enum(['full_time', 'adjunct', 'practitioner']),
  consultationRole: z.enum(['primary', 'specialist']),
  weeklyCapacity: nonnegativeIntegerSchema,
  openAssignedCount: nonnegativeIntegerSchema,
  priority: nonnegativeIntegerSchema,
  contacts: contactsSchema,
  contactVisibility: contactVisibilitySchema,
  tags: z.array(facultyTagSchema),
}).strict()

const studentEvidenceSchema = z.object({
  trackScores: z.object({
    documentary: scoreSchema,
    art_photo: scoreSchema,
    commercial: scoreSchema,
    video: scoreSchema,
  }).strict(),
  interestVector: z.record(tagKeySchema, interestSchema),
  selectedLabels: z.record(tagKeySchema, selectedLabelSchema),
}).strict()

const specialistLinkSchema = z.object({
  primaryFacultyId: safeIdSchema.nullable(),
  specialistFacultyId: safeIdSchema,
  tagKey: tagKeySchema,
  priority: nonnegativeIntegerSchema,
}).strict()

const recommendFacultyInputSchema = z.object({
  student: studentEvidenceSchema,
  faculty: z.array(facultyCandidateSchema),
  specialistLinks: z.array(specialistLinkSchema),
}).strict()

type ParsedInput = z.infer<typeof recommendFacultyInputSchema>
type ParsedStudent = ParsedInput['student']
type ParsedFaculty = ParsedInput['faculty'][number]
type ParsedTag = ParsedFaculty['tags'][number]

const trackKeySet = new Set<string>(trackKeys)
const categoryOrder = new Map<TagCategory, number>(tagCategories.map((category, index) => (
  [category, index]
)))

const compareText = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
)

const compareTags = (left: ParsedTag, right: ParsedTag): number => (
  compareText(left.key, right.key)
  || (categoryOrder.get(left.category) ?? 0) - (categoryOrder.get(right.category) ?? 0)
  || right.weight - left.weight
)

const roundOneDecimal = (value: number): number => Math.round((value + Number.EPSILON) * 10) / 10

const signalForTag = (student: ParsedStudent, tag: ParsedTag): number => {
  if (tag.category === 'track' && trackKeySet.has(tag.key)) {
    return student.trackScores[tag.key as TrackKey]
  }
  return (student.interestVector[tag.key] ?? 0) * 100
}

const categoryMatch = (
  student: ParsedStudent,
  tags: readonly ParsedTag[],
  category: TagCategory,
): number => {
  const categoryTags = tags.filter(tag => tag.category === category).sort(compareTags)
  const totalWeight = categoryTags.reduce((sum, tag) => sum + tag.weight, 0)
  if (totalWeight === 0) return 0
  return categoryTags.reduce(
    (sum, tag) => sum + signalForTag(student, tag) * tag.weight,
    0,
  ) / totalWeight
}

const assertUniqueInput = (input: ParsedInput): void => {
  const facultyIds = new Set<number>()
  for (const candidate of input.faculty) {
    if (facultyIds.has(candidate.id)) throw new Error('FACULTY_INPUT_DUPLICATE_ID')
    facultyIds.add(candidate.id)

    const tagIdentities = new Set<string>()
    for (const tag of candidate.tags) {
      const identity = `${tag.key}|${tag.category}`
      if (tagIdentities.has(identity)) throw new Error('FACULTY_INPUT_DUPLICATE_TAG')
      tagIdentities.add(identity)
    }
  }

  const links = new Set<string>()
  for (const link of input.specialistLinks) {
    const identity = `${link.primaryFacultyId ?? ''}|${link.specialistFacultyId}|${link.tagKey}`
    if (links.has(identity)) throw new Error('FACULTY_INPUT_DUPLICATE_LINK')
    links.add(identity)
  }
}

const assertLinkReferences = (input: ParsedInput): void => {
  const byId = new Map(input.faculty.map(candidate => [candidate.id, candidate]))
  for (const link of input.specialistLinks) {
    const specialist = byId.get(link.specialistFacultyId)
    const primary = link.primaryFacultyId === null ? null : byId.get(link.primaryFacultyId)
    if (!specialist
      || specialist.consultationRole !== 'specialist'
      || specialist.employmentType === 'full_time'
      || (link.primaryFacultyId !== null && (!primary
        || primary.consultationRole !== 'primary'
        || primary.employmentType !== 'full_time'))
      || !specialist.tags.some(tag => tag.key === link.tagKey && tag.category === 'specialist')) {
      throw new Error('FACULTY_LINK_REFERENCE_INVALID')
    }
  }
}

const assertLabelEvidence = (student: ParsedStudent): void => {
  for (const [key, score] of Object.entries(student.interestVector)) {
    if (score > 0 && student.selectedLabels[key] === undefined) {
      throw new Error('FACULTY_LABEL_EVIDENCE_MISSING')
    }
  }
}

interface PrimaryScore {
  readonly candidate: ParsedFaculty
  readonly rawScore: number
  readonly baseScore: number
}

const scorePrimary = (student: ParsedStudent, candidate: ParsedFaculty): PrimaryScore => {
  const tags = [...candidate.tags].sort(compareTags)
  const track = categoryMatch(student, tags, 'track')
  const activity = categoryMatch(student, tags, 'activity')
  const result = categoryMatch(student, tags, 'result')
  const career = categoryMatch(student, tags, 'career')
  const load = Math.max(0, 1 - candidate.openAssignedCount / candidate.weeklyCapacity) * 100
  const baseScore = track * 0.40 + activity * 0.25 + result * 0.15 + career * 0.15
  return { candidate, baseScore, rawScore: baseScore + load * 0.05 }
}

const strongestGlobalEvidenceKey = (student: ParsedStudent): string | null => {
  return Object.entries(student.interestVector)
    .filter(([key, signal]) => signal > 0 && student.selectedLabels[key] !== undefined)
    .sort((left, right) => right[1] - left[1] || compareText(left[0], right[0]))[0]?.[0] ?? null
}

const strongestFacultyEvidenceKey = (
  student: ParsedStudent,
  candidate: ParsedFaculty,
): string => {
  const matched = [...candidate.tags]
    .map(tag => ({ tag, signal: signalForTag(student, tag) }))
    .filter(match => match.signal > 0
      && match.tag.weight > 0
      && student.selectedLabels[match.tag.key] !== undefined)
    .sort((left, right) => (
      right.signal * right.tag.weight - left.signal * left.tag.weight
      || right.tag.weight - left.tag.weight
      || compareText(left.tag.key, right.tag.key)
    ))[0]
  const key = matched?.tag.key ?? strongestGlobalEvidenceKey(student)
  if (!key || student.selectedLabels[key] === undefined) {
    throw new Error('FACULTY_LABEL_EVIDENCE_MISSING')
  }
  return key
}

const publicContactsFor = (candidate: ParsedFaculty): FacultyPublicContacts => {
  const contacts: Record<string, string> = {}
  for (const field of contactFields) {
    const value = candidate.contacts[field]
    if (candidate.contactVisibility[field] === 'public' && value !== undefined) {
      contacts[field] = value
    }
  }
  return contacts
}

const reasonFor = (
  student: ParsedStudent,
  candidate: ParsedFaculty,
  role: 'primary' | 'backup' | 'specialist',
): string => {
  const key = strongestFacultyEvidenceKey(student, candidate)
  const label = student.selectedLabels[key]!
  let reason: string
  if (role === 'primary') {
    reason = `선택한 ‘${label}’ 관심을 ${candidate.name} ${candidate.title}의 ${candidate.expertise} 전문분야와 함께 살펴보는 추천 총괄교수입니다.`
  }
  else if (role === 'backup') {
    reason = `선택한 ‘${label}’ 관심을 ${candidate.name} ${candidate.title}의 ${candidate.expertise} 전문분야와 함께 살펴볼 예비 상담교수로 추천합니다.`
  }
  else {
    reason = `선택한 ‘${label}’ 관심은 ${candidate.name} ${candidate.title}의 ${candidate.expertise} 전문분야와 연결되어 선택적으로 함께 살펴볼 전문 연계입니다.`
  }
  if (reason.length <= 1_000) return reason
  if (role === 'primary') {
    return `${candidate.name} ${candidate.title}와 선택한 관심의 전체 학습경로를 함께 살펴보는 추천 총괄교수입니다.`
  }
  if (role === 'backup') {
    return `${candidate.name} ${candidate.title}와 선택한 관심을 함께 살펴볼 예비 상담교수로 추천합니다.`
  }
  return `${candidate.name} ${candidate.title}와 선택한 관심을 선택적으로 함께 살펴볼 전문 연계입니다.`
}

const resultFor = <Role extends 'primary' | 'backup' | 'specialist'>(
  student: ParsedStudent,
  candidate: ParsedFaculty,
  role: Role,
): FacultyResult<Role> => {
  const result = {
    role,
    id: candidate.id,
    name: candidate.name,
    title: candidate.title,
    expertise: candidate.expertise,
    reason: reasonFor(student, candidate, role),
    publicContacts: publicContactsFor(candidate),
  }
  const parsed = facultyResultSchema.safeParse(result)
  if (!parsed.success) throw new Error('FACULTY_OUTPUT_INVALID')
  return parsed.data as FacultyResult<Role>
}

interface SpecialistScore {
  readonly candidate: ParsedFaculty
  readonly rawScore: number
}

const scoreSpecialist = (student: ParsedStudent, candidate: ParsedFaculty): SpecialistScore => {
  const tags = [...candidate.tags].sort(compareTags)
  const specialist = categoryMatch(student, tags, 'specialist')
  const result = categoryMatch(student, tags, 'result')
  const career = categoryMatch(student, tags, 'career')
  const components = [
    { category: 'specialist' as const, score: specialist, weight: 0.50 },
    { category: 'result' as const, score: result, weight: 0.30 },
    { category: 'career' as const, score: career, weight: 0.20 },
  ].filter(component => tags.some(tag => (
    tag.category === component.category && tag.weight > 0
  )))
  const availableWeight = components.reduce((sum, component) => sum + component.weight, 0)
  const weightedScore = components.reduce(
    (sum, component) => sum + component.score * component.weight,
    0,
  )
  return { candidate, rawScore: availableWeight === 0 ? 0 : weightedScore / availableWeight }
}

const hasPositiveLinkSignal = (student: ParsedStudent, tagKey: string): boolean => (
  (student.interestVector[tagKey] ?? 0) > 0
  || (trackKeySet.has(tagKey) && student.trackScores[tagKey as TrackKey] > 0)
)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export const recommendFaculty = (rawInput: RecommendFacultyInput): FacultyRecommendationResult => {
  const parsedInput = recommendFacultyInputSchema.safeParse(rawInput)
  if (!parsedInput.success) throw new Error('FACULTY_INPUT_INVALID')
  const input = parsedInput.data
  assertUniqueInput(input)
  assertLinkReferences(input)
  assertLabelEvidence(input.student)

  const primaryScores = input.faculty
    .filter(candidate => candidate.status === 'active'
      && candidate.employmentType === 'full_time'
      && candidate.consultationRole === 'primary'
      && candidate.weeklyCapacity > 0)
    .map(candidate => scorePrimary(input.student, candidate))
    .sort((left, right) => (
      right.rawScore - left.rawScore
      || left.candidate.openAssignedCount - right.candidate.openAssignedCount
      || right.candidate.priority - left.candidate.priority
      || left.candidate.id - right.candidate.id
    ))

  if (primaryScores.length < 2) throw new Error('FACULTY_CONTENT_NOT_READY')
  const chosenPrimary = primaryScores[0]!
  const chosenBackup = primaryScores[1]!

  const eligibleSpecialistIds = new Set(input.specialistLinks
    .filter(link => (link.primaryFacultyId === null
      || link.primaryFacultyId === chosenPrimary.candidate.id)
      && hasPositiveLinkSignal(input.student, link.tagKey))
    .map(link => link.specialistFacultyId))

  const specialistScores = input.faculty
    .filter(candidate => candidate.status === 'active'
      && candidate.consultationRole === 'specialist'
      && (candidate.employmentType === 'adjunct' || candidate.employmentType === 'practitioner')
      && eligibleSpecialistIds.has(candidate.id))
    .map(candidate => scoreSpecialist(input.student, candidate))
    .filter(candidate => candidate.rawScore >= 50)
    .sort((left, right) => (
      right.rawScore - left.rawScore
      || right.candidate.priority - left.candidate.priority
      || left.candidate.id - right.candidate.id
    ))
    .slice(0, 2)

  const primary = resultFor(input.student, chosenPrimary.candidate, 'primary')
  const backup = resultFor(input.student, chosenBackup.candidate, 'backup')
  const specialists = specialistScores.map(({ candidate }) => (
    resultFor(input.student, candidate, 'specialist')
  ))
  const resultFaculty = { primary, backup, specialists }
  const canonical = resultFacultySchema.safeParse(resultFaculty)
  if (!canonical.success) throw new Error('FACULTY_OUTPUT_INVALID')

  const facultyFit = roundOneDecimal(Math.min(100, chosenPrimary.baseScore / 0.95))
  return deepFreeze({ ...canonical.data, facultyFit }) as FacultyRecommendationResult
}
