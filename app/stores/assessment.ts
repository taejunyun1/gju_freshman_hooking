import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  questionGroups,
  trackKeys,
  trackLabels,
  visualKeys,
  type QuestionGroup,
  type TrackKey,
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
  | 'submitting'
  | 'validating'
  | 'validated'

type RetryAction = 'load' | 'submit' | 'validate' | null
type SelectionState = Record<QuestionGroup, string[]>
type AssessmentCompletion = { publicId: string }

type PersistedAssessment = {
  step: number
  selections: SelectionState
  careerOther: string
  catalogRevision: string
}

const revisionPattern = /^sha256:[a-f0-9]{64}$/u
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const emailPattern = /[^\s@]+@[^\s@]+\.[^\s@]+/u
const phonePattern = /(?:(?:\+?82)[-.\s]?(?:0)?\d{1,2}|0\d{1,2})[-.\s)]?\d{3,4}[-.\s]?\d{4}/u
const interestTagPattern = /^[a-z][a-z0-9_]{0,63}$/u
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

  if (!hasExactKeys(value.limits, [...questionGroups])) return false

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

const isApiSuccess = <T>(
  value: unknown,
  isData: (data: unknown) => data is T,
): value is ApiSuccess<T> => isRecord(value)
  && hasExactKeys(value, ['data', 'requestId'])
  && typeof value.requestId === 'string'
  && value.requestId.length > 0
  && isData(value.data)

const isScoredAssessment = (value: unknown): value is ScoredAssessment => {
  if (!isRecord(value) || !hasExactKeys(value, ['trackScores', 'rankedTracks', 'interestVector'])) return false
  const { interestVector, rankedTracks, trackScores } = value
  if (!isRecord(trackScores)
    || !hasExactKeys(trackScores, [...trackKeys])
    || !Array.isArray(rankedTracks)
    || rankedTracks.length !== trackKeys.length
    || new Set(rankedTracks).size !== trackKeys.length
    || !rankedTracks.every(track => trackKeys.includes(track as TrackKey))
    || !isRecord(interestVector)) return false

  if (!trackKeys.every((track) => {
    const score = trackScores[track]
    return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100
  })) return false

  return Object.entries(interestVector).every(([tag, score]) => (
    interestTagPattern.test(tag)
    && typeof score === 'number'
    && Number.isFinite(score)
    && score >= 0
    && score <= 1
  ))
}

const isAssessmentCompletion = (value: unknown): value is AssessmentCompletion => isRecord(value)
  && hasExactKeys(value, ['publicId'])
  && typeof value.publicId === 'string'
  && canonicalUuidPattern.test(value.publicId)

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
  const reviewRequired = ref(false)
  const completedGroups = new Set<string>()
  let requestGeneration = 0
  let submissionIdempotencyKey: string | null = null
  let submissionKeyFingerprint: string | null = null
  let completedDraftNeedsFreshCatalog = false

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

  const fingerprint = (): string => JSON.stringify({
    catalogRevision: catalogRevision.value,
    selections: selections.value,
    careerOther: careerOther.value,
  })

  const requestIsCurrent = (generation: number, startingFingerprint: string): boolean => (
    generation === requestGeneration && startingFingerprint === fingerprint()
  )

  const mutationsLocked = (): boolean => status.value === 'loading'
    || status.value === 'submitting'
    || status.value === 'validating'

  const invalidateSubmissionKey = (): void => {
    submissionIdempotencyKey = null
    submissionKeyFingerprint = null
  }

  const idempotencyKeyFor = (selectionFingerprint: string): string => {
    if (submissionIdempotencyKey && submissionKeyFingerprint === selectionFingerprint) {
      return submissionIdempotencyKey
    }
    const generated = globalThis.crypto.randomUUID()
    if (!canonicalUuidPattern.test(generated)) throw new Error('ASSESSMENT_IDEMPOTENCY_KEY_INVALID')
    submissionIdempotencyKey = generated
    submissionKeyFingerprint = selectionFingerprint
    return generated
  }

  const moveToFirstIncompleteGroup = (): void => {
    if (!limits.value) return
    const incompleteIndex = questionGroups.findIndex((group) => {
      const count = selections.value[group].length
      const limit = limits.value![group]
      return count < limit.min || count > limit.max
    })
    if (incompleteIndex >= 0) step.value = incompleteIndex
  }

  const emitStepCompleted = (group: QuestionGroup, selectedCount: number): void => {
    const completionKey = `${catalogRevision.value}:${group}`
    if (completedGroups.has(completionKey)) return
    completedGroups.add(completionKey)
    sendEvent({
      eventName: 'assessment_step_completed',
      catalogRevision: catalogRevision.value,
      group,
      selectedCount,
    })
  }

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

  const resetCompletedDraft = (): void => {
    step.value = 0
    selections.value = emptySelections()
    careerOther.value = ''
    errorMessage.value = ''
    retryAction.value = null
    validatedResult.value = null
    reviewRequired.value = false
    startedEmitted.value = false
    completedGroups.clear()
    invalidateSubmissionKey()
    completedDraftNeedsFreshCatalog = true
    removePersisted()
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
    const startFresh = completedDraftNeedsFreshCatalog
    const hadCatalog = Boolean(catalogRevision.value) && !startFresh
    const generation = ++requestGeneration
    const startingFingerprint = fingerprint()
    status.value = 'loading'
    errorMessage.value = ''
    retryAction.value = null
    try {
      const response = await $fetch<unknown>('/api/assessment/options')
      if (!requestIsCurrent(generation, startingFingerprint)) return false
      if (!isApiSuccess(response, isCatalog)) throw new Error('ASSESSMENT_OPTIONS_INVALID')
      groups.value = response.data.groups
      limits.value = response.data.limits
      if (catalogRevision.value !== response.data.catalogRevision) invalidateSubmissionKey()
      catalogRevision.value = response.data.catalogRevision
      validatedResult.value = null

      if (groups.value.length === 0 || groups.value.some(group => group.options.length === 0)) {
        invalidateSubmissionKey()
        selections.value = emptySelections()
        careerOther.value = ''
        step.value = 0
        removePersisted()
        reviewRequired.value = false
        completedDraftNeedsFreshCatalog = false
        status.value = 'empty'
        return true
      }

      if (!startFresh && (options.preserveSelections || hadCatalog)) {
        reconcile(previousSelections, previousCareerOther)
      }
      else {
        selections.value = emptySelections()
        careerOther.value = ''
        step.value = 0
        restore()
      }
      completedDraftNeedsFreshCatalog = false
      if (reviewRequired.value) {
        moveToFirstIncompleteGroup()
        persist()
        status.value = 'stale'
        errorMessage.value = '선택지가 업데이트되었습니다. 선택을 다시 확인한 뒤 결과를 계산해 주세요.'
      }
      else {
        status.value = 'ready'
      }
      if (!startedEmitted.value) {
        startedEmitted.value = true
        sendEvent({ eventName: 'assessment_started', catalogRevision: catalogRevision.value })
      }
      return true
    }
    catch {
      if (!requestIsCurrent(generation, startingFingerprint)) return false
      status.value = 'error'
      retryAction.value = 'load'
      errorMessage.value = '선택지를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.'
      return false
    }
  }

  const invalidateResult = (): void => {
    validatedResult.value = null
    reviewRequired.value = false
    if (status.value === 'validated' || status.value === 'error' || status.value === 'stale') {
      status.value = 'ready'
    }
    errorMessage.value = ''
    retryAction.value = null
  }

  const toggleOption = (optionKey: string): boolean => {
    if (mutationsLocked()) return false
    const group = groups.value.find(candidate => candidate.options.some(option => option.key === optionKey))
    if (!group || !limits.value) return false
    const selected = selections.value[group.key]
    if (selected.includes(optionKey)) {
      selections.value[group.key] = selected.filter(key => key !== optionKey)
      if (optionKey === 'career.explore') careerOther.value = ''
      announcement.value = `${group.key} 선택 ${selections.value[group.key].length}개`
      completedDraftNeedsFreshCatalog = false
      invalidateSubmissionKey()
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
    completedDraftNeedsFreshCatalog = false
    invalidateSubmissionKey()
    invalidateResult()
    persist()
    return true
  }

  const setCareerOther = (value: string): boolean => {
    if (mutationsLocked()) return false
    if (!selections.value.career.includes('career.explore')) return false
    const issue = careerOtherDraftError(value)
    if (issue) {
      announcement.value = issue
      return false
    }
    if (careerOther.value === value) return true
    careerOther.value = value
    announcement.value = `${value.length} / 30자 입력`
    completedDraftNeedsFreshCatalog = false
    invalidateSubmissionKey()
    invalidateResult()
    persist()
    return true
  }

  const next = (): boolean => {
    if (mutationsLocked()) return false
    const group = currentGroup.value
    const limit = currentLimit.value
    if (!group || !limit || currentSelected.value.length < limit.min) {
      if (limit) announcement.value = `최소 ${limit.min}개를 골라주세요.`
      return false
    }
    if (step.value >= groups.value.length - 1) return false
    emitStepCompleted(group.key, currentSelected.value.length)
    step.value += 1
    announcement.value = `${step.value + 1}단계로 이동했습니다.`
    persist()
    return true
  }

  const previous = (): boolean => {
    if (mutationsLocked()) return false
    if (step.value <= 0) return false
    step.value -= 1
    announcement.value = `${step.value + 1}단계로 이동했습니다.`
    persist()
    return true
  }

  const validate = async (csrfToken: string): Promise<boolean> => {
    if (mutationsLocked()) return false
    if (!isComplete.value || !catalogRevision.value) {
      announcement.value = '각 단계의 최소 선택 수를 확인해 주세요.'
      return false
    }
    reviewRequired.value = false
    emitStepCompleted('career', selections.value.career.length)
    const generation = ++requestGeneration
    const startingFingerprint = fingerprint()
    const submission = {
      catalogRevision: catalogRevision.value,
      selections: {
        work: [...selections.value.work],
        result: [...selections.value.result],
        style: [...selections.value.style],
        career: [...selections.value.career],
        careerOther: careerOther.value.trim() || null,
      },
    }
    status.value = 'validating'
    errorMessage.value = ''
    retryAction.value = null
    validatedResult.value = null
    try {
      const response = await $fetch<unknown>('/api/student/assessment/validate', {
        body: submission,
        headers: { 'x-photo-next-csrf': csrfToken },
        method: 'POST',
      })
      if (!requestIsCurrent(generation, startingFingerprint)) {
        if (generation === requestGeneration) status.value = 'ready'
        return false
      }
      if (!isApiSuccess(response, isScoredAssessment)) {
        throw new Error('ASSESSMENT_RESULT_INVALID')
      }
      validatedResult.value = response.data
      status.value = 'validated'
      announcement.value = '결과 계산이 끝났습니다.'
      return true
    }
    catch (error) {
      if (!requestIsCurrent(generation, startingFingerprint)) {
        if (generation === requestGeneration) status.value = 'ready'
        return false
      }
      const code = publicErrorCode(error)
      if (code === 'ASSESSMENT_CATALOG_STALE') {
        reviewRequired.value = true
        const reloaded = await loadOptions({ preserveSelections: true })
        if (!reloaded && reviewRequired.value) {
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

  const submit = async (csrfToken: string): Promise<string | null> => {
    if (mutationsLocked()) return null
    if (!isComplete.value || !catalogRevision.value) {
      announcement.value = '각 단계의 최소 선택 수를 확인해 주세요.'
      return null
    }
    reviewRequired.value = false
    emitStepCompleted('career', selections.value.career.length)
    const generation = ++requestGeneration
    const startingFingerprint = fingerprint()
    let idempotencyKey: string
    try {
      idempotencyKey = idempotencyKeyFor(startingFingerprint)
    }
    catch {
      status.value = 'error'
      retryAction.value = 'submit'
      errorMessage.value = '결과를 준비하지 못했습니다. 선택은 그대로 유지됩니다. 다시 시도하세요.'
      return null
    }
    const submission = {
      catalogRevision: catalogRevision.value,
      idempotencyKey,
      selections: {
        work: [...selections.value.work],
        result: [...selections.value.result],
        style: [...selections.value.style],
        career: [...selections.value.career],
        careerOther: careerOther.value.trim() || null,
      },
    }
    status.value = 'submitting'
    announcement.value = '결과와 짧은 진로 제안을 정리 중입니다.'
    errorMessage.value = ''
    retryAction.value = null
    validatedResult.value = null
    try {
      const response = await $fetch<unknown>('/api/assessment/submit', {
        body: submission,
        headers: { 'x-photo-next-csrf': csrfToken },
        method: 'POST',
      })
      if (!requestIsCurrent(generation, startingFingerprint)) {
        if (generation === requestGeneration) status.value = 'ready'
        return null
      }
      if (!isApiSuccess(response, isAssessmentCompletion)) {
        throw new Error('ASSESSMENT_COMPLETION_INVALID')
      }
      resetCompletedDraft()
      status.value = 'ready'
      announcement.value = '결과가 준비되었습니다.'
      return response.data.publicId
    }
    catch (error) {
      if (!requestIsCurrent(generation, startingFingerprint)) {
        if (generation === requestGeneration) status.value = 'ready'
        return null
      }
      const code = publicErrorCode(error)
      if (code === 'ASSESSMENT_CATALOG_STALE') {
        invalidateSubmissionKey()
        reviewRequired.value = true
        const reloaded = await loadOptions({ preserveSelections: true })
        if (!reloaded && reviewRequired.value) {
          errorMessage.value = '선택지가 업데이트되어 다시 불러와야 합니다. 다시 불러온 뒤 선택을 확인해 주세요.'
        }
        return null
      }
      if (code === 'AUTH_FAILED') {
        status.value = 'unauthenticated'
        errorMessage.value = '로그인 정보가 만료되었습니다.'
        return null
      }
      status.value = 'error'
      if (code === 'ASSESSMENT_INVALID') {
        retryAction.value = null
        errorMessage.value = '선택 내용을 확인한 뒤 결과를 다시 만들어 주세요.'
      }
      else {
        retryAction.value = 'submit'
        errorMessage.value = '결과를 준비하지 못했습니다. 선택은 그대로 유지됩니다. 다시 시도하세요.'
      }
      return null
    }
  }

  const retry = async (csrfToken?: string): Promise<boolean | string | null> => {
    if (retryAction.value === 'load') return loadOptions({ preserveSelections: Boolean(catalogRevision.value) })
    if (retryAction.value === 'submit' && csrfToken) return submit(csrfToken)
    if (retryAction.value === 'validate' && csrfToken) return validate(csrfToken)
    return false
  }

  const clear = (): void => {
    requestGeneration += 1
    step.value = 0
    selections.value = emptySelections()
    careerOther.value = ''
    announcement.value = ''
    errorMessage.value = ''
    retryAction.value = null
    validatedResult.value = null
    reviewRequired.value = false
    startedEmitted.value = false
    completedGroups.clear()
    invalidateSubmissionKey()
    completedDraftNeedsFreshCatalog = false
    status.value = groups.value.length ? 'ready' : 'idle'
    removePersisted()
  }

  const markUnauthenticated = (): void => {
    requestGeneration += 1
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
    submit,
    toggleOption,
    validate,
    validatedResult,
  }
})
