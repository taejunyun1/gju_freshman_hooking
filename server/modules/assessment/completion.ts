import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  assessmentCatalogOptionSchema,
  assessmentSelectionsSchema,
  selectionLimits,
} from '../../../shared/schemas/assessment'
import { decodeResultSnapshot } from '../../../shared/schemas/result'
import { questionGroups } from '../../../shared/types/domain'
import type {
  AssessmentOption,
  AssessmentSelections,
  QuestionGroup,
  TrackKey,
} from '../../../shared/types/domain'
import type {
  ResultResource,
  ResultSnapshot,
  ResultSnapshotCore,
  SelectedInterest,
} from '../../../shared/types/result'
import {
  createAbsoluteDeadline,
  defaultDeadlineRunner,
  type AbsoluteDeadline,
  type DeadlineRunner,
} from '../../utils/absolute-deadline'
import { AppError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'
import { sha256, utf8 } from '../../utils/web-crypto'
import { createRosterSessionServiceFromSupabase } from '../identity/student-session'
import { createEventWriter, type EventWriter } from '../metrics/events'
import {
  type FacultyRecommendationCandidate,
  type FacultySpecialistLink,
  recommendFaculty,
} from '../matching/faculty'
import { buildLearningPath } from '../matching/learning-path'
import {
  renderConnectionReason,
  type SelectedInterestEvidence,
} from '../matching/reasons'
import {
  rankResources,
  withPrimaryTrackPathway,
  type ResourceCandidate,
} from '../matching/resources'
import { computeEnvironmentScore } from '../matching/environment-score'
import {
  createServerCareerNarrativeResolver,
  type CareerNarrativeResolution,
} from './career-narrative-generation'
import { createAssessmentCatalogRevision } from './catalog-revision'
import { AssessmentScoringError, scoreAssessment } from './scoring'
import { decodeStoredResultSnapshot } from './stored-result'

const SUBMIT_ROUTE = '/api/assessment/submit' as const
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const catalogRevisionPattern = /^sha256:[a-f0-9]{64}$/u
const tagKeyPattern = /^[a-z][a-z0-9_]{0,63}$/u
const offsetDateTimeSchema = z.iso.datetime({ offset: true }).max(32)
const groupOrder = new Map(questionGroups.map((group, index) => [group, index]))
const interestContributionTieOrder = new Map([
  ['work', 0],
  ['result', 1],
  ['career', 2],
  ['style', 3],
] as const)

type StudentSession = {
  prospectId: number
  nickname: string
  expiresAt: string
}

type RateLimitInput = {
  key: string
  route: string
  limit: number
  window: string
}

export type AssessmentCompletionContext = {
  anonymousId: string
  ip: string
  requestId: string
  sessionToken: string
}

export type OwnedAssessmentContext = {
  anonymousId: string
  requestId: string
  sessionToken: string
}

export type AssessmentResponseSnapshot = {
  group: QuestionGroup
  optionKey: string
  optionLabel: string
  trackWeights: Readonly<Record<TrackKey, number>>
  freeText: string | null
}

export type CompleteAssessmentInput = {
  prospectId: number
  idempotencyKey: string
  campaignId: number | null
  trackScores: Readonly<Record<TrackKey, number>>
  environmentScore: number
  resultSnapshot: ResultSnapshot
  responses: readonly AssessmentResponseSnapshot[]
  narrativeGenerationId: number
}

export type CompleteAssessmentResult = {
  assessmentId: number
  publicId: string
  created: boolean
}

export type StoredCompletedAssessmentSubmission = {
  publicId: string
  responseFingerprint: string
}

export type StoredOwnedAssessment = {
  assessmentId: number
  publicId: string
  campaignId: number | null
  completedAt: string
  resultSnapshot: unknown
}

export type AssessmentHistoryItem = {
  publicId: string
  completedAt: string
  topTrack: TrackKey
  environmentScore: number
  selectedInterests: readonly SelectedInterest[]
}

export type AssessmentCompletionDependencies = {
  getStudentSession: (sessionToken: string) => Promise<StudentSession | null>
  consumeRateLimit: (input: RateLimitInput) => Promise<boolean>
  loadActiveOptions: () => Promise<readonly AssessmentOption[]>
  loadResourceCandidates: () => Promise<readonly ResourceCandidate[]>
  loadFacultyCandidates: () => Promise<{
    faculty: readonly FacultyRecommendationCandidate[]
    specialistLinks: readonly FacultySpecialistLink[]
  }>
  loadCompletedAssessmentByIdempotency: (
    identity: {
      prospectId: number
      idempotencyKey: string
      deadline: AbsoluteDeadline
    },
  ) => Promise<StoredCompletedAssessmentSubmission | null>
  resolveCareerNarrative: (input: {
    prospectId: number
    idempotencyKey: string
    responseFingerprint: string
    coreSnapshot: ResultSnapshotCore
    deadline: AbsoluteDeadline
  }) => Promise<CareerNarrativeResolution>
  completeAssessment: (input: CompleteAssessmentInput) => Promise<CompleteAssessmentResult>
  loadOwnedAssessment: (identity: { prospectId: number, publicId: string }) => Promise<StoredOwnedAssessment | null>
  loadAssessmentHistory: (prospectId: number) => Promise<readonly StoredOwnedAssessment[]>
  recordEvent: EventWriter
  now?: () => string
  monotonicNow?: () => number
  runWithDeadline?: DeadlineRunner
}

type SubmissionEnvelope = {
  catalogRevision: string
  selections: AssessmentSelections
  idempotencyKey: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

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

const isBoundedText = (value: unknown, minimum: number, maximum: number): value is string => (
  typeof value === 'string'
  && value.length >= minimum
  && value.length <= maximum
  && value === value.trim()
  && hasOnlyPairedUtf16Surrogates(value)
  && hasNoControlCharacters(value)
)

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

const isSafeRelativePath = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length >= 1
  && value.length <= 512
  && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value)
  && !/(^|\/)\.{1,2}(\/|$)/u.test(value)
  && !value.includes('//')
)

const isSafePositiveInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
)

const isNonnegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const normalizeCatalog = (input: readonly AssessmentOption[]): AssessmentOption[] => {
  const parsed = assessmentCatalogOptionSchema.array().safeParse(input)
  if (!parsed.success) throw new Error('ASSESSMENT_CATALOG_STORE_INVALID')

  const active = (parsed.data as AssessmentOption[])
    .filter(option => option.status === 'active')
    .sort((left, right) => (
      (groupOrder.get(left.group) ?? Number.MAX_SAFE_INTEGER)
      - (groupOrder.get(right.group) ?? Number.MAX_SAFE_INTEGER)
      || left.sortOrder - right.sortOrder
      || left.optionKey.localeCompare(right.optionKey, 'en')
    ))
  const optionKeys = new Set<string>()
  const sortPositions = new Set<string>()
  for (const option of active) {
    const position = `${option.group}:${option.sortOrder}`
    if (optionKeys.has(option.optionKey) || sortPositions.has(position)) {
      throw new Error('ASSESSMENT_CATALOG_STORE_INVALID')
    }
    optionKeys.add(option.optionKey)
    sortPositions.add(position)
  }
  return active
}

const parseEnvelope = (input: unknown): SubmissionEnvelope => {
  if (!isRecord(input) || Object.keys(input).sort().join('|') !== 'catalogRevision|idempotencyKey|selections') {
    throw new AppError('ASSESSMENT_INVALID')
  }
  if (!canonicalUuidPattern.test(typeof input.idempotencyKey === 'string' ? input.idempotencyKey : '')) {
    throw new AppError('ASSESSMENT_INVALID')
  }
  if (!catalogRevisionPattern.test(typeof input.catalogRevision === 'string' ? input.catalogRevision : '')) {
    throw new AppError('ASSESSMENT_CATALOG_STALE')
  }
  const parsedSelections = assessmentSelectionsSchema.safeParse(input.selections)
  if (!parsedSelections.success) throw new AppError('ASSESSMENT_INVALID')
  return {
    catalogRevision: input.catalogRevision as string,
    idempotencyKey: input.idempotencyKey as string,
    selections: parsedSelections.data as AssessmentSelections,
  }
}

const selectedOptionsInCatalogOrder = (
  catalog: readonly AssessmentOption[],
  selections: AssessmentSelections,
): AssessmentOption[] => {
  const selectedKeys = new Set(questionGroups.flatMap(group => selections[group]))
  const selected = catalog.filter(option => selectedKeys.has(option.optionKey))
  if (selected.length !== selectedKeys.size) throw new AppError('ASSESSMENT_INVALID')
  return selected
}

const responseSnapshots = (
  selected: readonly AssessmentOption[],
  selections: AssessmentSelections,
): AssessmentResponseSnapshot[] => selected.map(option => ({
  group: option.group,
  optionKey: option.optionKey,
  optionLabel: option.label,
  trackWeights: { ...option.trackWeights },
  freeText: option.optionKey === 'career.explore' ? selections.careerOther : null,
}))

export const orderSelectedInterestsByTopTrackContribution = (
  selected: readonly AssessmentOption[],
  topTrack: TrackKey,
): SelectedInterest[] => {
  const selectedCountByGroup = new Map(questionGroups.map(group => [
    group,
    selected.filter(option => option.group === group).length,
  ]))

  return selected
    .map(option => ({
      option,
      contribution: selectionLimits[option.group].weight
        * option.trackWeights[topTrack]
        / (selectedCountByGroup.get(option.group) ?? 1),
    }))
    .sort((left, right) => {
      const contributionDifference = right.contribution - left.contribution
      if (Math.abs(contributionDifference) > Number.EPSILON * 16) return contributionDifference
      return interestContributionTieOrder.get(left.option.group)!
        - interestContributionTieOrder.get(right.option.group)!
        || left.option.sortOrder - right.option.sortOrder
    })
    .map(({ option }) => ({
      group: option.group,
      key: option.optionKey,
      label: option.label,
    }) as SelectedInterest)
}

const selectedLabelsByTag = (
  selected: readonly AssessmentOption[],
  interestVector: Readonly<Record<string, number>>,
): Record<string, string> => {
  const labels: Record<string, string> = {}
  for (const option of selected) {
    for (const key of option.interestTags) labels[key] ??= option.label
  }
  for (const [key, signal] of Object.entries(interestVector)) {
    if (signal > 0 && labels[key] === undefined) throw new Error('ASSESSMENT_LABEL_EVIDENCE_MISSING')
  }
  return labels
}

const assertResourceCandidates = (values: readonly ResourceCandidate[]): void => {
  if (!Array.isArray(values)) throw new Error('RESOURCE_STORE_INVALID')
  const ids = new Set<number>()
  for (const value of values as readonly unknown[]) {
    if (!isRecord(value)
      || !isSafePositiveInteger(value.id)
      || !['course', 'equipment', 'facility', 'extracurricular', 'project', 'student_work', 'career', 'support'].includes(String(value.type))
      || !isBoundedText(value.title, 1, 200)
      || !isBoundedText(value.summary, 1, 1_000)
      || (value.status !== 'active' && value.status !== 'next_year_confirmed')
      || value.visibility !== 'public'
      || !isNonnegativeInteger(value.priority)
      || value.priority > 32767
      || !isIsoDate(value.sourceDate)
      || !isRecord(value.metadata)
      || !Array.isArray(value.tags)
      || value.tags.length === 0) throw new Error('RESOURCE_STORE_INVALID')
    if (ids.has(value.id)) throw new Error('RESOURCE_STORE_INVALID')
    ids.add(value.id)

    const tagKeys = new Set<string>()
    for (const rawTag of value.tags) {
      if (!isRecord(rawTag)
        || typeof rawTag.key !== 'string'
        || !tagKeyPattern.test(rawTag.key)
        || typeof rawTag.weight !== 'number'
        || !Number.isFinite(rawTag.weight)
        || !Number.isInteger(rawTag.weight)
        || rawTag.weight < 0
        || rawTag.weight > 3
        || typeof rawTag.isPrimary !== 'boolean'
      || tagKeys.has(rawTag.key)) throw new Error('RESOURCE_STORE_INVALID')
      tagKeys.add(rawTag.key)
    }

    const metadata = value.metadata
    if (value.type === 'course' && (
      ![1, 2, 3, 4].includes(metadata.gradeYear as number)
      || !isBoundedText(metadata.term, 1, 20)
      || !isNonnegativeInteger(metadata.credits)
      || metadata.credits > 30
      || !isBoundedText(metadata.goalSummary, 1, 800)
      || (metadata.academicYear === 2026
        && metadata.requirementType !== 'major_required'
        && metadata.requirementType !== 'major_elective')
    )) throw new Error('RESOURCE_STORE_INVALID')
    if (value.type === 'equipment' && (
      !isBoundedText(metadata.locationLabel, 1, 120)
      || !isSafePositiveInteger(metadata.confirmedQuantity)
      || metadata.confirmedQuantity > 999
      || metadata.reservationUrl !== 'https://gjureserve.co.kr'
      || !((metadata.accessMode === 'reservation' && metadata.accessLabel === '예약 가능')
        || (metadata.accessMode === 'inquiry' && metadata.accessLabel === '문의 전용'))
    )) throw new Error('RESOURCE_STORE_INVALID')
    if (value.type === 'facility' && (
      !isBoundedText(metadata.locationLabel, 1, 120)
      || !isBoundedText(metadata.operationNote, 1, 1_000)
      || typeof metadata.lastVerifiedAt !== 'string'
      || !offsetDateTimeSchema.safeParse(metadata.lastVerifiedAt).success
    )) throw new Error('RESOURCE_STORE_INVALID')
    if (value.type === 'student_work' && (
      !isSafeRelativePath(metadata.imagePath) || !isBoundedText(metadata.imageAlt, 1, 200)
    )) throw new Error('RESOURCE_STORE_INVALID')
  }
}

const replaceReasonTemplateBraces = (value: string): string => value
  .replaceAll('{', '［')
  .replaceAll('}', '］')

const truncatePairedUtf16 = (value: string, maximum: number): string => {
  if (value.length <= maximum) return value
  let end = maximum
  const lastCodeUnit = value.charCodeAt(end - 1)
  if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) end -= 1
  return value.slice(0, end).trimEnd()
}

const boundedConnectionReason = (input: {
  candidate: ResourceCandidate
  interestVector: Readonly<Record<string, number>>
  selectedInterests: readonly SelectedInterestEvidence[]
}): { goalSummary: string, reason: string } => {
  const originalGoal = input.candidate.type === 'course'
    ? input.candidate.metadata.goalSummary
    : input.candidate.summary
  const safeGoal = replaceReasonTemplateBraces(originalGoal)
  const oneCharacterReason = renderConnectionReason({
    interestVector: input.interestVector,
    selectedInterests: input.selectedInterests,
    resourceTags: input.candidate.tags,
    resourceTitle: input.candidate.title,
    goalSummary: '가',
  })
  const maximumGoalLength = 1_000 - oneCharacterReason.length + 1
  if (maximumGoalLength < 1) throw new Error('RESOURCE_CONNECTION_REASON_INVALID')

  const goalSummary = truncatePairedUtf16(safeGoal, maximumGoalLength)
  const reason = renderConnectionReason({
    interestVector: input.interestVector,
    selectedInterests: input.selectedInterests,
    resourceTags: input.candidate.tags,
    resourceTitle: input.candidate.title,
    goalSummary,
  })
  if (!isBoundedText(reason, 1, 1_000)
    || /[{}]/u.test(reason)
    || !reason.includes(input.candidate.title)
    || !input.selectedInterests.some(evidence => reason.includes(evidence.label))) {
    throw new Error('RESOURCE_CONNECTION_REASON_INVALID')
  }
  return { goalSummary, reason }
}

const prepareResourceCandidates = (input: {
  candidates: readonly ResourceCandidate[]
  interestVector: Readonly<Record<string, number>>
  selectedInterests: readonly SelectedInterestEvidence[]
}): {
  candidates: readonly ResourceCandidate[]
  originalsById: ReadonlyMap<number, ResourceCandidate>
  reasonsById: ReadonlyMap<number, string>
} => {
  const originalsById = new Map(input.candidates.map(candidate => [candidate.id, candidate]))
  const reasonsById = new Map<number, string>()
  const candidates = input.candidates.map((candidate): ResourceCandidate => {
    const hasPositiveMatch = candidate.tags.some(tag => (
      tag.weight > 0 && (input.interestVector[tag.key] ?? 0) > 0
    ))
    if (!hasPositiveMatch) return candidate

    const rendered = boundedConnectionReason({
      candidate,
      interestVector: input.interestVector,
      selectedInterests: input.selectedInterests,
    })
    reasonsById.set(candidate.id, rendered.reason)
    if (candidate.type === 'course') {
      return {
        ...candidate,
        metadata: { ...candidate.metadata, goalSummary: rendered.goalSummary },
      }
    }
    return { ...candidate, summary: rendered.goalSummary }
  })
  return { candidates, originalsById, reasonsById }
}

const restoreRankedResources = <Resource extends ResultResource>(
  resources: readonly Resource[],
  originalsById: ReadonlyMap<number, ResourceCandidate>,
  reasonsById: ReadonlyMap<number, string>,
): readonly Resource[] => resources.map((resource) => {
  const original = originalsById.get(resource.id)
  const connectionReason = reasonsById.get(resource.id)
  if (!original || original.type !== resource.type || !connectionReason) {
    throw new Error('RESOURCE_CONNECTION_REASON_INVALID')
  }
  return Object.freeze({
    ...resource,
    title: original.title,
    summary: original.summary,
    connectionReason,
  }) as unknown as Resource
})

const validCompletionResult = (value: unknown): value is CompleteAssessmentResult => (
  isRecord(value)
  && Object.keys(value).sort().join('|') === 'assessmentId|created|publicId'
  && isSafePositiveInteger(value.assessmentId)
  && typeof value.publicId === 'string'
  && canonicalUuidPattern.test(value.publicId)
  && typeof value.created === 'boolean'
)

const canonicalSelections = (
  selections: AssessmentSelections,
): string => JSON.stringify({
  work: [...selections.work].sort((left, right) => left.localeCompare(right, 'en')),
  result: [...selections.result].sort((left, right) => left.localeCompare(right, 'en')),
  style: [...selections.style].sort((left, right) => left.localeCompare(right, 'en')),
  career: [...selections.career].sort((left, right) => left.localeCompare(right, 'en')),
  careerOther: selections.careerOther,
})

const hexEncode = (value: Uint8Array) => Array.from(
  value,
  byte => byte.toString(16).padStart(2, '0'),
).join('')

export const createAssessmentResponseFingerprint = async (
  selections: AssessmentSelections,
): Promise<string> => `sha256:${hexEncode(
  await sha256(utf8(canonicalSelections(selections))),
)}`

const validCompletedAssessmentSubmission = (
  value: unknown,
): value is StoredCompletedAssessmentSubmission => {
  if (!isRecord(value)
    || Object.keys(value).sort().join('|') !== 'publicId|responseFingerprint'
    || typeof value.publicId !== 'string'
    || !canonicalUuidPattern.test(value.publicId)
    || typeof value.responseFingerprint !== 'string'
    || !catalogRevisionPattern.test(value.responseFingerprint)) return false
  return true
}

const validateStoredAssessment = (value: unknown): StoredOwnedAssessment => {
  if (!isRecord(value)
    || Object.keys(value).sort().join('|') !== 'assessmentId|campaignId|completedAt|publicId|resultSnapshot'
    || !isSafePositiveInteger(value.assessmentId)
    || typeof value.publicId !== 'string'
    || !canonicalUuidPattern.test(value.publicId)
    || (value.campaignId !== null && !isSafePositiveInteger(value.campaignId))
    || typeof value.completedAt !== 'string'
    || !offsetDateTimeSchema.safeParse(value.completedAt).success) {
    throw new Error('ASSESSMENT_STORE_INVALID')
  }
  return value as StoredOwnedAssessment
}

const toInternalError = (error: unknown): AppError => (
  error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
)

const authenticate = async (
  dependencies: AssessmentCompletionDependencies,
  sessionToken: string,
): Promise<StudentSession> => {
  const session = await dependencies.getStudentSession(sessionToken)
  if (!session) throw new AppError('AUTH_FAILED')
  return session
}

const recordSafely = async (writer: EventWriter, event: Parameters<EventWriter>[0]): Promise<void> => {
  try {
    await writer(event)
  }
  catch {
    // Product telemetry is best-effort after the authoritative read or commit succeeds.
  }
}

export const createAssessmentCompletionService = (dependencies: AssessmentCompletionDependencies) => {
  const submitAssessment = async (
    rawInput: unknown,
    context: AssessmentCompletionContext,
  ): Promise<{ publicId: string }> => {
    const deadline = createAbsoluteDeadline({
      durationMs: 15_000,
      monotonicNow: dependencies.monotonicNow ?? (() => performance.now()),
      runWithDeadline: dependencies.runWithDeadline ?? defaultDeadlineRunner,
    })
    try {
      const session = await deadline.run(() => authenticate(dependencies, context.sessionToken))
      const allowed = await deadline.run(() => dependencies.consumeRateLimit({
          key: `prospect:${session.prospectId}`,
          route: SUBMIT_ROUTE,
          limit: 10,
          window: '5 minutes',
        }))
      if (!allowed) throw new AppError('RATE_LIMITED')

      const input = parseEnvelope(rawInput)
      const responseFingerprint = await deadline.run(() => (
        createAssessmentResponseFingerprint(input.selections)
      ))
      const existing = await deadline.run(() => (
        dependencies.loadCompletedAssessmentByIdempotency({
          prospectId: session.prospectId,
          idempotencyKey: input.idempotencyKey,
          deadline,
        })
      ))
      if (existing !== null) {
        if (!validCompletedAssessmentSubmission(existing)) throw new Error('ASSESSMENT_STORE_INVALID')
        if (existing.responseFingerprint !== responseFingerprint) {
          throw new AppError('ASSESSMENT_IDEMPOTENCY_CONFLICT')
        }
        return { publicId: existing.publicId }
      }

      const catalog = normalizeCatalog(await deadline.run(dependencies.loadActiveOptions))
      const revision = await deadline.run(() => createAssessmentCatalogRevision(catalog))
      if (input.catalogRevision !== revision) throw new AppError('ASSESSMENT_CATALOG_STALE')

      let scored
      try {
        scored = scoreAssessment(catalog, input.selections)
      }
      catch (error) {
        if (error instanceof AssessmentScoringError
          && error.code !== 'ASSESSMENT_CATALOG_INVALID') throw new AppError('ASSESSMENT_INVALID')
        throw error
      }
      const selected = selectedOptionsInCatalogOrder(catalog, input.selections)
      const labelsByTag = selectedLabelsByTag(selected, scored.interestVector)
      const selectedInterests = orderSelectedInterestsByTopTrackContribution(
        selected,
        scored.rankedTracks[0]!,
      )
      const matchingEvidence = Object.entries(labelsByTag).map(([key, label]) => ({ key, label }))
      const campaignId = null

      const candidates = await deadline.run(dependencies.loadResourceCandidates)
      assertResourceCandidates(candidates)
      const matchingInput = withPrimaryTrackPathway({
        candidates,
        interestVector: scored.interestVector,
        selectedInterests: matchingEvidence,
        primaryTrack: scored.rankedTracks[0]!,
        secondaryTrack: scored.rankedTracks[1]!,
      })
      const preparedResources = prepareResourceCandidates({
        candidates: matchingInput.candidates,
        interestVector: matchingInput.interestVector,
        selectedInterests: matchingInput.selectedInterests,
      })
      const rawRanked = rankResources({
        candidates: preparedResources.candidates,
        interestVector: matchingInput.interestVector,
        selectedInterests: matchingInput.selectedInterests,
        primaryTrack: matchingInput.primaryTrack,
        secondaryTrack: matchingInput.secondaryTrack,
        syntheticPathwayCourseIds: matchingInput.syntheticPathwayCourseIds,
        syntheticPathwayEvidenceKeys: matchingInput.syntheticPathwayEvidenceKeys,
      })
      const ranked = {
        ...rawRanked,
        course: restoreRankedResources(
          rawRanked.course,
          preparedResources.originalsById,
          preparedResources.reasonsById,
        ),
        capabilityEvidence: restoreRankedResources(
          rawRanked.capabilityEvidence,
          preparedResources.originalsById,
          preparedResources.reasonsById,
        ),
        extracurricularProject: restoreRankedResources(
          rawRanked.extracurricularProject,
          preparedResources.originalsById,
          preparedResources.reasonsById,
        ),
        studentWork: restoreRankedResources(
          rawRanked.studentWork,
          preparedResources.originalsById,
          preparedResources.reasonsById,
        ),
        career: restoreRankedResources(
          rawRanked.career,
          preparedResources.originalsById,
          preparedResources.reasonsById,
        ),
        support: restoreRankedResources(
          rawRanked.support,
          preparedResources.originalsById,
          preparedResources.reasonsById,
        ),
      }
      const learningPath = buildLearningPath(ranked.course)

      const facultyCandidates = await deadline.run(dependencies.loadFacultyCandidates)
      const facultyRecommendation = recommendFaculty({
        student: {
          trackScores: scored.trackScores,
          interestVector: scored.interestVector,
          selectedLabels: labelsByTag,
        },
        faculty: facultyCandidates.faculty,
        specialistLinks: facultyCandidates.specialistLinks,
        distributionKey: session.prospectId,
      })
      const faculty = {
        primary: facultyRecommendation.primary,
        backup: facultyRecommendation.backup,
        specialists: facultyRecommendation.specialists,
      }
      const resources = {
        course: ranked.course,
        equipment: ranked.capabilityEvidence.filter(resource => resource.type === 'equipment'),
        facility: ranked.capabilityEvidence.filter(resource => resource.type === 'facility'),
        extracurricular: ranked.extracurricularProject.filter(resource => resource.type === 'extracurricular'),
        project: ranked.extracurricularProject.filter(resource => resource.type === 'project'),
        student_work: ranked.studentWork,
        career: ranked.career,
        support: ranked.support.slice(0, 3),
      }
      const environmentScore = computeEnvironmentScore({
        facility: resources.facility,
        equipment: resources.equipment,
        learningPath,
        hasPrimaryFaculty: faculty.primary.id > 0,
      })
      const completedAt = (dependencies.now ?? (() => new Date().toISOString()))()
      const resultSnapshotCore: ResultSnapshotCore = {
        completedAt,
        selectedInterests,
        trackScores: scored.trackScores,
        rankedTracks: [
          scored.rankedTracks[0]!,
          scored.rankedTracks[1]!,
          scored.rankedTracks[2]!,
          scored.rankedTracks[3]!,
        ],
        environmentScore,
        learningPath,
        resources,
        faculty,
      }
      const resolvedNarrative = await deadline.run(() => dependencies.resolveCareerNarrative({
          prospectId: session.prospectId,
          idempotencyKey: input.idempotencyKey,
          responseFingerprint,
          coreSnapshot: resultSnapshotCore,
          deadline,
        }))
      if (resolvedNarrative.kind === 'existing_assessment') {
        if (!canonicalUuidPattern.test(resolvedNarrative.publicId)) {
          throw new Error('ASSESSMENT_STORE_INVALID')
        }
        return { publicId: resolvedNarrative.publicId }
      }
      if (resolvedNarrative.kind === 'conflict') {
        throw new AppError('ASSESSMENT_IDEMPOTENCY_CONFLICT')
      }

      const resultSnapshot = decodeResultSnapshot({
        ...resultSnapshotCore,
        careerNarrative: resolvedNarrative.narrative,
      })
      const completed = await deadline.run(() => dependencies.completeAssessment({
          prospectId: session.prospectId,
          idempotencyKey: input.idempotencyKey,
          campaignId,
          trackScores: scored.trackScores,
          environmentScore,
          resultSnapshot,
          responses: responseSnapshots(selected, input.selections),
          narrativeGenerationId: resolvedNarrative.generationId,
        }))
      if (!validCompletionResult(completed)) throw new Error('ASSESSMENT_RPC_INVALID')

      if (completed.created) {
        void deadline.run(() => dependencies.recordEvent({
            anonymousId: context.anonymousId,
            campaignId,
            eventName: 'assessment_completed',
            path: SUBMIT_ROUTE,
            prospectId: session.prospectId,
            properties: {
              assessment_id: completed.assessmentId,
              top_track: resultSnapshot.rankedTracks[0],
              narrative_source: resultSnapshot.careerNarrative.source,
            },
            requestId: context.requestId,
          })).catch(() => undefined)
      }
      return { publicId: completed.publicId }
    }
    catch (error) {
      throw toInternalError(error)
    }
  }

  const getOwnedResult = async (
    publicId: string,
    context: OwnedAssessmentContext,
  ): Promise<ResultSnapshot> => {
    try {
      const session = await authenticate(dependencies, context.sessionToken)
      if (!canonicalUuidPattern.test(publicId)) throw new AppError('RESULT_NOT_FOUND')
      const stored = await dependencies.loadOwnedAssessment({
        prospectId: session.prospectId,
        publicId,
      })
      if (!stored) throw new AppError('RESULT_NOT_FOUND')
      const row = validateStoredAssessment(stored)
      const snapshot = decodeStoredResultSnapshot(row.resultSnapshot)
      await recordSafely(dependencies.recordEvent, {
        anonymousId: context.anonymousId,
        campaignId: row.campaignId,
        eventName: 'result_viewed',
        path: `/api/result/${publicId}`,
        prospectId: session.prospectId,
        properties: {
          assessment_id: row.assessmentId,
          top_track: snapshot.rankedTracks[0],
        },
        requestId: context.requestId,
      })
      return snapshot
    }
    catch (error) {
      throw toInternalError(error)
    }
  }

  const getAssessmentHistory = async (
    context: OwnedAssessmentContext,
  ): Promise<{ items: AssessmentHistoryItem[] }> => {
    try {
      const session = await authenticate(dependencies, context.sessionToken)
      const rows = await dependencies.loadAssessmentHistory(session.prospectId)
      if (!Array.isArray(rows)) throw new Error('ASSESSMENT_STORE_INVALID')
      const parsed = rows.map((value) => {
        const row = validateStoredAssessment(value)
        const snapshot = decodeStoredResultSnapshot(row.resultSnapshot)
        return { row, snapshot }
      })
      parsed.sort((left, right) => (
        Date.parse(right.row.completedAt) - Date.parse(left.row.completedAt)
        || right.row.assessmentId - left.row.assessmentId
      ))
      return {
        items: parsed.slice(0, 3).map(({ row, snapshot }) => ({
          publicId: row.publicId,
          completedAt: row.completedAt,
          topTrack: snapshot.rankedTracks[0],
          environmentScore: snapshot.environmentScore,
          selectedInterests: snapshot.selectedInterests,
        })),
      }
    }
    catch (error) {
      throw toInternalError(error)
    }
  }

  return { submitAssessment, getOwnedResult, getAssessmentHistory }
}

const valueAt = (metadata: Record<string, unknown>, ...keys: string[]): unknown => {
  const key = keys.find(candidate => Object.hasOwn(metadata, candidate))
  return key === undefined ? undefined : metadata[key]
}

const mapResourceRow = (input: unknown): ResourceCandidate => {
  if (!isRecord(input) || !isRecord(input.metadata) || !Array.isArray(input.resource_tags)) {
    throw new Error('RESOURCE_STORE_INVALID')
  }
  const metadata = input.metadata
  const tags = input.resource_tags.map((value) => {
    if (!isRecord(value)) throw new Error('RESOURCE_STORE_INVALID')
    return { key: value.tag_key, weight: value.weight, isPrimary: value.is_primary }
  })
  const base = {
    id: input.id,
    type: input.type,
    title: input.title,
    summary: input.summary,
    status: input.status,
    visibility: input.visibility,
    priority: input.priority,
    sourceDate: input.source_date,
    tags,
  }
  switch (input.type) {
    case 'course': return {
      ...base,
      type: 'course',
      metadata: {
        academicYear: valueAt(metadata, 'academicYear', 'academic_year'),
        gradeYear: valueAt(metadata, 'gradeYear', 'grade_year'),
        term: metadata.term,
        credits: metadata.credits,
        goalSummary: valueAt(metadata, 'goal', 'goalSummary', 'source_goal'),
        requirementType: valueAt(metadata, 'requirementType', 'requirement_type'),
      },
    } as ResourceCandidate
    case 'equipment': return {
      ...base,
      type: 'equipment',
      metadata: {
        locationLabel: valueAt(metadata, 'locationLabel', 'location_label'),
        confirmedQuantity: valueAt(metadata, 'confirmedQuantity', 'confirmed_quantity'),
        reservationUrl: valueAt(metadata, 'reservationUrl', 'reservation_url'),
        accessMode: valueAt(metadata, 'accessMode', 'access_mode'),
        accessLabel: valueAt(metadata, 'accessLabel', 'access_label'),
        category: metadata.category,
      },
    } as ResourceCandidate
    case 'facility': return {
      ...base,
      type: 'facility',
      metadata: {
        locationLabel: valueAt(metadata, 'locationLabel', 'location_label'),
        operationNote: valueAt(metadata, 'operation_note', 'operationNote'),
        lastVerifiedAt: valueAt(metadata, 'last_verified_at', 'lastVerifiedAt'),
      },
    } as ResourceCandidate
    case 'student_work': return {
      ...base,
      type: 'student_work',
      metadata: {
        imagePath: input.image_path,
        imageAlt: valueAt(metadata, 'imageAlt', 'image_alt'),
      },
    } as ResourceCandidate
    case 'project': return {
      ...base,
      type: 'project',
      metadata: {
        displayTier: valueAt(metadata, 'displayTier', 'display_tier'),
        projectYear: valueAt(metadata, 'projectYear', 'project_year'),
        periodLabel: valueAt(metadata, 'periodLabel', 'period_label'),
        statusLabel: valueAt(metadata, 'statusLabel', 'status_label'),
        programGroup: valueAt(metadata, 'programGroup', 'program_group'),
      },
    } as ResourceCandidate
    case 'extracurricular':
    case 'career':
    case 'support': return { ...base, type: input.type, metadata: {} } as ResourceCandidate
    default: throw new Error('RESOURCE_STORE_INVALID')
  }
}

const mapFacultyRow = (input: unknown): FacultyRecommendationCandidate => {
  if (!isRecord(input) || !Array.isArray(input.faculty_tags) || !isRecord(input.contact_visibility)) {
    throw new Error('FACULTY_STORE_INVALID')
  }
  const contacts = Object.fromEntries([
    ['office', input.office],
    ['phone', input.phone],
    ['email', input.email],
    ['website', input.website],
  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  return {
    id: input.id as number,
    name: input.name as string,
    title: input.title as string,
    expertise: input.expertise_summary as string,
    status: input.status as FacultyRecommendationCandidate['status'],
    employmentType: input.employment_type as FacultyRecommendationCandidate['employmentType'],
    consultationRole: input.consultation_role as FacultyRecommendationCandidate['consultationRole'],
    weeklyCapacity: input.weekly_capacity as number,
    openAssignedCount: 0,
    priority: input.priority as number,
    contacts,
    contactVisibility: input.contact_visibility as FacultyRecommendationCandidate['contactVisibility'],
    tags: input.faculty_tags.map((value) => {
      if (!isRecord(value)) throw new Error('FACULTY_STORE_INVALID')
      return {
        key: value.tag_key as string,
        label: value.tag_label as string,
        category: value.category as FacultyRecommendationCandidate['tags'][number]['category'],
        weight: value.weight as number,
        isPrimary: value.is_primary as boolean,
      }
    }),
  }
}

const rawSpecialistLinkSchema = z.object({
  primary_faculty_id: z.number().int().positive().safe().nullable(),
  specialist_faculty_id: z.number().int().positive().safe(),
  tag_key: z.string().regex(tagKeyPattern),
  priority: z.number().int().nonnegative().max(32767).safe(),
}).strict()

const mapLinkRow = (input: unknown): FacultySpecialistLink => {
  const parsed = rawSpecialistLinkSchema.safeParse(input)
  if (!parsed.success) throw new Error('FACULTY_STORE_INVALID')
  return {
    primaryFacultyId: parsed.data.primary_faculty_id,
    specialistFacultyId: parsed.data.specialist_faculty_id,
    tagKey: parsed.data.tag_key,
    priority: parsed.data.priority,
  }
}

const decodeRawLinks = (
  rows: readonly unknown[],
  faculty: readonly FacultyRecommendationCandidate[],
): FacultySpecialistLink[] => {
  const links = rows.map(mapLinkRow)
  const identities = new Set<string>()
  for (const link of links) {
    if (link.primaryFacultyId === link.specialistFacultyId) {
      throw new Error('FACULTY_STORE_INVALID')
    }
    const identity = `${link.primaryFacultyId ?? ''}|${link.specialistFacultyId}|${link.tagKey}`
    if (identities.has(identity)) throw new Error('FACULTY_STORE_INVALID')
    identities.add(identity)
  }

  const activePrimaryIds = new Set(faculty
    .filter(person => person.status === 'active'
      && person.consultationRole === 'primary'
      && person.employmentType === 'full_time')
    .map(person => person.id))
  const activeSpecialistIds = new Set(faculty
    .filter(person => person.status === 'active'
      && person.consultationRole === 'specialist'
      && (person.employmentType === 'adjunct' || person.employmentType === 'practitioner'))
    .map(person => person.id))
  return links.filter(link => activeSpecialistIds.has(link.specialistFacultyId)
    && (link.primaryFacultyId === null || activePrimaryIds.has(link.primaryFacultyId)))
}

const rawCompletionRowSchema = z.object({
  assessment_id: z.number().int().positive().safe(),
  public_id: z.string().regex(canonicalUuidPattern),
  created: z.boolean(),
}).strict()

const rawCompletedIdentitySchema = z.object({
  id: z.number().int().positive().safe(),
  public_id: z.string().regex(canonicalUuidPattern),
}).strict()

const rawCompletedResponseSchema = z.object({
  question_group: z.enum(questionGroups),
  option_key: z.string().min(6).max(71),
  free_text: z.string().min(1).max(30).nullable(),
}).strict().superRefine((value, context) => {
  if (!value.option_key.startsWith(`${value.question_group}.`)) {
    context.addIssue({ code: 'custom', message: 'stored response group mismatch' })
  }
  if (
    value.free_text !== null
    && (value.question_group !== 'career' || value.option_key !== 'career.explore')
  ) {
    context.addIssue({ code: 'custom', message: 'stored response free text mismatch' })
  }
})

const storedAssessmentFromRow = (input: unknown): StoredOwnedAssessment => {
  if (!isRecord(input)) throw new Error('ASSESSMENT_STORE_INVALID')
  return validateStoredAssessment({
    assessmentId: input.id,
    publicId: input.public_id,
    campaignId: input.campaign_id,
    completedAt: input.completed_at,
    resultSnapshot: input.result_snapshot,
  })
}

export const createSupabaseAssessmentCompletionDependencies = (
  client: SupabaseClient,
  createSessionReader: typeof createRosterSessionServiceFromSupabase = createRosterSessionServiceFromSupabase,
): AssessmentCompletionDependencies => {
  let sessionReader: ReturnType<typeof createRosterSessionServiceFromSupabase> | undefined
  const loadCompletedAssessmentByIdempotency = async ({
    prospectId,
    idempotencyKey,
    deadline,
  }: {
    prospectId: number
    idempotencyKey: string
    deadline: AbsoluteDeadline
  }): Promise<StoredCompletedAssessmentSubmission | null> => {
    const { data, error } = await deadline.run(() => Promise.resolve(
      client.from('assessments')
        .select('id,public_id')
        .eq('prospect_id', prospectId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle(),
    ))
    if (error) throw new Error('ASSESSMENT_STORE_UNAVAILABLE')
    if (data === null) return null
    const parsed = rawCompletedIdentitySchema.safeParse(data)
    if (!parsed.success) throw new Error('ASSESSMENT_STORE_INVALID')
    const responsesResult = await deadline.run(() => Promise.resolve(
      client.from('assessment_responses')
        .select('question_group,option_key,free_text')
        .eq('assessment_id', parsed.data.id)
        .order('question_group')
        .order('option_key'),
    ))
    if (responsesResult.error || !Array.isArray(responsesResult.data)) {
      throw new Error('ASSESSMENT_STORE_UNAVAILABLE')
    }

    const storedSelections: Record<QuestionGroup, string[]> = {
      work: [],
      result: [],
      style: [],
      career: [],
    }
    const identities = new Set<string>()
    let careerOther: string | null = null
    for (const rawResponse of responsesResult.data) {
      const response = rawCompletedResponseSchema.safeParse(rawResponse)
      if (!response.success) throw new Error('ASSESSMENT_STORE_INVALID')
      const identity = `${response.data.question_group}:${response.data.option_key}`
      if (identities.has(identity)) throw new Error('ASSESSMENT_STORE_INVALID')
      identities.add(identity)
      storedSelections[response.data.question_group].push(response.data.option_key)
      if (response.data.option_key === 'career.explore') {
        careerOther = response.data.free_text
      }
    }
    const selections = assessmentSelectionsSchema.safeParse({
      ...storedSelections,
      careerOther,
    })
    if (!selections.success) throw new Error('ASSESSMENT_STORE_INVALID')
    return {
      publicId: parsed.data.public_id,
      responseFingerprint: await createAssessmentResponseFingerprint(
        selections.data as AssessmentSelections,
      ),
    }
  }
  const resolveCareerNarrative = createServerCareerNarrativeResolver(
    client,
    loadCompletedAssessmentByIdempotency,
  )
  return {
    getStudentSession: token => (
      sessionReader ??= createSessionReader(client)
    ).getStudentSession(token),
    consumeRateLimit: async ({ key, route, limit, window }) => {
      const { data, error } = await client.rpc('consume_rate_limit', {
        p_key: key,
        p_route: route,
        p_limit: limit,
        p_window: window,
      })
      if (error) throw new Error('ASSESSMENT_STORE_UNAVAILABLE')
      return data === true
    },
    loadActiveOptions: async () => {
      const { data, error } = await client.from('assessment_options')
        .select('question_group,option_key,label,description,visual_key,track_weights,interest_tags,status,sort_order')
        .eq('status', 'active')
        .order('question_group')
        .order('sort_order')
        .order('option_key')
      if (error || !Array.isArray(data)) throw new Error('ASSESSMENT_STORE_UNAVAILABLE')
      return data.map(row => ({
        group: row.question_group,
        optionKey: row.option_key,
        label: row.label,
        ...(row.description === null ? {} : { description: row.description }),
        visualKey: row.visual_key,
        trackWeights: row.track_weights,
        interestTags: row.interest_tags,
        status: row.status,
        sortOrder: row.sort_order,
      })) as AssessmentOption[]
    },
    loadResourceCandidates: async () => {
      const { data, error } = await client.from('resources')
        .select('id,type,title,summary,status,visibility,priority,source_date,metadata,image_path,resource_tags(tag_key,weight,is_primary)')
        .in('status', ['active', 'next_year_confirmed'])
        .eq('visibility', 'public')
      if (error || !Array.isArray(data)) throw new Error('RESOURCE_STORE_UNAVAILABLE')
      const equipmentIds = data.filter(row => isRecord(row) && row.type === 'equipment')
        .map(row => row.id)
      const verifiedCounts = new Map<number, number>()
      if (equipmentIds.length > 0) {
        const inventoryResult = await client.from('equipment_inventory_items')
          .select('equipment_resource_id,data_quality_status')
          .in('equipment_resource_id', equipmentIds)
          .eq('data_quality_status', 'verified')
        if (inventoryResult.error || !Array.isArray(inventoryResult.data)) {
          throw new Error('RESOURCE_STORE_UNAVAILABLE')
        }
        const inventoryRowSchema = z.object({
          equipment_resource_id: z.number().int().positive().safe(),
          data_quality_status: z.literal('verified'),
        }).strict()
        for (const rawRow of inventoryResult.data) {
          const row = inventoryRowSchema.safeParse(rawRow)
          if (!row.success || !equipmentIds.includes(row.data.equipment_resource_id)) {
            throw new Error('RESOURCE_STORE_INVALID')
          }
          verifiedCounts.set(
            row.data.equipment_resource_id,
            (verifiedCounts.get(row.data.equipment_resource_id) ?? 0) + 1,
          )
        }
      }
      return data.map((row) => {
        if (!isRecord(row) || row.type !== 'equipment' || !isRecord(row.metadata)) {
          return mapResourceRow(row)
        }
        return mapResourceRow({
          ...row,
          metadata: {
            ...row.metadata,
            confirmedQuantity: verifiedCounts.get(row.id as number) ?? 0,
          },
        })
      })
    },
    loadFacultyCandidates: async () => {
      const [facultyResult, linksResult] = await Promise.all([
        client.from('faculty')
          .select('id,name,title,expertise_summary,status,employment_type,consultation_role,weekly_capacity,priority,office,phone,email,website,contact_visibility,faculty_tags(tag_key,tag_label,category,weight,is_primary)')
          .eq('status', 'active'),
        client.from('faculty_specialist_links')
          .select('primary_faculty_id,specialist_faculty_id,tag_key,priority'),
      ])
      if (facultyResult.error || linksResult.error
        || !Array.isArray(facultyResult.data)
        || !Array.isArray(linksResult.data)) throw new Error('FACULTY_STORE_UNAVAILABLE')
      const faculty = facultyResult.data.map(mapFacultyRow)
      return {
        faculty,
        specialistLinks: decodeRawLinks(linksResult.data, faculty),
      }
    },
    loadCompletedAssessmentByIdempotency,
    resolveCareerNarrative,
    completeAssessment: async (input) => {
      const { data, error } = await client.rpc('complete_assessment_with_narrative', {
        p_prospect_id: input.prospectId,
        p_idempotency_key: input.idempotencyKey,
        p_campaign_id: input.campaignId,
        p_track_scores: input.trackScores,
        p_environment_score: input.environmentScore,
        p_result_snapshot: input.resultSnapshot,
        p_responses: input.responses.map(response => ({
          question_group: response.group,
          option_key: response.optionKey,
          option_label_snapshot: response.optionLabel,
          weight_snapshot: response.trackWeights,
          free_text: response.freeText,
        })),
        p_narrative_generation_id: input.narrativeGenerationId,
      })
      if (error && isRecord(error) && error.code === '23505') {
        throw new AppError('ASSESSMENT_IDEMPOTENCY_CONFLICT')
      }
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new Error('ASSESSMENT_STORE_UNAVAILABLE')
      }
      const parsed = rawCompletionRowSchema.safeParse(data[0])
      if (!parsed.success) throw new Error('ASSESSMENT_STORE_INVALID')
      return {
        assessmentId: parsed.data.assessment_id,
        publicId: parsed.data.public_id,
        created: parsed.data.created,
      }
    },
    loadOwnedAssessment: async ({ prospectId, publicId }) => {
      const { data, error } = await client.from('assessments')
        .select('id,public_id,campaign_id,completed_at,result_snapshot')
        .eq('public_id', publicId)
        .eq('prospect_id', prospectId)
        .maybeSingle()
      if (error) throw new Error('ASSESSMENT_STORE_UNAVAILABLE')
      return data ? storedAssessmentFromRow(data) : null
    },
    loadAssessmentHistory: async (prospectId) => {
      const { data, error } = await client.from('assessments')
        .select('id,public_id,campaign_id,completed_at,result_snapshot')
        .eq('prospect_id', prospectId)
        .order('completed_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(3)
      if (error || !Array.isArray(data)) throw new Error('ASSESSMENT_STORE_UNAVAILABLE')
      return data.map(storedAssessmentFromRow)
    },
    recordEvent: createEventWriter(client),
  }
}

export const getServerAssessmentCompletionService = () => {
  const client = getServerSupabaseClient()
  const dependencies = createSupabaseAssessmentCompletionDependencies(client)
  return createAssessmentCompletionService(dependencies)
}
