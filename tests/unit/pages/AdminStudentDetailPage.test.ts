import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAdminSessionStore } from '../../../app/stores/admin-session'
import type { AdminStudentDetail } from '../../../shared/schemas/admin-students'

const detail: AdminStudentDetail = {
  student: {
    id: 42,
    nickname: '선명한프레임42',
    phone: '010-****-5678',
    schoolName: '광주고등학교',
    applicantStage: 'high3',
    region: 'gwangju',
    status: 'active',
    lastActiveAt: '2026-07-15T01:00:00.000Z',
    createdAt: '2026-07-01T01:00:00.000Z',
  },
  recentResults: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      completedAt: '2026-07-15T01:00:00.000Z',
      campaignId: 9,
      primaryTrack: 'commercial',
      secondaryTrack: 'art_photo',
      trackScores: { documentary: 40, art_photo: 80, commercial: 90, video: 30 },
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      completedAt: '2026-07-14T01:00:00.000Z',
      campaignId: null,
      primaryTrack: 'art_photo',
      secondaryTrack: 'documentary',
      trackScores: { documentary: 65, art_photo: 88, commercial: 30, video: 40 },
    },
  ],
  counseling: [{
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'assigned',
    contactMethod: 'phone',
    availability: 'weekday_afternoon',
    inquiry: '입학 준비 포트폴리오가 궁금해요.',
    assignedFaculty: { id: 202, name: '윤태준', title: '교수' },
    createdAt: '2026-07-01T01:00:00.000Z',
  }],
}

const route = reactive({
  fullPath: '/admin/students/42?returnTo=%2Fadmin%2Fstudents%3Fstage%3Dhigh3%26cursor%3Dpage-two',
  params: { id: '42' } as Record<string, string>,
  query: { returnTo: '/admin/students?stage=high3&cursor=page-two' } as Record<string, string>,
})

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
}

const AppStateStub = {
  props: ['variant', 'message'],
  template: '<div :data-state="variant">{{ message }}</div>',
}

const wrappers: VueWrapper[] = []

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

const mountPage = async () => {
  const { default: Page } = await import('../../../app/pages/admin/students/[id].vue')
  const wrapper = mount(Page, {
    attachTo: document.body,
    global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('administrator student detail page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'short-lived-access-token',
      authenticatedAt: '2026-07-15T01:00:00.000Z',
      expiresAt: '2099-07-15T09:00:00.000Z',
      userId: 'admin-1',
    })
    route.params = { id: '42' }
    route.query = { returnTo: '/admin/students?stage=high3&cursor=page-two' }
    route.fullPath = '/admin/students/42?returnTo=%2Fadmin%2Fstudents%3Fstage%3Dhigh3%26cursor%3Dpage-two'
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', vi.fn())
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('loads exact student detail, keeps the masked phone, and preserves the safe list URL', async () => {
    const fetch = vi.fn(async () => ({ data: detail, requestId: 'trace-id' }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/students/42', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
    })
    expect(wrapper.get('[data-action="back-to-list"]').attributes('data-to')).toBe(
      JSON.stringify('/admin/students?stage=high3&cursor=page-two'),
    )
    expect(wrapper.text()).toContain('선명한프레임42')
    expect(wrapper.text()).toContain('010-****-5678')
    expect(wrapper.text()).not.toContain('01012345678')
    expect(wrapper.findAll('[data-result-row]')).toHaveLength(2)
    expect(wrapper.get('[data-result-row]').text()).toContain('광고사진')
    expect(wrapper.findAll('[data-counseling-row]')).toHaveLength(1)
    expect(wrapper.get('[data-counseling-row]').text()).toContain('윤태준 교수')
  })

  it('treats a reused route parameter as source of truth and ignores the previous student response', async () => {
    const first = deferred<{ data: AdminStudentDetail, requestId: string }>()
    const student43: AdminStudentDetail = {
      ...detail,
      student: { ...detail.student, id: 43, nickname: '선명한프레임43' },
    }
    const fetch = vi.fn((url: string) => url.endsWith('/42')
      ? first.promise
      : Promise.resolve({ data: student43, requestId: 'student-43-trace' }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await nextTick()

    route.params = { id: '43' }
    route.fullPath = '/admin/students/43'
    await nextTick()
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/students/43', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
    })
    expect(wrapper.text()).toContain('선명한프레임43')

    first.resolve({ data: detail, requestId: 'stale-student-42-trace' })
    await flushPromises()
    expect(wrapper.text()).toContain('선명한프레임43')
    expect(wrapper.text()).not.toContain('선명한프레임42')
  })

  it('reveals a phone only inside the dialog and automatically destroys it after 60 seconds', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async (url: string) => url.endsWith('/reveal-phone')
      ? { data: { phone: '01012345678' }, requestId: 'reveal-trace' }
      : { data: detail, requestId: 'detail-trace' })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    const opener = wrapper.get('button[data-action="open-phone"]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    await flushPromises()
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('010-****-5678')
    expect(dialog.text()).not.toContain('01012345678')

    await dialog.get('button[data-action="reveal-phone"]').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith('/api/admin/students/42/reveal-phone', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'POST',
    })
    expect(dialog.text()).toContain('01012345678')
    expect(wrapper.find('[role="dialog"]').text()).toContain('01012345678')
    expect(sessionStorage.getItem('01012345678')).toBeNull()
    expect(sessionStorage.getItem('photo_next_admin_session_v1')).not.toContain('01012345678')

    await vi.advanceTimersByTimeAsync(60_000)
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).not.toContain('01012345678')
    expect(wrapper.get('[role="dialog"]').text()).toContain('표시 시간이 종료됐습니다')
  })

  it('closes on Escape, destroys the phone, and restores focus to the opening control', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/reveal-phone')
      ? { data: { phone: '01012345678' }, requestId: 'reveal-trace' }
      : { data: detail, requestId: 'detail-trace' })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    const opener = wrapper.get('button[data-action="open-phone"]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    await flushPromises()
    await wrapper.get('button[data-action="reveal-phone"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).toContain('01012345678')

    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('01012345678')
    expect(document.activeElement).toBe(opener.element)
  })

  it.each(['REAUTH_REQUIRED', 'ADMIN_REQUIRED'])(
    'routes %s failures to login with a safe local redirect and clears the stale session',
    async (errorCode) => {
    route.query = { returnTo: '//evil.example/steal' }
    route.fullPath = '/admin/students/42?returnTo=%2F%2Fevil.example%2Fsteal'
    const navigate = vi.mocked(navigateTo)
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/reveal-phone')) {
        throw { data: { error: { code: errorCode, message: 'private provider detail' } } }
      }
      return { data: detail, requestId: 'detail-trace' }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.get('[data-action="back-to-list"]').attributes('data-to')).toBe(JSON.stringify('/admin/students'))
    await wrapper.get('button[data-action="open-phone"]').trigger('click')
    await flushPromises()
    await wrapper.get('button[data-action="reveal-phone"]').trigger('click')
    await flushPromises()

    expect(useAdminSessionStore().session).toBeNull()
    expect(navigate).toHaveBeenCalledWith({
      path: '/admin/login',
      query: { redirect: '/admin/students/42?returnTo=%2F%2Fevil.example%2Fsteal' },
    }, { replace: true })
    expect(wrapper.text()).not.toContain('private provider detail')
    },
  )
})
