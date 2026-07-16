import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

if (process.env.PHOTO_NEXT_RUN_PAID_OPENAI_EVAL !== '1') {
  console.log('Paid OpenAI evaluation is disabled.')
  process.exit(0)
}

const apiKey = process.env.PHOTO_NEXT_OPENAI_EVAL_API_KEY?.trim() ?? ''
if (apiKey === '') {
  console.error('PHOTO_NEXT_OPENAI_EVAL_API_KEY is required for the explicit paid evaluation.')
  process.exit(1)
}

const {
  requestOpenAiCareerNarrativeChoice,
} = await import('../server/modules/assessment/openai-career-narrative.ts')
const {
  renderCareerNarrative,
} = await import('../server/modules/assessment/career-narrative.ts')

const models = ['gpt-5.6-sol', 'gpt-5.6-luna']
const repetitions = 20
const safetyIdentifier = `pn_${'A'.repeat(43)}`

const scenarioDefinitions = [
  {
    id: 'documentary-social',
    track: 'documentary',
    interest: '사람과 사회 기록',
    course: '포토커뮤니케이션',
    career: '다큐멘터리 사진가',
    primary: ['조대연', '교수', '포토커뮤니케이션·다큐멘터리·시각커뮤니케이션'],
    required: ['faculty:primary:11:name', 'course'],
  },
  {
    id: 'documentary-archive',
    track: 'documentary',
    interest: '지역문화 기록과 사진 아카이브',
    course: '지역문화 사진기록',
    career: '사진 아카이브 연구자',
    primary: ['김사라', '교수', '다큐멘터리·지역기록·사진아카이브'],
    required: ['faculty:primary:12:name', 'course'],
  },
  {
    id: 'art-photo',
    track: 'art_photo',
    interest: '개인 주제 예술사진과 영상',
    course: '현대사진과 융합이미지',
    career: '미디어아티스트',
    primary: ['윤태준', '교수', '현대예술·예술사진·영상·AI·기술적 이미지'],
    required: ['faculty:primary:13:expertise', 'course'],
  },
  {
    id: 'commercial',
    track: 'commercial',
    interest: '광고·패션 브랜드 이미지',
    course: '광고사진',
    career: '상업사진가',
    primary: ['윤태준', '교수', '현대예술·예술사진·영상·AI·기술적 이미지'],
    specialist: ['곽동욱', '겸임교수', '광고사진·패션사진·제품사진·브랜드 이미지'],
    required: ['specialist', 'course'],
  },
  {
    id: 'video-ai-drone',
    track: 'video',
    interest: 'AI 기반 영상·편집·드론 촬영',
    course: 'AI 영상과 편집',
    career: '영상콘텐츠 제작자',
    primary: ['윤태준', '교수', '현대예술·예술사진·영상·AI·기술적 이미지'],
    specialist: ['박재웅', '겸임교수', '영상콘텐츠·드론·VR·360 영상'],
    required: ['specialist', 'course'],
  },
]

const scenarioBrief = (scenario, ordinal) => {
  const primaryId = 11 + ordinal
  const courseId = 111 + ordinal * 10
  const careerId = 211 + ordinal * 10
  const interestRef = `interest:work.eval_${ordinal}`
  const trackRef = `track:${scenario.track}`
  const primaryRefs = [
    `faculty:primary:${primaryId}:name`,
    `faculty:primary:${primaryId}:title`,
    `faculty:primary:${primaryId}:expertise`,
  ]
  const specialistId = 24 + Math.max(0, ordinal - 3)
  const specialistRefs = scenario.specialist === undefined
    ? []
    : [
        `faculty:specialist:${specialistId}:name`,
        `faculty:specialist:${specialistId}:title`,
        `faculty:specialist:${specialistId}:expertise`,
      ]
  const courseRef = `resource:${courseId}`
  const careerRef = `resource:${careerId}`
  const facts = {
    [interestRef]: { ref: interestRef, kind: 'interest', label: scenario.interest },
    [trackRef]: {
      ref: trackRef,
      kind: 'track',
      label: scenario.track === 'art_photo'
        ? '예술사진'
        : scenario.track === 'video'
          ? '영상과 기술(AI·편집·드론)'
          : scenario.track === 'commercial'
            ? '광고사진'
            : '다큐멘터리 사진',
    },
    [courseRef]: {
      ref: courseRef,
      kind: 'course',
      sourceResourceType: 'course',
      label: scenario.course,
    },
    [careerRef]: {
      ref: careerRef,
      kind: 'career',
      sourceResourceType: 'career',
      label: scenario.career,
    },
    [primaryRefs[0]]: { ref: primaryRefs[0], kind: 'faculty_name', label: scenario.primary[0] },
    [primaryRefs[1]]: { ref: primaryRefs[1], kind: 'faculty_title', label: scenario.primary[1] },
    [primaryRefs[2]]: { ref: primaryRefs[2], kind: 'faculty_expertise', label: scenario.primary[2] },
  }
  if (scenario.specialist !== undefined) {
    facts[specialistRefs[0]] = {
      ref: specialistRefs[0],
      kind: 'faculty_name',
      label: scenario.specialist[0],
    }
    facts[specialistRefs[1]] = {
      ref: specialistRefs[1],
      kind: 'faculty_title',
      label: scenario.specialist[1],
    }
    facts[specialistRefs[2]] = {
      ref: specialistRefs[2],
      kind: 'faculty_expertise',
      label: scenario.specialist[2],
    }
  }
  return {
    brief: {
      version: 'career-narrative-v1',
      providerEligible: true,
      ineligibilityReason: null,
      facts,
      slots: [
        {
          slot: 'direction',
          allowedTemplateIds: ['direction_focus_v1', 'direction_bridge_v1'],
          allowedConnectorIds: ['and_v1', 'then_v1'],
          allowedFactRefs: [interestRef, trackRef],
        },
        {
          slot: 'learning_path',
          allowedTemplateIds: ['learning_course_v1', 'learning_course_activity_v1', 'learning_interest_v1'],
          allowedConnectorIds: ['through_v1', 'and_v1'],
          allowedFactRefs: [courseRef, interestRef, trackRef],
        },
        {
          slot: 'career_direction',
          allowedTemplateIds: ['career_portfolio_v1', 'career_explore_v1'],
          allowedConnectorIds: ['with_v1', 'then_v1'],
          allowedFactRefs: [careerRef, interestRef, trackRef],
        },
        {
          slot: 'faculty_connection',
          allowedTemplateIds: ['faculty_primary_v1', 'faculty_primary_specialist_v1'],
          allowedConnectorIds: ['with_v1', 'and_v1'],
          allowedFactRefs: [...primaryRefs, ...specialistRefs],
        },
      ],
    },
    requiredRefs: scenario.required.map((requirement) => {
      if (requirement === 'course') return courseRef
      if (requirement === 'specialist') return specialistRefs[0]
      return requirement
    }),
  }
}

const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0
}

const assertGenerated = (requiredRefs, brief, result) => {
  if (result.kind !== 'generated') return { passed: false, reason: result.failureCode }
  const rendered = renderCareerNarrative(brief, result.choice, 'openai')
  const usedRefs = new Set(result.choice.choices.flatMap(item => item.factRefs))
  const passed = (
    rendered.sentences.length === 4
    && rendered.sentences.every(sentence => sentence.text.endsWith('다.'))
    && requiredRefs.every(ref => usedRefs.has(ref))
  )
  return {
    passed,
    reason: passed ? null : 'policy_assertion',
    choiceIds: {
      templates: result.choice.choices.map(item => item.templateId),
      connectors: result.choice.choices.map(item => item.connectorId),
    },
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  }
}

const runLocalAdversarialPreflight = async () => {
  const { brief } = scenarioBrief(scenarioDefinitions[0], 0)
  brief.providerEligible = false
  brief.ineligibilityReason = 'unsafe_fact'
  let providerCalled = false
  const injection = await requestOpenAiCareerNarrativeChoice({
    apiKey,
    model: 'gpt-5.6-sol',
    safetyIdentifier,
    timeoutMs: 2_000,
    brief,
    fetch: async () => {
      providerCalled = true
      throw new Error('provider must remain closed')
    },
  })
  if (providerCalled || injection.kind !== 'fallback') {
    throw new Error('prompt-injection-title preflight failed')
  }

  const refusalFixture = scenarioBrief(scenarioDefinitions[0], 0)
  const refusal = await requestOpenAiCareerNarrativeChoice({
    apiKey,
    model: 'gpt-5.6-sol',
    safetyIdentifier,
    timeoutMs: 2_000,
    brief: refusalFixture.brief,
    fetch: async () => new Response(JSON.stringify({
      id: 'resp_local_refusal',
      status: 'completed',
      incomplete_details: null,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'declined' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  if (refusal.kind !== 'fallback' || refusal.failureCode !== 'refusal') {
    throw new Error('refusal preflight failed')
  }
  return ['prompt-injection-title', 'refusal']
}

const aggregate = {
  version: 'photo-next-openai-eval-v1',
  createdAt: new Date().toISOString(),
  repetitions,
  adversarialPreflight: await runLocalAdversarialPreflight(),
  models: {},
}

for (const model of models) {
  aggregate.models[model] = {}
  for (const [ordinal, scenario] of scenarioDefinitions.entries()) {
    const { brief, requiredRefs } = scenarioBrief(scenario, ordinal)
    const latencies = []
    const choiceCounts = new Map()
    let passed = 0
    let refusals = 0
    let policyFailures = 0
    let unknownRefs = 0
    let inputTokens = 0
    let outputTokens = 0

    for (let attempt = 0; attempt < repetitions; attempt += 1) {
      const startedAt = performance.now()
      const result = await requestOpenAiCareerNarrativeChoice({
        apiKey,
        model,
        safetyIdentifier,
        timeoutMs: 8_000,
        brief,
      })
      latencies.push(performance.now() - startedAt)
      const assertion = assertGenerated(requiredRefs, brief, result)
      if (assertion.passed) passed += 1
      else if (assertion.reason === 'refusal') refusals += 1
      else if (assertion.reason === 'invalid_output') unknownRefs += 1
      else policyFailures += 1
      if (assertion.choiceIds !== undefined) {
        const key = JSON.stringify(assertion.choiceIds)
        choiceCounts.set(key, (choiceCounts.get(key) ?? 0) + 1)
      }
      inputTokens += assertion.inputTokens ?? 0
      outputTokens += assertion.outputTokens ?? 0
    }

    aggregate.models[model][scenario.id] = {
      attempts: repetitions,
      strictSchemaPasses: passed,
      refusals,
      policyFailures,
      unknownRefs,
      latencyMs: {
        median: Math.round(percentile(latencies, 0.5)),
        p95: Math.round(percentile(latencies, 0.95)),
      },
      tokens: { input: inputTokens, output: outputTokens },
      stableChoiceIds: [...choiceCounts.entries()].map(([ids, count]) => ({
        ...JSON.parse(ids),
        count,
      })),
      passed: passed === repetitions && refusals === 0 && policyFailures === 0 && unknownRefs === 0,
    }
  }
}

const artifactPath = resolve(
  process.env.PHOTO_NEXT_OPENAI_EVAL_ARTIFACT
    ?? '.artifacts/openai-career-eval-local.json',
)
await mkdir(dirname(artifactPath), { recursive: true })
await writeFile(artifactPath, `${JSON.stringify(aggregate, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
})
console.log(`Aggregate-only paid evaluation written to ${artifactPath}`)
