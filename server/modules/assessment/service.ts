import type { SupabaseClient } from '@supabase/supabase-js'
import { assessmentCatalogOptionSchema, selectionLimits } from '../../../shared/schemas/assessment'
import { questionGroups } from '../../../shared/types/domain'
import type {
  AssessmentOption,
  AssessmentSelections,
  QuestionGroup,
} from '../../../shared/types/domain'
import { AppError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'
import { createRosterSessionServiceFromSupabase } from '../identity/student-session'
import { AssessmentScoringError, scoreAssessment } from './scoring'
import { createAssessmentCatalogRevision } from './catalog-revision'
import type { ScoredAssessment } from './types'

const VALIDATE_ROUTE = '/api/student/assessment/validate' as const
const groupOrder = new Map(questionGroups.map((group, index) => [group, index]))

export type PublicAssessmentCatalog = {
  catalogRevision: string
  groups: Array<{
    key: QuestionGroup
    options: Array<{
      key: string
      label: string
      description?: string
      visualKey: AssessmentOption['visualKey']
    }>
  }>
  limits: Record<QuestionGroup, { min: number, max: number }>
}

type StudentSession = {
  prospectId: number
  nickname: string
  expiresAt: string
}

type RateLimitInput = {
  key: string
  route: string
  limit: number
  window: string
}

export type AssessmentServiceDependencies = {
  consumeRateLimit: (input: RateLimitInput) => Promise<boolean>
  getStudentSession: (sessionToken: string) => Promise<StudentSession | null>
  loadActiveOptions: () => Promise<AssessmentOption[]>
}

type ValidateAssessmentContext = {
  ip: string
  sessionToken: string
}

const normalizeActiveCatalog = (input: AssessmentOption[]) => {
  const parsed = assessmentCatalogOptionSchema.array().safeParse(input)
  if (!parsed.success) {
    throw new Error('ASSESSMENT_CATALOG_STORE_INVALID')
  }

  const active = (parsed.data as AssessmentOption[])
    .filter(option => option.status === 'active')
    .sort((left, right) => (
      (groupOrder.get(left.group) ?? Number.MAX_SAFE_INTEGER)
      - (groupOrder.get(right.group) ?? Number.MAX_SAFE_INTEGER)
      || left.sortOrder - right.sortOrder
      || (left.optionKey < right.optionKey ? -1 : left.optionKey > right.optionKey ? 1 : 0)
    ))

  const optionKeys = new Set<string>()
  const groupSortPositions = new Set<string>()
  for (const option of active) {
    const groupSortPosition = `${option.group}:${option.sortOrder}`
    if (optionKeys.has(option.optionKey) || groupSortPositions.has(groupSortPosition)) {
      throw new Error('ASSESSMENT_CATALOG_STORE_INVALID')
    }
    optionKeys.add(option.optionKey)
    groupSortPositions.add(groupSortPosition)
  }
  return active
}

const hasExactEnvelopeKeys = (input: unknown): input is {
  catalogRevision: unknown
  selections: unknown
} => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false
  const keys = Object.keys(input).sort()
  return keys.length === 2 && keys[0] === 'catalogRevision' && keys[1] === 'selections'
}

const publicLimits = Object.fromEntries(questionGroups.map(group => [group, {
  min: selectionLimits[group].min,
  max: selectionLimits[group].max,
}])) as Record<QuestionGroup, { min: number, max: number }>

export const createAssessmentService = (dependencies: AssessmentServiceDependencies) => {
  const loadCatalog = async () => normalizeActiveCatalog(await dependencies.loadActiveOptions())

  const getOptions = async (): Promise<PublicAssessmentCatalog> => {
    const catalog = await loadCatalog()
    const catalogRevision = await createAssessmentCatalogRevision(catalog)
    const groups = questionGroups.map(group => ({
      key: group,
      options: catalog.filter(option => option.group === group).map(option => ({
        key: option.optionKey,
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
        visualKey: option.visualKey,
      })),
    }))

    return { catalogRevision, groups, limits: publicLimits }
  }

  const validateAssessment = async (
    input: unknown,
    context: ValidateAssessmentContext,
  ): Promise<ScoredAssessment> => {
    const session = await dependencies.getStudentSession(context.sessionToken)
    if (!session) throw new AppError('AUTH_FAILED')

    const allowed = await dependencies.consumeRateLimit({
      key: `prospect:${session.prospectId}`,
      route: VALIDATE_ROUTE,
      limit: 20,
      window: '5 minutes',
    })
    if (!allowed) throw new AppError('RATE_LIMITED')

    const catalog = await loadCatalog()
    const currentRevision = await createAssessmentCatalogRevision(catalog)
    if (!hasExactEnvelopeKeys(input)) throw new AppError('ASSESSMENT_INVALID')
    if (
      typeof input.catalogRevision !== 'string'
      || input.catalogRevision.length < 1
      || input.catalogRevision.length > 100
      || input.catalogRevision !== currentRevision
    ) {
      throw new AppError('ASSESSMENT_CATALOG_STALE')
    }

    try {
      return scoreAssessment(catalog, input.selections as AssessmentSelections)
    }
    catch (error) {
      if (error instanceof AssessmentScoringError) {
        throw new AppError('ASSESSMENT_INVALID')
      }
      throw error
    }
  }

  return { getOptions, validateAssessment }
}

type StudentSessionReaderFactory = typeof createRosterSessionServiceFromSupabase

export const createSupabaseAssessmentDependencies = (
  client: SupabaseClient,
  createSessionReader: StudentSessionReaderFactory = createRosterSessionServiceFromSupabase,
): AssessmentServiceDependencies => {
  let sessionReader: ReturnType<StudentSessionReaderFactory> | undefined
  return {
    consumeRateLimit: async ({ key, route, limit, window }) => {
      const { data, error } = await client.rpc('consume_rate_limit', {
        p_key: key,
        p_limit: limit,
        p_route: route,
        p_window: window,
      })
      if (error) throw new Error('ASSESSMENT_STORE_UNAVAILABLE')
      return data === true
    },
    getStudentSession: sessionToken => (
      sessionReader ??= createSessionReader(client)
    ).getStudentSession(sessionToken),
    loadActiveOptions: async () => {
      const { data, error } = await client.from('assessment_options')
        .select('question_group,option_key,label,description,visual_key,track_weights,interest_tags,status,sort_order')
        .eq('status', 'active')
        .order('question_group')
        .order('sort_order')
        .order('option_key')
      if (error || !data) throw new Error('ASSESSMENT_STORE_UNAVAILABLE')

      return data.map(row => ({
        group: row.question_group,
        optionKey: row.option_key,
        label: row.label,
        ...(row.description === null ? {} : { description: row.description }),
        visualKey: row.visual_key,
        trackWeights: row.track_weights,
        interestTags: row.interest_tags,
        status: row.status,
        sortOrder: row.sort_order,
      })) as AssessmentOption[]
    },
  }
}

export const getServerAssessmentService = () => createAssessmentService(
  createSupabaseAssessmentDependencies(getServerSupabaseClient()),
)
