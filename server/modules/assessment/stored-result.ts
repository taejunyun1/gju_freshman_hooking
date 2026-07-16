import {
  decodeLegacyResultSnapshot,
  decodeResultSnapshot,
} from '../../../shared/schemas/result'
import type { ResultSnapshot } from '../../../shared/types/result'
import {
  buildCareerNarrativeBrief,
  buildDeterministicCareerNarrativeChoice,
  renderCareerNarrative,
} from './career-narrative'

export const decodeStoredResultSnapshot = (input: unknown): ResultSnapshot => {
  try {
    return decodeResultSnapshot(input)
  }
  catch (currentError) {
    try {
      const core = decodeLegacyResultSnapshot(input)
      const brief = buildCareerNarrativeBrief(core)
      return decodeResultSnapshot({
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
}
