import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const assessmentPublicId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const nextAssessmentPublicId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const routeQuery = ref<Record<string, string>>({})
const route = {
  get query() { return routeQuery.value },
}

const NuxtLinkStub = {
  props: ['to'],
  template: '<a><slot /></a>',
}
const CounselingFormStub = {
  props: ['assessmentPublicId'],
  template: '<form data-testid="counseling-form">{{ assessmentPublicId }}</form>',
}
const CounselingStatusStub = {
  props: {
    request: { type: Object, required: true },
    compact: { type: Boolean, default: false },
  },
  template: '<div data-testid="counseling-status" :data-compact="compact">{{ request.status }}</div>',
}

const terminalRequest = (status: 'completed' | 'closed') => ({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  assessmentPublicId,
  status,
  contactMethod: 'phone',
  availability: 'weekday_afternoon',
  inquiry: null,
  consentedAt: '2026-07-15T01:00:00.000Z',
  assignedAt: status === 'completed' ? '2026-07-15T02:00:00.000Z' : null,
  contactedAt: status === 'completed' ? '2026-07-15T03:00:00.000Z' : null,
  completedAt: status === 'completed' ? '2026-07-15T04:00:00.000Z' : null,
  closedAt: status === 'closed' ? '2026-07-15T04:00:00.000Z' : null,
  version: 3,
  createdAt: '2026-07-15T01:00:00.000Z',
  updatedAt: '2026-07-15T04:00:00.000Z',
  assignedFaculty: status === 'completed'
    ? { name: '윤태준', title: '교수', expertise: '현대예술·영상촬영' }
    : null,
  recommendations: [
    { name: '윤태준', title: '교수', expertise: '현대예술·영상촬영', reason: '주 관심 연결', role: 'primary', rank: 1 },
    { name: '조대연', title: '교수', expertise: '다큐멘터리', reason: '보완 연결', role: 'backup', rank: 1 },
  ],
})

const envelope = (data: unknown) => ({ data, requestId: 'request-id' })
const apiError = (code: string) => Object.assign(new Error(code), {
  data: { error: { code, message: 'private detail' }, requestId: 'private-id' },
})
const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

const mountedWrappers: VueWrapper[] = []

const mountPage = async (useRealForm = false) => {
  const { default: CounselingPage } = await import('../../../app/pages/counseling.vue')
  const wrapper = mount(CounselingPage, {
    global: {
      stubs: {
        NuxtLink: NuxtLinkStub,
        ...(!useRealForm && { CounselingForm: CounselingFormStub }),
        CounselingStatus: CounselingStatusStub,
      },
    },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

describe('student counseling page', () => {
  beforeEach(() => {
    routeQuery.value = {}
    vi.stubGlobal('useRoute', () => route)
  })

  afterEach(() => {
    while (mountedWrappers.length > 0) mountedWrappers.pop()?.unmount()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['completed', 'closed'] as const)(
    'offers a fresh form for a valid result while keeping the prior %s request available',
    async (status) => {
      routeQuery.value = { assessmentPublicId }
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(envelope(terminalRequest(status))))
      const wrapper = await mountPage()
      await flushPromises()

      expect(wrapper.get('[data-testid="counseling-form"]').text()).toContain(assessmentPublicId)
      expect(wrapper.get('[data-testid="prior-counseling"]').text()).toContain('이전 상담')
      expect(wrapper.getComponent(CounselingStatusStub).props('compact')).toBe(true)
    },
  )

  it.each(['completed', 'closed'] as const)(
    'shows the latest terminal %s status when no result query is present',
    async (status) => {
      vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(envelope(terminalRequest(status))))
      const wrapper = await mountPage()
      await flushPromises()

      expect(wrapper.find('[data-testid="counseling-form"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="counseling-status"]').text()).toBe(status)
    },
  )

  it('directs a student with no request and no result query to choose a result', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(envelope(null)))
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('상담에 연결할 결과를 먼저 선택해 주세요.')
    expect(wrapper.text()).toContain('최근 결과에서 선택하기')
    expect(wrapper.find('[data-testid="counseling-form"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="counseling-status"]').exists()).toBe(false)
  })

  it('handles null, authentication, generic error, and a successful retry with accurate copy', async () => {
    routeQuery.value = { assessmentPublicId }
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(null))
      .mockRejectedValueOnce(apiError('AUTH_FAILED'))
      .mockRejectedValueOnce(apiError('INTERNAL_ERROR'))
      .mockResolvedValueOnce(envelope(null))
    vi.stubGlobal('$fetch', fetch)

    const formPage = await mountPage()
    await flushPromises()
    expect(formPage.find('[data-testid="counseling-form"]').exists()).toBe(true)
    formPage.unmount()

    const authPage = await mountPage()
    await flushPromises()
    expect(authPage.text()).toContain('로그인 정보가 만료')
    authPage.unmount()

    const errorPage = await mountPage()
    await flushPromises()
    expect(errorPage.text()).toContain('상담 신청 상태를 불러오지 못했습니다')
    expect(errorPage.text()).not.toContain('입력한 내용은 변경되지 않았습니다')
    await errorPage.get('button').trigger('click')
    await flushPromises()
    expect(errorPage.find('[data-testid="counseling-form"]').exists()).toBe(true)
  })

  it('ignores a stale GET after the assessment query changes', async () => {
    routeQuery.value = { assessmentPublicId }
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const fetch = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    routeQuery.value = { assessmentPublicId: nextAssessmentPublicId }
    await wrapper.vm.$nextTick()
    second.resolve(envelope(null))
    await flushPromises()
    expect(wrapper.get('[data-testid="counseling-form"]').text()).toContain(nextAssessmentPublicId)

    first.resolve(envelope(terminalRequest('completed')))
    await flushPromises()
    expect(wrapper.get('[data-testid="counseling-form"]').text()).toContain(nextAssessmentPublicId)
    expect(wrapper.find('[data-testid="prior-counseling"]').exists()).toBe(false)
  })

  it('keeps the real form mounted with its draft after an authenticated GET then expired POST', async () => {
    routeQuery.value = { assessmentPublicId }
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(null))
      .mockRejectedValueOnce(apiError('AUTH_FAILED'))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage(true)
    await flushPromises()
    await wrapper.get('textarea[name="inquiry"]').setValue('초안 유지')
    await wrapper.get('input[name="consent"]').setValue(true)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('form').exists()).toBe(true)
    expect((wrapper.get('textarea[name="inquiry"]').element as HTMLTextAreaElement).value).toBe('초안 유지')
    expect(wrapper.text()).toContain('로그인 정보가 만료')
  })
})
