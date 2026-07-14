import {
  assessmentCatalogOptionSchema,
  assessmentSelectionsSchema,
  selectionLimits,
} from '../../../shared/schemas/assessment'
import {
  questionGroups,
  trackKeys,
} from '../../../shared/types/domain'
import type {
  AssessmentOption,
  AssessmentSelections,
  QuestionGroup,
  TrackKey,
} from '../../../shared/types/domain'
import type {
  AssessmentScoringErrorCode,
  ScoredAssessment,
} from './types'

const scoringErrorMessages = {
  ASSESSMENT_CATALOG_INVALID: '평가 선택지 구성이 올바르지 않습니다.',
  ASSESSMENT_SELECTIONS_INVALID: '평가 응답이 올바르지 않습니다.',
  ASSESSMENT_OPTION_UNAVAILABLE: '선택한 평가 항목을 사용할 수 없습니다.',
} as const satisfies Record<AssessmentScoringErrorCode, string>

const roundTo = (value: number, decimalPlaces: number) => {
  const factor = 10 ** decimalPlaces
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export class AssessmentScoringError extends Error {
  readonly code: AssessmentScoringErrorCode

  constructor(code: AssessmentScoringErrorCode) {
    super(scoringErrorMessages[code])
    this.name = 'AssessmentScoringError'
    this.code = code
  }
}

const parseCatalog = (input: readonly AssessmentOption[]) => {
  const parsed = assessmentCatalogOptionSchema.array().safeParse(input)
  if (!parsed.success) {
    throw new AssessmentScoringError('ASSESSMENT_CATALOG_INVALID')
  }

  const optionKeys = new Set<string>()
  const groupSortPositions = new Set<string>()
  for (const option of parsed.data) {
    const groupPrefix = `${option.group}.`
    const groupSortPosition = `${option.group}:${option.sortOrder}`
    if (
      !option.optionKey.startsWith(groupPrefix)
      || optionKeys.has(option.optionKey)
      || groupSortPositions.has(groupSortPosition)
    ) {
      throw new AssessmentScoringError('ASSESSMENT_CATALOG_INVALID')
    }
    optionKeys.add(option.optionKey)
    groupSortPositions.add(groupSortPosition)
  }

  return parsed.data as AssessmentOption[]
}

const parseSelections = (input: AssessmentSelections) => {
  const parsed = assessmentSelectionsSchema.safeParse(input)
  if (!parsed.success) {
    throw new AssessmentScoringError('ASSESSMENT_SELECTIONS_INVALID')
  }
  return parsed.data as AssessmentSelections
}

type SelectedOptions = Record<QuestionGroup, AssessmentOption[]>
type GroupTrackScores = Record<QuestionGroup, Record<TrackKey, number>>

const resolveSelectedOptions = (
  catalog: AssessmentOption[],
  selections: AssessmentSelections,
): SelectedOptions => {
  const optionsByKey = new Map(catalog.map(option => [option.optionKey, option]))

  return Object.fromEntries(questionGroups.map((group) => {
    const options = selections[group].map((optionKey) => {
      const option = optionsByKey.get(optionKey)
      if (!option || option.status !== 'active') {
        throw new AssessmentScoringError('ASSESSMENT_OPTION_UNAVAILABLE')
      }
      if (option.group !== group) {
        throw new AssessmentScoringError('ASSESSMENT_SELECTIONS_INVALID')
      }
      return option
    })
    return [group, options]
  })) as SelectedOptions
}

const calculateGroupTrackScores = (selected: SelectedOptions): GroupTrackScores => Object.fromEntries(
  questionGroups.map((group) => {
    const options = selected[group]
    const scores = Object.fromEntries(trackKeys.map((track) => {
      const weightTotal = options.reduce(
        (total, option) => total + option.trackWeights[track],
        0,
      )
      return [track, (weightTotal / (options.length * 3)) * 100]
    })) as Record<TrackKey, number>
    return [group, scores]
  }),
) as GroupTrackScores

const calculateTrackScores = (groupScores: GroupTrackScores) => Object.fromEntries(
  trackKeys.map((track) => {
    const total = questionGroups.reduce(
      (score, group) => score + groupScores[group][track] * selectionLimits[group].weight,
      0,
    )
    return [track, roundTo(total, 1)]
  }),
) as Record<TrackKey, number>

const rankTracks = (
  trackScores: Record<TrackKey, number>,
  groupScores: GroupTrackScores,
) => [...trackKeys].sort((left, right) => {
  const totalDifference = trackScores[right] - trackScores[left]
  if (totalDifference !== 0) {
    return totalDifference
  }

  for (const group of ['work', 'result', 'career'] as const) {
    const groupDifference = groupScores[group][right] - groupScores[group][left]
    if (groupDifference !== 0) {
      return groupDifference
    }
  }

  return trackKeys.indexOf(left) - trackKeys.indexOf(right)
})

const calculateInterestVector = (selected: SelectedOptions) => {
  const scores = new Map<string, number>()

  for (const group of questionGroups) {
    const options = selected[group]
    const matchingOptionCount = new Map<string, number>()
    for (const option of options) {
      for (const tag of option.interestTags) {
        matchingOptionCount.set(tag, (matchingOptionCount.get(tag) ?? 0) + 1)
      }
    }

    for (const [tag, count] of matchingOptionCount) {
      const groupContribution = (count / options.length) * selectionLimits[group].weight
      scores.set(tag, (scores.get(tag) ?? 0) + groupContribution)
    }
  }

  return Object.fromEntries(
    [...scores.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([tag, score]) => [tag, roundTo(score, 6)]),
  )
}

export const scoreAssessment = (
  options: readonly AssessmentOption[],
  inputSelections: AssessmentSelections,
): ScoredAssessment => {
  const catalog = parseCatalog(options)
  const selections = parseSelections(inputSelections)
  const selected = resolveSelectedOptions(catalog, selections)
  const groupScores = calculateGroupTrackScores(selected)
  const trackScores = calculateTrackScores(groupScores)

  return {
    trackScores,
    rankedTracks: rankTracks(trackScores, groupScores),
    interestVector: calculateInterestVector(selected),
  }
}
