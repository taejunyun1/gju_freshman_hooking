import type { TrackKey } from '../../../shared/types/domain'

export interface ScoredAssessment {
  trackScores: Record<TrackKey, number>
  rankedTracks: TrackKey[]
  interestVector: Record<string, number>
}

export type AssessmentScoringErrorCode =
  | 'ASSESSMENT_CATALOG_INVALID'
  | 'ASSESSMENT_SELECTIONS_INVALID'
  | 'ASSESSMENT_OPTION_UNAVAILABLE'
