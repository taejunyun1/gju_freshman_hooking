import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  questionGroups,
  trackLabels,
  visualKeys,
  type QuestionGroup,
} from '../../shared/types/domain'
import type {
  ApiFailure,
  ApiSuccess,
  PublicAssessmentCatalog,
  ScoredAssessment,
} from '../../shared/types/api'

export const assessmentStorageKey = 'photo_next_assessment_v1'

type AssessmentStatus =
  | 'idle'
  | 'loading'
  | 'empty'
  | 'ready'
  | 'error'
  | 'stale'
  | 'unauthenticated'
  | 'validating'
  | 'validated'

type RetryAction = 'load' | 'validate' | null
type SelectionState = Record<QuestionGroup, string[]>

type PersistedAssessment = {
  step: number
  selections: SelectionState
  careerOther: string
  catalogRevision: string
}

const revisionPattern = /^sha256:[a-f0-9]{64}$/u
const emailPattern = /[^\s@]+@[^\s@]+\.[^\s@]+/u
const phonePattern = /(?:(?:\+?82)[-.\s]?(?:0)?\d{1,2}|0\d{1,2})[-.\s)]?\d{3,4}[-.\s]?\d{4}/u
const requiredLimits = {
  work: { min: 1, max: 4 },
  result: { min: 1, max: 3 },
  style: { min: 1, max: 2 },
  career: { min: 1, max: 2 },
} as const satisfies Record<QuestionGroup, { min: number, max: number }>
const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)
const hasExactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}
const emptySelections = (): SelectionState => ({
  work: [],
  result: [],
  style: [],
  career: [],
})

export const careerOtherDraftError = (value: string): string => {
  if ([...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
  })) {
    return '줄바꿈이나 제어문자는 입력할 수 없습니다.'
  }
  if (emailPattern.test(value) || phonePattern.test(value)) {
    return '전화번호나 이메일은 입력할 수 없습니다.'
  }
  if (value.length > 30) return '다른 가능성은 30자 이하로 입력해 주세요.'
  return ''
}

const storage = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  }
  catch {
    return null
  }
}

const publicErrorCode = (error: unknown): ApiFailure['error']['code'] | undefined => {
  if (!isRecord(error)) return undefined
  const direct = error.data
  const responseData = isRecord(error.response) ? error.response._data : undefined
  const payload = isRecord(direct) ? direct : isRecord(responseData) ? responseData : undefined
  if (!payload || !isRecord(payload.error) || typeof payload.error.code !== 'string') return undefined
  return payload.error.code as ApiFailure['error']['code']
}

const isCatalog = (value: unknown): value is PublicAssessmentCatalog => {
  if (!isRecord(value)
    || typeof value.catalogRevision !== 'string'
    || !revisionPattern.test(value.catalogRevision)
    || !Array.isArray(value.groups)
    || !isRecord(value.limits)) return false

  for (const group of questionGroups) {
    const limit = value.limits[group]
    const required = requiredLimits[group]
    if (!isRecord(limit)
      || !Number.isInteger(limit.min)
      || !Number.isInteger(limit.max)
      || Number(limit.min) !== required.min
      || Number(limit.max) !== required.max) return false
  }

  if (value.groups.length !== questionGroups.length) return false
  const seenGroups = new Set<string>()
  const seenOptions = new Set<string>()
  for (const [index, group] of value.groups.entries()) {
    if (!isRecord(group)
      || group.key !== questionGroups[index]
      || seenGroups.has(group.key as string)
      || !Array.isArray(group.options)) return false
    seenGroups.add(group.key as string)
    for (const option of group.options) {
      if (!isRecord(option)
        || typeof option.key !== 'string'
        || !option.key.startsWith(`${group.key}.`)
        || seenOptions.has(option.key)
        || typeof option.label !== 'string'
        || option.label.trim() === ''
        || !visualKeys.includes(option.visualKey as typeof visualKeys[number])) return false
      if (option.description !== undefined && typeof option.description !== 'string') return false
      seenOptions.add(option.key)
    }
  }
  return true
}

export const useAssessmentStore = defineStore('assessment', () => {
  const status = ref<AssessmentStatus>('idle')
  const groups = ref<PublicAssessmentCatalog['groups']>([])
  const limits = ref<PublicAssessmentCatalog['limits'] | null>(null)
  const catalogRevision = ref('')
  const step = ref(0)
  const selections = ref<SelectionState>(emptySelections())
  const careerOther = ref('')
  const announcement = ref('')
  const errorMessage = ref('')
  const retryAction = ref<RetryAction>(null)
  const validatedResult = ref<ScoredAssessment | null>(null)
  const startedEmitted = ref(false)

  const currentGroup = computed(() => groups.value[step.value])
  const currentLimit = computed(() => currentGroup.value && limits.value
    ? limits.value[currentGroup.value.key]
    : null)
  const currentSelected = computed(() => currentGroup.value
    ? selections.value[currentGroup.value.key]
    : [])
  const canAdvance = computed(() => Boolean(
    currentLimit.value && currentSelected.value.length >= currentLimit.value.min,
  ))
  const isComplete = computed(() => Boolean(limits.value) && questionGroups.every((group) => {
    const limit = limits.value![group]
    const count = selections.value[group].length
    return count >= limit.min && count <= limit.max
  }))
  const primaryTrackLabel = computed(() => {
    const primary = validatedResult.value?.rankedTracks[0]
    return primary ? trackLabels[primary] : ''
  })

  const persist = (): void => {
    if (!catalogRevision.value) return
    const value: PersistedAssessment = {
      step: step.value,
      selections: {
        work: [...selections.value.work],
        result: [...selections.value.result],
        style: [...selections.value.style],
        career: [...selections.value.career],
      },
      careerOther: careerOther.value,
      catalogRevision: catalogRevision.value,
    }
    try {
      storage()?.setItem(assessmentStorageKey, JSON.stringify(value))
    }
    catch {
      // Assessment remains usable when browser storage is unavailable.
    }
  }

  const removePersisted = (): void => {
    try {
      storage()?.removeItem(assessmentStorageKey)
    }
    catch {
      // Clearing in-memory state still succeeds when storage is unavailable.
    }
  }

  const parsedPersisted = (): PersistedAssessment | null => {
    let parsed: unknown
    try {
      const raw = storage()?.getItem(assessmentStorageKey)
      if (!raw) return null
      parsed = JSON.parse(raw) as unknown
    }
    catch {
      return null
    }

    if (!isRecord(parsed)
      || !hasExactKeys(parsed, ['step', 'selections', 'careerOther', 'catalogRevision'])
      || parsed.catalogRevision !== catalogRevision.value
      || !Number.isInteger(parsed.step)
      || Number(parsed.step) < 0
      || Number(parsed.step) >= questionGroups.length
      || typeof parsed.careerOther !== 'string'
      || careerOtherDraftError(parsed.careerOther)
      || !isRecord(parsed.selections)
      || !hasExactKeys(parsed.selections, [...questionGroups])) return null

    const allowedByGroup = Object.fromEntries(groups.value.map(group => [
      group.key,
      new Set(group.options.map(option => option.key)),
    ])) as Record<QuestionGroup, Set<string>>
    const nextSelections = emptySelections()
    for (const group of questionGroups) {
      const values = parsed.selections[group]
      const limit = limits.value?.[group]
      if (!Array.isArray(values)
        || !limit
        || values.length > limit.max
        || values.some(value => typeof value !== 'string' || !allowedByGroup[group]?.has(value))
        || new Set(values).size !== values.length) return null
      nextSelections[group] = [...values] as string[]
    }
    if (parsed.careerOther && !nextSelections.career.includes('career.explore')) return null

    return {
      step: Number(parsed.step),
      selections: nextSelections,
      careerOther: parsed.careerOther,
      catalogRevision: parsed.catalogRevision,
    }
  }

  const restore = (): void => {
    const persisted = parsedPersisted()
    if (!persisted) {
      removePersisted()
      return
    }
    step.value = persisted.step
    selections.value = persisted.selections
    careerOther.value = persisted.careerOther
  }

  const reconcile = (previous: SelectionState, previousCareerOther: string): void => {
    const next = emptySelections()
    for (const group of groups.value) {
      const allowed = new Set(group.options.map(option => option.key))
      next[group.key] = previous[group.key]
        .filter(key => allowed.has(key))
        .slice(0, limits.value?.[group.key].max ?? 0)
    }
    selections.value = next
    careerOther.value = next.career.includes('career.explore') && !careerOtherDraftError(previousCareerOther)
      ? previousCareerOther
      : ''
    step.value = Math.min(step.value, Math.max(groups.value.length - 1, 0))
    persist()
  }

  const sendEvent = (body: Record<string, unknown>): void => {
    void $fetch('/api/events', { body, method: 'POST' }).catch(() => undefined)
  }

  const loadOptions = async (options: { preserveSelections?: boolean } = {}): Promise<boolean> => {
    const previousSelections = {
      work: [...selections.value.work],
      result: [...selections.value.result],
      style: [...selections.value.style],
      career: [...selections.value.career],
    }
    const previousCareerOther = careerOther.value
    const hadCatalog = Boolean(catalogRevision.value)
    status.value = 'loading'
    errorMessage.value = ''
    retryAction.value = null
    try {
      const response = await $fetch<ApiSuccess<PublicAssessmentCatalog>>('/api/assessment/options')
      if (!isCatalog(response.data)) throw new Error('ASSESSMENT_OPTIONS_INVALID')
      groups.value = response.data.groups
      limits.value = response.data.limits
      catalogRevision.value = response.data.catalogRevision
      validatedResult.value = null

      if (groups.value.length === 0 || groups.value.some(group => group.options.length === 0)) {
        selections.value = emptySelections()
        careerOther.value = ''
        step.value = 0
        removePersisted()
        status.value = 'empty'
        return true
      }

      if (options.preserveSelections || hadCatalog) {
        reconcile(previousSelections, previousCareerOther)
      }
      else {
        selections.value = emptySelections()
        careerOther.value = ''
        step.value = 0
        restore()
      }
      status.value = 'ready'
      if (!startedEmitted.value) {
        startedEmitted.value = true
        sendEvent({ eventName: 'assessment_started', catalogRevision: catalogRevision.value })
      }
      return true
    }
    catch {
      status.value = 'error'
      retryAction.value = 'load'
      errorMessage.value = '선택지를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.'
      return false
    }
  }

  const invalidateResult = (): void => {
    validatedResult.value = null
    if (status.value === 'validated' || status.value === 'error' || status.value === 'stale') {
      status.value = 'ready'
    }
    errorMessage.value = ''
    retryAction.value = null
  }

  const toggleOption = (optionKey: string): boolean => {
    const group = groups.value.find(candidate => candidate.options.some(option => option.key === optionKey))
    if (!group || !limits.value) return false
    const selected = selections.value[group.key]
    if (selected.includes(optionKey)) {
      selections.value[group.key] = selected.filter(key => key !== optionKey)
      if (optionKey === 'career.explore') careerOther.value = ''
      announcement.value = `${group.key} 선택 ${selections.value[group.key].length}개`
      invalidateResult()
      persist()
      return true
    }
    const maximum = limits.value[group.key].max
    if (selected.length >= maximum) {
      announcement.value = `최대 ${maximum}개까지 선택할 수 있어요.`
      return false
    }
    selections.value[group.key] = [...selected, optionKey]
    announcement.value = `${group.key} 선택 ${selections.value[group.key].length}개`
    invalidateResult()
    persist()
    return true
  }

  const setCareerOther = (value: string): boolean => {
    if (!selections.value.career.includes('career.explore')) return false
    const issue = careerOtherDraftError(value)
    if (issue) {
      announcement.value = issue
      return false
    }
    careerOther.value = value
    announcement.value = `${value.length} / 30자 입력`
    invalidateResult()
    persist()
    return true
  }

  const next = (): boolean => {
    const group = currentGroup.value
    const limit = currentLimit.value
    if (!group || !limit || currentSelected.value.length < limit.min) {
      if (limit) announcement.value = `최소 ${limit.min}개를 골라주세요.`
      return false
    }
    if (step.value >= groups.value.length - 1) return false
    sendEvent({
      eventName: 'assessment_step_completed',
      catalogRevision: catalogRevision.value,
      group: group.key,
      selectedCount: currentSelected.value.length,
    })
    step.value += 1
    announcement.value = `${step.value + 1}단계로 이동했습니다.`
    persist()
    return true
  }

  const previous = (): boolean => {
    if (step.value <= 0) return false
    step.value -= 1
    announcement.value = `${step.value + 1}단계로 이동했습니다.`
    persist()
    return true
  }

  const validate = async (csrfToken: string): Promise<boolean> => {
    if (!isComplete.value || !catalogRevision.value) {
      announcement.value = '각 단계의 최소 선택 수를 확인해 주세요.'
      return false
    }
    status.value = 'validating'
    errorMessage.value = ''
    retryAction.value = null
    validatedResult.value = null
    try {
      const response = await $fetch<ApiSuccess<ScoredAssessment>>('/api/student/assessment/validate', {
        body: {
          catalogRevision: catalogRevision.value,
          selections: {
            work: [...selections.value.work],
            result: [...selections.value.result],
            style: [...selections.value.style],
            career: [...selections.value.career],
            careerOther: careerOther.value.trim() || null,
          },
        },
        headers: { 'x-photo-next-csrf': csrfToken },
        method: 'POST',
      })
      validatedResult.value = response.data
      status.value = 'validated'
      announcement.value = '결과 계산이 끝났습니다.'
      return true
    }
    catch (error) {
      const code = publicErrorCode(error)
      if (code === 'ASSESSMENT_CATALOG_STALE') {
        const reloaded = await loadOptions({ preserveSelections: true })
        validatedResult.value = null
        if (reloaded && groups.value.every(group => group.options.length > 0)) {
          status.value = 'stale'
          retryAction.value = null
          errorMessage.value = '선택지가 업데이트되었습니다. 선택을 다시 확인한 뒤 결과를 계산해 주세요.'
        }
        else if (!reloaded) {
          status.value = 'error'
          retryAction.value = 'load'
          errorMessage.value = '선택지가 업데이트되어 다시 불러와야 합니다. 다시 불러온 뒤 선택을 확인해 주세요.'
        }
        return false
      }
      if (code === 'AUTH_FAILED') {
        status.value = 'unauthenticated'
        errorMessage.value = '로그인 정보가 만료되었습니다.'
        return false
      }
      status.value = 'error'
      if (code === 'ASSESSMENT_INVALID') {
        retryAction.value = null
        errorMessage.value = '선택 내용을 확인한 뒤 결과를 다시 계산해 주세요.'
      }
      else {
        retryAction.value = 'validate'
        errorMessage.value = '결과를 계산하지 못했습니다. 선택은 그대로 유지됩니다. 다시 시도하세요.'
      }
      return false
    }
  }

  const retry = async (csrfToken?: string): Promise<boolean> => {
    if (retryAction.value === 'load') return loadOptions({ preserveSelections: Boolean(catalogRevision.value) })
    if (retryAction.value === 'validate' && csrfToken) return validate(csrfToken)
    return false
  }

  const clear = (): void => {
    step.value = 0
    selections.value = emptySelections()
    careerOther.value = ''
    announcement.value = ''
    errorMessage.value = ''
    retryAction.value = null
    validatedResult.value = null
    status.value = groups.value.length ? 'ready' : 'idle'
    removePersisted()
  }

  const markUnauthenticated = (): void => {
    status.value = 'unauthenticated'
    errorMessage.value = '로그인 정보를 확인할 수 없습니다.'
    retryAction.value = null
  }

  return {
    announcement,
    canAdvance,
    careerOther,
    catalogRevision,
    clear,
    currentGroup,
    currentLimit,
    currentSelected,
    errorMessage,
    groups,
    isComplete,
    limits,
    loadOptions,
    markUnauthenticated,
    next,
    previous,
    primaryTrackLabel,
    retry,
    retryAction,
    selections,
    setCareerOther,
    status,
    step,
    toggleOption,
    validate,
    validatedResult,
  }
})
