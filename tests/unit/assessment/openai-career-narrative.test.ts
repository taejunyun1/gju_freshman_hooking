import { describe, expect, it, vi } from 'vitest'

import {
  buildCareerNarrativeBrief,
  buildDeterministicCareerNarrativeChoice,
} from '../../../server/modules/assessment/career-narrative'
import {
  readResponseBodyBounded,
  requestOpenAiCareerNarrativeChoice,
} from '../../../server/modules/assessment/openai-career-narrative'
import {
  createSafetyIdentifier,
  loadOpenAiCareerConfig,
} from '../../../server/utils/openai-career-config'
import { base64urlEncode, hmacSha256, utf8 } from '../../../server/utils/web-crypto'
import type {
  CareerNarrativeBrief,
  CareerNarrativeChoice,
} from '../../../shared/types/career-narrative'
import { makeResultSnapshot } from '../../fixtures/result'

const safetyKey = new Uint8Array(32).fill(29)
const safetyKeyEncoded = base64urlEncode(safetyKey)
const validSafetyIdentifier = `pn_${'A'.repeat(43)}`

const makeBrief = () => {
  const { careerNarrative: _ignored, ...core } = makeResultSnapshot()
  return buildCareerNarrativeBrief(core)
}

const makeChoice = () => {
  const brief = makeBrief()
  return buildDeterministicCareerNarrativeChoice(brief)
}

const makeVideoBrief = () => {
  const { careerNarrative: _ignored, ...base } = makeResultSnapshot()
  return buildCareerNarrativeBrief({
    ...base,
    selectedInterests: [
      { group: 'work', key: 'work.video_scene', label: '카메라로 영상 장면 촬영하기' },
      ...base.selectedInterests.slice(1),
    ],
    rankedTracks: ['video', 'art_photo', 'commercial', 'documentary'],
  })
}

const nonVideoBridgeChoice = (): CareerNarrativeChoice => {
  const deterministic = makeChoice()
  return {
    ...deterministic,
    choices: [
      {
        slot: 'direction',
        templateId: 'direction_bridge_v1',
        connectorId: 'and_v1',
        factRefs: [
          'interest:work.commercial_image',
          'track:commercial',
          'track:art_photo',
        ],
      },
      deterministic.choices[1],
      deterministic.choices[2],
      deterministic.choices[3],
    ],
  }
}

const providerPayload = (
  choice: unknown = makeChoice(),
  overrides: Record<string, unknown> = {},
) => ({
  id: 'resp_test-provider-1',
  object: 'response',
  status: 'completed',
  incomplete_details: null,
  output: [{
    id: 'msg_test-1',
    type: 'message',
    role: 'assistant',
    content: [{
      type: 'output_text',
      text: JSON.stringify(choice),
      annotations: [],
    }],
  }],
  usage: {
    input_tokens: 420,
    output_tokens: 120,
    total_tokens: 540,
  },
  ...overrides,
})

const providerResponse = (
  payload: unknown = providerPayload(),
  init: ResponseInit = {},
) => new Response(
  typeof payload === 'string' ? payload : JSON.stringify(payload),
  {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  },
)

const requestWith = async (
  fetch: typeof globalThis.fetch,
  brief = makeBrief(),
) => requestOpenAiCareerNarrativeChoice({
  apiKey: 'server-test-key',
  model: 'gpt-5.6-sol',
  safetyIdentifier: validSafetyIdentifier,
  timeoutMs: 5_000,
  brief,
  fetch,
})

describe('OpenAI career narrative server config', () => {
  it('keeps both missing secrets as a valid deterministic-only configuration', () => {
    expect(loadOpenAiCareerConfig({})).toEqual({
      enabled: false,
      failureCode: 'missing_config',
    })
  })

  it('enables only canonical paired secrets and applies the bounded defaults', () => {
    expect(loadOpenAiCareerConfig({
      OPENAI_API_KEY: ' server-key ',
      OPENAI_SAFETY_HMAC_KEY: safetyKeyEncoded,
    })).toEqual({
      enabled: true,
      apiKey: 'server-key',
      safetyHmacKey: safetyKey,
      model: 'gpt-5.6-sol',
      timeoutMs: 5_000,
      dailyCap: 500,
      prospectCap: 5,
      maxOutputTokens: 512,
    })

    expect(loadOpenAiCareerConfig({
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: safetyKeyEncoded,
      OPENAI_CAREER_NARRATIVE_MODEL: 'gpt-5.6-luna',
      OPENAI_CAREER_NARRATIVE_TIMEOUT_MS: '2000',
      OPENAI_CAREER_NARRATIVE_DAILY_CAP: '10000',
      OPENAI_CAREER_NARRATIVE_PROSPECT_CAP: '5',
    })).toMatchObject({
      enabled: true,
      model: 'gpt-5.6-luna',
      timeoutMs: 2_000,
      dailyCap: 10_000,
      prospectCap: 5,
    })
  })

  it.each([
    { OPENAI_API_KEY: 'server-key' },
    { OPENAI_SAFETY_HMAC_KEY: safetyKeyEncoded },
    { OPENAI_API_KEY: 'server-key', OPENAI_SAFETY_HMAC_KEY: 'not_base64url!' },
    {
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: base64urlEncode(new Uint8Array(33)),
    },
    {
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: safetyKeyEncoded,
      OPENAI_CAREER_NARRATIVE_MODEL: 'gpt-5.6',
    },
    {
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: safetyKeyEncoded,
      OPENAI_CAREER_NARRATIVE_TIMEOUT_MS: '1999',
    },
    {
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: safetyKeyEncoded,
      OPENAI_CAREER_NARRATIVE_TIMEOUT_MS: '5000.5',
    },
    {
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: safetyKeyEncoded,
      OPENAI_CAREER_NARRATIVE_DAILY_CAP: '10001',
    },
    {
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: safetyKeyEncoded,
      OPENAI_CAREER_NARRATIVE_PROSPECT_CAP: '4',
    },
  ])('disables an incomplete or invalid private configuration: %#', (env) => {
    expect(loadOpenAiCareerConfig(env)).toEqual({
      enabled: false,
      failureCode: 'missing_config',
    })
  })

  it('never reads a public OpenAI variable as a server credential', () => {
    expect(loadOpenAiCareerConfig({
      NUXT_PUBLIC_OPENAI_API_KEY: 'public-leak',
      NUXT_PUBLIC_OPENAI_SAFETY_HMAC_KEY: safetyKeyEncoded,
    })).toEqual({
      enabled: false,
      failureCode: 'missing_config',
    })
  })

  it('creates a domain-separated stable non-reversible student identifier', async () => {
    const first = await createSafetyIdentifier(123, safetyKey)
    const same = await createSafetyIdentifier(123, safetyKey)
    const other = await createSafetyIdentifier(124, safetyKey)
    const expectedDigest = await hmacSha256(
      utf8('PHOTO:NEXT/openai-safety/v1\n123'),
      safetyKey,
    )

    expect(first).toBe(`pn_${base64urlEncode(expectedDigest)}`)
    expect(first).toBe(same)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^pn_[A-Za-z0-9_-]{43}$/u)
    expect(first).toHaveLength(46)
    expect(first.length).toBeLessThanOrEqual(64)
    expect(first).not.toContain('123')
    await expect(createSafetyIdentifier(0, safetyKey))
      .rejects.toThrowError('OPENAI_SAFETY_IDENTIFIER_INPUT_INVALID')
    await expect(createSafetyIdentifier(123, new Uint8Array(31)))
      .rejects.toThrowError('OPENAI_SAFETY_IDENTIFIER_INPUT_INVALID')
  })
})

describe('privacy-bounded OpenAI Responses adapter', () => {
  it('rejects a commercial-first provider bridge as invalid output', async () => {
    const fetch = vi.fn(async () => providerResponse(providerPayload(nonVideoBridgeChoice())))

    await expect(requestWith(fetch as typeof globalThis.fetch)).resolves.toEqual({
      kind: 'fallback',
      failureCode: 'invalid_output',
    })
  })

  it('accepts the advertised bridge for a video-first provider choice', async () => {
    const brief = makeVideoBrief()
    const choice = buildDeterministicCareerNarrativeChoice(brief)
    const fetch = vi.fn(async () => providerResponse(providerPayload(choice)))

    expect(brief.slots[0].allowedTemplateIds).toEqual([
      'direction_focus_v1',
      'direction_bridge_v1',
    ])
    expect(brief.slots[0].allowedFactRefs).toEqual([
      'interest:work.video_scene',
      'track:video',
      'track:art_photo',
    ])
    await expect(requestWith(fetch as typeof globalThis.fetch, brief)).resolves.toMatchObject({
      kind: 'generated',
      choice,
    })
  })

  it('sends the exact private Responses API contract once', async () => {
    const fetch = vi.fn(async () => providerResponse())
    const brief = makeBrief()
    const result = await requestWith(fetch as typeof globalThis.fetch, brief)

    expect(result).toEqual({
      kind: 'generated',
      choice: makeChoice(),
      providerResponseId: 'resp_test-provider-1',
      model: 'gpt-5.6-sol',
      inputTokens: 420,
      outputTokens: 120,
    })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: 'Bearer server-test-key',
      'content-type': 'application/json',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'gpt-5.6-sol',
      store: false,
      safety_identifier: validSafetyIdentifier,
      max_output_tokens: 512,
      reasoning: { effort: 'none' },
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'photo_next_career_narrative_choice_v1',
          strict: true,
        },
      },
    })
    expect(Object.keys(body).sort()).toEqual([
      'input',
      'instructions',
      'max_output_tokens',
      'model',
      'reasoning',
      'safety_identifier',
      'store',
      'text',
    ])
    expect(JSON.stringify(body)).not.toMatch(
      /닉네임|010\d{8}|학교|careerOther|@|resource:201|resource:202|resource:203|resource:204/u,
    )
    expect(JSON.stringify(body)).not.toMatch(
      /minLength|maxLength|tools|metadata|previous_response_id|conversation/u,
    )

    const providerBrief = JSON.parse(String(body.input)) as Record<string, unknown>
    expect(Object.keys(providerBrief).sort()).toEqual(['facts', 'slots', 'version'])
    expect(providerBrief.version).toBe('career-narrative-v1')
    expect(JSON.stringify(providerBrief)).toContain('현대예술·예술사진·영상·AI·기술적 이미지')
    expect(JSON.stringify(providerBrief)).not.toMatch(/publicContacts|affinity|score|summary|sourceUrl/u)

    const format = (body.text as {
      format: {
        schema: {
          properties: {
            choices: {
              items: {
                properties: {
                  templateId: { enum: string[] }
                  connectorId: { enum: string[] }
                  factRefs: { items: { enum: string[] } }
                }
              }
            }
          }
        }
      }
    }).format
    const itemProperties = format.schema.properties.choices.items.properties
    expect(itemProperties.templateId.enum).toEqual([
      'direction_focus_v1',
      'learning_course_v1',
      'learning_course_activity_v1',
      'learning_interest_v1',
      'career_portfolio_v1',
      'career_explore_v1',
      'faculty_primary_v1',
      'faculty_primary_specialist_v1',
    ])
    expect(itemProperties.connectorId.enum).toEqual(['and_v1', 'then_v1', 'through_v1', 'with_v1'])
    expect(itemProperties.factRefs.items.enum).toEqual(
      [...new Set(brief.slots.flatMap(slot => slot.allowedFactRefs))],
    )
  })

  it('keeps the same timeout active while a streamed response body stalls', async () => {
    vi.useFakeTimers()
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":"resp_stalled"'))
        },
      })
      const fetch = vi.fn(async () => new Response(body, { status: 200 }))
      const pending = requestOpenAiCareerNarrativeChoice({
        apiKey: 'server-test-key',
        model: 'gpt-5.6-sol',
        safetyIdentifier: validSafetyIdentifier,
        timeoutMs: 2_000,
        brief: makeBrief(),
        fetch: fetch as typeof globalThis.fetch,
      })

      await vi.advanceTimersByTimeAsync(2_001)

      await expect(pending).resolves.toEqual({ kind: 'fallback', failureCode: 'timeout' })
      expect(fetch).toHaveBeenCalledOnce()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('maps an abort before response headers to the private timeout category', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('private provider timeout detail', 'AbortError'))
        }, { once: true })
      }))
      const pending = requestOpenAiCareerNarrativeChoice({
        apiKey: 'server-test-key',
        model: 'gpt-5.6-sol',
        safetyIdentifier: validSafetyIdentifier,
        timeoutMs: 2_000,
        brief: makeBrief(),
        fetch: fetch as typeof globalThis.fetch,
      })

      await vi.advanceTimersByTimeAsync(2_001)

      await expect(pending).resolves.toEqual({ kind: 'fallback', failureCode: 'timeout' })
      expect(fetch).toHaveBeenCalledOnce()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['401', () => providerResponse({ error: { message: 'private auth detail' } }, { status: 401 }), 'provider_error'],
    ['429', () => providerResponse({ error: { message: 'private rate detail' } }, { status: 429 }), 'provider_error'],
    ['500', () => providerResponse({ error: { message: 'private server detail' } }, { status: 500 }), 'provider_error'],
    ['invalid JSON', () => providerResponse('not-json'), 'invalid_output'],
    ['incomplete', () => providerResponse(providerPayload(makeChoice(), {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    })), 'incomplete'],
    ['refusal', () => providerResponse(providerPayload(makeChoice(), {
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'private refusal detail' }],
      }],
    })), 'refusal'],
    ['multiple messages', () => providerResponse(providerPayload(makeChoice(), {
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(makeChoice()) }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(makeChoice()) }],
        },
      ],
    })), 'invalid_output'],
    ['invalid strict-output JSON', () => providerResponse(providerPayload(makeChoice(), {
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '{broken' }],
      }],
    })), 'invalid_output'],
    ['invalid response id', () => providerResponse(providerPayload(makeChoice(), {
      id: 'chatcmpl_not-allowed',
    })), 'invalid_output'],
    ['invalid usage', () => providerResponse(providerPayload(makeChoice(), {
      usage: { input_tokens: 1, output_tokens: 513, total_tokens: 514 },
    })), 'invalid_output'],
  ] as const)(
    'maps %s without retries or raw provider details',
    async (_label, responseFactory, failureCode) => {
      const fetch = vi.fn(async () => responseFactory())

      const result = await requestWith(fetch as typeof globalThis.fetch)

      expect(result).toEqual({ kind: 'fallback', failureCode })
      expect(JSON.stringify(result)).not.toMatch(
        /private auth detail|private rate detail|private server detail|private refusal detail|max_output_tokens/u,
      )
      expect(fetch).toHaveBeenCalledOnce()
    },
  )

  it('maps transport errors and the 64 KiB response limit without retrying', async () => {
    const networkFetch = vi.fn(async () => {
      throw new Error('private DNS and socket detail')
    })
    await expect(requestWith(networkFetch as typeof globalThis.fetch)).resolves.toEqual({
      kind: 'fallback',
      failureCode: 'provider_error',
    })
    expect(networkFetch).toHaveBeenCalledOnce()

    const oversizedFetch = vi.fn(async () => providerResponse('x'.repeat(65_537)))
    await expect(requestWith(oversizedFetch as typeof globalThis.fetch)).resolves.toEqual({
      kind: 'fallback',
      failureCode: 'provider_error',
    })
    expect(oversizedFetch).toHaveBeenCalledOnce()
  })

  it.each([
    ['wrong slot', (choice: CareerNarrativeChoice) => ({
      ...choice,
      choices: choice.choices.map((item, index) => index === 0
        ? { ...item, slot: 'learning_path' }
        : item),
    })],
    ['unknown template', (choice: CareerNarrativeChoice) => ({
      ...choice,
      choices: choice.choices.map((item, index) => index === 0
        ? { ...item, templateId: 'invented_template' }
        : item),
    })],
    ['unknown connector', (choice: CareerNarrativeChoice) => ({
      ...choice,
      choices: choice.choices.map((item, index) => index === 0
        ? { ...item, connectorId: 'invented_connector' }
        : item),
    })],
    ['unknown ref', (choice: CareerNarrativeChoice) => ({
      ...choice,
      choices: choice.choices.map((item, index) => index === 0
        ? { ...item, factRefs: ['resource:999999'] }
        : item),
    })],
    ['duplicate refs', (choice: CareerNarrativeChoice) => ({
      ...choice,
      choices: choice.choices.map((item, index) => index === 0
        ? { ...item, factRefs: [item.factRefs[0], item.factRefs[0]] }
        : item),
    })],
    ['model prose', (choice: CareerNarrativeChoice) => ({
      ...choice,
      text: '서울예대 광고감독 취업을 추천합니다.',
    })],
    ['explanation field', (choice: CareerNarrativeChoice) => ({
      ...choice,
      choices: choice.choices.map((item, index) => index === 0
        ? { ...item, explanation: '서울예대 감독이 적합합니다.' }
        : item),
    })],
    ['extra item key', (choice: CareerNarrativeChoice) => ({
      ...choice,
      choices: choice.choices.map((item, index) => index === 0
        ? { ...item, inventedProfessor: '김가짜' }
        : item),
    })],
  ] as const)('rejects %s as invalid output', async (_label, mutate) => {
    const malicious = mutate(makeChoice())
    const fetch = vi.fn(async () => providerResponse(providerPayload(malicious)))

    const result = await requestWith(fetch as typeof globalThis.fetch)

    expect(result).toEqual({ kind: 'fallback', failureCode: 'invalid_output' })
    expect(JSON.stringify(result)).not.toMatch(/서울예대|감독|김가짜/u)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not call the provider for an ineligible or privacy-unsafe brief', async () => {
    const fetch = vi.fn(async () => providerResponse())
    const ineligible = structuredClone(makeBrief())
    ineligible.providerEligible = false
    ineligible.ineligibilityReason = 'unsafe_fact'

    await expect(requestWith(fetch as typeof globalThis.fetch, ineligible)).resolves.toEqual({
      kind: 'fallback',
      failureCode: 'invalid_output',
    })
    expect(fetch).not.toHaveBeenCalled()

    const unsafe = structuredClone(makeBrief())
    unsafe.facts['resource:101']!.label = '문의 test@example.com'
    await expect(requestWith(fetch as typeof globalThis.fetch, unsafe)).resolves.toEqual({
      kind: 'fallback',
      failureCode: 'invalid_output',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['equipment-shaped resource without a source type', (brief: CareerNarrativeBrief) => {
      const fact = { ...brief.facts['resource:101']! }
      Reflect.deleteProperty(fact, 'sourceResourceType')
      return {
        ...brief,
        facts: { ...brief.facts, 'resource:101': fact },
      }
    }],
    ['facility source type', (brief: CareerNarrativeBrief) => ({
      ...brief,
      facts: {
        ...brief.facts,
        'resource:101': {
          ...brief.facts['resource:101']!,
          sourceResourceType: 'facility',
        },
      },
    })],
    ['mismatched resource kind and type', (brief: CareerNarrativeBrief) => ({
      ...brief,
      facts: {
        ...brief.facts,
        'resource:101': {
          ...brief.facts['resource:101']!,
          kind: 'career',
          sourceResourceType: 'course',
        },
      },
    })],
    ['email in a fact ref', (brief: CareerNarrativeBrief) => ({
      ...brief,
      facts: {
        ...brief.facts,
        'interest:test@example.com': {
          ref: 'interest:test@example.com',
          kind: 'interest',
          label: '광고사진',
        },
      },
      slots: [
        {
          ...brief.slots[0],
          allowedFactRefs: ['interest:test@example.com', ...brief.slots[0].allowedFactRefs.slice(1)],
        },
        brief.slots[1],
        brief.slots[2],
        brief.slots[3],
      ],
    })],
    ['email in a template id', (brief: CareerNarrativeBrief) => ({
      ...brief,
      slots: [
        {
          ...brief.slots[0],
          allowedTemplateIds: ['direction_focus_v1@example.com', 'direction_bridge_v1'],
        },
        brief.slots[1],
        brief.slots[2],
        brief.slots[3],
      ],
    })],
    ['backtick in a connector id', (brief: CareerNarrativeBrief) => ({
      ...brief,
      slots: [
        {
          ...brief.slots[0],
          allowedConnectorIds: ['and_v1`', 'then_v1'],
        },
        brief.slots[1],
        brief.slots[2],
        brief.slots[3],
      ],
    })],
    ['more than six refs in one slot', (brief: CareerNarrativeBrief) => {
      const refs = Array.from({ length: 7 }, (_, index) => `interest:work.extra${index}`)
      return {
        ...brief,
        facts: {
          ...brief.facts,
          ...Object.fromEntries(refs.map(ref => [ref, {
            ref,
            kind: 'interest',
            label: `관심 ${ref.at(-1)}`,
          }])),
        },
        slots: [
          { ...brief.slots[0], allowedFactRefs: refs },
          brief.slots[1],
          brief.slots[2],
          brief.slots[3],
        ],
      }
    }],
  ] as const)('rejects a non-canonical provider brief before fetch: %s', async (_label, tamper) => {
    const fetch = vi.fn(async () => providerResponse())
    const unsafeBrief = tamper(makeBrief()) as CareerNarrativeBrief

    const result = await requestWith(fetch as typeof globalThis.fetch, unsafeBrief)

    expect(result).toEqual({ kind: 'fallback', failureCode: 'invalid_output' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { apiKey: ' ', safetyIdentifier: validSafetyIdentifier, model: 'gpt-5.6-sol', timeoutMs: 5_000 },
    { apiKey: 'server-key', safetyIdentifier: 'student@example.com', model: 'gpt-5.6-sol', timeoutMs: 5_000 },
    { apiKey: 'server-key', safetyIdentifier: `pn_${'A'.repeat(42)}`, model: 'gpt-5.6-sol', timeoutMs: 5_000 },
    { apiKey: 'server-key', safetyIdentifier: `pn_${'A'.repeat(44)}`, model: 'gpt-5.6-sol', timeoutMs: 5_000 },
    { apiKey: 'server-key', safetyIdentifier: validSafetyIdentifier, model: 'gpt-5.6-terra', timeoutMs: 5_000 },
    { apiKey: 'server-key', safetyIdentifier: validSafetyIdentifier, model: 'gpt-5.6-sol', timeoutMs: 1_999 },
    { apiKey: 'server-key', safetyIdentifier: validSafetyIdentifier, model: 'gpt-5.6-sol', timeoutMs: 8_001 },
  ] as const)('rejects invalid adapter configuration before fetch: %#', async (invalid) => {
    const fetch = vi.fn(async () => providerResponse())

    const result = await requestOpenAiCareerNarrativeChoice({
      ...invalid,
      model: invalid.model as 'gpt-5.6-sol',
      brief: makeBrief(),
      fetch: fetch as typeof globalThis.fetch,
    })

    expect(result).toEqual({ kind: 'fallback', failureCode: 'provider_error' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns timeout even when reader cancellation never settles', async () => {
    vi.useFakeTimers()
    try {
      let cancelCalls = 0
      const body = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => undefined)
        },
        cancel() {
          cancelCalls += 1
          return new Promise<void>(() => undefined)
        },
      })
      const fetch = vi.fn(async () => new Response(body, { status: 200 }))
      const pending = requestOpenAiCareerNarrativeChoice({
        apiKey: 'server-test-key',
        model: 'gpt-5.6-sol',
        safetyIdentifier: validSafetyIdentifier,
        timeoutMs: 2_000,
        brief: makeBrief(),
        fetch: fetch as typeof globalThis.fetch,
      })

      await vi.advanceTimersByTimeAsync(2_001)
      const outcome = Promise.race([
        pending,
        new Promise<'cleanup_blocked'>(resolve => setTimeout(() => resolve('cleanup_blocked'), 10)),
      ])
      await vi.advanceTimersByTimeAsync(11)

      expect(await outcome).toEqual({ kind: 'fallback', failureCode: 'timeout' })
      expect(cancelCalls).toBe(1)
      expect(fetch).toHaveBeenCalledOnce()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('cancels and releases a bounded body reader on abort', async () => {
    let cancelCalls = 0
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined)
      },
      cancel() {
        cancelCalls += 1
      },
    })
    const pending = readResponseBodyBounded(body, {
      signal: controller.signal,
      maxBytes: 65_536,
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelCalls).toBe(1)
  })
})
