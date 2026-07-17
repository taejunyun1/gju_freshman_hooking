import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeResultSnapshot, resultPublicId } from '../../fixtures/result'

type RouteUpdateHook = (to: { params: { publicId?: string | string[] } }) => void

const routerHooks = vi.hoisted(() => ({
  beforeUpdate: undefined as RouteUpdateHook | undefined,
}))

vi.mock('vue-router', () => ({
  onBeforeRouteUpdate: (callback: RouteUpdateHook) => {
    routerHooks.beforeUpdate = callback
  },
}))

const nextResultPublicId = '33333333-3333-4333-8333-333333333333'
const routeParam = ref<string | string[] | undefined>(resultPublicId)
const route = {
  get params() {
    return { publicId: routeParam.value }
  },
}

const ResultTimelineStub = {
  props: ['snapshot', 'resultPublicId'],
  template: '<div data-testid="loaded-result">{{ resultPublicId }} / {{ snapshot.completedAt }}</div>',
}

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const apiError = (code: string, privateDetail: string) => Object.assign(new Error(privateDetail), {
  data: { error: { code, message: privateDetail }, requestId: 'private-request-id' },
})

const mountPage = async () => {
  const { default: ResultPage } = await import('../../../app/pages/result/[publicId].vue')
  return mount(ResultPage, {
    global: {
      stubs: { NuxtLink: true, ResultTimeline: ResultTimelineStub },
    },
  })
}

describe('owned result page', () => {
  beforeEach(() => {
    routeParam.value = resultPublicId
    routerHooks.beforeUpdate = undefined
    vi.stubGlobal('useRoute', () => route)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps learning, faculty, and career ahead of supporting resource evidence', () => {
    const source = readFileSync('app/pages/result/[publicId].vue', 'utf8')
    expect(source.indexOf('<LearningPath')).toBeLessThan(source.indexOf('<CapabilityEvidence'))
    expect(source.indexOf('<FacultyRecommendation')).toBeLessThan(source.indexOf('<CapabilityEvidence'))
    expect(source.indexOf('<CareerNarrative')).toBeLessThan(source.indexOf('<CapabilityEvidence'))
  })

  it('loads the owned result by route ID and keeps a layout-stable skeleton while pending', async () => {
    const pending = deferred<unknown>()
    const fetch = vi.fn().mockReturnValue(pending.promise)
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    expect(fetch).toHaveBeenCalledWith(`/api/result/${resultPublicId}`)
    expect(wrapper.get('[data-testid="result-skeleton"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.findAll('[data-skeleton-section]')).toHaveLength(9)

    pending.resolve({ data: makeResultSnapshot(), requestId: 'request-id' })
    await flushPromises()

    expect(wrapper.find('[data-testid="result-skeleton"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="loaded-result"]').text()).toContain(resultPublicId)
  })

  it.each([
    ['missing result', 'row 222 was missing'],
    ['foreign result', 'prospect 99 owns this result'],
  ])('uses the exact shared 404 copy without leaking detail for a %s', async (_case, detail) => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(apiError('RESULT_NOT_FOUND', detail)))
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe('결과를 찾을 수 없습니다.')
    expect(wrapper.text()).not.toContain(detail)
    expect(wrapper.text()).not.toContain('private-request-id')
    expect(wrapper.find('[data-testid="result-retry"]').exists()).toBe(false)
  })

  it('shows a generic retryable error and recovers without exposing backend detail', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(apiError('INTERNAL_ERROR', 'db.internal.local snapshot row 701'))
      .mockResolvedValueOnce({ data: makeResultSnapshot(), requestId: 'request-id' })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('결과를 불러오지 못했습니다')
    expect(wrapper.text()).not.toMatch(/db\.internal\.local|snapshot row 701/u)

    await wrapper.get('[data-testid="result-retry"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="loaded-result"]').text()).toContain(resultPublicId)
  })

  it('loads a changed route ID and ignores the previous request when it resolves late', async () => {
    const firstRequest = deferred<unknown>()
    const secondRequest = deferred<unknown>()
    const fetch = vi.fn((url: string) => {
      if (url === `/api/result/${resultPublicId}`) return firstRequest.promise
      if (url === `/api/result/${nextResultPublicId}`) return secondRequest.promise
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    routeParam.value = nextResultPublicId
    expect(routerHooks.beforeUpdate).toBeTypeOf('function')
    routerHooks.beforeUpdate?.({ params: { publicId: nextResultPublicId } })
    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(fetch).toHaveBeenNthCalledWith(2, `/api/result/${nextResultPublicId}`)
    expect(wrapper.get('[data-testid="result-skeleton"]').attributes('aria-busy')).toBe('true')

    const nextSnapshot = {
      ...makeResultSnapshot(),
      completedAt: '2026-07-15T12:45:00+09:00',
    }
    secondRequest.resolve({ data: nextSnapshot, requestId: 'second-request-id' })
    await secondRequest.promise
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="loaded-result"]').text()).toContain(
      `${nextResultPublicId} / ${nextSnapshot.completedAt}`,
    )

    firstRequest.resolve({ data: makeResultSnapshot(), requestId: 'first-request-id' })
    await flushPromises()

    expect(wrapper.get('[data-testid="loaded-result"]').text()).toContain(
      `${nextResultPublicId} / ${nextSnapshot.completedAt}`,
    )
  })
})
