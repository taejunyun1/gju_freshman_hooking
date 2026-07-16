import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAdminSessionStore } from '../../../app/stores/admin-session'
import type { AdminFacultyListItem } from '../../../shared/schemas/admin-faculty'

const updatedAt = '2026-07-15T01:00:00.000Z'
const faculty: AdminFacultyListItem = {
  id: 11,
  name: '윤태준',
  title: '조교수',
  employmentType: 'full_time',
  consultationRole: 'primary',
  status: 'active',
  weeklyCapacity: 8,
  openAssignedCount: 3,
  lastVerifiedAt: '2026-07-14T03:00:00.000Z',
  primaryTags: [
    { key: 'art_photo', label: '예술사진', category: 'track', weight: 3, isPrimary: true },
    { key: 'ai', label: 'AI', category: 'activity', weight: 2, isPrimary: true },
  ],
  updatedAt,
}
const specialist: AdminFacultyListItem = {
  ...faculty,
  id: 12,
  name: '김소연',
  title: '겸임교수',
  employmentType: 'practitioner',
  consultationRole: 'specialist',
  status: 'draft',
  weeklyCapacity: 4,
  openAssignedCount: 1,
  lastVerifiedAt: null,
  primaryTags: [],
  updatedAt: '2026-07-16T01:00:00.000Z',
}

const AppStateStub = {
  props: ['variant', 'message'],
  template: '<div :data-state="variant" :role="variant === \'error\' ? \'alert\' : undefined">{{ message }}</div>',
}
const NuxtLinkStub = {
  props: ['to'],
  template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
}
const wrappers: VueWrapper[] = []

const setSession = () => useAdminSessionStore().setVerifiedSession({
  accessToken: 'admin-token',
  authenticatedAt: updatedAt,
  expiresAt: '2099-07-15T01:00:00.000Z',
  userId: 'admin-1',
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('admin faculty list page', () => {
  const route = reactive({
    fullPath: '/admin/faculty',
    params: {} as Record<string, string>,
    query: {} as Record<string, unknown>,
  })
  const replace = vi.fn(async (target: { path: string, query: Record<string, string> }) => {
    route.query = { ...target.query }
    const search = new URLSearchParams(target.query).toString()
    route.fullPath = `${target.path}${search ? `?${search}` : ''}`
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    setSession()
    route.query = {}
    route.fullPath = '/admin/faculty'
    replace.mockClear()
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace }))
    vi.stubGlobal('navigateTo', vi.fn())
  })

  afterEach(() => {
    while (wrappers.length) wrappers.pop()?.unmount()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('provides the /admin/faculty route page', () => {
    expect(existsSync(resolve('app/pages/admin/faculty/index.vue'))).toBe(true)
  })

  it('uses the exact supported URL filters and renders desktop and labeled mobile list semantics', async () => {
    route.query = {
      query: '영상', employmentType: 'full_time', consultationRole: 'primary', status: 'active',
      tag: 'art_photo', limit: '20', cursor: 'page-one', unknown: 'discard',
    }
    route.fullPath = '/admin/faculty?query=%EC%98%81%EC%83%81&employmentType=full_time&consultationRole=primary&status=active&tag=art_photo&limit=20&cursor=page-one'
    const fetch = vi.fn(async () => ({
      data: { items: [faculty], nextCursor: 'page-two' }, requestId: 'trace',
    }))
    vi.stubGlobal('$fetch', fetch)
    const { default: Page } = await import('../../../app/pages/admin/faculty/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/faculty', {
      headers: { Authorization: 'Bearer admin-token' },
      query: {
        query: '영상', employmentType: 'full_time', consultationRole: 'primary', status: 'active',
        tag: 'art_photo', limit: '20', cursor: 'page-one',
      },
    })
    expect(wrapper.get('table').attributes('aria-label')).toBe('교수진 운영 목록')
    expect(wrapper.findAll('[data-faculty-card]')).toHaveLength(1)
    expect(wrapper.get('[data-faculty-card]').findAll('dt').map(label => label.text())).toEqual([
      '직위', '고용 형태', '상담 역할', '상태', '배정 여유', '기본 태그', '최근 검증', '수정',
    ])
    expect(wrapper.text()).toContain('3 / 8')
    expect(wrapper.text()).toContain('예술사진')
    const detailTargets = wrapper.findAll('a[data-faculty-link]').map(link => (
      JSON.parse(link.attributes('data-to'))
    ))
    expect(detailTargets).toEqual([
      { path: '/admin/faculty/11', query: { returnTo: route.fullPath } },
      { path: '/admin/faculty/11', query: { returnTo: route.fullPath } },
    ])
    expect(JSON.parse(wrapper.get('a[data-next-page]').attributes('data-to'))).toEqual({
      path: '/admin/faculty',
      query: {
        query: '영상', employmentType: 'full_time', consultationRole: 'primary', status: 'active',
        tag: 'art_photo', limit: '20', cursor: 'page-two',
      },
    })
  })

  it('allowlists every query value and falls back from an unsafe list return URL', async () => {
    route.query = {
      query: ['array'], employmentType: 'tenured', consultationRole: 'coach', status: 'live',
      tag: '../art', limit: '100', cursor: 'bad\u0007cursor', unknown: 'discard',
    }
    route.fullPath = 'https://evil.invalid/admin/faculty?status=active'
    const fetch = vi.fn(async () => ({ data: { items: [faculty], nextCursor: null } }))
    vi.stubGlobal('$fetch', fetch)
    const { default: Page } = await import('../../../app/pages/admin/faculty/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/faculty', {
      headers: { Authorization: 'Bearer admin-token' }, query: { limit: '20' },
    })
    expect(wrapper.findAll('a[data-faculty-link]').map(link => (
      JSON.parse(link.attributes('data-to')).query.returnTo
    ))).toEqual(['/admin/faculty', '/admin/faculty'])
  })

  it.each([
    ['/admin/faculty-other?status=active', 'a sibling path'],
    [`/admin/faculty?query=${'x'.repeat(2_001)}`, 'an overlong path'],
    ['/admin/faculty?query=bad\u0007value', 'a path containing controls'],
  ])('rejects %s as %s for returnTo', async (fullPath) => {
    route.fullPath = fullPath
    vi.stubGlobal('$fetch', vi.fn(async () => ({ data: { items: [faculty], nextCursor: null } })))
    const { default: Page } = await import('../../../app/pages/admin/faculty/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(JSON.parse(wrapper.get('a[data-faculty-link]').attributes('data-to'))).toEqual({
      path: '/admin/faculty/11', query: { returnTo: '/admin/faculty' },
    })
  })

  it('debounces query into the URL for 350ms and removes the stale cursor', async () => {
    vi.useFakeTimers()
    route.query = { status: 'active', cursor: 'old', limit: '20' }
    route.fullPath = '/admin/faculty?status=active&cursor=old&limit=20'
    vi.stubGlobal('$fetch', vi.fn(async () => ({ data: { items: [], nextCursor: null } })))
    const { default: Page } = await import('../../../app/pages/admin/faculty/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.get('input[name="query"]').setValue('포트폴리오')
    await vi.advanceTimersByTimeAsync(349)
    expect(replace).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(replace).toHaveBeenCalledWith({
      path: '/admin/faculty', query: { query: '포트폴리오', status: 'active', limit: '20' },
    })
  })

  it('removes the stale cursor when any select filter changes', async () => {
    route.query = { employmentType: 'full_time', cursor: 'old', limit: '20' }
    route.fullPath = '/admin/faculty?employmentType=full_time&cursor=old&limit=20'
    vi.stubGlobal('$fetch', vi.fn(async () => ({ data: { items: [], nextCursor: null } })))
    const { default: Page } = await import('../../../app/pages/admin/faculty/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.get('select[name="status"]').setValue('archived')
    expect(replace).toHaveBeenCalledWith({
      path: '/admin/faculty', query: { employmentType: 'full_time', status: 'archived', limit: '20' },
    })
  })

  it('rejects an over-posted list response instead of partially rendering faculty', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({
      data: { items: [faculty], nextCursor: null, internalCount: 1 }, requestId: 'trace',
    })))
    const { default: Page } = await import('../../../app/pages/admin/faculty/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('다시 시도')
    expect(wrapper.get('button[data-action="retry"]').text()).toBe('다시 시도')
  })

  it.each(['ADMIN_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'])(
    'clears the session and recovers %s at login with a safe filtered return URL', async (code) => {
      route.query = { status: 'draft' }
      route.fullPath = '/admin/faculty?status=draft'
      const navigate = vi.mocked(navigateTo)
      vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({
        data: { error: { code, message: 'private' } },
      }))
      const { default: Page } = await import('../../../app/pages/admin/faculty/index.vue')
      const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
      wrappers.push(wrapper)
      await flushPromises()

      expect(useAdminSessionStore().session).toBeNull()
      expect(navigate).toHaveBeenCalledWith({
        path: '/admin/login', query: { redirect: '/admin/faculty?status=draft' },
      }, { replace: true })
      expect(wrapper.text()).not.toContain('private')
    },
  )

  it('keeps the newest route response when an older request resolves last', async () => {
    const first = deferred<{ data: { items: AdminFacultyListItem[], nextCursor: null } }>()
    const second = deferred<{ data: { items: AdminFacultyListItem[], nextCursor: null } }>()
    const fetch = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    vi.stubGlobal('$fetch', fetch)
    const { default: Page } = await import('../../../app/pages/admin/faculty/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    route.query = { status: 'draft' }
    route.fullPath = '/admin/faculty?status=draft'
    await flushPromises()
    second.resolve({ data: { items: [specialist], nextCursor: null } })
    await flushPromises()
    first.resolve({ data: { items: [faculty], nextCursor: null } })
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('김소연')
    expect(wrapper.text()).not.toContain('윤태준')
  })

  it('does not recover authentication after an outstanding request resolves post-unmount', async () => {
    const pending = deferred<never>()
    const navigate = vi.mocked(navigateTo)
    vi.stubGlobal('$fetch', vi.fn(() => pending.promise))
    const { default: Page } = await import('../../../app/pages/admin/faculty/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrapper.unmount()
    pending.reject({ data: { error: { code: 'ADMIN_REQUIRED', message: 'private' } } })
    await flushPromises()

    expect(useAdminSessionStore().session).not.toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('includes 320px overflow protection, visible focus, touch targets, and reduced-motion CSS', () => {
    const source = readFileSync(resolve('app/pages/admin/faculty/index.vue'), 'utf8')

    expect(source).toContain('min-height: var(--touch-target)')
    expect(source).toContain(':focus-visible')
    expect(source).toContain('overflow-x: auto')
    expect(source).toContain('min-width: 0')
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

describe('admin layout faculty navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setSession()
    vi.stubGlobal('navigateTo', vi.fn())
  })

  afterEach(() => {
    while (wrappers.length) wrappers.pop()?.unmount()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('exposes the faculty operations list from the administrator navigation', async () => {
    const { default: Layout } = await import('../../../app/layouts/admin.vue')
    const wrapper = mount(Layout, { global: { stubs: { NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)

    expect(wrapper.findAll('a').some(link => (
      link.text() === '교수진 운영' && link.attributes('data-to') === JSON.stringify('/admin/faculty')
    ))).toBe(true)
  })
})
