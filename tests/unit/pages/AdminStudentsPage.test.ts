import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import StudentFilters from '../../../app/components/admin/StudentFilters.vue'
import { useAdminSessionStore } from '../../../app/stores/admin-session'
import type { AdminStudentFilters, AdminStudentsList } from '../../../shared/schemas/admin-students'

const student = {
  id: 42,
  nickname: '선명한프레임42',
  phone: '010-****-5678',
  schoolName: '광주고등학교',
  applicantStage: 'high3',
  region: 'gwangju',
  status: 'active',
  lastActiveAt: '2026-07-15T01:00:00.000Z',
  createdAt: '2026-07-01T01:00:00.000Z',
} as const

const envelope = (data: AdminStudentsList) => ({ data, requestId: 'trace-id' })

const DataTableStub = {
  name: 'DataTable',
  props: ['items', 'listUrl'],
  template: '<div data-testid="student-table" :data-list-url="listUrl">{{ items.map((item) => item.nickname).join(",") }}</div>',
}

const AppStateStub = {
  props: ['variant', 'message'],
  template: '<div :data-state="variant">{{ message }}</div>',
}

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
}

const wrappers: VueWrapper[] = []
const route = reactive({
  fullPath: '/admin/students',
  params: {} as Record<string, string>,
  query: {} as Record<string, string>,
})
const replace = vi.fn(async (target: { path: string, query: Record<string, string> }) => {
  route.query = { ...target.query }
  const search = new URLSearchParams(target.query).toString()
  route.fullPath = `${target.path}${search ? `?${search}` : ''}`
})

const mountPage = async () => {
  const { default: Page } = await import('../../../app/pages/admin/students/index.vue')
  const wrapper = mount(Page, {
    global: {
      stubs: {
        AppState: AppStateStub,
        DataTable: DataTableStub,
        NuxtLink: NuxtLinkStub,
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('administrator students page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'short-lived-access-token',
      authenticatedAt: '2026-07-15T01:00:00.000Z',
      expiresAt: '2099-07-15T09:00:00.000Z',
      userId: 'admin-1',
    })
    route.query = {}
    route.fullPath = '/admin/students'
    replace.mockClear()
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace }))
    vi.stubGlobal('navigateTo', vi.fn())
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('exposes the individual applicant registration control', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => envelope({ items: [], nextCursor: null })))
    const wrapper = await mountPage()
    await flushPromises()
    expect(wrapper.get('[data-action="add-student"]').text()).toContain('학생 개별 등록')
  })

  it('uses the shareable URL as the only list query source and forwards only supported API fields', async () => {
    route.query = {
      query: '선명',
      stage: 'high3',
      region: 'gwangju',
      school: '광주고',
      track: 'art_photo',
      campaign: '9',
      counselingStatus: 'assigned',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      limit: '20',
      cursor: 'eyJpZCI6NDJ9',
      unknown: 'discard-me',
    }
    route.fullPath = '/admin/students?query=%EC%84%A0%EB%AA%85&stage=high3&region=gwangju&school=%EA%B4%91%EC%A3%BC%EA%B3%A0&track=art_photo&campaign=9&counselingStatus=assigned&dateFrom=2026-07-01&dateTo=2026-07-31&limit=20&cursor=eyJpZCI6NDJ9'
    const fetch = vi.fn(async () => envelope({ items: [student], nextCursor: 'next-page-cursor' }))
    vi.stubGlobal('$fetch', fetch)

    const wrapper = await mountPage()
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/students', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      query: {
        query: '선명',
        stage: 'high3',
        region: 'gwangju',
        school: '광주고',
        track: 'art_photo',
        campaign: '9',
        counselingStatus: 'assigned',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        limit: '20',
        cursor: 'eyJpZCI6NDJ9',
      },
    })
    expect(wrapper.get('[data-testid="student-table"]').attributes('data-list-url')).toBe(route.fullPath)
    expect(wrapper.get('[data-testid="student-table"]').text()).toContain('선명한프레임42')
  })

  it('replaces the URL without a stale cursor when filters change and builds a stable next-cursor link', async () => {
    route.query = { stage: 'high3', limit: '20' }
    route.fullPath = '/admin/students?stage=high3&limit=20'
    const fetch = vi.fn(async () => envelope({ items: [student], nextCursor: 'next-page-cursor' }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    const filters: AdminStudentFilters = {
      query: '프레임',
      stage: 'high3',
      region: '',
      school: '',
      track: 'commercial',
      campaign: '',
      counselingStatus: '',
      dateFrom: '',
      dateTo: '',
    }
    wrapper.getComponent(StudentFilters).vm.$emit('apply', filters)
    await flushPromises()

    expect(replace).toHaveBeenCalledWith({
      path: '/admin/students',
      query: { query: '프레임', stage: 'high3', track: 'commercial', limit: '20' },
    })
    expect((fetch.mock.calls.at(-1)?.[1] as { query: Record<string, string> }).query).toEqual({
      query: '프레임',
      stage: 'high3',
      track: 'commercial',
      limit: '20',
    })

    const nextTarget = JSON.parse(wrapper.get('[data-action="next-page"]').attributes('data-to'))
    expect(nextTarget).toEqual({
      path: '/admin/students',
      query: {
        query: '프레임',
        stage: 'high3',
        track: 'commercial',
        limit: '20',
        cursor: 'next-page-cursor',
      },
    })
  })

  it('clears every filter through the URL and gives a recoverable private error without leaking details', async () => {
    route.query = { query: '선명', cursor: 'old-cursor', limit: '20' }
    route.fullPath = '/admin/students?query=%EC%84%A0%EB%AA%85&cursor=old-cursor&limit=20'
    const fetch = vi.fn().mockRejectedValueOnce(new Error('provider private detail'))
      .mockResolvedValueOnce(envelope({ items: [], nextCursor: null }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('학생 목록을 불러오지 못했습니다')
    expect(wrapper.text()).not.toContain('provider private detail')

    wrapper.getComponent(StudentFilters).vm.$emit('reset')
    await flushPromises()
    expect(replace).toHaveBeenCalledWith({ path: '/admin/students', query: { limit: '20' } })
    expect(wrapper.get('[data-state="empty"]').text()).toContain('조건에 맞는 학생이 없습니다')
  })

  it('posts an individual applicant with the current cycle and clears the one-time credential when its dialog closes', async () => {
    const fetch = vi.fn(async (url: string, options?: { method?: string }) => {
      if (url === '/api/admin/admission-cycles') return { data: [{ id: '11111111-1111-4111-8111-111111111111', year: 2027, status: 'current', rosterVersion: 2, passwordKeyVersion: 1, createdAt: '2026-07-17T00:00:00.000Z', archivedAt: null }], requestId: 'cycle-trace' }
      return url === '/api/admin/students' && options?.method !== 'POST'
        ? envelope({ items: [student], nextCursor: null })
        : { data: { id: 77, credential: { name: '홍 길동', phone: '01012345678', password: '5678AB' } }, requestId: 'add-trace' }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('button[data-action="add-student"]').trigger('click')
    await wrapper.get('input[name="name"]').setValue('홍 길동')
    await wrapper.get('input[name="phone"]').setValue('010-1234-5678')
    await wrapper.get('input[name="highSchool"]').setValue('광주고')
    await wrapper.get('select[name="grade"]').setValue('high3')
    expect(wrapper.find('input[name="cycleId"]').exists()).toBe(false)
    await wrapper.get('form[aria-label="학생 개별 등록"]').trigger('submit')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/students', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer short-lived-access-token' },
      body: {
        cycleId: '11111111-1111-4111-8111-111111111111',
        name: '홍 길동',
        phone: '010-1234-5678',
        highSchool: '광주고',
        grade: 'high3',
      },
    }))
    expect(wrapper.text()).toContain('5678AB')
    await wrapper.get('button[data-action="close-password-dialog"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('5678AB')
  })
})
