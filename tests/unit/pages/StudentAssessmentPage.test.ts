import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const revision = `sha256:${'a'.repeat(64)}`
const storageKey = 'photo_next_assessment_v1'
const publicId = '11111111-1111-4111-8111-111111111111'
const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const session = {
  csrfToken: 'csrf-memory-token',
  expiresAt: '2026-07-14T12:00:00.000Z',
  nickname: '고요한프레임27',
  prospectId: 27,
}
const catalog = {
  catalogRevision: revision,
  groups: [
    { key: 'work', options: [{ key: 'work.photo', label: '사진 촬영하기', visualKey: 'photo_frame' }] },
    { key: 'result', options: [{ key: 'result.portfolio', label: '사진 포트폴리오', visualKey: 'gallery_grid' }] },
    { key: 'style', options: [{ key: 'style.solo', label: '혼자 집중해서 작업', visualKey: 'project_board' }] },
    { key: 'career', options: [{ key: 'career.photo', label: '사진 진로', visualKey: 'photo_frame' }] },
  ],
  limits: {
    work: { min: 1, max: 4 },
    result: { min: 1, max: 3 },
    style: { min: 1, max: 2 },
    career: { min: 1, max: 2 },
  },
}
const success = <T>(data: T) => ({ data, requestId: 'request-id' })

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const mountPageWithStore = async () => {
  const { default: AssessmentPage } = await import('../../../app/pages/assessment.vue')
  const { useAssessmentStore } = await import('../../../app/stores/assessment')
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(AssessmentPage, {
    global: { plugins: [pinia], stubs: { NuxtLink: true } },
  })
  return { store: useAssessmentStore(pinia), wrapper }
}

const mountPage = async () => {
  const { default: AssessmentPage } = await import('../../../app/pages/assessment.vue')
  return mount(AssessmentPage, {
    global: { plugins: [createPinia()], stubs: { NuxtLink: true } },
  })
}

describe('student assessment page', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(idempotencyKey) })
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads the session before the catalog and renders the first contact-sheet step', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(success(session))
      .mockResolvedValueOnce(success(catalog))
      .mockResolvedValueOnce(success({ accepted: true }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('로그인 정보를 확인하고 있어요.')
    await flushPromises()

    expect(fetch.mock.calls[0]).toEqual(['/api/student/session'])
    expect(fetch.mock.calls[1]).toEqual(['/api/assessment/options'])
    expect(wrapper.text()).toContain('고요한프레임27님')
    expect(wrapper.text()).toContain('광주대학교 사진영상미디어학과 · 관심사 연결')
    expect(wrapper.text()).toContain('01 / 04')
    expect(wrapper.text()).toContain('무엇을 해보고 싶나요?')
    expect(wrapper.text()).toContain('사진 촬영하기')
    expect(wrapper.text()).not.toContain('장비')
    expect(wrapper.text()).not.toContain('시설')
    expect(wrapper.text()).not.toContain('csrf-memory-token')
  })

  it('shows catalog loading after the session resolves while options are pending', async () => {
    let resolveOptions: ((value: unknown) => void) | undefined
    const pendingOptions = new Promise(resolve => { resolveOptions = resolve })
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return pendingOptions
      return success({ accepted: true })
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    await flushPromises()

    expect(wrapper.text()).toContain('관심 선택지를 불러오고 있어요.')
    resolveOptions?.(success(catalog))
    await flushPromises()
  })

  it('redirects an unauthenticated visitor to login and does not load options', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('unauthenticated'))
    vi.stubGlobal('$fetch', fetch)
    await mountPage()

    await flushPromises()

    expect(globalThis.navigateTo).toHaveBeenCalledWith('/login', { replace: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/student/session')
  })

  it('shows a retry action when options cannot be loaded and keeps backend details private', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(success(session))
      .mockRejectedValueOnce(new Error('supabase.internal.local'))
      .mockResolvedValueOnce(success(catalog))
      .mockResolvedValueOnce(success({ accepted: true }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('선택지를 불러오지 못했습니다')
    expect(wrapper.text()).not.toContain('supabase.internal.local')
    await wrapper.get('[data-testid="assessment-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('무엇을 해보고 싶나요?')
  })

  it('focuses and scrolls the new step heading after mobile next and previous navigation', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return success(catalog)
      return success({ accepted: true })
    }))
    const wrapper = await mountPage()
    await flushPromises()

    const next = wrapper.get('[data-testid="assessment-next"]')
    expect(next.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-key="work.photo"]').trigger('click')
    expect(next.attributes('disabled')).toBeUndefined()
    await next.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('02 / 04')
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(focus.mock.contexts.at(-1)).toBe(wrapper.get('legend').element)

    await wrapper.get('[data-testid="assessment-previous"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('01 / 04')
    expect(focus).toHaveBeenCalledTimes(2)
    expect(scroll).toHaveBeenCalledTimes(2)
  })

  it('disables final submission until every assessment group is complete', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      step: 3,
      selections: { work: [], result: [], style: [], career: ['career.photo'] },
      careerOther: '',
      catalogRevision: revision,
    }))
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return success(catalog)
      return success({ accepted: true })
    }))
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.get('[data-testid="assessment-submit"]').attributes('disabled')).toBeDefined()
  })

  it('submits the final step with memory-only CSRF and idempotency, clears the draft, and navigates to the owned result', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      step: 3,
      selections: {
        work: ['work.photo'],
        result: ['result.portfolio'],
        style: ['style.solo'],
        career: ['career.photo'],
      },
      careerOther: '',
      catalogRevision: revision,
    }))
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return success(catalog)
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/assessment/submit') {
        return success({ publicId })
      }
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="assessment-submit"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/assessment/submit', expect.objectContaining({
      body: expect.objectContaining({ idempotencyKey }),
      headers: { 'x-photo-next-csrf': 'csrf-memory-token' },
      method: 'POST',
    }))
    expect(globalThis.navigateTo).toHaveBeenCalledWith(`/result/${publicId}`)
    expect(wrapper.find('[data-testid="validated-primary-track"]').exists()).toBe(false)
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it('disables the assessment fieldset and announces the exact progress copy while submission is pending', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      step: 3,
      selections: {
        work: ['work.photo'],
        result: ['result.portfolio'],
        style: ['style.solo'],
        career: ['career.photo'],
      },
      careerOther: '',
      catalogRevision: revision,
    }))
    const pendingSubmission = deferred<unknown>()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return success(catalog)
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/assessment/submit') return pendingSubmission.promise
      throw new Error(`unexpected ${url}`)
    }))
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="assessment-submit"]').trigger('click')

    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="assessment-submit"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('[data-testid="assessment-submit"]').text()).toBe('결과와 진로 제안 정리 중…')
    expect(wrapper.get('.assessment-page__global-status').text()).toBe(
      '결과와 짧은 진로 제안을 정리 중입니다.',
    )
    const before = sessionStorage.getItem(storageKey)
    await wrapper.get('[data-testid="assessment-submit"]').trigger('click')
    await wrapper.get('[data-key="career.photo"]').trigger('click')
    expect(sessionStorage.getItem(storageKey)).toBe(before)
    expect((globalThis.$fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]: [string]) => url === '/api/assessment/submit',
    )).toHaveLength(1)

    pendingSubmission.resolve(success({ publicId }))
    await flushPromises()
    expect(globalThis.navigateTo).toHaveBeenCalledWith(`/result/${publicId}`)
    expect(globalThis.navigateTo).toHaveBeenCalledTimes(1)
  })

  it('disables logout and does not call the logout API while assessment submission is pending', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      step: 3,
      selections: {
        work: ['work.photo'],
        result: ['result.portfolio'],
        style: ['style.solo'],
        career: ['career.photo'],
      },
      careerOther: '',
      catalogRevision: revision,
    }))
    const pendingSubmission = deferred<unknown>()
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return success(catalog)
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/assessment/submit') return pendingSubmission.promise
      if (url === '/api/student/logout') return success({ ok: true })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="assessment-submit"]').trigger('click')
    const logout = wrapper.get('[data-testid="logout"]')

    expect(logout.attributes('disabled')).toBeDefined()
    await logout.trigger('click')
    expect(fetch.mock.calls.filter(([url]) => url === '/api/student/logout')).toHaveLength(0)
    expect(globalThis.navigateTo).not.toHaveBeenCalledWith('/login', { replace: true })

    pendingSubmission.resolve(success({ publicId }))
    await flushPromises()
  })

  it('shows a distinct stale-catalog review state after submission reloads the options', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      step: 3,
      selections: {
        work: ['work.photo'],
        result: ['result.portfolio'],
        style: ['style.solo'],
        career: ['career.photo'],
      },
      careerOther: '',
      catalogRevision: revision,
    }))
    const stale = Object.assign(new Error('stale upstream'), {
      data: { error: { code: 'ASSESSMENT_CATALOG_STALE', message: 'sanitized' } },
      statusCode: 409,
    })
    let optionsLoads = 0
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') {
        optionsLoads += 1
        return success({ ...catalog, catalogRevision: optionsLoads === 1 ? revision : `sha256:${'b'.repeat(64)}` })
      }
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/assessment/submit') throw stale
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="assessment-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="assessment-stale"]').text()).toContain('선택을 다시 확인')
  })

  it('returns to visible stale review after a failed reload retry removes an earlier choice', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      step: 3,
      selections: {
        work: ['work.photo'],
        result: ['result.portfolio'],
        style: ['style.solo'],
        career: ['career.photo'],
      },
      careerOther: '',
      catalogRevision: revision,
    }))
    const stale = Object.assign(new Error('stale upstream'), {
      data: { error: { code: 'ASSESSMENT_CATALOG_STALE', message: 'sanitized' } },
      statusCode: 409,
    })
    let optionsLoads = 0
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') {
        optionsLoads += 1
        if (optionsLoads === 2) throw new Error('reload unavailable')
        if (optionsLoads === 3) {
          return success({
            ...catalog,
            catalogRevision: `sha256:${'b'.repeat(64)}`,
            groups: catalog.groups.map(group => group.key === 'work'
              ? { ...group, options: [{ key: 'work.video', label: '영상 촬영하기', visualKey: 'video_frame' }] }
              : group),
          })
        }
        return success(catalog)
      }
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/assessment/submit') throw stale
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="assessment-submit"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="assessment-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="assessment-stale"]').text()).toContain('선택을 다시 확인')
    expect(wrapper.text()).toContain('01 / 04')
    expect(wrapper.text()).toContain('영상 촬영하기')
    expect(wrapper.find('[data-testid="assessment-submit"]').exists()).toBe(false)
    expect(fetch.mock.calls.filter(([url]) => url === '/api/assessment/submit')).toHaveLength(1)
  })

  it('routes an expired submit session to login while preserving the draft', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      step: 3,
      selections: {
        work: ['work.photo'],
        result: ['result.portfolio'],
        style: ['style.solo'],
        career: ['career.photo'],
      },
      careerOther: '',
      catalogRevision: revision,
    }))
    const authFailure = Object.assign(new Error('expired session'), {
      data: { error: { code: 'AUTH_FAILED', message: 'sanitized' }, requestId: 'auth-id' },
      statusCode: 401,
    })
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return success(catalog)
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/assessment/submit') throw authFailure
      throw new Error(`unexpected ${url}`)
    }))
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="assessment-submit"]').trigger('click')
    await flushPromises()

    expect(globalThis.navigateTo).toHaveBeenCalledWith('/login', { replace: true })
    expect(sessionStorage.getItem(storageKey)).not.toBeNull()
  })

  it('does not navigate or clear a changed draft when an obsolete submission succeeds late', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({
      step: 3,
      selections: {
        work: ['work.photo'],
        result: ['result.portfolio'],
        style: ['style.solo'],
        career: ['career.photo'],
      },
      careerOther: '',
      catalogRevision: revision,
    }))
    const pendingSubmission = deferred<unknown>()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return success(catalog)
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/assessment/submit') return pendingSubmission.promise
      throw new Error(`unexpected ${url}`)
    }))
    const { store, wrapper } = await mountPageWithStore()
    await flushPromises()

    await wrapper.get('[data-testid="assessment-submit"]').trigger('click')
    store.clear()
    expect(store.toggleOption('work.photo')).toBe(true)
    const changedDraft = sessionStorage.getItem(storageKey)
    pendingSubmission.resolve(success({ publicId }))
    await flushPromises()

    expect(globalThis.navigateTo).not.toHaveBeenCalledWith(`/result/${publicId}`)
    expect(sessionStorage.getItem(storageKey)).toBe(changedDraft)
  })

  it('logs out through the API, clears assessment storage, and replaces the route with login', async () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ catalogRevision: revision }))
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return success(catalog)
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/logout') return success({ ok: true })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="logout"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/student/logout', {
      headers: { 'x-photo-next-csrf': 'csrf-memory-token' },
      method: 'POST',
    })
    expect(sessionStorage.getItem(storageKey)).toBeNull()
    expect(globalThis.navigateTo).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('stays authenticated and preserves assessment state when logout fails', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/assessment/options') return success(catalog)
      if (url === '/api/events') return success({ accepted: true })
      if (url === '/api/student/logout') throw new Error('sensitive upstream detail')
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()
    await wrapper.get('[data-key="work.photo"]').trigger('click')
    const before = sessionStorage.getItem(storageKey)

    await wrapper.get('[data-testid="logout"]').trigger('click')
    await flushPromises()

    expect(globalThis.navigateTo).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="logout"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="logout"]').text()).toBe('로그아웃')
    expect(wrapper.get('[role="alert"]').text()).toBe('로그아웃하지 못했습니다. 다시 시도하세요.')
    expect(wrapper.text()).not.toContain('sensitive upstream detail')
    expect(sessionStorage.getItem(storageKey)).toBe(before)
  })
})
