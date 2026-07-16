import { readFileSync } from 'node:fs'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAdminSessionStore } from '../../../app/stores/admin-session'

const createdAt = '2026-07-15T01:00:00.123456Z'
const updatedAt = '2026-07-16T01:00:00.654321Z'
const campaign = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  code: 'open-day-2026',
  name: '2026 오픈데이',
  channel: 'qr',
  status: 'active',
  startsAt: null,
  endsAt: null,
  sentCount: 120,
  createdAt,
  updatedAt,
  metrics: {
    version: 's6-daily-metrics-v1',
    availability: 'pending',
    visits: null,
    assessmentCompletions: null,
    counselingConversions: null,
  },
  ...overrides,
})
const storedCampaign = (overrides: Record<string, unknown> = {}) => {
  const { metrics: _metrics, ...stored } = campaign(overrides)
  return stored
}
const listEnvelope = (items = [campaign()], nextCursor: string | null = null) => ({
  data: { items, nextCursor }, requestId: 'list-trace',
})

const AppStateStub = {
  props: ['variant', 'message'],
  template: '<div :data-state="variant">{{ message }}</div>',
}
const NuxtLinkStub = {
  props: ['to'],
  template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
}

const route = reactive({
  fullPath: '/admin/campaigns',
  path: '/admin/campaigns',
  query: {} as Record<string, string>,
})
const replace = vi.fn(async (target: { path: string, query: Record<string, string> }) => {
  route.query = { ...target.query }
  const search = new URLSearchParams(target.query).toString()
  route.fullPath = `${target.path}${search ? `?${search}` : ''}`
})
const navigateTo = vi.fn()
const wrappers: VueWrapper[] = []

const mountPage = async () => {
  const { default: Page } = await import('../../../app/pages/admin/campaigns.vue')
  const wrapper = mount(Page, {
    attachTo: document.body,
    global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('administrator campaigns page', () => {
  beforeEach(() => {
    vi.useRealTimers()
    setActivePinia(createPinia())
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'short-lived-access-token',
      authenticatedAt: '2026-07-16T01:00:00.000Z',
      expiresAt: '2099-07-16T09:00:00.000Z',
      userId: 'admin-1',
    })
    route.query = {}
    route.fullPath = '/admin/campaigns'
    replace.mockClear()
    navigateTo.mockClear()
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace }))
    vi.stubGlobal('useRequestURL', () => new URL('https://photo-next.example/admin/campaigns'))
    vi.stubGlobal('navigateTo', navigateTo)
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('renders a semantic desktop ledger and ordered mobile articles with truthful pending metrics', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => listEnvelope()))
    const wrapper = await mountPage()

    expect(wrapper.get('h1').text()).toBe('캠페인 운영')
    expect(wrapper.text()).toContain('ATTRIBUTION LEDGER / CAMPAIGN LINKS')
    expect(wrapper.get('table').attributes('aria-label')).toBe('캠페인 운영 목록')
    expect(wrapper.findAll('thead th').map(cell => cell.text())).toEqual([
      '캠페인', '배포 링크', '기여 흐름', '운영 기록',
    ])
    expect(wrapper.get('[data-campaign-card]').findAll('[data-card-section]').map(section => section.attributes('data-card-section')))
      .toEqual(['identity', 'url', 'attribution', 'lifecycle'])
    expect(wrapper.findAll('[data-attribution-frame]')).toHaveLength(8)
    expect(wrapper.text()).toContain('집계 준비 중')
    expect(wrapper.text()).not.toMatch(/0%|전환율/u)
    expect(wrapper.find('img[alt*="QR"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/phone|token|secret/iu)
  })

  it('owns strict filters in the URL, drops cursor on changes, and preserves returned pagination only', async () => {
    vi.useFakeTimers()
    route.query = { query: '오픈', status: 'active', channel: 'qr', limit: '20', cursor: 'old-cursor', unknown: 'discard' }
    route.fullPath = '/admin/campaigns?query=%EC%98%A4%ED%94%88&status=active&channel=qr&limit=20&cursor=old-cursor'
    const fetch = vi.fn(async () => listEnvelope([campaign()], 'next-cursor'))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    expect(fetch).toHaveBeenCalledWith('/api/admin/campaigns', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      query: { query: '오픈', status: 'active', channel: 'qr', limit: '20', cursor: 'old-cursor' },
    })

    await wrapper.get('select[name="statusFilter"]').setValue('draft')
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({
      path: '/admin/campaigns', query: { query: '오픈', status: 'draft', channel: 'qr', limit: '20' },
    })

    await wrapper.get('input[name="queryFilter"]').setValue('여름')
    await vi.advanceTimersByTimeAsync(350)
    expect(replace).toHaveBeenLastCalledWith({
      path: '/admin/campaigns', query: { query: '여름', status: 'draft', channel: 'qr', limit: '20' },
    })
    const next = JSON.parse(wrapper.get('[data-next-page]').attributes('data-to'))
    expect(next).toEqual({
      path: '/admin/campaigns',
      query: { query: '여름', status: 'draft', channel: 'qr', limit: '20', cursor: 'next-cursor' },
    })
  })

  it('fails closed on malformed list DTOs and recovers auth through only the safe local URL', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ data: { items: [campaign({ privateNote: 'leak' })], nextCursor: null }, requestId: 'bad' })
      .mockRejectedValueOnce({ data: { error: { code: 'ADMIN_REQUIRED' } } })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    expect(wrapper.get('[data-state="error"]').text()).toContain('캠페인 목록을 불러오지 못했습니다')
    route.fullPath = 'https://attacker.example/admin/campaigns'
    await flushPromises()
    expect(useAdminSessionStore().session).toBeNull()
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/admin/login', query: { redirect: '/admin/campaigns' },
    }, { replace: true })
  })

  it('recovers a locally expired session before the list request through the safe login redirect', async () => {
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'expired-list-token',
      authenticatedAt: '2026-07-16T01:00:00.000Z',
      expiresAt: '2026-07-16T01:00:01.000Z',
      userId: 'admin-1',
    })
    const fetch = vi.fn(async () => listEnvelope())
    vi.stubGlobal('$fetch', fetch)
    await mountPage()

    expect(fetch).not.toHaveBeenCalled()
    expect(useAdminSessionStore().session).toBeNull()
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/admin/login', query: { redirect: '/admin/campaigns' },
    }, { replace: true })
  })

  it('recovers a locally expired session before create through the safe login redirect', async () => {
    const fetch = vi.fn(async () => listEnvelope())
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'expired-create-token',
      authenticatedAt: '2026-07-16T01:00:00.000Z',
      expiresAt: '2026-07-16T01:00:01.000Z',
      userId: 'admin-1',
    })
    await wrapper.get('input[name="name"]').setValue('만료 생성')
    await wrapper.get('input[name="code"]').setValue('EXPIRED CREATE')
    await wrapper.get('form[data-link-maker]').trigger('submit')
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(useAdminSessionStore().session).toBeNull()
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/admin/login', query: { redirect: '/admin/campaigns' },
    }, { replace: true })
  })

  it('recovers a locally expired session before archive through the safe login redirect', async () => {
    const fetch = vi.fn(async () => listEnvelope())
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'expired-archive-token',
      authenticatedAt: '2026-07-16T01:00:00.000Z',
      expiresAt: '2026-07-16T01:00:01.000Z',
      userId: 'admin-1',
    })
    const trigger = wrapper.get('[data-action="request-archive"]')
    await trigger.trigger('click')
    await flushPromises()
    wrapper.get('[data-action="confirm-archive"]').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(useAdminSessionStore().session).toBeNull()
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/admin/login', query: { redirect: '/admin/campaigns' },
    }, { replace: true })
  })

  it('lets only the latest list response update state and ignores work after unmount', async () => {
    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    route.query = { status: 'draft' }
    route.fullPath = '/admin/campaigns?status=draft'
    await flushPromises()
    resolveSecond(listEnvelope([campaign({ id: 8, code: 'new-campaign', name: '최신 캠페인' })]))
    await flushPromises()
    resolveFirst(listEnvelope([campaign({ name: '오래된 응답' })]))
    await flushPromises()
    expect(wrapper.text()).toContain('최신 캠페인')
    expect(wrapper.text()).not.toContain('오래된 응답')

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(() => resolveFirst(listEnvelope())).not.toThrow()
  })

  it('posts the exact create body once and accepts only the strict normalized server baseline', async () => {
    let resolveCreate!: (value: unknown) => void
    const fetch = vi.fn(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return new Promise(resolve => { resolveCreate = resolve })
      return listEnvelope()
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await wrapper.get('input[name="name"]').setValue('여름 오픈데이')
    await wrapper.get('input[name="code"]').setValue('SUMMER OPEN DAY')
    await wrapper.get('select[name="channel"]').setValue('social')
    await wrapper.get('select[name="status"]').setValue('active')
    await wrapper.get('input[name="sentCount"]').setValue('25')
    await wrapper.get('form[data-link-maker]').trigger('submit')
    await wrapper.get('form[data-link-maker]').trigger('submit')

    expect(fetch.mock.calls.filter(([, options]) => (options as { method?: string })?.method === 'POST')).toHaveLength(1)
    expect(fetch).toHaveBeenCalledWith('/api/admin/campaigns', {
      method: 'POST',
      headers: { Authorization: 'Bearer short-lived-access-token' },
      body: {
        code: 'SUMMER OPEN DAY', name: '여름 오픈데이', channel: 'social', status: 'active',
        startsAt: null, endsAt: null, sentCount: 25,
      },
    })
    resolveCreate({ data: { campaign: storedCampaign({ id: 8, code: 'summer-open-day', name: '여름 오픈데이' }) }, requestId: 'create' })
    await flushPromises()
    expect(wrapper.get('[data-live="mutation"]').text()).toContain('summer-open-day')
  })

  it('copies the exact canonical URL and leaves it selectable with fallback feedback on failure', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.stubGlobal('$fetch', vi.fn(async () => listEnvelope()))
    const wrapper = await mountPage()
    const visibleUrl = wrapper.get('[data-campaign-url]').text()
    expect(visibleUrl).toBe('https://photo-next.example/api/campaign/open-day-2026')
    expect(wrapper.get('[data-campaign-url]').attributes('tabindex')).toBe('0')

    const copy = wrapper.findAll('[data-action="copy-link"]')[0]!
    await copy.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(visibleUrl)
    expect(wrapper.get('[data-live="copy"]').text()).toContain('복사했습니다')
    await copy.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-live="copy"]').text()).toContain('URL을 직접 선택해 복사')
  })

  it('requires inline archive confirmation, blocks duplicate requests, and restores focus', async () => {
    let resolveArchive!: (value: unknown) => void
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return new Promise(resolve => { resolveArchive = resolve })
      return listEnvelope()
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    const trigger = wrapper.findAll('[data-action="request-archive"]')[0]!
    await trigger.trigger('click')
    await flushPromises()
    const confirm = trigger.element.closest('[data-campaign-entry]')!.querySelector<HTMLButtonElement>('[data-action="confirm-archive"]')!
    expect(document.activeElement).toBe(confirm)
    confirm.click()
    confirm.click()
    await flushPromises()
    expect(fetch.mock.calls.filter(([, options]) => (options as { method?: string })?.method === 'POST')).toHaveLength(1)
    expect(fetch).toHaveBeenCalledWith('/api/admin/campaigns/7/archive', {
      method: 'POST',
      headers: { Authorization: 'Bearer short-lived-access-token' },
      body: { expectedUpdatedAt: updatedAt },
    })
    resolveArchive({ data: { campaign: storedCampaign({ status: 'archived', updatedAt: '2026-07-16T02:00:00.000001Z' }) }, requestId: 'archive' })
    await flushPromises()
    expect(document.activeElement).toBe(trigger.element)
  })

  it('locks every archive path while create is pending and converges the accepted create DTO', async () => {
    let resolveCreate!: (value: unknown) => void
    const accepted = campaign({ id: 8, code: 'locked-create', name: '잠금 생성' })
    const fetch = vi.fn(async (url: string, options?: { method?: string }) => {
      if (url === '/api/admin/campaigns' && options?.method === 'POST') {
        return new Promise(resolve => { resolveCreate = resolve })
      }
      return fetch.mock.calls.filter(([calledUrl, calledOptions]) => (
        calledUrl === '/api/admin/campaigns' && !(calledOptions as { method?: string })?.method
      )).length > 1 ? listEnvelope([accepted, campaign()]) : listEnvelope()
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    await wrapper.get('input[name="name"]').setValue('잠금 생성')
    await wrapper.get('input[name="code"]').setValue('LOCKED CREATE')
    await wrapper.get('form[data-link-maker]').trigger('submit')
    expect(wrapper.get('[data-create-fields]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('[data-action="request-archive"]').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    wrapper.get('[data-action="request-archive"]').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-action="confirm-archive"]').exists()).toBe(false)
    expect(fetch.mock.calls.filter(([, options]) => (options as { method?: string })?.method === 'POST')).toHaveLength(1)

    resolveCreate({ data: { campaign: storedCampaign(accepted) }, requestId: 'create-accepted' })
    await flushPromises()
    expect(wrapper.get('[data-live="mutation"]').text()).toContain('locked-create')
    expect(wrapper.text()).toContain('잠금 생성')
    expect((wrapper.get('input[name="name"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('[data-create-fields]').attributes('disabled')).toBeUndefined()
  })

  it('locks create and every other archive path while one archive is pending, then applies its accepted DTO', async () => {
    let resolveArchive!: (value: unknown) => void
    const second = campaign({ id: 8, code: 'second-campaign', name: '두 번째 캠페인' })
    const fetch = vi.fn(async (url: string, options?: { method?: string }) => {
      if (url === '/api/admin/campaigns/7/archive' && options?.method === 'POST') {
        return new Promise(resolve => { resolveArchive = resolve })
      }
      return listEnvelope([campaign(), second])
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    await wrapper.get('input[name="name"]').setValue('차단할 생성')
    await wrapper.get('input[name="code"]').setValue('BLOCKED CREATE')

    const secondTrigger = wrapper.findAll('[data-action="request-archive"]')[1]!
    await secondTrigger.trigger('click')
    await flushPromises()
    const detachedSecondConfirm = secondTrigger.element.closest('[data-campaign-entry]')!
      .querySelector<HTMLButtonElement>('[data-action="confirm-archive"]')!
    const firstTrigger = wrapper.findAll('[data-action="request-archive"]')[0]!
    await firstTrigger.trigger('click')
    await flushPromises()
    const firstConfirm = firstTrigger.element.closest('[data-campaign-entry]')!
      .querySelector<HTMLButtonElement>('[data-action="confirm-archive"]')!
    firstConfirm.click()
    detachedSecondConfirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.get('form[data-link-maker]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-create-fields]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('[data-action="request-archive"]').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    expect(firstConfirm.disabled).toBe(true)
    expect(fetch.mock.calls.filter(([, options]) => (options as { method?: string })?.method === 'POST')).toHaveLength(1)

    resolveArchive({ data: { campaign: storedCampaign({ status: 'archived', updatedAt: '2026-07-16T04:00:00.000001Z' }) }, requestId: 'archive-accepted' })
    await flushPromises()
    expect(wrapper.get('[data-live="mutation"]').text()).toContain('보관했습니다')
    expect(wrapper.findAll('[data-action="request-archive"]')[0]!.text()).toBe('보관됨')
    expect((wrapper.get('input[name="name"]').element as HTMLInputElement).value).toBe('차단할 생성')
    expect(document.activeElement).toBe(firstTrigger.element)
  })

  it('serializes clipboard writes globally and keeps the accepted write feedback consistent', async () => {
    let resolveCopy!: () => void
    const writeText = vi.fn()
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveCopy = resolve }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const fetch = vi.fn(async () => listEnvelope([campaign(), campaign({ id: 8, code: 'summer-day', name: '여름 캠페인' })]))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    const copyButtons = wrapper.findAll('[data-action="copy-link"]')
    await copyButtons[0]!.trigger('click')
    await flushPromises()
    expect(copyButtons.every(button => button.attributes('disabled') !== undefined)).toBe(true)
    copyButtons[1]!.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('https://photo-next.example/api/campaign/open-day-2026')
    resolveCopy()
    await flushPromises()
    expect(wrapper.get('[data-live="copy"]').text()).toContain('2026 오픈데이')
    expect(wrapper.get('[data-live="copy"]').text()).not.toContain('여름 캠페인')
    expect(wrapper.findAll('[data-action="copy-link"]').every(button => button.attributes('disabled') === undefined)).toBe(true)
  })

  it('ignores create completion after unmount', async () => {
    let resolveCreate!: (value: unknown) => void
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => options?.method === 'POST'
      ? new Promise(resolve => { resolveCreate = resolve })
      : listEnvelope())
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    await wrapper.get('input[name="name"]').setValue('분리된 생성')
    await wrapper.get('input[name="code"]').setValue('DETACHED CREATE')
    await wrapper.get('form[data-link-maker]').trigger('submit')
    const callsBeforeUnmount = fetch.mock.calls.length
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    resolveCreate({ data: { campaign: storedCampaign({ id: 9, code: 'detached-create' }) }, requestId: 'detached' })
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(callsBeforeUnmount)
  })

  it('keeps the current form and reloads the current route after a create accepted on an older route', async () => {
    let resolveCreate!: (value: unknown) => void
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => options?.method === 'POST'
      ? new Promise(resolve => { resolveCreate = resolve })
      : listEnvelope())
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    await wrapper.get('input[name="name"]').setValue('이전 화면 생성')
    await wrapper.get('input[name="code"]').setValue('OLD ROUTE CREATE')
    await wrapper.get('form[data-link-maker]').trigger('submit')
    route.query = { status: 'draft' }
    route.fullPath = '/admin/campaigns?status=draft'
    await flushPromises()
    const callsOnCurrentRoute = fetch.mock.calls.length

    resolveCreate({ data: { campaign: storedCampaign({ id: 9, code: 'old-route-create' }) }, requestId: 'old-route' })
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(callsOnCurrentRoute + 1)
    expect(wrapper.get('[data-live="mutation"]').text()).not.toContain('old-route-create')
    expect((wrapper.get('input[name="name"]').element as HTMLInputElement).value).toBe('이전 화면 생성')
    expect((wrapper.get('input[name="code"]').element as HTMLInputElement).value).toBe('OLD ROUTE CREATE')
    expect(route.fullPath).toBe('/admin/campaigns?status=draft')
  })

  it('adds campaign navigation and keeps 320px-safe, reduced-motion source contracts', async () => {
    const page = readFileSync('app/pages/admin/campaigns.vue', 'utf8')
    const layout = readFileSync('app/layouts/admin.vue', 'utf8')
    expect(layout).toContain('<NuxtLink to="/admin/campaigns">캠페인 운영</NuxtLink>')
    expect(page).toContain("definePageMeta({ layout: 'admin', middleware: 'admin' })")
    expect(page).toContain('minmax(0, 1fr)')
    expect(page).toContain('overflow-wrap: anywhere')
    expect(page).toContain('@media (prefers-reduced-motion: reduce)')
    expect(page).not.toMatch(/<img[^>]+QR|linear-gradient|radial-gradient/iu)
  })
})
