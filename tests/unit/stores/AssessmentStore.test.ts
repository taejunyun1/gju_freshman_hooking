import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssessmentStore } from '../../../app/stores/assessment'

const revisionA = `sha256:${'a'.repeat(64)}`
const revisionB = `sha256:${'b'.repeat(64)}`
const storageKey = 'photo_next_assessment_v1'
const publicId = '11111111-1111-4111-8111-111111111111'
const idempotencyKeyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const idempotencyKeyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const catalog = (catalogRevision = revisionA) => ({
  catalogRevision,
  groups: [
    {
      key: 'work',
      options: [
        { key: 'work.photo', label: '사진 촬영', visualKey: 'photo_frame' },
        { key: 'work.video', label: '영상 촬영', visualKey: 'video_frame' },
        { key: 'work.edit', label: '영상 편집', visualKey: 'edit_timeline' },
        { key: 'work.studio', label: '스튜디오 촬영', visualKey: 'studio_still' },
        { key: 'work.book', label: '사진집 제작', visualKey: 'photobook_spread' },
      ],
    },
    { key: 'result', options: [{ key: 'result.portfolio', label: '포트폴리오', visualKey: 'gallery_grid' }] },
    { key: 'style', options: [{ key: 'style.solo', label: '혼자 집중', visualKey: 'project_board' }] },
    {
      key: 'career',
      options: [
        { key: 'career.photo', label: '사진 진로', visualKey: 'photo_frame' },
        { key: 'career.explore', label: '가능성 탐색', visualKey: 'contact_sheet' },
      ],
    },
  ],
  limits: {
    work: { min: 1, max: 4 },
    result: { min: 1, max: 3 },
    style: { min: 1, max: 2 },
    career: { min: 1, max: 2 },
  },
})

const success = <T>(data: T) => ({ data, requestId: 'request-id' })

const validScoredResult = () => ({
  trackScores: { documentary: 8, art_photo: 5, commercial: 2, video: 1 },
  rankedTracks: ['documentary', 'art_photo', 'commercial', 'video'],
  interestVector: { field: 0.3 },
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const catalogWithoutCareer = () => {
  const value = catalog()
  value.groups.pop()
  return value
}

const catalogWithChangedLimits = () => {
  const value = catalog()
  value.limits.work.max = 5
  return value
}

const catalogWithExtraLimit = () => {
  const value = catalog() as ReturnType<typeof catalog> & {
    limits: ReturnType<typeof catalog>['limits'] & { equipment?: { min: number, max: number } }
  }
  value.limits.equipment = { min: 1, max: 1 }
  return value
}

const setCompleteSelections = (store: ReturnType<typeof useAssessmentStore>) => {
  store.toggleOption('work.photo')
  store.toggleOption('result.portfolio')
  store.toggleOption('style.solo')
  store.toggleOption('career.photo')
}

describe('assessment store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('loads the public catalog and emits assessment_started once without blocking', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') return success(catalog())
      if (url === '/api/events') throw new Error('telemetry unavailable')
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()

    await store.loadOptions()
    await Promise.resolve()
    await store.loadOptions()

    expect(store.status).toBe('ready')
    expect(store.groups).toHaveLength(4)
    expect(fetch).toHaveBeenCalledWith('/api/events', {
      body: { eventName: 'assessment_started', catalogRevision: revisionA },
      method: 'POST',
    })
    expect(fetch.mock.calls.filter(([url]) => url === '/api/events')).toHaveLength(1)
  })

  it('resets assessment_started and completed-event lifecycle flags on clear', async () => {
    const fetch = vi.fn(async (url: string, _options?: { body?: Record<string, unknown> }) => url === '/api/assessment/options'
      ? success(catalog())
      : success({ accepted: true }))
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()

    await store.loadOptions()
    store.toggleOption('work.photo')
    expect(store.next()).toBe(true)
    store.previous()
    expect(store.next()).toBe(true)
    store.clear()
    await store.loadOptions()

    const eventBodies = fetch.mock.calls
      .filter(([url]) => url === '/api/events')
      .map(([, options]) => options?.body)
    expect(eventBodies.filter(body => body?.eventName === 'assessment_started')).toHaveLength(2)
    expect(eventBodies.filter(body => body?.eventName === 'assessment_step_completed')).toHaveLength(1)
  })

  it('blocks over-limit selections and advances only after the exact minimum', async () => {
    const fetch = vi.fn(async (url: string) => url === '/api/assessment/options'
      ? success(catalog())
      : success({ accepted: true }))
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()

    expect(store.next()).toBe(false)
    expect(store.step).toBe(0)
    for (const key of ['work.photo', 'work.video', 'work.edit', 'work.studio', 'work.book']) {
      store.toggleOption(key)
    }

    expect(store.selections.work).toEqual(['work.photo', 'work.video', 'work.edit', 'work.studio'])
    expect(store.announcement).toContain('최대 4개')
    expect(store.next()).toBe(true)
    expect(store.step).toBe(1)
    expect(store.previous()).toBe(true)
    expect(store.step).toBe(0)
    expect(fetch).toHaveBeenCalledWith('/api/events', {
      body: {
        eventName: 'assessment_step_completed',
        catalogRevision: revisionA,
        group: 'work',
        selectedCount: 4,
      },
      method: 'POST',
    })
  })

  it('rejects private career text and clears it synchronously with explore', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(success(catalog())))
    const store = useAssessmentStore()
    await store.loadOptions()
    store.toggleOption('career.explore')

    expect(store.setCareerOther('name@example.com')).toBe(false)
    expect(store.setCareerOther('010-1234-5678')).toBe(false)
    expect(store.setCareerOther('첫 줄\n둘째 줄')).toBe(false)
    expect(store.careerOther).toBe('')
    expect(store.setCareerOther('아카이브 연구')).toBe(true)
    expect(store.careerOther).toBe('아카이브 연구')

    store.toggleOption('career.explore')
    expect(store.careerOther).toBe('')
    expect(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}').careerOther).toBe('')
  })

  it('restores only an exact safe shape matching the loaded catalog revision', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      step: 2,
      selections: {
        work: ['work.photo'],
        result: ['result.portfolio'],
        style: ['style.solo'],
        career: [],
      },
      careerOther: '',
      catalogRevision: revisionA,
    }))
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(success(catalog())))
    const store = useAssessmentStore()

    await store.loadOptions()

    expect(store.step).toBe(2)
    expect(store.selections.work).toEqual(['work.photo'])
    expect(Object.keys(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')).sort()).toEqual([
      'careerOther', 'catalogRevision', 'selections', 'step',
    ])
  })

  it.each([
    ['another revision', { step: 1, selections: { work: ['work.photo'], result: [], style: [], career: [] }, careerOther: '', catalogRevision: revisionB }],
    ['unknown key', { step: 1, selections: { work: ['work.secret'], result: [], style: [], career: [] }, careerOther: '', catalogRevision: revisionA }],
    ['extra field', { step: 1, selections: { work: ['work.photo'], result: [], style: [], career: [] }, careerOther: '', catalogRevision: revisionA, csrfToken: 'leak' }],
  ])('discards persisted state with %s', async (_name, persisted) => {
    sessionStorage.setItem(storageKey, JSON.stringify(persisted))
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(success(catalog())))
    const store = useAssessmentStore()

    await store.loadOptions()

    expect(store.step).toBe(0)
    expect(store.selections.work).toEqual([])
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it('submits the exact revision and selections with memory-only CSRF and scored result', async () => {
    const scored = validScoredResult()
    const fetch = vi.fn(async (url: string, _options?: { body?: Record<string, unknown> }) => {
      if (url === '/api/assessment/options') return success(catalog())
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/assessment/validate') return success(scored)
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    const ok = await store.validate('csrf-memory-token')

    expect(ok).toBe(true)
    expect(store.status).toBe('validated')
    expect(store.validatedResult).toEqual(scored)
    expect(store.primaryTrackLabel).toBe('다큐멘터리 사진')
    expect(fetch).toHaveBeenCalledWith('/api/student/assessment/validate', {
      body: {
        catalogRevision: revisionA,
        selections: {
          work: ['work.photo'],
          result: ['result.portfolio'],
          style: ['style.solo'],
          career: ['career.photo'],
          careerOther: null,
        },
      },
      headers: { 'x-photo-next-csrf': 'csrf-memory-token' },
      method: 'POST',
    })
    const persisted = sessionStorage.getItem(storageKey) ?? ''
    expect(persisted).not.toContain('csrf-memory-token')
    expect(persisted).not.toContain('trackScores')
    expect(persisted).not.toContain('rankedTracks')
    expect(persisted).not.toContain('interestVector')
  })

  describe('atomic assessment submission', () => {
    it('reuses one memory-only UUID for an unchanged failed request and retry, then clears the draft on success', async () => {
      const randomUUID = vi.fn().mockReturnValue(idempotencyKeyA)
      vi.stubGlobal('crypto', { randomUUID })
      let submissions = 0
      const fetch = vi.fn(async (url: string) => {
        if (url === '/api/assessment/options') return success(catalog())
        if (url === '/api/events') return success({ accepted: true })
        if (url === '/api/assessment/submit') {
          submissions += 1
          if (submissions === 1) throw new Error('private upstream detail')
          return success({ publicId })
        }
        throw new Error(`unexpected ${url}`)
      })
      vi.stubGlobal('$fetch', fetch)
      const store = useAssessmentStore()
      await store.loadOptions()
      setCompleteSelections(store)

      await expect(store.submit('csrf-memory-token')).resolves.toBeNull()

      expect(store.status).toBe('error')
      expect(store.retryAction).toBe('submit')
      expect(store.selections.work).toEqual(['work.photo'])
      expect(sessionStorage.getItem(storageKey)).not.toBeNull()
      expect(sessionStorage.getItem(storageKey)).not.toContain(idempotencyKeyA)

      await expect(store.retry('csrf-memory-token')).resolves.toBe(publicId)

      const submitCalls = fetch.mock.calls.filter(([url]) => url === '/api/assessment/submit')
      expect(submitCalls).toHaveLength(2)
      expect(submitCalls[0]?.[1]).toEqual({
        body: {
          catalogRevision: revisionA,
          idempotencyKey: idempotencyKeyA,
          selections: {
            work: ['work.photo'],
            result: ['result.portfolio'],
            style: ['style.solo'],
            career: ['career.photo'],
            careerOther: null,
          },
        },
        headers: { 'x-photo-next-csrf': 'csrf-memory-token' },
        method: 'POST',
      })
      expect(submitCalls[1]?.[1]).toEqual(submitCalls[0]?.[1])
      expect(randomUUID).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem(storageKey)).toBeNull()
    })

    it('resets the completed in-memory draft so the same store cannot restore it on catalog re-entry', async () => {
      vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(idempotencyKeyA) })
      const fetch = vi.fn(async (url: string) => {
        if (url === '/api/assessment/options') return success(catalog())
        if (url === '/api/events') return success({ accepted: true })
        if (url === '/api/assessment/submit') return success({ publicId })
        throw new Error(`unexpected ${url}`)
      })
      vi.stubGlobal('$fetch', fetch)
      const store = useAssessmentStore()
      await store.loadOptions()
      setCompleteSelections(store)
      store.toggleOption('career.explore')
      store.setCareerOther('아카이브 연구')
      expect(store.next()).toBe(true)
      expect(store.next()).toBe(true)
      expect(store.next()).toBe(true)

      await expect(store.submit('csrf-memory-token')).resolves.toBe(publicId)

      expect(store.step).toBe(0)
      expect(store.selections).toEqual({ work: [], result: [], style: [], career: [] })
      expect(store.careerOther).toBe('')
      expect(store.isComplete).toBe(false)
      expect(sessionStorage.getItem(storageKey)).toBeNull()

      await expect(store.loadOptions()).resolves.toBe(true)

      expect(store.step).toBe(0)
      expect(store.selections).toEqual({ work: [], result: [], style: [], career: [] })
      expect(store.careerOther).toBe('')
      expect(store.isComplete).toBe(false)
      expect(sessionStorage.getItem(storageKey)).toBeNull()
    })

    it('rotates the idempotency key when a selection changes after a failed submission', async () => {
      const randomUUID = vi.fn()
        .mockReturnValueOnce(idempotencyKeyA)
        .mockReturnValueOnce(idempotencyKeyB)
      vi.stubGlobal('crypto', { randomUUID })
      const fetch = vi.fn(async (url: string) => {
        if (url === '/api/assessment/options') return success(catalog())
        if (url === '/api/events') return success({ accepted: true })
        if (url === '/api/assessment/submit') throw new Error('submit unavailable')
        throw new Error(`unexpected ${url}`)
      })
      vi.stubGlobal('$fetch', fetch)
      const store = useAssessmentStore()
      await store.loadOptions()
      setCompleteSelections(store)

      await store.submit('csrf-memory-token')
      expect(store.toggleOption('work.video')).toBe(true)
      await store.submit('csrf-memory-token')

      const keys = fetch.mock.calls
        .filter(([url]) => url === '/api/assessment/submit')
        .map(([, options]) => options?.body?.idempotencyKey)
      expect(keys).toEqual([idempotencyKeyA, idempotencyKeyB])
      expect(randomUUID).toHaveBeenCalledTimes(2)
    })

    it('rotates the idempotency key when career free text changes after a failed submission', async () => {
      const randomUUID = vi.fn()
        .mockReturnValueOnce(idempotencyKeyA)
        .mockReturnValueOnce(idempotencyKeyB)
      vi.stubGlobal('crypto', { randomUUID })
      const fetch = vi.fn(async (url: string) => {
        if (url === '/api/assessment/options') return success(catalog())
        if (url === '/api/events') return success({ accepted: true })
        if (url === '/api/assessment/submit') throw new Error('submit unavailable')
        throw new Error(`unexpected ${url}`)
      })
      vi.stubGlobal('$fetch', fetch)
      const store = useAssessmentStore()
      await store.loadOptions()
      setCompleteSelections(store)
      store.toggleOption('career.explore')
      store.setCareerOther('아카이브 연구')

      await store.submit('csrf-memory-token')
      expect(store.setCareerOther('문화기관 아카이브')).toBe(true)
      await store.submit('csrf-memory-token')

      const keys = fetch.mock.calls
        .filter(([url]) => url === '/api/assessment/submit')
        .map(([, options]) => options?.body?.idempotencyKey)
      expect(keys).toEqual([idempotencyKeyA, idempotencyKeyB])
      expect(randomUUID).toHaveBeenCalledTimes(2)
      expect(sessionStorage.getItem(storageKey)).not.toContain(idempotencyKeyB)
    })

    it('invalidates the old key when a stale catalog is reconciled but keeps recognized choices', async () => {
      const randomUUID = vi.fn()
        .mockReturnValueOnce(idempotencyKeyA)
        .mockReturnValueOnce(idempotencyKeyB)
      vi.stubGlobal('crypto', { randomUUID })
      const stale = Object.assign(new Error('stale upstream'), {
        data: { error: { code: 'ASSESSMENT_CATALOG_STALE', message: 'sanitized' }, requestId: 'stale-id' },
        statusCode: 409,
      })
      let optionsLoads = 0
      let submissions = 0
      const fetch = vi.fn(async (url: string) => {
        if (url === '/api/assessment/options') {
          optionsLoads += 1
          return success(catalog(optionsLoads === 1 ? revisionA : revisionB))
        }
        if (url === '/api/events') return success({ accepted: true })
        if (url === '/api/assessment/submit') {
          submissions += 1
          if (submissions === 1) throw stale
          throw new Error('submit unavailable')
        }
        throw new Error(`unexpected ${url}`)
      })
      vi.stubGlobal('$fetch', fetch)
      const store = useAssessmentStore()
      await store.loadOptions()
      setCompleteSelections(store)

      await store.submit('csrf-memory-token')
      expect(store.catalogRevision).toBe(revisionB)
      expect(store.selections.work).toEqual(['work.photo'])
      await store.submit('csrf-memory-token')

      const submitCalls = fetch.mock.calls.filter(([url]) => url === '/api/assessment/submit')
      expect(submitCalls.map(([, options]) => options?.body?.idempotencyKey)).toEqual([
        idempotencyKeyA,
        idempotencyKeyB,
      ])
      expect(submitCalls.map(([, options]) => options?.body?.catalogRevision)).toEqual([
        revisionA,
        revisionB,
      ])
      expect(sessionStorage.getItem(storageKey)).toContain(revisionB)
    })

    it('ignores a late success after clear starts a changed draft and does not remove that draft', async () => {
      vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(idempotencyKeyA) })
      const pendingSubmission = deferred<unknown>()
      vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
        if (url === '/api/assessment/options') return success(catalog())
        if (url === '/api/events') return success({ accepted: true })
        if (url === '/api/assessment/submit') return pendingSubmission.promise
        throw new Error(`unexpected ${url}`)
      }))
      const store = useAssessmentStore()
      await store.loadOptions()
      setCompleteSelections(store)

      const submission = store.submit('csrf-memory-token')
      expect(store.status).toBe('submitting')
      expect(store.toggleOption('work.video')).toBe(false)

      store.clear()
      expect(store.toggleOption('work.video')).toBe(true)
      const changedDraft = sessionStorage.getItem(storageKey)
      pendingSubmission.resolve(success({ publicId }))

      await expect(submission).resolves.toBeNull()
      expect(sessionStorage.getItem(storageKey)).toBe(changedDraft)
      expect(sessionStorage.getItem(storageKey)).toContain('work.video')
    })

    it('marks an authentication failure without clearing the persisted draft', async () => {
      vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(idempotencyKeyA) })
      const authFailure = Object.assign(new Error('expired session'), {
        data: { error: { code: 'AUTH_FAILED', message: 'sanitized' }, requestId: 'auth-id' },
        statusCode: 401,
      })
      vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
        if (url === '/api/assessment/options') return success(catalog())
        if (url === '/api/events') return success({ accepted: true })
        if (url === '/api/assessment/submit') throw authFailure
        throw new Error(`unexpected ${url}`)
      }))
      const store = useAssessmentStore()
      await store.loadOptions()
      setCompleteSelections(store)

      await expect(store.submit('csrf-memory-token')).resolves.toBeNull()

      expect(store.status).toBe('unauthenticated')
      expect(store.selections.work).toEqual(['work.photo'])
      expect(sessionStorage.getItem(storageKey)).not.toBeNull()
    })
  })

  it('blocks public mutations while validation is pending and keeps the accepted result memory-only', async () => {
    const pendingValidation = deferred<unknown>()
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') return success(catalog())
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/assessment/validate') return pendingValidation.promise
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    const validation = store.validate('csrf-memory-token')

    expect(store.status).toBe('validating')
    expect(store.toggleOption('work.video')).toBe(false)
    expect(store.selections.work).toEqual(['work.photo'])
    pendingValidation.resolve(success(validScoredResult()))

    expect(await validation).toBe(true)
    expect(store.validatedResult).toEqual(validScoredResult())
    const persisted = sessionStorage.getItem(storageKey) ?? ''
    expect(persisted).not.toContain('trackScores')
    expect(persisted).not.toContain('csrf-memory-token')
  })

  it('ignores a late validation result when the selection fingerprint changes', async () => {
    const pendingValidation = deferred<unknown>()
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') return success(catalog())
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/assessment/validate') return pendingValidation.promise
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    const validation = store.validate('csrf-memory-token')
    store.selections.work.push('work.video')
    pendingValidation.resolve(success(validScoredResult()))

    expect(await validation).toBe(false)
    expect(store.status).toBe('ready')
    expect(store.validatedResult).toBeNull()
  })

  it('invalidates an in-flight options request when clear removes persisted state', async () => {
    const pendingOptions = deferred<unknown>()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') return pendingOptions.promise
      return success({ accepted: true })
    }))
    const store = useAssessmentStore()

    const loading = store.loadOptions()
    store.clear()
    pendingOptions.resolve(success(catalog()))

    expect(await loading).toBe(false)
    expect(store.status).toBe('idle')
    expect(store.groups).toEqual([])
    expect(store.selections.work).toEqual([])
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it('invalidates an in-flight validation when clear removes persisted state', async () => {
    const pendingValidation = deferred<unknown>()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') return success(catalog())
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/assessment/validate') return pendingValidation.promise
      throw new Error(`unexpected ${url}`)
    }))
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    const validation = store.validate('csrf-memory-token')
    store.clear()
    pendingValidation.resolve(success(validScoredResult()))

    expect(await validation).toBe(false)
    expect(store.status).toBe('ready')
    expect(store.selections).toEqual({ work: [], result: [], style: [], career: [] })
    expect(store.validatedResult).toBeNull()
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it.each([
    ['extra envelope field', { ...success(validScoredResult()), debug: true }],
    ['missing request id', { data: validScoredResult() }],
    ['extra result field', success({ ...validScoredResult(), csrfToken: 'leak' })],
    ['missing track score', success({ ...validScoredResult(), trackScores: { documentary: 8, art_photo: 5, commercial: 2 } })],
    ['extra track score', success({ ...validScoredResult(), trackScores: { ...validScoredResult().trackScores, secret: 4 } })],
    ['non-finite track score', success({ ...validScoredResult(), trackScores: { ...validScoredResult().trackScores, video: Number.NaN } })],
    ['out-of-range track score', success({ ...validScoredResult(), trackScores: { ...validScoredResult().trackScores, video: 101 } })],
    ['duplicate ranked track', success({ ...validScoredResult(), rankedTracks: ['documentary', 'art_photo', 'commercial', 'commercial'] })],
    ['unknown ranked track', success({ ...validScoredResult(), rankedTracks: ['documentary', 'art_photo', 'commercial', 'secret'] })],
    ['unsafe interest tag', success({ ...validScoredResult(), interestVector: { 'Field Contact': 0.3 } })],
    ['out-of-range interest score', success({ ...validScoredResult(), interestVector: { field: 1.1 } })],
  ])('rejects a malformed validation success with %s', async (_name, malformed) => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') return success(catalog())
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/assessment/validate') return malformed
      throw new Error(`unexpected ${url}`)
    }))
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    expect(await store.validate('csrf-memory-token')).toBe(false)
    expect(store.status).toBe('error')
    expect(store.retryAction).toBe('validate')
    expect(store.errorMessage).toContain('다시 시도')
    expect(store.errorMessage).not.toContain('leak')
    expect(store.validatedResult).toBeNull()
  })

  it('emits the career completion event once when the final step is accepted', async () => {
    const fetch = vi.fn(async (url: string, _options?: { body?: Record<string, unknown> }) => {
      if (url === '/api/assessment/options') return success(catalog())
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/assessment/validate') return success(validScoredResult())
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    expect(await store.validate('csrf-memory-token')).toBe(true)

    expect(fetch.mock.calls.filter(([, options]) => (
      options?.body?.eventName === 'assessment_step_completed'
      && options.body.group === 'career'
    ))).toHaveLength(1)
  })

  it('preserves safe choices and exposes validation retry after a network failure', async () => {
    let validationAttempts = 0
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') return success(catalog())
      if (url === '/api/events') return success({ accepted: true })
      validationAttempts += 1
      if (validationAttempts === 1) throw new Error('private upstream detail')
      return success({
        trackScores: { documentary: 3, art_photo: 2, commercial: 1, video: 0 },
        rankedTracks: ['documentary', 'art_photo', 'commercial', 'video'],
        interestVector: {},
      })
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    expect(await store.validate('csrf-memory-token')).toBe(false)
    expect(store.status).toBe('error')
    expect(store.retryAction).toBe('validate')
    expect(store.errorMessage).toContain('다시 시도')
    expect(store.errorMessage).not.toContain('private upstream detail')
    expect(store.selections.work).toEqual(['work.photo'])

    expect(await store.retry('csrf-memory-token')).toBe(true)
    expect(store.status).toBe('validated')
  })

  it('reloads a stale catalog, preserves only recognized choices, and requires review', async () => {
    let optionsLoads = 0
    const stale = Object.assign(new Error('stale upstream'), {
      data: { error: { code: 'ASSESSMENT_CATALOG_STALE', message: 'sanitized' }, requestId: 'stale-id' },
      statusCode: 409,
    })
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') {
        optionsLoads += 1
        const nextCatalog = catalog(optionsLoads === 1 ? revisionA : revisionB)
        if (optionsLoads === 2) nextCatalog.groups[0]!.options = nextCatalog.groups[0]!.options.filter(option => option.key !== 'work.video')
        return success(nextCatalog)
      }
      if (url === '/api/events') return success({ accepted: true })
      throw stale
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)
    store.toggleOption('work.video')

    expect(await store.validate('csrf-memory-token')).toBe(false)

    expect(optionsLoads).toBe(2)
    expect(store.catalogRevision).toBe(revisionB)
    expect(store.selections.work).toEqual(['work.photo'])
    expect(store.validatedResult).toBeNull()
    expect(store.status).toBe('stale')
    expect(store.retryAction).toBeNull()
    expect(store.errorMessage).toContain('선택을 다시 확인')
    expect(sessionStorage.getItem(storageKey)).toContain(revisionB)
  })

  it('keeps the empty state when a stale reload has an empty required step', async () => {
    let optionsLoads = 0
    const stale = Object.assign(new Error('stale upstream'), {
      data: { error: { code: 'ASSESSMENT_CATALOG_STALE', message: 'sanitized' } },
      statusCode: 409,
    })
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') {
        optionsLoads += 1
        const nextCatalog = catalog(optionsLoads === 1 ? revisionA : revisionB)
        if (optionsLoads === 2) nextCatalog.groups[3]!.options = []
        return success(nextCatalog)
      }
      if (url === '/api/events') return success({ accepted: true })
      throw stale
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    expect(await store.validate('csrf-memory-token')).toBe(false)

    expect(store.status).toBe('empty')
    expect(store.validatedResult).toBeNull()
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it('preserves stale review through a failed reload and successful retry', async () => {
    const stale = Object.assign(new Error('stale upstream'), {
      data: { error: { code: 'ASSESSMENT_CATALOG_STALE', message: 'sanitized' } },
      statusCode: 409,
    })
    let optionsLoads = 0
    let validations = 0
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') {
        optionsLoads += 1
        if (optionsLoads === 2) throw new Error('reload unavailable')
        const nextCatalog = catalog(optionsLoads === 1 ? revisionA : revisionB)
        if (optionsLoads === 3) {
          nextCatalog.groups[0]!.options = nextCatalog.groups[0]!.options
            .filter(option => option.key !== 'work.photo')
        }
        return success(nextCatalog)
      }
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/assessment/validate') {
        validations += 1
        throw stale
      }
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    expect(await store.validate('csrf-memory-token')).toBe(false)
    expect(store.status).toBe('error')
    expect(store.retryAction).toBe('load')

    expect(await store.retry('csrf-memory-token')).toBe(true)
    expect(store.status).toBe('stale')
    expect(store.step).toBe(0)
    expect(store.selections.work).toEqual([])
    expect(store.isComplete).toBe(false)
    expect(store.errorMessage).toContain('선택을 다시 확인')
    expect(store.validatedResult).toBeNull()
    expect(validations).toBe(1)
  })

  it('persists the first incomplete stale step so a new store restores the review position', async () => {
    const stale = Object.assign(new Error('stale upstream'), {
      data: { error: { code: 'ASSESSMENT_CATALOG_STALE', message: 'sanitized' } },
      statusCode: 409,
    })
    let optionsLoads = 0
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/assessment/options') {
        optionsLoads += 1
        const nextCatalog = catalog(optionsLoads === 1 ? revisionA : revisionB)
        if (optionsLoads >= 2) {
          nextCatalog.groups[0]!.options = nextCatalog.groups[0]!.options
            .filter(option => option.key !== 'work.photo')
        }
        return success(nextCatalog)
      }
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/assessment/validate') throw stale
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)
    expect(store.next()).toBe(true)
    expect(store.next()).toBe(true)
    expect(store.next()).toBe(true)
    expect(store.step).toBe(3)

    expect(await store.validate('csrf-memory-token')).toBe(false)
    expect(store.status).toBe('stale')
    expect(store.step).toBe(0)
    expect(store.selections).toEqual({
      work: [],
      result: ['result.portfolio'],
      style: ['style.solo'],
      career: ['career.photo'],
    })
    expect(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')).toMatchObject({
      catalogRevision: revisionB,
      step: 0,
    })

    setActivePinia(createPinia())
    const restored = useAssessmentStore()
    await restored.loadOptions()

    expect(restored.step).toBe(0)
    expect(restored.selections).toEqual(store.selections)
    expect(restored.isComplete).toBe(false)
  })

  it('deduplicates step completion within a revision and emits again for a stale revision', async () => {
    const stale = Object.assign(new Error('stale upstream'), {
      data: { error: { code: 'ASSESSMENT_CATALOG_STALE', message: 'sanitized' } },
      statusCode: 409,
    })
    let optionsLoads = 0
    const fetch = vi.fn(async (url: string, _options?: { body?: Record<string, unknown> }) => {
      if (url === '/api/assessment/options') {
        optionsLoads += 1
        const nextCatalog = catalog(optionsLoads === 1 ? revisionA : revisionB)
        if (optionsLoads === 2) {
          nextCatalog.groups[0]!.options = nextCatalog.groups[0]!.options
            .filter(option => option.key !== 'work.photo')
        }
        return success(nextCatalog)
      }
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/assessment/validate') throw stale
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()
    await store.loadOptions()
    setCompleteSelections(store)

    expect(store.next()).toBe(true)
    expect(await store.validate('csrf-memory-token')).toBe(false)
    expect(store.step).toBe(0)
    expect(store.toggleOption('work.video')).toBe(true)
    expect(store.next()).toBe(true)
    expect(store.previous()).toBe(true)
    expect(store.next()).toBe(true)

    const workEvents = fetch.mock.calls
      .filter(([url, options]) => url === '/api/events'
        && options?.body?.eventName === 'assessment_step_completed'
        && options.body.group === 'work')
      .map(([, options]) => options?.body?.catalogRevision)
    expect(workEvents).toEqual([revisionA, revisionB])
  })

  it('uses the empty state when any required step has no options', async () => {
    const partialCatalog = catalog()
    partialCatalog.groups[3]!.options = []
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(success(partialCatalog)))
    const store = useAssessmentStore()

    await store.loadOptions()

    expect(store.status).toBe('empty')
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it.each([
    ['a missing step', catalogWithoutCareer],
    ['changed selection limits', catalogWithChangedLimits],
    ['an extra limit group', catalogWithExtraLimit],
  ])('rejects a catalog with %s', async (_name, invalidCatalog) => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(success(invalidCatalog())))
    const store = useAssessmentStore()

    await store.loadOptions()

    expect(store.status).toBe('error')
    expect(store.retryAction).toBe('load')
  })

  it('models load failure, empty, and unauthenticated states without leaking errors', async () => {
    const emptyCatalog = catalog()
    emptyCatalog.groups = emptyCatalog.groups.map(group => ({ ...group, options: [] }))
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('database hostname'))
      .mockResolvedValueOnce(success(emptyCatalog))
    vi.stubGlobal('$fetch', fetch)
    const store = useAssessmentStore()

    await store.loadOptions()
    expect(store.status).toBe('error')
    expect(store.retryAction).toBe('load')
    expect(store.errorMessage).not.toContain('database hostname')

    await store.retry()
    expect(store.status).toBe('empty')

    store.markUnauthenticated()
    expect(store.status).toBe('unauthenticated')
  })
})
