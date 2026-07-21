import { careerNarrativeSchema } from '../../../shared/schemas/career-narrative'
import type {
  CareerNarrative,
  CareerNarrativeBrief,
  CareerNarrativeChoice,
  CareerNarrativeChoiceItem,
  CareerNarrativeEvidenceId,
  CareerNarrativeFact,
  CareerNarrativeSlot,
} from '../../../shared/types/career-narrative'
import { careerNarrativeSlots } from '../../../shared/types/career-narrative'
import { trackLabels } from '../../../shared/types/domain'
import type {
  FacultyResult,
  CourseResultResource,
  ResultResource,
  ResultSnapshotCore,
  SelectedInterest,
} from '../../../shared/types/result'
import { primaryTrackPathwayCourses } from '../matching/resources'

const unsafeFactPattern = /`|<\s*\/?\s*[a-z]|<system|assistant:|developer:|ignore previous|이전 지시를 무시|(?:https?:\/\/|www\.)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:01[016789]|0[2-6]\d?)[-. )]?\d{3,4}[-. ]?\d{4}|합격 보장|취업 보장|진로 확정|배정 완료|반드시|무조건|100%/iu
const forbiddenOutputPattern = /`|<[^>]+>|(?:https?:\/\/|www\.)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:01[016789]|0[2-6]\d?)[-. )]?\d{3,4}[-. ]?\d{4}|합격 보장|취업 보장|진로 확정|배정 완료|반드시|무조건|100%/iu

const hasControlCharacters = (value: string) => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
})

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

const isSafeFactLabel = (label: string) => (
  label.length > 0
  && label.length <= 200
  && label === label.trim()
  && !hasControlCharacters(label)
  && !unsafeFactPattern.test(label)
)

const interestRef = (interest: SelectedInterest): CareerNarrativeEvidenceId => (
  `interest:${interest.key}`
)

const resourceRef = (resource: Pick<ResultResource, 'id'>): CareerNarrativeEvidenceId => (
  `resource:${resource.id}`
)

const facultyRefs = (
  faculty: Pick<FacultyResult, 'id'>,
  role: 'primary' | 'specialist',
): readonly [
  CareerNarrativeEvidenceId,
  CareerNarrativeEvidenceId,
  CareerNarrativeEvidenceId,
] => [
  `faculty:${role}:${faculty.id}:name`,
  `faculty:${role}:${faculty.id}:title`,
  `faculty:${role}:${faculty.id}:expertise`,
]

const firstInterest = (
  interests: readonly SelectedInterest[],
  groups?: readonly SelectedInterest['group'][],
) => interests.find(interest => groups === undefined || groups.includes(interest.group))

const videoBridgeCourses = (
  core: ResultSnapshotCore,
): readonly [CourseResultResource, CourseResultResource] | undefined => {
  if (core.rankedTracks[0] !== 'video') return undefined

  const secondaryTrack = core.rankedTracks[1]
  const hasVideoPathwayCourse = (course: CourseResultResource) => (
    course.displayMetadata.gradeYear === 3
    && primaryTrackPathwayCourses.video.some(pathway => pathway.title === course.title)
  )
  const hasSecondaryPathwayCourse = (course: CourseResultResource) => (
    course.displayMetadata.gradeYear === 4
    && primaryTrackPathwayCourses[secondaryTrack].some(pathway => pathway.title === course.title)
  )
  const videoCourse = core.resources.course.find(hasVideoPathwayCourse)
  const secondaryCourse = core.resources.course.find(hasSecondaryPathwayCourse)

  return videoCourse === undefined || secondaryCourse === undefined
    ? undefined
    : [videoCourse, secondaryCourse]
}

const completeFacultyFacts = (
  faculty: FacultyResult,
  role: 'primary' | 'specialist',
): readonly CareerNarrativeFact[] => {
  const [nameRef, titleRef, expertiseRef] = facultyRefs(faculty, role)
  return [
    { ref: nameRef, kind: 'faculty_name', label: faculty.name },
    { ref: titleRef, kind: 'faculty_title', label: faculty.title },
    { ref: expertiseRef, kind: 'faculty_expertise', label: faculty.expertise },
  ]
}

export const buildCareerNarrativeBrief = (
  core: ResultSnapshotCore,
): CareerNarrativeBrief => {
  const facts: Partial<Record<CareerNarrativeEvidenceId, CareerNarrativeFact>> = {}
  let unsafeFact = false
  let insufficientFacts = false

  const addFact = (
    fact: CareerNarrativeFact,
    unsafeFallbackLabel?: string,
  ): boolean => {
    if (!isSafeFactLabel(fact.label)) {
      unsafeFact = true
      if (unsafeFallbackLabel === undefined) return false
      facts[fact.ref] = Object.freeze({ ...fact, label: unsafeFallbackLabel })
      return true
    }
    facts[fact.ref] = Object.freeze({ ...fact })
    return true
  }

  const addInterest = (interest: SelectedInterest | undefined) => {
    if (interest === undefined) return undefined
    const ref = interestRef(interest)
    const fallbackLabels = {
      work: '선택한 시각 작업',
      result: '선택한 결과물',
      style: '선택한 작업 방식',
      career: '선택한 진로 관심',
    } as const
    return addFact(
      { ref, kind: 'interest', label: interest.label },
      fallbackLabels[interest.group],
    ) ? ref : undefined
  }

  const addTrack = (track: typeof core.rankedTracks[number]) => {
    const ref = `track:${track}` as const
    return addFact({ ref, kind: 'track', label: trackLabels[track] }) ? ref : undefined
  }

  const primaryInterestRef = addInterest(firstInterest(core.selectedInterests))
  const learningInterestRef = addInterest(firstInterest(core.selectedInterests, ['work', 'result']))
  const careerInterestRef = addInterest(firstInterest(core.selectedInterests, ['career']))
  const topTrackRef = addTrack(core.rankedTracks[0])
  const secondTrackRef = addTrack(core.rankedTracks[1])

  const bridgeCourses = videoBridgeCourses(core)
  const selectedCourses = core.rankedTracks[0] === 'video'
    ? bridgeCourses ?? []
    : core.resources.course.slice(0, 2)
  const courseRefs = selectedCourses.flatMap((resource) => {
    const ref = resourceRef(resource)
    return addFact({
      ref,
      kind: 'course',
      sourceResourceType: 'course',
      label: resource.title,
    }) ? [ref] : []
  })
  const activity = core.resources.project[0] ?? core.resources.extracurricular[0]
  const activityRefs = activity === undefined
    ? []
    : (() => {
        const ref = resourceRef(activity)
        return addFact({
          ref,
          kind: 'activity',
          sourceResourceType: activity.type,
          label: activity.title,
        }) ? [ref] : []
      })()

  const approvedCareer = core.resources.career[0]
  const careerRefs = approvedCareer === undefined
    ? []
    : (() => {
        const ref = resourceRef(approvedCareer)
        return addFact({
          ref,
          kind: 'career',
          sourceResourceType: 'career',
          label: approvedCareer.title,
        }) ? [ref] : []
      })()
  const studentWork = core.resources.student_work[0]
  const studentWorkRefs = studentWork === undefined
    ? []
    : (() => {
        const ref = resourceRef(studentWork)
        return addFact({
          ref,
          kind: 'student_work',
          sourceResourceType: 'student_work',
          label: studentWork.title,
        }) ? [ref] : []
      })()

  const addFaculty = (
    faculty: FacultyResult,
    role: 'primary' | 'specialist',
  ): readonly CareerNarrativeEvidenceId[] => {
    const candidateFacts = completeFacultyFacts(faculty, role)
    if (!candidateFacts.every(fact => isSafeFactLabel(fact.label))) {
      unsafeFact = true
      if (role === 'primary') {
        const genericLabels = ['학과 전임교원', '교수', '사진·영상 교육'] as const
        candidateFacts.forEach((fact, index) => {
          facts[fact.ref] = Object.freeze({ ...fact, label: genericLabels[index]! })
        })
        return candidateFacts.map(fact => fact.ref)
      }
      return []
    }
    candidateFacts.forEach(fact => addFact(fact))
    return candidateFacts.map(fact => fact.ref)
  }

  const primaryFacultyRefs = addFaculty(core.faculty.primary, 'primary')
  const specialistFacultyRefs = core.faculty.specialists[0] === undefined
    ? []
    : addFaculty(core.faculty.specialists[0], 'specialist')

  if (core.faculty.primary.name === '윤태준') {
    const requiredExpertise = ['현대예술', '예술사진', '영상', 'AI', '기술적 이미지']
    if (!requiredExpertise.every(term => core.faculty.primary.expertise.includes(term))) {
      insufficientFacts = true
    }
  }
  if (primaryInterestRef === undefined || topTrackRef === undefined || primaryFacultyRefs.length !== 3) {
    insufficientFacts = true
  }

  const directionRefs = [
    primaryInterestRef,
    topTrackRef,
    secondTrackRef,
  ].filter((ref): ref is CareerNarrativeEvidenceId => ref !== undefined)
  const learningRefs = [
    ...courseRefs,
    ...activityRefs,
    learningInterestRef,
    topTrackRef,
  ].filter((ref): ref is CareerNarrativeEvidenceId => ref !== undefined)
  const careerDirectionRefs = [
    ...careerRefs,
    ...studentWorkRefs,
    careerInterestRef,
    topTrackRef,
  ].filter((ref): ref is CareerNarrativeEvidenceId => ref !== undefined)

  const brief: CareerNarrativeBrief = {
    version: 'career-narrative-v1',
    providerEligible: !unsafeFact && !insufficientFacts,
    ineligibilityReason: unsafeFact
      ? 'unsafe_fact'
      : insufficientFacts
        ? 'insufficient_facts'
        : null,
    facts: facts as Readonly<Record<CareerNarrativeEvidenceId, CareerNarrativeFact>>,
    slots: [
      {
        slot: 'direction',
        allowedTemplateIds: ['direction_focus_v1', 'direction_bridge_v1'],
        allowedConnectorIds: ['and_v1', 'then_v1'],
        allowedFactRefs: directionRefs,
      },
      {
        slot: 'learning_path',
        allowedTemplateIds: ['learning_course_v1', 'learning_course_activity_v1', 'learning_interest_v1'],
        allowedConnectorIds: ['through_v1', 'and_v1'],
        allowedFactRefs: [...new Set(learningRefs)],
      },
      {
        slot: 'career_direction',
        allowedTemplateIds: ['career_portfolio_v1', 'career_explore_v1'],
        allowedConnectorIds: ['with_v1', 'then_v1'],
        allowedFactRefs: [...new Set(careerDirectionRefs)],
      },
      {
        slot: 'faculty_connection',
        allowedTemplateIds: ['faculty_primary_v1', 'faculty_primary_specialist_v1'],
        allowedConnectorIds: ['with_v1', 'and_v1'],
        allowedFactRefs: [...primaryFacultyRefs, ...specialistFacultyRefs],
      },
    ],
  }
  return deepFreeze(brief)
}

const factsByKind = (
  brief: CareerNarrativeBrief,
  slot: CareerNarrativeSlot,
  kind: CareerNarrativeFact['kind'],
) => {
  const slotBrief = brief.slots.find(candidate => candidate.slot === slot)
  if (slotBrief === undefined) return []
  return slotBrief.allowedFactRefs.filter(ref => brief.facts[ref]?.kind === kind)
}

export const buildDeterministicCareerNarrativeChoice = (
  brief: CareerNarrativeBrief,
): CareerNarrativeChoice => {
  const directionInterest = factsByKind(brief, 'direction', 'interest')[0]
  const directionTracks = factsByKind(brief, 'direction', 'track')
  const courses = factsByKind(brief, 'learning_path', 'course').slice(0, 2)
  const learningFallback = [
    factsByKind(brief, 'learning_path', 'interest')[0],
    factsByKind(brief, 'learning_path', 'track')[0],
  ].filter((ref): ref is CareerNarrativeEvidenceId => ref !== undefined)
  const careers = factsByKind(brief, 'career_direction', 'career').slice(0, 1)
  const studentWorks = factsByKind(brief, 'career_direction', 'student_work').slice(0, 1)
  const careerFallback = [
    factsByKind(brief, 'career_direction', 'interest')[0],
    factsByKind(brief, 'career_direction', 'track')[0],
  ].filter((ref): ref is CareerNarrativeEvidenceId => ref !== undefined)
  const primaryFaculty = brief.slots[3].allowedFactRefs.filter(ref => ref.startsWith('faculty:primary:'))

  if (directionInterest === undefined || directionTracks[0] === undefined) {
    throw new Error('CAREER_NARRATIVE_FACT_REFERENCE_INVALID')
  }
  if (primaryFaculty.length !== 3) throw new Error('CAREER_NARRATIVE_FACT_REFERENCE_INVALID')

  const direction: CareerNarrativeChoiceItem<'direction'> = (
    directionTracks[0] === 'track:video' && directionTracks[1] !== undefined
      ? {
          slot: 'direction',
          templateId: 'direction_bridge_v1',
          connectorId: 'and_v1',
          factRefs: [directionInterest, directionTracks[0], directionTracks[1]],
        }
      : {
          slot: 'direction',
          templateId: 'direction_focus_v1',
          connectorId: 'and_v1',
          factRefs: [directionInterest, directionTracks[0]],
        }
  )

  const learningPath: CareerNarrativeChoiceItem<'learning_path'> = courses.length > 0
    ? {
        slot: 'learning_path',
        templateId: 'learning_course_v1',
        connectorId: 'through_v1',
        factRefs: courses,
      }
    : {
        slot: 'learning_path',
        templateId: 'learning_interest_v1',
        connectorId: 'through_v1',
        factRefs: learningFallback,
      }

  const careerDirection: CareerNarrativeChoiceItem<'career_direction'> = careers.length > 0
    ? {
        slot: 'career_direction',
        templateId: 'career_portfolio_v1',
        connectorId: 'with_v1',
        factRefs: [...careers, ...studentWorks],
      }
    : {
        slot: 'career_direction',
        templateId: 'career_explore_v1',
        connectorId: 'then_v1',
        factRefs: careerFallback,
      }

  const facultyConnection: CareerNarrativeChoiceItem<'faculty_connection'> = {
    slot: 'faculty_connection',
    templateId: 'faculty_primary_v1',
    connectorId: 'with_v1',
    factRefs: primaryFaculty,
  }

  return deepFreeze({
    version: 'career-narrative-choice-v1',
    choices: [direction, learningPath, careerDirection, facultyConnection],
  })
}

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

const assertKinds = (
  brief: CareerNarrativeBrief,
  refs: readonly CareerNarrativeEvidenceId[],
  expected: readonly CareerNarrativeFact['kind'][],
) => {
  const actual = refs.map(ref => brief.facts[ref]?.kind)
  if (actual.length !== expected.length || actual.some((kind, index) => kind !== expected[index])) {
    throw new Error('CAREER_NARRATIVE_FACT_SHAPE_INVALID')
  }
}

const assertFacultyTriple = (
  refs: readonly CareerNarrativeEvidenceId[],
  role: 'primary' | 'specialist',
) => {
  if (refs.length !== 3) throw new Error('CAREER_NARRATIVE_FACT_SHAPE_INVALID')
  const parsed = refs.map((ref) => {
    const match = new RegExp(`^faculty:${role}:(\\d+):(name|title|expertise)$`, 'u').exec(ref)
    if (match === null) throw new Error('CAREER_NARRATIVE_FACT_SHAPE_INVALID')
    return { id: match[1], suffix: match[2] }
  })
  if (new Set(parsed.map(item => item.id)).size !== 1) {
    throw new Error('CAREER_NARRATIVE_FACT_SHAPE_INVALID')
  }
  if (parsed.map(item => item.suffix).join('|') !== 'name|title|expertise') {
    throw new Error('CAREER_NARRATIVE_FACT_SHAPE_INVALID')
  }
}

const validateTemplateFacts = (
  brief: CareerNarrativeBrief,
  choice: CareerNarrativeChoiceItem,
) => {
  switch (choice.templateId) {
    case 'direction_focus_v1':
      assertKinds(brief, choice.factRefs, ['interest', 'track'])
      return
    case 'direction_bridge_v1':
      assertKinds(brief, choice.factRefs, ['interest', 'track', 'track'])
      return
    case 'learning_course_v1': {
      if (choice.factRefs.length < 1 || choice.factRefs.length > 2) {
        throw new Error('CAREER_NARRATIVE_FACT_SHAPE_INVALID')
      }
      assertKinds(brief, choice.factRefs, choice.factRefs.map(() => 'course'))
      return
    }
    case 'learning_course_activity_v1': {
      if (choice.factRefs.length < 2 || choice.factRefs.length > 3) {
        throw new Error('CAREER_NARRATIVE_FACT_SHAPE_INVALID')
      }
      const expected = [
        ...choice.factRefs.slice(0, -1).map(() => 'course' as const),
        'activity' as const,
      ]
      assertKinds(brief, choice.factRefs, expected)
      return
    }
    case 'learning_interest_v1':
      assertKinds(brief, choice.factRefs, ['interest', 'track'])
      return
    case 'career_portfolio_v1':
      assertKinds(
        brief,
        choice.factRefs,
        choice.factRefs.length === 1 ? ['career'] : ['career', 'student_work'],
      )
      return
    case 'career_explore_v1':
      assertKinds(brief, choice.factRefs, ['interest', 'track'])
      return
    case 'faculty_primary_v1':
      assertFacultyTriple(choice.factRefs, 'primary')
      assertKinds(brief, choice.factRefs, ['faculty_name', 'faculty_title', 'faculty_expertise'])
      return
    case 'faculty_primary_specialist_v1':
      if (choice.factRefs.length !== 6) throw new Error('CAREER_NARRATIVE_FACT_SHAPE_INVALID')
      assertFacultyTriple(choice.factRefs.slice(0, 3), 'primary')
      assertFacultyTriple(choice.factRefs.slice(3, 6), 'specialist')
      assertKinds(brief, choice.factRefs, [
        'faculty_name',
        'faculty_title',
        'faculty_expertise',
        'faculty_name',
        'faculty_title',
        'faculty_expertise',
      ])
  }
}

const clipAtWordBoundary = (input: string, maximum: number) => {
  if (input.length <= maximum) return input
  let end = maximum - 1
  const codeUnit = input.charCodeAt(end - 1)
  if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) end -= 1
  const sliced = input.slice(0, end)
  const lastSpace = sliced.lastIndexOf(' ')
  const clipped = lastSpace >= Math.floor(maximum / 2) ? sliced.slice(0, lastSpace) : sliced
  return `${clipped}…`
}

const hasFinalConsonant = (value: string) => {
  const last = [...value].at(-1)
  if (last === undefined) return false
  const codePoint = last.codePointAt(0) ?? 0
  return codePoint >= 0xAC00 && codePoint <= 0xD7A3 && (codePoint - 0xAC00) % 28 !== 0
}

const particle = (
  source: string,
  whenFinalConsonant: string,
  otherwise: string,
) => hasFinalConsonant(source) ? whenFinalConsonant : otherwise

const labelsFor = (
  brief: CareerNarrativeBrief,
  choice: CareerNarrativeChoiceItem,
) => choice.factRefs.map((ref) => {
  const fact = brief.facts[ref]
  if (fact === undefined) throw new Error('CAREER_NARRATIVE_FACT_REFERENCE_INVALID')
  return fact.label
})

const renderChoice = (
  brief: CareerNarrativeBrief,
  choice: CareerNarrativeChoice,
  source: CareerNarrative['source'],
): CareerNarrative => {
  const [direction, learningPath, careerDirection, facultyConnection] = choice.choices
  const directionLabels = labelsFor(brief, direction)
  const learningLabels = labelsFor(brief, learningPath)
  const careerLabels = labelsFor(brief, careerDirection)
  const facultyLabels = labelsFor(brief, facultyConnection)

  const directionText = direction.templateId === 'direction_bridge_v1'
    ? `선택한 ‘${clipAtWordBoundary(directionLabels[0]!, 32)}’ 관심은 ${clipAtWordBoundary(directionLabels[1]!, 28)}을 중심으로 ${clipAtWordBoundary(directionLabels[2]!, 28)}까지 함께 탐색하는 방향과 연결됩니다.`
    : `선택한 ‘${clipAtWordBoundary(directionLabels[0]!, 40)}’ 관심은 ${clipAtWordBoundary(directionLabels[1]!, 35)}을 중심으로 탐색하는 방향과 연결됩니다.`

  const learningText = learningPath.templateId === 'learning_interest_v1'
    ? `공개 확인된 교과·프로젝트가 없으면 선택한 ‘${clipAtWordBoundary(learningLabels[0]!, 34)}’ 관심과 ${clipAtWordBoundary(learningLabels[1]!, 30)} 방향을 바탕으로 기초 결과물부터 단계적으로 구체화해 볼 수 있습니다.`
    : learningPath.templateId === 'learning_course_activity_v1'
      ? `2026 교과과정의 ‘${clipAtWordBoundary(learningLabels[0]!, 28)}’${learningLabels.length === 3 ? `과 ‘${clipAtWordBoundary(learningLabels[1]!, 24)}’` : ''}, ‘${clipAtWordBoundary(learningLabels.at(-1)!, 28)}’ 활동을 통해 관심을 실제 결과물로 발전시키는 경로를 살펴볼 수 있습니다.`
      : `2026 교과과정의 ‘${clipAtWordBoundary(learningLabels[0]!, 32)}’${learningLabels[1] === undefined ? '' : `${particle(learningLabels[0]!, '과', '와')} ‘${clipAtWordBoundary(learningLabels[1], 28)}’`}${particle(learningLabels.at(-1)!, '을', '를')} 통해 관심을 실제 결과물로 발전시키는 경로를 살펴볼 수 있습니다.`

  const careerText = careerDirection.templateId === 'career_portfolio_v1'
    ? `${clipAtWordBoundary(careerLabels[0]!, 40)}${particle(careerLabels[0]!, '을', '를')} 바탕으로 ${careerLabels[1] === undefined ? '선택한 관심' : clipAtWordBoundary(careerLabels[1], 36)} 방향의 포트폴리오와 진로 가능성을 구체화해 볼 수 있습니다.`
    : `선택한 ‘${clipAtWordBoundary(careerLabels[0]!, 38)}’ 관심을 바탕으로 ${clipAtWordBoundary(careerLabels[1]!, 32)} 방향의 포트폴리오와 진로 가능성을 구체화해 볼 수 있습니다.`

  const facultyText = facultyConnection.templateId === 'faculty_primary_specialist_v1'
    ? `${clipAtWordBoundary(facultyLabels[0]!, 10)} ${clipAtWordBoundary(facultyLabels[1]!, 8)}${particle(facultyLabels[1]!, '이', '가')} ${clipAtWordBoundary(facultyLabels[2]!, 20)} 관점에서 전체 학습경로를 상담하고, ${clipAtWordBoundary(facultyLabels[3]!, 10)} ${clipAtWordBoundary(facultyLabels[4]!, 8)}의 ${clipAtWordBoundary(facultyLabels[5]!, 20)} 실무를 연계하며 실제 상담 담당자는 학과가 최종 배정합니다.`
    : `${clipAtWordBoundary(facultyLabels[0]!, 16)} ${clipAtWordBoundary(facultyLabels[1]!, 10)}${particle(facultyLabels[1]!, '이', '가')} ${clipAtWordBoundary(facultyLabels[2]!, 40)} 관점에서 전체 학습경로를 상담하고, 실제 상담 담당자는 학과가 최종 배정합니다.`

  return {
    source,
    sentences: [
      { slot: 'direction', text: directionText, evidenceIds: direction.factRefs },
      { slot: 'learning_path', text: learningText, evidenceIds: learningPath.factRefs },
      { slot: 'career_direction', text: careerText, evidenceIds: careerDirection.factRefs },
      { slot: 'faculty_connection', text: facultyText, evidenceIds: facultyConnection.factRefs },
    ],
  }
}

const validateRenderedNarrative = (narrative: CareerNarrative) => {
  const parsed = careerNarrativeSchema.safeParse(narrative)
  if (!parsed.success) throw new Error('CAREER_NARRATIVE_RENDER_INVALID')
  if (narrative.sentences.some(sentence => (
    !sentence.text.endsWith('다.')
    || !/[가-힣]/u.test(sentence.text)
    || hasControlCharacters(sentence.text)
    || forbiddenOutputPattern.test(sentence.text)
  ))) {
    throw new Error('CAREER_NARRATIVE_RENDER_INVALID')
  }
  const totalLength = narrative.sentences.reduce((sum, sentence) => sum + sentence.text.length, 0)
  if (totalLength > 520) throw new Error('CAREER_NARRATIVE_RENDER_INVALID')
}

export const validateCareerNarrativeChoice = (
  brief: CareerNarrativeBrief,
  input: unknown,
): CareerNarrativeChoice => {
  if (!isRecord(input) || !hasExactKeys(input, ['version', 'choices'])) {
    throw new Error('CAREER_NARRATIVE_CHOICE_INVALID')
  }
  if (input.version !== 'career-narrative-choice-v1'
    || !Array.isArray(input.choices)
    || input.choices.length !== careerNarrativeSlots.length) {
    throw new Error('CAREER_NARRATIVE_CHOICE_INVALID')
  }

  const choices = input.choices.map((raw, index) => {
    if (!isRecord(raw) || !hasExactKeys(raw, ['slot', 'templateId', 'connectorId', 'factRefs'])) {
      throw new Error('CAREER_NARRATIVE_CHOICE_INVALID')
    }
    const slotBrief = brief.slots[index]!
    if (raw.slot !== slotBrief.slot
      || typeof raw.templateId !== 'string'
      || !slotBrief.allowedTemplateIds.includes(raw.templateId as never)
      || typeof raw.connectorId !== 'string'
      || !slotBrief.allowedConnectorIds.includes(raw.connectorId as never)
      || !Array.isArray(raw.factRefs)
      || raw.factRefs.length < 1
      || raw.factRefs.length > 6
      || raw.factRefs.some(ref => typeof ref !== 'string')
      || new Set(raw.factRefs).size !== raw.factRefs.length) {
      throw new Error('CAREER_NARRATIVE_CHOICE_INVALID')
    }
    for (const ref of raw.factRefs as string[]) {
      const fact = brief.facts[ref as CareerNarrativeEvidenceId]
      if (fact === undefined || !slotBrief.allowedFactRefs.includes(ref as CareerNarrativeEvidenceId)) {
        throw new Error('CAREER_NARRATIVE_FACT_REFERENCE_INVALID')
      }
    }
    const choice = raw as unknown as CareerNarrativeChoiceItem
    validateTemplateFacts(brief, choice)
    return choice
  }) as unknown as CareerNarrativeChoice['choices']

  const validated = deepFreeze({
    version: 'career-narrative-choice-v1' as const,
    choices,
  })
  validateRenderedNarrative(renderChoice(brief, validated, 'deterministic'))
  return validated
}

export const renderCareerNarrative = (
  brief: CareerNarrativeBrief,
  input: unknown,
  source: CareerNarrative['source'],
): CareerNarrative => {
  const choice = validateCareerNarrativeChoice(brief, input)
  const narrative = renderChoice(brief, choice, source)
  validateRenderedNarrative(narrative)
  return deepFreeze(narrative)
}
