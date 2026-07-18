import {
  decodeLegacyResultSnapshot,
  decodeResultSnapshot,
} from '../../../shared/schemas/result'
import type { ResultSnapshot } from '../../../shared/types/result'
import { withComputedEnvironmentScore } from '../matching/environment-score'
import {
  buildCareerNarrativeBrief,
  buildDeterministicCareerNarrativeChoice,
  renderCareerNarrative,
} from './career-narrative'

export const decodeStoredResultSnapshot = (input: unknown): ResultSnapshot => {
  let snapshot: ResultSnapshot
  try {
    snapshot = decodeResultSnapshot(input)
  }
  catch (currentError) {
    try {
      const core = decodeLegacyResultSnapshot(input)
      const brief = buildCareerNarrativeBrief(core)
      snapshot = decodeResultSnapshot({
        ...core,
        careerNarrative: renderCareerNarrative(
          brief,
          buildDeterministicCareerNarrativeChoice(brief),
          'deterministic',
        ),
      })
    }
    catch {
      throw currentError
    }
  }
  return withComputedEnvironmentScore(snapshot)
}
