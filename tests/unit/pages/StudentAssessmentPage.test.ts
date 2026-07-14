import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const revision = `sha256:${'a'.repeat(64)}`
const storageKey = 'photo_next_assessment_v1'
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
    sessionStorage.clear()
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

  it('disables next below the minimum, then advances and returns through four groups', async () => {
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

    await wrapper.get('[data-testid="assessment-previous"]').trigger('click')
    expect(wrapper.text()).toContain('01 / 04')
  })

  it('validates the final step with memory-only CSRF and exposes a temporary primary track label', async () => {
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
      if (url === '/api/student/assessment/validate') {
        return success({
          trackScores: { documentary: 9, art_photo: 4, commercial: 2, video: 1 },
          rankedTracks: ['documentary', 'art_photo', 'commercial', 'video'],
          interestVector: { field: 2 },
        })
      }
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="assessment-validate"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/student/assessment/validate', expect.objectContaining({
      headers: { 'x-photo-next-csrf': 'csrf-memory-token' },
      method: 'POST',
    }))
    expect(wrapper.get('[data-testid="validated-primary-track"]').text()).toContain('다큐멘터리')
    const persisted = sessionStorage.getItem(storageKey) ?? ''
    expect(persisted).not.toContain('csrf-memory-token')
    expect(persisted).not.toContain('trackScores')
  })

  it('shows a distinct stale-catalog review state after validation reloads the options', async () => {
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
      if (url === '/api/student/assessment/validate') throw stale
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-testid="assessment-validate"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="assessment-stale"]').text()).toContain('선택을 다시 확인')
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
