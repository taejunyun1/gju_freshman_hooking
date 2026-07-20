import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdminSessionStore } from '../../../app/stores/admin-session'
import type { AdminCounselingQueue } from '../../../shared/schemas/counseling'

const item = {
  id: '11111111-1111-4111-8111-111111111111',
  assessmentPublicId: '22222222-2222-4222-8222-222222222222',
  primaryTrack: 'art_photo',
  secondaryTrack: 'video',
  selectedWorkLabels: ['전시 프로젝트'],
  selectedCareerLabels: ['사진작가'],
  nickname: '빛의기록27',
  maskedPhone: '010-****-5678',
  schoolName: '광주고등학교',
  applicantStage: 'high3',
  region: 'gwangju',
  contactMethod: 'phone',
  availability: 'weekday_afternoon',
  consentedAt: '2026-07-15T01:00:00.000Z',
  createdAt: '2026-07-15T01:00:00.000Z',
  updatedAt: '2026-07-15T01:00:00.000Z',
  assignedAt: null,
  contactedAt: null,
  completedAt: null,
  closedAt: null,
  status: 'new',
  version: 0,
  assignedFaculty: null,
  recommendations: [
    { id: 11, name: '윤태준', title: '교수', role: 'primary', rank: 1 },
    { id: 12, name: '조대연', title: '교수', role: 'backup', rank: 1 },
  ],
} as const

const queue = (overrides: Partial<AdminCounselingQueue> = {}): AdminCounselingQueue => ({
  faculty: [
    { id: 11, name: '윤태준', title: '교수' },
    { id: 12, name: '조대연', title: '교수' },
  ],
  items: [item],
  nextCursor: 'next-cursor',
  ...overrides,
})

const QueueStub = {
  props: ['items', 'faculty'],
  emits: ['refresh'],
  template: '<div data-testid="queue">{{ items.map((item) => item.nickname).join(",") }}|{{ faculty.map((item) => item.name).join(",") }}<button data-refresh @click="$emit(\'refresh\')">refresh</button></div>',
}

const AppStateStub = {
  props: ['variant', 'message'],
  template: '<div :data-state="variant">{{ message }}</div>',
}

const envelope = (data: AdminCounselingQueue) => ({ data, requestId: 'trace-id' })
const apiFailure = (code: string, requestId = 'counseling-req-17') => ({
  data: { error: { code, message: 'private database detail' }, requestId },
})

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

const wrappers: VueWrapper[] = []

const mountPage = async () => {
  const { default: Page } = await import('../../../app/pages/admin/counseling.vue')
  const wrapper = mount(Page, { global: { stubs: { CounselingQueue: QueueStub, AppState: AppStateStub } } })
  wrappers.push(wrapper)
  return wrapper
}

describe('administrator counseling page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'short-lived-access-token',
      authenticatedAt: '2026-07-15T01:00:00.000Z',
      expiresAt: '2099-07-15T09:00:00.000Z',
      userId: 'admin-1',
    })
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('navigateTo', vi.fn())
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('loads a bounded queue with authorization and uses API faculty options', async () => {
    const fetch = vi.fn(async () => envelope(queue()))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/counseling', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      query: { limit: '20' },
    })
    expect(wrapper.get('[data-testid="queue"]').text()).toContain('빛의기록27|윤태준,조대연')
    expect(wrapper.findAll('select[name="assignedFacultyId"] option').map(option => option.text())).toContain('윤태준 교수')
  })

  it('adds cursor results and resets the cursor and records when a filter changes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(queue()))
      .mockResolvedValueOnce(envelope(queue({ items: [{ ...item, id: '33333333-3333-4333-8333-333333333333', nickname: '빛의기록28' }], nextCursor: null })))
      .mockResolvedValueOnce(envelope(queue({ items: [{ ...item, nickname: '필터된학생' }], nextCursor: null })))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('button[data-action="next-page"]').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/counseling', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      query: { cursor: 'next-cursor', limit: '20' },
    })
    expect(wrapper.get('[data-testid="queue"]').text()).toContain('빛의기록27,빛의기록28')

    await wrapper.get('select[name="status"]').setValue('assigned')
    await flushPromises()
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/admin/counseling', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      query: { limit: '20', status: 'assigned' },
    })
    expect(wrapper.get('[data-testid="queue"]').text()).toContain('필터된학생')
    expect(wrapper.get('[data-testid="queue"]').text()).not.toContain('빛의기록28')
  })

  it('keeps existing records visible when pagination fails and retries only the same cursor page', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(queue()))
      .mockRejectedValueOnce(new Error('private pagination detail'))
      .mockResolvedValueOnce(envelope(queue({
        items: [{ ...item, id: '33333333-3333-4333-8333-333333333333', nickname: '빛의기록28' }],
        nextCursor: null,
      })))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('button[data-action="next-page"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="queue"]').text()).toContain('빛의기록27')
    expect(wrapper.text()).toContain('서버가 상담 목록을 처리하지 못했습니다')
    expect(wrapper.text()).not.toContain('private pagination detail')
    await wrapper.get('button[data-action="retry-next-page"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenNthCalledWith(3, '/api/admin/counseling', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      query: { cursor: 'next-cursor', limit: '20' },
    })
    expect(wrapper.get('[data-testid="queue"]').text()).toContain('빛의기록27,빛의기록28')
  })

  it('clears a stale pagination error when filters start a fresh queue', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(queue()))
      .mockRejectedValueOnce(new Error('private pagination detail'))
      .mockResolvedValueOnce(envelope(queue({ items: [{ ...item, nickname: '필터된학생' }], nextCursor: null })))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('button[data-action="next-page"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('서버가 상담 목록을 처리하지 못했습니다')

    await wrapper.get('select[name="status"]').setValue('assigned')
    await flushPromises()

    expect(wrapper.get('[data-testid="queue"]').text()).toContain('필터된학생')
    expect(wrapper.text()).not.toContain('다음 요청을 불러오지 못했습니다')
  })

  it('sends track, faculty, and date bounds without a campaign filter and refreshes without cursor', async () => {
    const fetch = vi.fn(async () => envelope(queue({ nextCursor: null })))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('select[name="primaryTrack"]').setValue('documentary')
    await flushPromises()
    expect(wrapper.find('[name="campaignId"]').exists()).toBe(false)
    await wrapper.get('select[name="assignedFacultyId"]').setValue('12')
    await wrapper.get('input[name="createdFrom"]').setValue('2026-07-01')
    await wrapper.get('input[name="createdTo"]').setValue('2026-07-15')
    await wrapper.get('button[data-action="apply-filters"]').trigger('click')
    await flushPromises()

    const lastOptions = fetch.mock.calls.at(-1)?.[1] as { query: Record<string, string> }
    expect(lastOptions.query).toMatchObject({
      assignedFacultyId: '12',
      createdFrom: expect.stringMatching(/^2026-06-30T15:00:00\.000Z$/u),
      createdTo: expect.stringMatching(/^2026-07-15T14:59:59\.999Z$/u),
      limit: '20',
      primaryTrack: 'documentary',
    })
    expect(lastOptions.query).not.toHaveProperty('cursor')
    expect(lastOptions.query).not.toHaveProperty('campaignId')

    await wrapper.get('[data-refresh]').trigger('click')
    await flushPromises()
    expect((fetch.mock.calls.at(-1)?.[1] as { query: Record<string, string> }).query).not.toHaveProperty('cursor')
  })

  it('keeps the queue mounted while a component-triggered background refresh is pending', async () => {
    const refresh = deferred<ReturnType<typeof envelope>>()
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(queue()))
      .mockImplementationOnce(() => refresh.promise)
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-refresh]').trigger('click')

    expect(wrapper.get('[data-testid="queue"]').text()).toContain('빛의기록27')
    expect(wrapper.find('[data-state="loading"]').exists()).toBe(false)
    refresh.resolve(envelope(queue({ items: [{ ...item, nickname: '최신학생' }], nextCursor: null })))
    await flushPromises()
    expect(wrapper.get('[data-testid="queue"]').text()).toContain('최신학생')
  })

  it('shows actionable error and empty states and allows retry', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('private network detail'))
      .mockResolvedValueOnce(envelope(queue({ items: [], nextCursor: null })))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.get('[data-state="error"]').text()).toContain('서버가 상담 목록을 처리하지 못했습니다')
    expect(wrapper.text()).toContain('잠시 후 다시 시도')
    expect(wrapper.text()).not.toContain('private network detail')
    await wrapper.get('button[data-action="retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-state="empty"]').text()).toContain('상담 요청이 없습니다')
  })

  it('explains an expired administrator session without exposing server detail and opens login on demand', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(apiFailure('ADMIN_REQUIRED'))
    const navigateTo = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigateTo)
    const wrapper = await mountPage()
    await flushPromises()

    const alert = wrapper.get('[data-counseling-load-failure][role="alert"]')
    expect(alert.text()).toContain('로그인 세션이 만료')
    expect(alert.text()).toContain('다시 로그인한 뒤 작업을 시작')
    expect(alert.text()).toContain('요청 번호: counseling-req-17')
    expect(alert.attributes('aria-live')).toBe('assertive')
    expect(alert.text()).not.toContain('private database detail')
    expect(wrapper.find('[data-action="retry"]').exists()).toBe(false)
    await wrapper.get('[data-action="login"]').trigger('click')
    expect(navigateTo).toHaveBeenCalledWith({ path: '/admin/login', query: { redirect: '/admin/counseling' } }, { replace: true })
  })

  it('ignores a queue response that resolves after unmount', async () => {
    const response = deferred<ReturnType<typeof envelope>>()
    vi.stubGlobal('$fetch', vi.fn(() => response.promise))
    const wrapper = await mountPage()
    const state = wrapper.vm.$.setupState as { items: unknown[] }

    wrapper.unmount()
    response.resolve(envelope(queue()))
    await flushPromises()

    expect(state.items).toEqual([])
  })
})
