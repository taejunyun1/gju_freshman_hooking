export const careerNarrativeSlots = [
  'direction',
  'learning_path',
  'career_direction',
  'faculty_connection',
] as const

export type CareerNarrativeSlot = typeof careerNarrativeSlots[number]
export type CareerNarrativeEvidenceId =
  | `interest:${string}`
  | `track:${string}`
  | `resource:${number}`
  | `faculty:${'primary' | 'specialist'}:${number}:${'name' | 'title' | 'expertise'}`

export type CareerNarrativeSentence<Slot extends CareerNarrativeSlot = CareerNarrativeSlot> = {
  readonly slot: Slot
  readonly text: string
  readonly evidenceIds: readonly CareerNarrativeEvidenceId[]
}

export type CareerNarrative = {
  readonly source: 'openai' | 'deterministic'
  readonly sentences: readonly [
    CareerNarrativeSentence<'direction'>,
    CareerNarrativeSentence<'learning_path'>,
    CareerNarrativeSentence<'career_direction'>,
    CareerNarrativeSentence<'faculty_connection'>,
  ]
}

export type CareerNarrativeFact = {
  readonly ref: CareerNarrativeEvidenceId
  readonly kind:
    | 'interest'
    | 'track'
    | 'course'
    | 'activity'
    | 'career'
    | 'student_work'
    | 'faculty_name'
    | 'faculty_title'
    | 'faculty_expertise'
  readonly sourceResourceType?: 'course' | 'extracurricular' | 'project' | 'student_work' | 'career'
  readonly label: string
}

export type CareerNarrativeTemplateId =
  | 'direction_focus_v1'
  | 'direction_bridge_v1'
  | 'learning_course_v1'
  | 'learning_course_activity_v1'
  | 'learning_interest_v1'
  | 'career_portfolio_v1'
  | 'career_explore_v1'
  | 'faculty_primary_v1'
  | 'faculty_primary_specialist_v1'

export type CareerNarrativeConnectorId =
  | 'and_v1'
  | 'then_v1'
  | 'through_v1'
  | 'with_v1'

export type CareerNarrativeChoiceItem<Slot extends CareerNarrativeSlot = CareerNarrativeSlot> = {
  readonly slot: Slot
  readonly templateId: CareerNarrativeTemplateId
  readonly connectorId: CareerNarrativeConnectorId
  readonly factRefs: readonly CareerNarrativeEvidenceId[]
}

export type CareerNarrativeBrief = {
  readonly version: 'career-narrative-v1'
  readonly providerEligible: boolean
  readonly ineligibilityReason: null | 'unsafe_fact' | 'insufficient_facts'
  readonly facts: Readonly<Record<CareerNarrativeEvidenceId, CareerNarrativeFact>>
  readonly slots: readonly [
    {
      readonly slot: 'direction'
      readonly allowedTemplateIds:
        | readonly ['direction_focus_v1']
        | readonly ['direction_focus_v1', 'direction_bridge_v1']
      readonly allowedConnectorIds: readonly ['and_v1', 'then_v1']
      readonly allowedFactRefs: readonly CareerNarrativeEvidenceId[]
    },
    {
      readonly slot: 'learning_path'
      readonly allowedTemplateIds: readonly ['learning_course_v1', 'learning_course_activity_v1', 'learning_interest_v1']
      readonly allowedConnectorIds: readonly ['through_v1', 'and_v1']
      readonly allowedFactRefs: readonly CareerNarrativeEvidenceId[]
    },
    {
      readonly slot: 'career_direction'
      readonly allowedTemplateIds: readonly ['career_portfolio_v1', 'career_explore_v1']
      readonly allowedConnectorIds: readonly ['with_v1', 'then_v1']
      readonly allowedFactRefs: readonly CareerNarrativeEvidenceId[]
    },
    {
      readonly slot: 'faculty_connection'
      readonly allowedTemplateIds: readonly ['faculty_primary_v1', 'faculty_primary_specialist_v1']
      readonly allowedConnectorIds: readonly ['with_v1', 'and_v1']
      readonly allowedFactRefs: readonly CareerNarrativeEvidenceId[]
    },
  ]
}

export type CareerNarrativeChoice = {
  readonly version: 'career-narrative-choice-v1'
  readonly choices: readonly [
    CareerNarrativeChoiceItem<'direction'>,
    CareerNarrativeChoiceItem<'learning_path'>,
    CareerNarrativeChoiceItem<'career_direction'>,
    CareerNarrativeChoiceItem<'faculty_connection'>,
  ]
}
