import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { careerNarrativeSchema } from '../../../shared/schemas/career-narrative'
import type {
  CareerNarrative,
  CareerNarrativeBrief,
} from '../../../shared/types/career-narrative'
import type { ResultSnapshotCore } from '../../../shared/types/result'
import type { AbsoluteDeadline } from '../../utils/absolute-deadline'
import {
  createSafetyIdentifier as createOpenAiSafetyIdentifier,
  loadOpenAiCareerConfig,
  type OpenAiCareerConfig,
} from '../../utils/openai-career-config'
import { isMinorRolloutApprovalId } from '../../utils/openai-career-approval'
import { sha256, utf8 } from '../../utils/web-crypto'
import {
  buildCareerNarrativeBrief,
  buildDeterministicCareerNarrativeChoice,
  renderCareerNarrative,
} from './career-narrative'
import {
  requestOpenAiCareerNarrativeChoice,
  type OpenAiCareerNarrativeResult,
} from './openai-career-narrative'

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const inputHashPattern = /^sha256:[a-f0-9]{64}$/u
const maximumWaitMs = 12_000
const initialPollDelayMs = 50
const maximumPollDelayMs = 1_000
const minimumProviderTimeoutMs = 2_000
const completionReserveMs = 1_000

type GenerationFailureCode =
  | 'missing_config'
  | 'minor_policy'
  | 'input_ineligible'
  | 'budget_exhausted'
  | 'timeout'
  | 'provider_error'
  | 'incomplete'
  | 'refusal'
  | 'invalid_output'
  | 'stale_claim'

type ProviderFailureCode =
  | 'timeout'
  | 'provider_error'
  | 'incomplete'
  | 'refusal'
  | 'invalid_output'

type ModelGate =
  | 'enabled'
  | 'missing_config'
  | 'minor_policy'
  | 'input_ineligible:unsafe_fact'
  | 'input_ineligible:insufficient_facts'

export type GenerationTerminalResult = {
  kind: 'terminal'
  id: number
  expiresAt: string
  source: CareerNarrative['source']
  narrative: CareerNarrative
  failureCode?: GenerationFailureCode
}

export type GenerationReadResult =
  | GenerationTerminalResult
  | { kind: 'waiting', id: number, expiresAt: string }
  | { kind: 'conflict', id: number }
  | { kind: 'missing' }

export type GenerationClaimResult =
  | GenerationTerminalResult
  | { kind: 'owner', id: number, claimToken: string, expiresAt: string }
  | { kind: 'waiting', id: number, expiresAt: string }
  | { kind: 'conflict', id: number }

export type GenerationFinishResult =
  | GenerationTerminalResult
  | { kind: 'conflict' }

export type CareerNarrativeGenerationStore = {
  claim: (input: {
    prospectId: number
    idempotencyKey: string
    inputHash: string
    fallbackNarrative: CareerNarrative
    modelGate: ModelGate
    dailyCap: number
    prospectCap: number
  }) => Promise<GenerationClaimResult>
  markAttempted: (input: {
    generationId: number
    claimToken: string
  }) => Promise<boolean>
  finish: (input: {
    generationId: number
    claimToken: string
    narrative: CareerNarrative
    source: CareerNarrative['source']
    failureCode: ProviderFailureCode | null
    model: string | null
    providerResponseId: string | null
    inputTokens: number | null
    outputTokens: number | null
  }) => Promise<GenerationFinishResult>
  read: (input: {
    prospectId: number
    idempotencyKey: string
    inputHash: string
  }) => Promise<GenerationReadResult>
}

export type CareerNarrativeResolution =
  | { kind: 'narrative_ready', generationId: number, narrative: CareerNarrative }
  | { kind: 'existing_assessment', publicId: string }
  | { kind: 'conflict' }

type ResolveCareerNarrativeInput = {
  prospectId: number
  idempotencyKey: string
  responseFingerprint: string
  coreSnapshot: ResultSnapshotCore
  deadline: AbsoluteDeadline
}

type CareerNarrativeResolverDependencies = {
  store: CareerNarrativeGenerationStore
  config: OpenAiCareerConfig
  minorPolicyApproved: boolean
  loadCompletedAssessmentByIdempotency: (
    identity: {
      prospectId: number
      idempotencyKey: string
      deadline: AbsoluteDeadline
    },
  ) => Promise<{ publicId: string, responseFingerprint: string } | null>
  provider: (input: Parameters<typeof requestOpenAiCareerNarrativeChoice>[0]) => Promise<OpenAiCareerNarrativeResult>
  createSafetyIdentifier: typeof createOpenAiSafetyIdentifier
  delay: (milliseconds: number) => Promise<void>
  wallNow: () => number
}

const terminalSchema = z.object({
  kind: z.literal('terminal'),
  id: z.number().int().positive().safe(),
  expiresAt: z.iso.datetime({ offset: true }),
  source: z.enum(['openai', 'deterministic']),
  narrative: careerNarrativeSchema,
  failureCode: z.enum([
    'missing_config',
    'minor_policy',
    'input_ineligible',
    'budget_exhausted',
    'timeout',
    'provider_error',
    'incomplete',
    'refusal',
    'invalid_output',
    'stale_claim',
  ]).optional(),
}).strict().superRefine((value, context) => {
  if (value.narrative.source !== value.source) {
    context.addIssue({ code: 'custom', message: 'narrative source mismatch' })
  }
  if (value.source === 'openai' && value.failureCode !== undefined) {
    context.addIssue({ code: 'custom', message: 'generated narrative cannot have failure code' })
  }
  if (value.source === 'deterministic' && value.failureCode === undefined) {
    context.addIssue({ code: 'custom', message: 'deterministic narrative requires failure code' })
  }
})

const ownerSchema = z.object({
  kind: z.literal('owner'),
  id: z.number().int().positive().safe(),
  claimToken: z.string().regex(canonicalUuidPattern),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict()

const waitingSchema = z.object({
  kind: z.literal('waiting'),
  id: z.number().int().positive().safe(),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict()

const conflictSchema = z.object({
  kind: z.literal('conflict'),
  id: z.number().int().positive().safe(),
}).strict()

const finishConflictSchema = z.object({ kind: z.literal('conflict') }).strict()
const missingSchema = z.object({ kind: z.literal('missing') }).strict()

const claimSchema = z.discriminatedUnion('kind', [
  terminalSchema,
  ownerSchema,
  waitingSchema,
  conflictSchema,
])
const readSchema = z.discriminatedUnion('kind', [
  terminalSchema,
  waitingSchema,
  conflictSchema,
  missingSchema,
])
const finishSchema = z.discriminatedUnion('kind', [
  terminalSchema,
  finishConflictSchema,
])

const decodeClaim = (input: unknown): GenerationClaimResult => {
  const parsed = claimSchema.safeParse(input)
  if (!parsed.success) throw new Error('ASSESSMENT_NARRATIVE_STORE_INVALID')
  return parsed.data as GenerationClaimResult
}

const decodeRead = (input: unknown): GenerationReadResult => {
  const parsed = readSchema.safeParse(input)
  if (!parsed.success) throw new Error('ASSESSMENT_NARRATIVE_STORE_INVALID')
  return parsed.data as GenerationReadResult
}

const decodeFinish = (input: unknown): GenerationFinishResult => {
  const parsed = finishSchema.safeParse(input)
  if (!parsed.success) throw new Error('ASSESSMENT_NARRATIVE_STORE_INVALID')
  return parsed.data as GenerationFinishResult
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value)
      .sort()
      .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]))
  }
  return value
}

const hexEncode = (value: Uint8Array) => Array.from(
  value,
  byte => byte.toString(16).padStart(2, '0'),
).join('')

export const createCareerNarrativeInputHash = async (
  brief: CareerNarrativeBrief,
  responseFingerprint: string,
): Promise<string> => `sha256:${hexEncode(
  await sha256(utf8(JSON.stringify(canonicalize({
    version: 'career-narrative-input-v2',
    brief,
    responseFingerprint,
  })))),
)}`

const asNarrativeResolution = (
  terminal: GenerationTerminalResult,
): CareerNarrativeResolution => ({
  kind: 'narrative_ready',
  generationId: terminal.id,
  narrative: terminal.narrative,
})

const assertPublicId = (value: string): string => {
  if (!canonicalUuidPattern.test(value)) throw new Error('ASSESSMENT_STORE_INVALID')
  return value
}

const modelGateFor = (
  brief: CareerNarrativeBrief,
  config: OpenAiCareerConfig,
  minorPolicyApproved: boolean,
): ModelGate => {
  if (!brief.providerEligible) {
    if (brief.ineligibilityReason === 'unsafe_fact') return 'input_ineligible:unsafe_fact'
    return 'input_ineligible:insufficient_facts'
  }
  if (!config.enabled) return 'missing_config'
  if (!minorPolicyApproved) return 'minor_policy'
  return 'enabled'
}

const parseExpiry = (value: string): number => {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw new Error('ASSESSMENT_NARRATIVE_STORE_INVALID')
  return milliseconds
}

const defaultDelay = async (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds)
})

export const createCareerNarrativeResolver = (
  dependencies: CareerNarrativeResolverDependencies,
) => {
  const loadCompleted = async (
    input: ResolveCareerNarrativeInput,
  ): Promise<CareerNarrativeResolution | null> => {
    const completed = await input.deadline.run(() => (
      dependencies.loadCompletedAssessmentByIdempotency({
        prospectId: input.prospectId,
        idempotencyKey: input.idempotencyKey,
        deadline: input.deadline,
      })
    ))
    if (completed === null) return null
    if (!inputHashPattern.test(completed.responseFingerprint)) {
      throw new Error('ASSESSMENT_STORE_INVALID')
    }
    return completed.responseFingerprint === input.responseFingerprint
      ? { kind: 'existing_assessment', publicId: assertPublicId(completed.publicId) }
      : { kind: 'conflict' }
  }

  const settleWaiting = async (
    input: ResolveCareerNarrativeInput,
    inputHash: string,
    waiting: { expiresAt: string },
  ): Promise<CareerNarrativeResolution> => {
    const localStart = input.deadline.now()
    const authoritativeRemaining = Math.max(
      0,
      parseExpiry(waiting.expiresAt) - dependencies.wallNow(),
    )
    const deadline = Math.min(
      input.deadline.expiresAt,
      localStart + Math.min(maximumWaitMs, authoritativeRemaining),
    )
    let nextDelay = initialPollDelayMs

    while (input.deadline.now() < deadline) {
      const completed = await loadCompleted(input)
      if (completed !== null) return completed

      const remaining = deadline - input.deadline.now()
      if (remaining <= 0) break
      await input.deadline.run(() => dependencies.delay(Math.min(nextDelay, remaining)))
      if (input.deadline.now() >= deadline) break

      const current = await input.deadline.run(() => dependencies.store.read({
          prospectId: input.prospectId,
          idempotencyKey: input.idempotencyKey,
          inputHash,
        }))
      if (current.kind === 'terminal') return asNarrativeResolution(current)
      if (current.kind === 'conflict') return { kind: 'conflict' }
      if (current.kind === 'missing') throw new Error('ASSESSMENT_NARRATIVE_STORE_INVALID')
      nextDelay = Math.min(maximumPollDelayMs, nextDelay * 2)
    }

    const finalGeneration = await input.deadline.run(() => dependencies.store.read({
        prospectId: input.prospectId,
        idempotencyKey: input.idempotencyKey,
        inputHash,
      }))
    const completed = await loadCompleted(input)
    if (completed !== null) return completed
    if (finalGeneration.kind === 'terminal') return asNarrativeResolution(finalGeneration)
    if (finalGeneration.kind === 'conflict') return { kind: 'conflict' }
    throw new Error('ASSESSMENT_NARRATIVE_STORE_INVALID')
  }

  return async (
    input: ResolveCareerNarrativeInput,
  ): Promise<CareerNarrativeResolution> => {
    if (!inputHashPattern.test(input.responseFingerprint)) {
      throw new Error('ASSESSMENT_NARRATIVE_RESPONSE_FINGERPRINT_INVALID')
    }

    const brief = buildCareerNarrativeBrief(input.coreSnapshot)
    const fallbackNarrative = renderCareerNarrative(
      brief,
      buildDeterministicCareerNarrativeChoice(brief),
      'deterministic',
    )
    const inputHash = await createCareerNarrativeInputHash(brief, input.responseFingerprint)
    if (!inputHashPattern.test(inputHash)) throw new Error('ASSESSMENT_NARRATIVE_HASH_INVALID')

    const modelGate = modelGateFor(
      brief,
      dependencies.config,
      dependencies.minorPolicyApproved,
    )
    const claimed = await input.deadline.run(() => dependencies.store.claim({
        prospectId: input.prospectId,
        idempotencyKey: input.idempotencyKey,
        inputHash,
        fallbackNarrative,
        modelGate,
        dailyCap: dependencies.config.enabled ? dependencies.config.dailyCap : 500,
        prospectCap: dependencies.config.enabled ? dependencies.config.prospectCap : 5,
      }))

    if (claimed.kind === 'terminal') return asNarrativeResolution(claimed)
    if (claimed.kind === 'conflict') return { kind: 'conflict' }
    if (claimed.kind === 'waiting') {
      return settleWaiting(input, inputHash, claimed)
    }

    const attempted = await input.deadline.run(() => dependencies.store.markAttempted({
        generationId: claimed.id,
        claimToken: claimed.claimToken,
      }))
    if (!attempted) {
      const current = await input.deadline.run(() => dependencies.store.read({
          prospectId: input.prospectId,
          idempotencyKey: input.idempotencyKey,
          inputHash,
        }))
      if (current.kind === 'terminal') return asNarrativeResolution(current)
      if (current.kind === 'conflict') return { kind: 'conflict' }
      if (current.kind === 'waiting') {
        return settleWaiting(input, inputHash, current)
      }
      throw new Error('ASSESSMENT_NARRATIVE_STORE_INVALID')
    }

    let narrative = fallbackNarrative
    let source: CareerNarrative['source'] = 'deterministic'
    let failureCode: ProviderFailureCode | null = 'provider_error'
    let model: string | null = null
    let providerResponseId: string | null = null
    let inputTokens: number | null = null
    let outputTokens: number | null = null

    if (dependencies.config.enabled && modelGate === 'enabled') {
      const config = dependencies.config
      let providerResult: OpenAiCareerNarrativeResult
      const providerBudget = input.deadline.remaining() - completionReserveMs
      try {
        providerResult = providerBudget < minimumProviderTimeoutMs
          ? { kind: 'fallback', failureCode: 'provider_error' }
          : await input.deadline.run(async () => dependencies.provider({
              apiKey: config.apiKey,
              model: config.model,
              safetyIdentifier: await dependencies.createSafetyIdentifier(
                input.prospectId,
                config.safetyHmacKey,
              ),
              timeoutMs: Math.min(config.timeoutMs, providerBudget),
              brief,
            }))
      }
      catch {
        providerResult = { kind: 'fallback', failureCode: 'provider_error' }
      }

      if (providerResult.kind === 'generated') {
        try {
          narrative = renderCareerNarrative(brief, providerResult.choice, 'openai')
          source = 'openai'
          failureCode = null
          model = providerResult.model
          providerResponseId = providerResult.providerResponseId
          inputTokens = providerResult.inputTokens
          outputTokens = providerResult.outputTokens
        }
        catch {
          narrative = fallbackNarrative
          source = 'deterministic'
          failureCode = 'invalid_output'
        }
      }
      else {
        failureCode = providerResult.failureCode
      }
    }

    await input.deadline.run(() => dependencies.store.finish({
        generationId: claimed.id,
        claimToken: claimed.claimToken,
        narrative,
        source,
        failureCode,
        model,
        providerResponseId,
        inputTokens,
        outputTokens,
      }))

    const authoritative = await input.deadline.run(() => dependencies.store.read({
        prospectId: input.prospectId,
        idempotencyKey: input.idempotencyKey,
        inputHash,
      }))
    if (authoritative.kind === 'terminal') return asNarrativeResolution(authoritative)
    if (authoritative.kind === 'conflict') return { kind: 'conflict' }
    throw new Error('ASSESSMENT_NARRATIVE_STORE_INVALID')
  }
}

export const createSupabaseCareerNarrativeGenerationStore = (
  client: SupabaseClient,
): CareerNarrativeGenerationStore => ({
  claim: async (input) => {
    const { data, error } = await client.rpc('claim_assessment_narrative_generation', {
      p_prospect_id: input.prospectId,
      p_idempotency_key: input.idempotencyKey,
      p_input_hash: input.inputHash,
      p_fallback_narrative: input.fallbackNarrative,
      p_model_gate: input.modelGate,
      p_daily_cap: input.dailyCap,
      p_prospect_cap: input.prospectCap,
    })
    if (error) throw new Error('ASSESSMENT_NARRATIVE_STORE_UNAVAILABLE')
    return decodeClaim(data)
  },
  markAttempted: async (input) => {
    const { data, error } = await client.rpc('mark_assessment_narrative_attempted', {
      p_generation_id: input.generationId,
      p_claim_token: input.claimToken,
    })
    if (error || typeof data !== 'boolean') {
      throw new Error(error ? 'ASSESSMENT_NARRATIVE_STORE_UNAVAILABLE' : 'ASSESSMENT_NARRATIVE_STORE_INVALID')
    }
    return data
  },
  finish: async (input) => {
    const { data, error } = await client.rpc('finish_assessment_narrative_generation', {
      p_generation_id: input.generationId,
      p_claim_token: input.claimToken,
      p_narrative: input.narrative,
      p_source: input.source,
      p_failure_code: input.failureCode,
      p_model: input.model,
      p_provider_response_id: input.providerResponseId,
      p_input_tokens: input.inputTokens,
      p_output_tokens: input.outputTokens,
    })
    if (error) throw new Error('ASSESSMENT_NARRATIVE_STORE_UNAVAILABLE')
    return decodeFinish(data)
  },
  read: async (input) => {
    const { data, error } = await client.rpc('read_assessment_narrative_generation', {
      p_prospect_id: input.prospectId,
      p_idempotency_key: input.idempotencyKey,
      p_input_hash: input.inputHash,
    })
    if (error) throw new Error('ASSESSMENT_NARRATIVE_STORE_UNAVAILABLE')
    return decodeRead(data)
  },
})

export const createServerCareerNarrativeResolver = (
  client: SupabaseClient,
  loadCompletedAssessmentByIdempotency: CareerNarrativeResolverDependencies['loadCompletedAssessmentByIdempotency'],
) => createCareerNarrativeResolver({
  store: createSupabaseCareerNarrativeGenerationStore(client),
  config: loadOpenAiCareerConfig(),
  minorPolicyApproved: isMinorRolloutApprovalId(
    process.env.OPENAI_CAREER_NARRATIVE_MINOR_ROLLOUT_APPROVAL_ID?.trim() ?? '',
  ),
  loadCompletedAssessmentByIdempotency,
  provider: requestOpenAiCareerNarrativeChoice,
  createSafetyIdentifier: createOpenAiSafetyIdentifier,
  delay: defaultDelay,
  wallNow: () => Date.now(),
})
