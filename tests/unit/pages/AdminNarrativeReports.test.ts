import { readFileSync } from 'node:fs'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAdminSessionStore } from '../../../app/stores/admin-session'
import type {
  AdminNarrativeReportList,
} from '../../../shared/schemas/admin-narrative-reports'

const report = {
  id: 7,
  category: 'unsafe',
  priority: 'urgent',
  createdAt: '2026-07-16T01:30:00.123456Z',
  updatedAt: '2026-07-16T01:30:00.123456Z',
  status: 'open',
  assessmentPublicId: '22222222-2222-4222-8222-222222222222',
  resultPath: '/api/admin/narrative-reports/7/result',
} as const

const list = (overrides: Partial<AdminNarrativeReportList> = {}): AdminNarrativeReportList => ({
  items: [report],
  nextCursor: 'next-cursor',
  ...overrides,
})

const envelope = <Value,>(data: Value) => ({ data, requestId: 'trace-id' })
const wrappers: VueWrapper[] = []

const mountPage = async () => {
  const { default: Page } = await import('../../../app/pages/admin/narrative-reports.vue')
  const wrapper = mount(Page, {
    attachTo: document.body,
    global: {
      stubs: {
        AppButton: {
          props: ['loading'],
          template: '<button type="button" :disabled="loading" v-bind="$attrs"><slot /></button>',
        },
        AppState: {
          props: ['variant', 'message'],
          template: '<div :data-state="variant">{{ message }}</div>',
        },
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('administrator narrative report queue page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'short-lived-access-token',
      authenticatedAt: '2026-07-16T01:00:00.000Z',
      expiresAt: '2099-07-16T09:00:00.000Z',
      userId: 'admin-1',
    })
    vi.stubGlobal('definePageMeta', vi.fn())
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('loads the unsafe-first bounded queue without narrative or contact text', async () => {
    const fetch = vi.fn(async () => envelope(list()))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/narrative-reports', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      query: { limit: '20' },
    })
    expect(wrapper.get('h1').text()).toBe('AI 문장 신고')
    expect(wrapper.text()).toContain('안전 우선')
    expect(wrapper.get('[data-report-id="7"]').text()).toContain('#7')
    expect(wrapper.get('[data-report-id="7"]').text()).toContain('안전 문제')
    expect(wrapper.get('[data-report-id="7"]').text()).toContain('긴급')
    expect(wrapper.get('[data-report-id="7"]').text()).toContain('열림')
    expect(wrapper.get('[data-report-id="7"]').text()).toContain(report.assessmentPublicId)
    expect(wrapper.get('[data-result-link]').attributes('href')).toBe(report.resultPath)
    expect(wrapper.text()).not.toMatch(/학생 전화|학교명|닉네임|생성 문장/u)
  })

  it('loads and closes the immutable result detail through a separate authorized request', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(list()))
      .mockResolvedValueOnce(envelope({
        reportId: 7,
        assessmentPublicId: report.assessmentPublicId,
        selectedInterests: [
          { group: 'work', label: '예술사진 촬영' },
          { group: 'result', label: '전시 결과물' },
          { group: 'style', label: '개인 창작' },
          { group: 'career', label: '사진작가' },
        ],
        rankedTracks: ['art_photo', 'video', 'documentary', 'commercial'],
        learningCourseTitles: ['현대사진'],
        faculty: {
          primary: { name: '윤태준', title: '교수', expertise: '현대예술·예술사진·영상·AI·기술적 이미지' },
          specialists: [],
        },
        narrativeSentences: [
          '첫 번째 검증 문장입니다.',
          '두 번째 검증 문장입니다.',
          '세 번째 검증 문장입니다.',
          '네 번째 검증 문장입니다.',
        ],
      }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    const trigger = wrapper.get('[data-result-link]').element as HTMLElement
    trigger.focus()
    await wrapper.get('[data-result-link]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenNthCalledWith(2, report.resultPath, {
      headers: { Authorization: 'Bearer short-lived-access-token' },
    })
    expect(wrapper.get('[data-result-detail]').text()).toContain('첫 번째 검증 문장')
    expect(wrapper.get('[data-result-detail]').text()).toContain('네 번째 검증 문장')
    expect(wrapper.get('[data-result-detail]').text()).toContain('예술사진 촬영')
    expect(wrapper.get('[data-result-detail]').text()).toContain('현대사진')
    expect(wrapper.get('[data-result-detail]').text()).toContain('윤태준')
    expect(document.activeElement).toBe(wrapper.get('#result-review-title').element)
    await wrapper.get('[data-action="close-result"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-result-detail]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('shows a private retry state when the authorized result detail fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(list()))
      .mockRejectedValueOnce(new Error('private result failure'))
      .mockResolvedValueOnce(envelope({
        reportId: 7,
        assessmentPublicId: report.assessmentPublicId,
        selectedInterests: [
          { group: 'work', label: '예술사진 촬영' },
          { group: 'result', label: '전시 결과물' },
          { group: 'style', label: '개인 창작' },
          { group: 'career', label: '사진작가' },
        ],
        rankedTracks: ['art_photo', 'video', 'documentary', 'commercial'],
        learningCourseTitles: [],
        faculty: {
          primary: { name: '윤태준', title: '교수', expertise: '현대예술·예술사진·영상·AI·기술적 이미지' },
          specialists: [],
        },
        narrativeSentences: [
          '재시도 문장 1입니다.',
          '재시도 문장 2입니다.',
          '재시도 문장 3입니다.',
          '재시도 문장 4입니다.',
        ],
      }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-result-link]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-result-error]').text()).toContain('결과를 불러오지 못했습니다')
    expect(wrapper.get('[data-result-error]').attributes('role')).toBe('alert')
    expect(wrapper.get('[data-result-error]').attributes('aria-live')).toBe('assertive')
    expect(document.activeElement).toBe(wrapper.get('[data-action="retry-result"]').element)
    expect(wrapper.text()).not.toContain('private result failure')
    await wrapper.get('[data-action="retry-result"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-result-detail]').text()).toContain('재시도 문장 1')
  })

  it('keeps keyboard controls explicit and resolves with the exact optimistic timestamp', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(list()))
      .mockResolvedValueOnce(envelope({ ...report, status: 'resolved_unsafe' }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('select[name="resolution-7"]').setValue('resolved_unsafe')
    await wrapper.get('[data-action="resolve-7"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/narrative-reports/7/resolve', {
      method: 'POST',
      headers: { Authorization: 'Bearer short-lived-access-token' },
      body: {
        expectedUpdatedAt: report.updatedAt,
        resolution: 'resolved_unsafe',
      },
    })
    expect(wrapper.find('[data-report-id="7"]').exists()).toBe(false)
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('처리했습니다')
  })

  it('loads the same next cursor, retains current cards on failure, and retries', async () => {
    const second = { ...report, id: 8, priority: 'standard' as const, category: 'inaccurate' as const }
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(list()))
      .mockRejectedValueOnce(new Error('private pagination failure'))
      .mockResolvedValueOnce(envelope(list({ items: [second], nextCursor: null })))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-action="next-page"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-report-id="7"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('다음 신고를 불러오지 못했습니다')
    expect(wrapper.text()).not.toContain('private pagination failure')
    await wrapper.get('[data-action="retry-next-page"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenNthCalledWith(3, '/api/admin/narrative-reports', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      query: { cursor: 'next-cursor', limit: '20' },
    })
    expect(wrapper.findAll('[data-report-id]')).toHaveLength(2)
  })

  it('refreshes after a concurrent conflict and announces the stable current state', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(list()))
      .mockRejectedValueOnce({
        data: {
          error: {
            code: 'NARRATIVE_REPORT_CONFLICT',
            current: { ...report, status: 'resolved_copy' },
          },
        },
      })
      .mockResolvedValueOnce(envelope(list({ items: [], nextCursor: null })))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('select[name="resolution-7"]').setValue('resolved_copy')
    await wrapper.get('[data-action="resolve-7"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('다른 관리자가 먼저 처리')
    expect(wrapper.get('[data-state="empty"]').text()).toContain('열린 신고가 없습니다')
  })

  it('shows a visible bounded status region when resolution fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(list()))
      .mockRejectedValueOnce(new Error('private resolution failure'))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('[data-action="resolve-7"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-resolution-status]').attributes('aria-live')).toBe('polite')
    expect(wrapper.get('[data-resolution-status]').text()).toContain('처리하지 못했습니다')
    expect(wrapper.text()).not.toContain('private resolution failure')
  })

  it('shows actionable initial error and empty states', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('private load failure'))
      .mockResolvedValueOnce(envelope(list({ items: [], nextCursor: null })))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.get('[data-state="error"]').text()).toContain('다시 시도')
    expect(wrapper.text()).not.toContain('private load failure')
    await wrapper.get('[data-action="retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-state="empty"]').text()).toContain('열린 신고가 없습니다')
  })

  it('uses the actual content container for the desktop contact sheet without hiding focus', () => {
    const source = readFileSync('app/pages/admin/narrative-reports.vue', 'utf8')
    const layout = readFileSync('app/layouts/admin.vue', 'utf8')

    expect(source).toMatch(/\.report-queue\s*\{[^}]*grid-template-columns:\s*1fr/su)
    expect(source).toMatch(/container-type:\s*inline-size/u)
    expect(source).toMatch(/@container \(min-width: 70rem\)[\s\S]*?grid-template-columns:\s*5rem 7rem 9rem minmax\(13rem, 1fr\) minmax\(18rem, 1\.2fr\)/u)
    expect(source).not.toMatch(/@media \(min-width: 54rem\)[\s\S]*?\.report-card/u)
    expect(source).toMatch(/:focus-visible/u)
    expect(source).toMatch(/min-height:\s*var\(--touch-target\)/u)
    expect(layout).toContain('to="/admin/narrative-reports"')
    expect(layout).toContain('AI 문장 신고')
  })
})
