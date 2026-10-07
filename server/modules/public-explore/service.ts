import { publicExploreSchema } from '../../../shared/schemas/public-explore'
import { decodeResultSnapshot } from '../../../shared/schemas/result'
import type { AssessmentSelections } from '../../../shared/types/domain'
import { getServerSupabaseClient } from '../../utils/supabase'
import { AppError } from '../../utils/app-error'
import { buildAssessmentRecommendation, createSupabaseAssessmentCompletionDependencies, type AssessmentCompletionDependencies } from '../assessment/completion'
import { createAssessmentService } from '../assessment/service'
import { buildCareerNarrativeBrief, buildDeterministicCareerNarrativeChoice, renderCareerNarrative } from '../assessment/career-narrative'
import { PublicExploreError } from './counseling'

type PublicCatalogReader = Pick<AssessmentCompletionDependencies, 'loadActiveOptions' | 'loadResourceCandidates' | 'loadFacultyCandidates'>

// Only public department data is cached. Responses, names and contact data never enter this cache.
export const createPublicExploreService = (reader: PublicCatalogReader, now = Date.now) => {
  const load = async () => {
    const [catalog, candidates, facultyCandidates] = await Promise.all([
      reader.loadActiveOptions(), reader.loadResourceCandidates(), reader.loadFacultyCandidates(),
    ])
    const options = await createAssessmentService({
      loadActiveOptions: async () => [...catalog],
      getStudentSession: async () => null,
      consumeRateLimit: async () => false,
    }).getOptions()
    return { catalog, candidates, facultyCandidates, options }
  }
  let cached: Promise<Awaited<ReturnType<typeof load>>> | undefined
  let expires = 0
  const getCatalog = () => {
    if (!cached || expires <= now()) {
      expires = now() + 10 * 60 * 1000
      cached = load().catch((error) => { cached = undefined; throw error })
    }
    return cached
  }
  return {
    async getOptions() { return (await getCatalog()).options },
    async recommend(raw: unknown) {
      const parsed = publicExploreSchema.safeParse(raw)
      if (!parsed.success) throw new PublicExploreError('PUBLIC_INPUT_INVALID')
      const data = await getCatalog()
      if (parsed.data.catalogRevision !== data.options.catalogRevision) throw new AppError('ASSESSMENT_CATALOG_STALE')
      const { coreSnapshot } = buildAssessmentRecommendation({
        ...data, selections: parsed.data.selections as AssessmentSelections,
        distributionKey: parsed.data.visitorSeed, completedAt: new Date(now()).toISOString(),
      })
      const brief = buildCareerNarrativeBrief(coreSnapshot)
      return decodeResultSnapshot({
        ...coreSnapshot,
        careerNarrative: renderCareerNarrative(brief, buildDeterministicCareerNarrativeChoice(brief), 'deterministic'),
      })
    },
  }
}

let service: ReturnType<typeof createPublicExploreService> | undefined
export const getPublicExploreService = () => service ??= createPublicExploreService(
  createSupabaseAssessmentCompletionDependencies(getServerSupabaseClient()),
)
