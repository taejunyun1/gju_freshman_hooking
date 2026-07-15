import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAdminSessionStore } from '../../../app/stores/admin-session'
import type {
  AdminEquipmentInventoryItem,
  AdminResource,
  AdminResourceWrite,
} from '../../../shared/schemas/admin-resources'

const updatedAt = '2026-07-15T01:00:00.000Z'
const course: AdminResource = {
  id: 42, type: 'course', title: '기초사진실기', summary: '촬영 기초 교과',
  connectionTemplate: '관심과 교과를 연결합니다.', status: 'draft', visibility: 'public',
  priority: 10, sourceDate: '2026-07-14', metadata: {
    academic_year: 2026, grade_year: 1, term: '1학기', credits: 3, goal: '촬영 기초를 익힌다.',
  }, imagePath: null, tags: [{ key: 'photography', weight: 3, isPrimary: true }],
  createdAt: '2026-07-01T01:00:00.000Z', updatedAt,
}
const equipment: AdminResource = {
  ...course,
  type: 'equipment',
  title: '스튜디오 카메라',
  metadata: {
    category: 'camera', locationKey: 'department_equipment_room', locationLabel: '기자재실',
    accessMode: 'reservation', accessLabel: '예약', confirmedQuantity: 1,
  },
}
const inventoryItem: AdminEquipmentInventoryItem = {
  id: 7, equipmentResourceId: 42, inventoryCode: 'CAM-001', sourceRow: 1,
  locationKey: 'department_equipment_room', accessMode: 'reservation', availabilityState: 'available',
  note: null, dataQualityStatus: 'verified', sourceDate: '2026-07-14', updatedAt,
}
const secondInventoryItem: AdminEquipmentInventoryItem = {
  ...inventoryItem,
  id: 8,
  inventoryCode: 'CAM-008',
  sourceRow: 8,
}

const writeOf = (resource: AdminResource): AdminResourceWrite => ({
  type: resource.type,
  title: resource.title,
  summary: resource.summary,
  connectionTemplate: resource.connectionTemplate,
  sourceDate: resource.sourceDate,
  visibility: resource.visibility,
  priority: resource.priority,
  tags: resource.tags,
  metadata: resource.type === 'equipment'
    ? Object.fromEntries(Object.entries(resource.metadata).filter(([key]) => key !== 'confirmedQuantity'))
    : resource.metadata,
  imagePath: resource.imagePath,
} as AdminResourceWrite)

const AppStateStub = { props: ['variant', 'message'], template: '<div :data-state="variant">{{ message }}</div>' }
const NuxtLinkStub = { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' }
const ResourceEditorStub = {
  name: 'ResourceEditor',
  props: ['resource', 'inventory', 'validatorIssues'],
  emits: ['save', 'publish', 'archive', 'upload-image'],
  template: '<div data-testid="resource-editor" :data-updated-at="resource.updatedAt">{{ resource.title }}</div>',
}
const EquipmentInventoryTableStub = {
  name: 'EquipmentInventoryTable',
  props: ['resourceId', 'items', 'importValidation', 'mutationError'],
  emits: ['update', 'validate-import'],
  template: '<div data-testid="equipment-inventory" :data-error="mutationError?.message" :data-import-total="importValidation?.actual.total" />',
}
const wrappers: VueWrapper[] = []

const setSession = () => useAdminSessionStore().setVerifiedSession({
  accessToken: 'admin-token', authenticatedAt: updatedAt,
  expiresAt: '2099-07-15T01:00:00.000Z', userId: 'admin-1',
})

describe('administrator resources list page', () => {
  const route = reactive({
    fullPath: '/admin/resources', params: {} as Record<string, string>, query: {} as Record<string, string>,
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
    route.fullPath = '/admin/resources'
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

  it('uses only supported URL filters, preserves them in cursor and safe detail links, and renders desktop and mobile semantics', async () => {
    route.query = {
      query: '사진', type: 'course', status: 'draft', visibility: 'public', tag: 'photography',
      sourceDateFrom: '2026-07-01', sourceDateTo: '2026-07-31', limit: '20', cursor: 'page-one', unknown: 'discard',
    }
    route.fullPath = '/admin/resources?query=%EC%82%AC%EC%A7%84&type=course&status=draft&visibility=public&tag=photography&sourceDateFrom=2026-07-01&sourceDateTo=2026-07-31&limit=20&cursor=page-one'
    const fetch = vi.fn(async () => ({ data: { items: [course], nextCursor: 'page-two' }, requestId: 'trace' }))
    vi.stubGlobal('$fetch', fetch)
    const { default: Page } = await import('../../../app/pages/admin/resources/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/resources', {
      headers: { Authorization: 'Bearer admin-token' },
      query: {
        query: '사진', type: 'course', status: 'draft', visibility: 'public', tag: 'photography',
        sourceDateFrom: '2026-07-01', sourceDateTo: '2026-07-31', limit: '20', cursor: 'page-one',
      },
    })
    expect(wrapper.get('table').attributes('aria-label')).toBe('학과 자원 목록')
    expect(wrapper.findAll('[data-resource-card]')).toHaveLength(1)
    expect(wrapper.get('[data-resource-card]').findAll('dt').map(label => label.text())).toEqual([
      '유형', '상태', '공개', '기준일', '수정', '기본 태그',
    ])
    const detailTargets = wrapper.findAll('a[data-resource-link]').map(link => JSON.parse(link.attributes('data-to')))
    expect(detailTargets).toEqual([
      { path: '/admin/resources/42', query: { returnTo: route.fullPath } },
      { path: '/admin/resources/42', query: { returnTo: route.fullPath } },
    ])
    expect(JSON.parse(wrapper.get('a[data-next-page]').attributes('data-to'))).toEqual({
      path: '/admin/resources', query: expect.objectContaining({ query: '사진', type: 'course', cursor: 'page-two' }),
    })
  })

  it('debounces text into the URL for 350ms and removes a stale cursor', async () => {
    vi.useFakeTimers()
    route.query = { status: 'draft', cursor: 'old', limit: '20' }
    route.fullPath = '/admin/resources?status=draft&cursor=old&limit=20'
    vi.stubGlobal('$fetch', vi.fn(async () => ({ data: { items: [], nextCursor: null }, requestId: 'trace' })))
    const { default: Page } = await import('../../../app/pages/admin/resources/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.get('input[name="query"]').setValue('포트폴리오')
    await vi.advanceTimersByTimeAsync(349)
    expect(replace).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(replace).toHaveBeenCalledWith({
      path: '/admin/resources', query: { query: '포트폴리오', status: 'draft', limit: '20' },
    })
  })

  it('rejects an over-posted list response instead of rendering partially decoded resources', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({
      data: { items: [course], nextCursor: null, internalCount: 1 }, requestId: 'trace',
    })))
    const { default: Page } = await import('../../../app/pages/admin/resources/index.vue')
    const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.get('[data-state="error"]').text()).toContain('다시 시도')
  })

  it.each(['ADMIN_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'])(
    'clears the session and recovers list %s at login with the safe filtered URL', async (code) => {
      route.query = { status: 'draft' }
      route.fullPath = '/admin/resources?status=draft'
      const navigate = vi.mocked(navigateTo)
      vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { error: { code, message: 'private' } } }))
      const { default: Page } = await import('../../../app/pages/admin/resources/index.vue')
      const wrapper = mount(Page, { global: { stubs: { AppState: AppStateStub, NuxtLink: NuxtLinkStub } } })
      wrappers.push(wrapper)
      await flushPromises()

      expect(useAdminSessionStore().session).toBeNull()
      expect(navigate).toHaveBeenCalledWith({
        path: '/admin/login', query: { redirect: '/admin/resources?status=draft' },
      }, { replace: true })
      expect(wrapper.text()).not.toContain('private')
    },
  )
})

describe('administrator resource detail page', () => {
  const route = reactive({
    fullPath: '/admin/resources/42?returnTo=%2Fadmin%2Fresources%3Fstatus%3Ddraft',
    params: { id: '42' } as Record<string, string>,
    query: { returnTo: '/admin/resources?status=draft' } as Record<string, string>,
  })
  const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
    return { promise, reject, resolve }
  }

  const mountDetail = async () => {
    const { default: Page } = await import('../../../app/pages/admin/resources/[id].vue')
    const wrapper = mount(Page, { global: { stubs: {
      AppState: AppStateStub,
      EquipmentInventoryTable: EquipmentInventoryTableStub,
      NuxtLink: NuxtLinkStub,
      ResourceEditor: ResourceEditorStub,
    } } })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    setSession()
    route.params = { id: '42' }
    route.query = { returnTo: '/admin/resources?status=draft' }
    route.fullPath = '/admin/resources/42?returnTo=%2Fadmin%2Fresources%3Fstatus%3Ddraft'
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('navigateTo', vi.fn())
  })

  afterEach(() => {
    while (wrappers.length) wrappers.pop()?.unmount()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('reacts to a reused route, ignores the stale response, and preserves only a safe resource-list returnTo', async () => {
    const first = deferred<{ data: { resource: AdminResource, inventory: [] }, requestId: string }>()
    const next = { ...course, id: 43, title: '스튜디오 조명 실습' } as AdminResource
    const fetch = vi.fn((url: string) => url.endsWith('/42')
      ? first.promise
      : Promise.resolve({ data: { resource: next, inventory: [] }, requestId: 'next-trace' }))
    vi.stubGlobal('$fetch', fetch)
    const { default: Page } = await import('../../../app/pages/admin/resources/[id].vue')
    const wrapper = mount(Page, { global: { stubs: {
      AppState: AppStateStub, NuxtLink: NuxtLinkStub, ResourceEditor: ResourceEditorStub,
    } } })
    wrappers.push(wrapper)
    await nextTick()

    route.params = { id: '43' }
    route.query = { returnTo: '//evil.example/steal' }
    route.fullPath = '/admin/resources/43?returnTo=%2F%2Fevil.example%2Fsteal'
    await nextTick()
    await flushPromises()

    expect(wrapper.get('[data-testid="resource-editor"]').text()).toContain('스튜디오 조명 실습')
    expect(wrapper.get('[data-action="back-to-resources"]').attributes('data-to')).toBe(JSON.stringify('/admin/resources'))
    first.resolve({ data: { resource: course, inventory: [] }, requestId: 'old-trace' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('기초사진실기')
  })

  it('keeps the section heading available while detail is loading and after an error', async () => {
    const pending = deferred<never>()
    vi.stubGlobal('$fetch', vi.fn(() => pending.promise))
    const { default: Page } = await import('../../../app/pages/admin/resources/[id].vue')
    const wrapper = mount(Page, { global: { stubs: {
      AppState: AppStateStub, NuxtLink: NuxtLinkStub, ResourceEditor: ResourceEditorStub,
    } } })
    wrappers.push(wrapper)
    await nextTick()

    expect(wrapper.get('section.resource-detail').attributes('aria-labelledby')).toBe('resource-detail-title')
    expect(wrapper.get('h1#resource-detail-title').text()).toContain('학과 자원')

    pending.reject(new Error('offline'))
    await flushPromises()
    expect(wrapper.get('[data-state="error"]').exists()).toBe(true)
    expect(wrapper.get('h1#resource-detail-title').exists()).toBe(true)
  })

  it.each(['ADMIN_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'])(
    'clears the session and recovers %s at login with a safe local redirect', async (code) => {
      const navigate = vi.mocked(navigateTo)
      vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { error: { code, message: 'private' } } }))
      const { default: Page } = await import('../../../app/pages/admin/resources/[id].vue')
      const wrapper = mount(Page, { global: { stubs: {
        AppState: AppStateStub, NuxtLink: NuxtLinkStub, ResourceEditor: ResourceEditorStub,
      } } })
      wrappers.push(wrapper)
      await flushPromises()

      expect(useAdminSessionStore().session).toBeNull()
      expect(navigate).toHaveBeenCalledWith({
        path: '/admin/login',
        query: { redirect: '/admin/resources/42?returnTo=%2Fadmin%2Fresources%3Fstatus%3Ddraft' },
      }, { replace: true })
      expect(wrapper.text()).not.toContain('private')
    },
  )

  it('flattens the editor save payload and replaces the baseline only after a strict success response', async () => {
    const changed = { ...course, title: '저장된 교과', updatedAt: '2026-07-15T02:00:00.000Z' } as AdminResource
    const write = { ...writeOf(course), title: '저장된 교과' } as AdminResourceWrite
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => options?.method === 'PUT'
      ? { data: { resource: changed, inventory: [] }, requestId: 'save-trace' }
      : { data: { resource: course, inventory: [] }, requestId: 'load-trace' })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()

    wrapper.getComponent(ResourceEditorStub).vm.$emit('save', { expectedUpdatedAt: updatedAt, resource: write })
    await flushPromises()

    expect(fetch).toHaveBeenLastCalledWith('/api/admin/resources/42', {
      method: 'PUT',
      headers: { Authorization: 'Bearer admin-token' },
      body: { expectedUpdatedAt: updatedAt, ...write },
    })
    expect(wrapper.get('[data-testid="resource-editor"]').attributes('data-updated-at')).toBe(changed.updatedAt)
  })

  it('rejects over-posted detail and mutation success payloads', async () => {
    let invalidMutation = false
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => {
      if (!options?.method) {
        return invalidMutation
          ? { data: { resource: course, inventory: [] }, requestId: 'load-trace' }
          : { data: { resource: course, inventory: [], privateNote: 'no' }, requestId: 'load-trace' }
      }
      return { data: {
        resource: { ...course, updatedAt: '2026-07-15T02:00:00.000Z' }, inventory: [], privateNote: 'no',
      }, requestId: 'save-trace' }
    })
    vi.stubGlobal('$fetch', fetch)
    let wrapper = await mountDetail()
    expect(wrapper.find('[data-testid="resource-editor"]').exists()).toBe(false)
    expect(wrapper.get('[data-state="error"]').exists()).toBe(true)

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    invalidMutation = true
    wrapper = await mountDetail()
    wrapper.getComponent(ResourceEditorStub).vm.$emit('save', {
      expectedUpdatedAt: updatedAt, resource: writeOf(course),
    })
    await flushPromises()
    expect(wrapper.get('[data-testid="resource-editor"]').attributes('data-updated-at')).toBe(updatedAt)
    expect(wrapper.text()).not.toContain('privateNote')
  })

  it('rejects detail resources and inventory rows that do not belong to the route endpoint', async () => {
    const wrongResource = { ...course, id: 43 } as AdminResource
    let wrongInventory = false
    const fetch = vi.fn(async () => ({
      data: wrongInventory
        ? { resource: equipment, inventory: [{ ...inventoryItem, equipmentResourceId: 43 }] }
        : { resource: wrongResource, inventory: [] },
      requestId: 'load-trace',
    }))
    vi.stubGlobal('$fetch', fetch)
    let wrapper = await mountDetail()
    expect(wrapper.find('[data-testid="resource-editor"]').exists()).toBe(false)
    expect(wrapper.get('[data-state="error"]').exists()).toBe(true)

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    wrongInventory = true
    wrapper = await mountDetail()
    expect(wrapper.find('[data-testid="equipment-inventory"]').exists()).toBe(false)
    expect(wrapper.get('[data-state="error"]').exists()).toBe(true)
  })

  it('rejects a structurally valid resource mutation success for another resource ID', async () => {
    const wrong = { ...course, id: 43, title: '다른 자원' } as AdminResource
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => options?.method
      ? { data: { resource: wrong, inventory: [] }, requestId: 'save-trace' }
      : { data: { resource: course, inventory: [] }, requestId: 'load-trace' })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()

    wrapper.getComponent(ResourceEditorStub).vm.$emit('save', {
      expectedUpdatedAt: updatedAt, resource: writeOf(course),
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="resource-editor"]').text()).toContain(course.title)
    expect(wrapper.text()).not.toContain('다른 자원')
  })

  it('posts only expectedUpdatedAt for publish and archive transitions', async () => {
    const active = { ...course, status: 'active', updatedAt: '2026-07-15T02:00:00.000Z' } as AdminResource
    const archived = { ...active, status: 'archived', updatedAt: '2026-07-15T03:00:00.000Z' } as AdminResource
    const fetch = vi.fn(async (url: string, _options?: { method?: string }) => {
      if (url.endsWith('/publish')) return { data: { resource: active, inventory: [] }, requestId: 'publish-trace' }
      if (url.endsWith('/archive')) return { data: { resource: archived, inventory: [] }, requestId: 'archive-trace' }
      return { data: { resource: course, inventory: [] }, requestId: 'load-trace' }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const editor = wrapper.getComponent(ResourceEditorStub)

    editor.vm.$emit('publish', { resourceId: 42, expectedUpdatedAt: updatedAt })
    await flushPromises()
    editor.vm.$emit('archive', { resourceId: 42, expectedUpdatedAt: active.updatedAt })
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/resources/42/publish', {
      method: 'POST', headers: { Authorization: 'Bearer admin-token' }, body: { expectedUpdatedAt: updatedAt },
    })
    expect(fetch).toHaveBeenCalledWith('/api/admin/resources/42/archive', {
      method: 'POST', headers: { Authorization: 'Bearer admin-token' }, body: { expectedUpdatedAt: active.updatedAt },
    })
  })

  it('uploads the selected image in the multipart image field', async () => {
    const changed = { ...course, imagePath: 'resources/42/new.webp', updatedAt: '2026-07-15T02:00:00.000Z' } as AdminResource
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => options?.method === 'POST'
      ? { data: { resource: changed, inventory: [] }, requestId: 'image-trace' }
      : { data: { resource: course, inventory: [] }, requestId: 'load-trace' })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const file = new File(['image'], 'evidence.webp', { type: 'image/webp' })

    wrapper.getComponent(ResourceEditorStub).vm.$emit('upload-image', {
      resourceId: 42, expectedUpdatedAt: updatedAt, file,
    })
    await flushPromises()

    const call = fetch.mock.calls.find(([url]) => url === '/api/admin/resources/42/image')
    expect(call?.[1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer admin-token' } })
    expect(call?.[1]?.body).toBeInstanceOf(FormData)
    expect((call?.[1]?.body as FormData).get('image')).toBe(file)
  })

  it('stages a strict 409 current resource until the operator explicitly applies it', async () => {
    const current = { ...course, title: '최신 서버 교과', updatedAt: '2026-07-15T02:00:00.000Z' } as AdminResource
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => {
      if (!options?.method) return { data: { resource: course, inventory: [] }, requestId: 'load-trace' }
      throw { data: { error: {
        code: 'RESOURCE_CONFLICT', message: 'private', current,
      } } }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const editor = wrapper.getComponent(ResourceEditorStub)

    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, resource: writeOf(course) })
    await flushPromises()
    expect(wrapper.get('[data-testid="resource-editor"]').text()).toContain(course.title)
    expect(wrapper.get('[data-resource-conflict]').text()).toContain('최신 서버 교과')
    expect(wrapper.get('[data-resource-conflict]').text()).toContain(current.updatedAt)
    expect(wrapper.text()).not.toContain('private')

    await wrapper.get('[data-action="apply-resource-conflict"]').trigger('click')
    expect(wrapper.get('[data-testid="resource-editor"]').text()).toContain('최신 서버 교과')
    expect(wrapper.get('[data-testid="resource-editor"]').attributes('data-updated-at')).toBe(current.updatedAt)
  })

  it('applies a staged resource conflict without regressing later inventory state', async () => {
    const conflictResource = {
      ...equipment,
      title: '충돌 시점 자원',
      updatedAt: '2026-07-15T02:00:00.000Z',
    } as AdminResource
    const savedItem = {
      ...inventoryItem,
      inventoryCode: 'CAM-AFTER-CONFLICT',
      dataQualityStatus: 'quantity_check' as const,
      updatedAt: '2026-07-15T03:00:00.000Z',
    }
    const fetch = vi.fn(async (url: string, options?: { method?: string }) => {
      if (!options?.method) {
        return { data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace' }
      }
      if (url.includes('/inventory/')) {
        return { data: { item: savedItem, resourceUpdatedAt: savedItem.updatedAt }, requestId: 'inventory-trace' }
      }
      throw { data: { error: {
        code: 'RESOURCE_CONFLICT', message: 'private', current: conflictResource,
      } } }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const editor = wrapper.getComponent(ResourceEditorStub)
    const table = wrapper.getComponent(EquipmentInventoryTableStub)

    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, resource: writeOf(equipment) })
    await flushPromises()
    table.vm.$emit('update', {
      resourceId: 42, itemId: 7, expectedUpdatedAt: updatedAt, inventoryCode: savedItem.inventoryCode,
      locationKey: 'department_equipment_room', accessMode: 'reservation', availabilityState: 'available',
      note: null, dataQualityStatus: savedItem.dataQualityStatus,
    })
    await flushPromises()

    await wrapper.get('[data-action="apply-resource-conflict"]').trigger('click')

    expect(editor.text()).toContain(conflictResource.title)
    expect(editor.attributes('data-updated-at')).toBe(savedItem.updatedAt)
    expect((editor.props('resource') as AdminResource & { type: 'equipment' }).metadata.confirmedQuantity).toBe(0)
    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe(savedItem.inventoryCode)
  })

  it.each([
    ['wrong code', 'INTERNAL_ERROR', { ...course, title: '코드가 틀린 current' }],
    ['wrong resource ID', 'RESOURCE_CONFLICT', { ...course, id: 43, title: '다른 자원 current' }],
  ])('does not stage a structurally valid resource current with %s', async (_label, code, current) => {
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => {
      if (!options?.method) return { data: { resource: course, inventory: [] }, requestId: 'load-trace' }
      throw { data: { error: { code, message: 'private', current } } }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()

    wrapper.getComponent(ResourceEditorStub).vm.$emit('save', {
      expectedUpdatedAt: updatedAt, resource: writeOf(course),
    })
    await flushPromises()

    expect(wrapper.find('[data-resource-conflict]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="resource-editor"]').text()).toContain(course.title)
    expect(wrapper.text()).not.toContain('private')
  })

  it('sends the inventory update contract and passes a fresh typed failure back to the table', async () => {
    const firstFailure = deferred<never>()
    const secondFailure = deferred<never>()
    let failureIndex = 0
    const fetch = vi.fn((url: string) => {
      if (url.includes('/inventory/')) return failureIndex++ === 0 ? firstFailure.promise : secondFailure.promise
      return Promise.resolve({ data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace' })
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const table = wrapper.getComponent(EquipmentInventoryTableStub)
    const update = {
      resourceId: 42, itemId: 7, expectedUpdatedAt: updatedAt, inventoryCode: 'CAM-002',
      locationKey: 'fantasy_lab', accessMode: 'inquiry', availabilityState: 'unknown', note: '점검',
      dataQualityStatus: 'quantity_check',
    }

    table.vm.$emit('update', update)
    await nextTick()
    expect(table.props('mutationError')).toBeNull()
    expect(fetch).toHaveBeenCalledWith('/api/admin/resources/42/inventory/7', {
      method: 'PUT', headers: { Authorization: 'Bearer admin-token' }, body: {
        expectedUpdatedAt: updatedAt, inventoryCode: 'CAM-002', locationKey: 'fantasy_lab',
        accessMode: 'inquiry', availabilityState: 'unknown', note: '점검', dataQualityStatus: 'quantity_check',
      },
    })
    firstFailure.reject({ data: { error: { code: 'INTERNAL_ERROR', message: 'private' } } })
    await flushPromises()
    const firstError = table.props('mutationError')
    expect(firstError).toEqual({ itemId: 7, expectedUpdatedAt: updatedAt, message: '기자재 항목을 저장하지 못했습니다.' })

    table.vm.$emit('update', update)
    await nextTick()
    expect(table.props('mutationError')).toBeNull()
    secondFailure.reject({ data: { error: { code: 'INTERNAL_ERROR', message: 'private' } } })
    await flushPromises()
    expect(table.props('mutationError')).toEqual(firstError)
    expect(table.props('mutationError')).not.toBe(firstError)
  })

  it('stages a strict inventory 409 current after releasing pending and applies it only on confirmation', async () => {
    const successItem = { ...inventoryItem, inventoryCode: 'CAM-002', updatedAt: '2026-07-15T02:00:00.000Z' }
    const conflictItem = { ...successItem, inventoryCode: 'CAM-003', updatedAt: '2026-07-15T03:00:00.000Z' }
    let mutation = 0
    const fetch = vi.fn(async (url: string) => {
      if (!url.includes('/inventory/')) {
        return { data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace' }
      }
      mutation += 1
      if (mutation === 1) {
        return { data: { item: successItem, resourceUpdatedAt: successItem.updatedAt }, requestId: 'inventory-trace' }
      }
      throw { data: { error: {
        code: 'RESOURCE_CONFLICT', message: 'private',
        current: mutation === 2 ? conflictItem : { ...conflictItem, privateNote: 'no' },
      } } }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const table = wrapper.getComponent(EquipmentInventoryTableStub)
    const update = {
      resourceId: 42, itemId: 7, expectedUpdatedAt: updatedAt, inventoryCode: 'CAM-002',
      locationKey: 'department_equipment_room', accessMode: 'reservation', availabilityState: 'available',
      note: null, dataQualityStatus: 'verified',
    }

    table.vm.$emit('update', update)
    await flushPromises()
    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe('CAM-002')
    expect(wrapper.get('[data-testid="resource-editor"]').attributes('data-updated-at')).toBe(successItem.updatedAt)

    table.vm.$emit('update', { ...update, expectedUpdatedAt: successItem.updatedAt })
    await flushPromises()
    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe('CAM-002')
    expect(table.props('mutationError')).toMatchObject({ itemId: 7, expectedUpdatedAt: successItem.updatedAt })
    expect(wrapper.get('[data-inventory-conflict]').text()).toContain('CAM-003')
    expect(wrapper.get('[data-inventory-conflict]').text()).toContain(conflictItem.updatedAt)

    await wrapper.get('[data-action="apply-inventory-conflict"]').trigger('click')
    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe('CAM-003')

    table.vm.$emit('update', { ...update, expectedUpdatedAt: conflictItem.updatedAt })
    await flushPromises()
    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.updatedAt).toBe(conflictItem.updatedAt)
    expect(wrapper.text()).not.toContain('private')
  })

  it('merges an applied inventory conflict while preserving a newer parent version and recomputing quantity', async () => {
    const conflictItem = {
      ...inventoryItem,
      inventoryCode: 'CAM-CONFLICT',
      dataQualityStatus: 'quantity_check' as const,
      updatedAt: '2026-07-15T03:00:00.000Z',
    }
    const savedSecondItem = {
      ...secondInventoryItem,
      inventoryCode: 'CAM-008-SAVED',
      dataQualityStatus: 'verified' as const,
      updatedAt: '2026-07-15T04:00:00.000Z',
    }
    const initialSecondItem = { ...secondInventoryItem, dataQualityStatus: 'quantity_check' as const }
    const fetch = vi.fn(async (url: string) => {
      if (!url.includes('/inventory/')) {
        return {
          data: { resource: equipment, inventory: [inventoryItem, initialSecondItem] },
          requestId: 'load-trace',
        }
      }
      if (url.endsWith('/8')) {
        return {
          data: { item: savedSecondItem, resourceUpdatedAt: savedSecondItem.updatedAt },
          requestId: 'second-trace',
        }
      }
      throw { data: { error: {
        code: 'RESOURCE_CONFLICT', message: 'private', current: conflictItem,
      } } }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const editor = wrapper.getComponent(ResourceEditorStub)
    const table = wrapper.getComponent(EquipmentInventoryTableStub)
    const common = {
      resourceId: 42, expectedUpdatedAt: updatedAt, locationKey: 'department_equipment_room',
      accessMode: 'reservation', availabilityState: 'available', note: null,
    }

    table.vm.$emit('update', {
      ...common, itemId: 7, inventoryCode: conflictItem.inventoryCode, dataQualityStatus: 'quantity_check',
    })
    await flushPromises()
    table.vm.$emit('update', {
      ...common, itemId: 8, inventoryCode: savedSecondItem.inventoryCode, dataQualityStatus: 'verified',
    })
    await flushPromises()
    await wrapper.get('[data-action="apply-inventory-conflict"]').trigger('click')

    const items = table.props('items') as AdminEquipmentInventoryItem[]
    expect(items.find(item => item.id === 7)?.inventoryCode).toBe(conflictItem.inventoryCode)
    expect(editor.attributes('data-updated-at')).toBe(savedSecondItem.updatedAt)
    expect((editor.props('resource') as AdminResource & { type: 'equipment' }).metadata.confirmedQuantity).toBe(1)
  })

  it('rejects inventory success rows that do not match both endpoint identifiers', async () => {
    let mutation = 0
    const fetch = vi.fn(async (url: string) => {
      if (!url.includes('/inventory/')) {
        return { data: { resource: equipment, inventory: [inventoryItem, secondInventoryItem] }, requestId: 'load-trace' }
      }
      mutation += 1
      const item = mutation === 1
        ? { ...secondInventoryItem, inventoryCode: 'WRONG-ITEM' }
        : { ...inventoryItem, equipmentResourceId: 43, inventoryCode: 'WRONG-RESOURCE' }
      return { data: { item, resourceUpdatedAt: item.updatedAt }, requestId: 'inventory-trace' }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const table = wrapper.getComponent(EquipmentInventoryTableStub)
    const update = {
      resourceId: 42, itemId: 7, expectedUpdatedAt: updatedAt, inventoryCode: 'CAM-002',
      locationKey: 'department_equipment_room', accessMode: 'reservation', availabilityState: 'available',
      note: null, dataQualityStatus: 'verified',
    }

    table.vm.$emit('update', update)
    await flushPromises()
    table.vm.$emit('update', update)
    await flushPromises()

    expect((table.props('items') as AdminEquipmentInventoryItem[]).map(item => item.inventoryCode)).toEqual(['CAM-001', 'CAM-008'])
    expect(wrapper.get('[data-testid="resource-editor"]').attributes('data-updated-at')).toBe(updatedAt)
  })

  it.each([
    ['wrong code', 'INTERNAL_ERROR', inventoryItem],
    ['wrong item ID', 'RESOURCE_CONFLICT', secondInventoryItem],
    ['wrong resource ID', 'RESOURCE_CONFLICT', { ...inventoryItem, equipmentResourceId: 43 }],
  ])('does not stage inventory current with %s', async (_label, code, current) => {
    const fetch = vi.fn(async (url: string) => {
      if (!url.includes('/inventory/')) {
        return { data: { resource: equipment, inventory: [inventoryItem, secondInventoryItem] }, requestId: 'load-trace' }
      }
      throw { data: { error: { code, message: 'private', current } } }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const table = wrapper.getComponent(EquipmentInventoryTableStub)

    table.vm.$emit('update', {
      resourceId: 42, itemId: 7, expectedUpdatedAt: updatedAt, inventoryCode: 'CAM-002',
      locationKey: 'department_equipment_room', accessMode: 'reservation', availabilityState: 'available',
      note: null, dataQualityStatus: 'verified',
    })
    await flushPromises()

    expect(wrapper.find('[data-inventory-conflict]').exists()).toBe(false)
    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe('CAM-001')
    expect(table.props('mutationError')).toEqual({
      itemId: 7,
      expectedUpdatedAt: updatedAt,
      message: '기자재 항목을 저장하지 못했습니다.',
    })
  })

  it('keeps the newest save or publish response when an older same-resource mutation resolves last', async () => {
    for (const kind of ['save', 'publish'] as const) {
      const first = deferred<{ data: { resource: AdminResource, inventory: [] }, requestId: string }>()
      const newest = { ...course, title: `${kind}-newest`, updatedAt: '2026-07-15T03:00:00.000Z' } as AdminResource
      const stale = { ...course, title: `${kind}-stale`, updatedAt: '2026-07-15T02:00:00.000Z' } as AdminResource
      let mutation = 0
      const fetch = vi.fn((url: string, options?: { method?: string }) => {
        if (!options?.method) return Promise.resolve({ data: { resource: course, inventory: [] }, requestId: 'load-trace' })
        mutation += 1
        return mutation === 1
          ? first.promise
          : Promise.resolve({ data: { resource: newest, inventory: [] }, requestId: 'new-trace' })
      })
      vi.stubGlobal('$fetch', fetch)
      const wrapper = await mountDetail()
      const editor = wrapper.getComponent(ResourceEditorStub)
      const eventPayload = kind === 'save'
        ? { expectedUpdatedAt: updatedAt, resource: writeOf(course) }
        : { resourceId: 42, expectedUpdatedAt: updatedAt }

      editor.vm.$emit(kind, eventPayload)
      editor.vm.$emit(kind, eventPayload)
      await flushPromises()
      first.resolve({ data: { resource: stale, inventory: [] }, requestId: 'old-trace' })
      await flushPromises()

      expect(wrapper.get('[data-testid="resource-editor"]').text()).toContain(`${kind}-newest`)
      wrapper.unmount()
      wrappers.splice(wrappers.indexOf(wrapper), 1)
    }
  })

  it('keeps the newest inventory response when an older update resolves last', async () => {
    const first = deferred<{ data: { item: AdminEquipmentInventoryItem, resourceUpdatedAt: string }, requestId: string }>()
    const stale = { ...inventoryItem, inventoryCode: 'CAM-OLD', updatedAt: '2026-07-15T02:00:00.000Z' }
    const newest = { ...inventoryItem, inventoryCode: 'CAM-NEW', updatedAt: '2026-07-15T03:00:00.000Z' }
    let mutation = 0
    const fetch = vi.fn((url: string) => {
      if (!url.includes('/inventory/')) {
        return Promise.resolve({ data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace' })
      }
      mutation += 1
      return mutation === 1
        ? first.promise
        : Promise.resolve({ data: { item: newest, resourceUpdatedAt: newest.updatedAt }, requestId: 'new-trace' })
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const table = wrapper.getComponent(EquipmentInventoryTableStub)
    const update = {
      resourceId: 42, itemId: 7, expectedUpdatedAt: updatedAt, inventoryCode: 'CAM-NEW',
      locationKey: 'department_equipment_room', accessMode: 'reservation', availabilityState: 'available',
      note: null, dataQualityStatus: 'verified',
    }

    table.vm.$emit('update', update)
    table.vm.$emit('update', update)
    await flushPromises()
    first.resolve({ data: { item: stale, resourceUpdatedAt: stale.updatedAt }, requestId: 'old-trace' })
    await flushPromises()

    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe('CAM-NEW')
    expect(wrapper.get('[data-testid="resource-editor"]').attributes('data-updated-at')).toBe(newest.updatedAt)
  })

  it('lets resource and import lanes finish independently in reverse order', async () => {
    const save = deferred<{ data: { resource: AdminResource, inventory: AdminEquipmentInventoryItem[] }, requestId: string }>()
    const saved = { ...equipment, title: '저장 완료', updatedAt: '2026-07-15T03:00:00.000Z' } as AdminResource
    const validation = {
      expected: { total: 144, departmentEquipmentRoom: 83, fantasyLab: 61, reservation: 81, inquiry: 63 },
      actual: { total: 1, departmentEquipmentRoom: 1, fantasyLab: 0, reservation: 1, inquiry: 0 },
      duplicateInventoryCodeGroups: [], unidentifiedRows: [], quantityCheckRows: [], unmatchedSourceRows: [],
    }
    const row = {
      sourceRow: 1, name: '카메라', inventoryCode: 'CAM-001', locationKey: 'department_equipment_room',
      category: 'camera', accessMode: 'reservation', availabilityState: 'available', note: null,
      dataQualityStatus: 'verified', sourceDate: '2026-07-14', tags: ['photography'],
    }
    const fetch = vi.fn((url: string, options?: { method?: string }) => {
      if (!options?.method) return Promise.resolve({ data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace' })
      if (url.endsWith('/validate')) return Promise.resolve({ data: validation, requestId: 'import-trace' })
      return save.promise
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const file = { text: vi.fn(async () => JSON.stringify({ rows: [row] })) } as unknown as File

    wrapper.getComponent(ResourceEditorStub).vm.$emit('save', {
      expectedUpdatedAt: updatedAt, resource: writeOf(equipment),
    })
    wrapper.getComponent(EquipmentInventoryTableStub).vm.$emit('validate-import', {
      file, knownResourceCodes: ['CAM-001'],
    })
    await flushPromises()
    save.resolve({ data: { resource: saved, inventory: [inventoryItem] }, requestId: 'save-trace' })
    await flushPromises()

    expect(wrapper.get('[data-testid="resource-editor"]').text()).toContain('저장 완료')
    expect(wrapper.get('[data-testid="equipment-inventory"]').attributes('data-import-total')).toBe('1')
  })

  it('preserves a completed inventory lane when an older resource response resolves later', async () => {
    const save = deferred<{ data: { resource: AdminResource, inventory: AdminEquipmentInventoryItem[] }, requestId: string }>()
    const savedResource = {
      ...equipment,
      title: '늦게 저장된 자원',
      updatedAt: '2026-07-15T02:00:00.000Z',
    } as AdminResource
    const savedItem = {
      ...inventoryItem,
      inventoryCode: 'CAM-INVENTORY-NEW',
      dataQualityStatus: 'quantity_check' as const,
      updatedAt: '2026-07-15T04:00:00.000Z',
    }
    const fetch = vi.fn((url: string, options?: { method?: string }) => {
      if (!options?.method) {
        return Promise.resolve({ data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace' })
      }
      if (url.includes('/inventory/')) {
        return Promise.resolve({
          data: { item: savedItem, resourceUpdatedAt: savedItem.updatedAt }, requestId: 'inventory-trace',
        })
      }
      return save.promise
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const editor = wrapper.getComponent(ResourceEditorStub)
    const table = wrapper.getComponent(EquipmentInventoryTableStub)

    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, resource: writeOf(equipment) })
    table.vm.$emit('update', {
      resourceId: 42, itemId: 7, expectedUpdatedAt: updatedAt, inventoryCode: savedItem.inventoryCode,
      locationKey: 'department_equipment_room', accessMode: 'reservation', availabilityState: 'available',
      note: null, dataQualityStatus: savedItem.dataQualityStatus,
    })
    await flushPromises()
    save.resolve({
      data: { resource: savedResource, inventory: [inventoryItem] },
      requestId: 'resource-trace',
    })
    await flushPromises()

    expect(editor.text()).toContain(savedResource.title)
    expect(editor.attributes('data-updated-at')).toBe(savedItem.updatedAt)
    expect((editor.props('resource') as AdminResource & { type: 'equipment' }).metadata.confirmedQuantity).toBe(0)
    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe(savedItem.inventoryCode)
  })

  it('adopts a newer inventory row returned by a resource mutation', async () => {
    const responseItem = {
      ...inventoryItem,
      inventoryCode: 'CAM-FROM-RESOURCE',
      dataQualityStatus: 'quantity_check' as const,
      updatedAt: '2026-07-15T02:00:00.000Z',
    }
    const savedResource = {
      ...equipment,
      title: '기자재 응답 병합',
      updatedAt: responseItem.updatedAt,
    } as AdminResource
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => options?.method
      ? { data: { resource: savedResource, inventory: [responseItem] }, requestId: 'save-trace' }
      : { data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace' })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const editor = wrapper.getComponent(ResourceEditorStub)
    const table = wrapper.getComponent(EquipmentInventoryTableStub)

    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, resource: writeOf(equipment) })
    await flushPromises()

    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe(responseItem.inventoryCode)
    expect((editor.props('resource') as AdminResource & { type: 'equipment' }).metadata.confirmedQuantity).toBe(0)
  })

  it('preserves newer resource inventory when an older independent item response resolves later', async () => {
    const inventoryResponse = deferred<{
      data: { item: AdminEquipmentInventoryItem, resourceUpdatedAt: string }, requestId: string
    }>()
    const newerResourceItem = {
      ...inventoryItem,
      inventoryCode: 'CAM-RESOURCE-NEWER',
      updatedAt: '2026-07-15T04:00:00.000Z',
    }
    const olderItemResponse = {
      ...inventoryItem,
      inventoryCode: 'CAM-ITEM-OLDER',
      updatedAt: '2026-07-15T03:00:00.000Z',
    }
    const savedResource = {
      ...equipment,
      title: '자원 응답 우선 완료',
      updatedAt: newerResourceItem.updatedAt,
    } as AdminResource
    const fetch = vi.fn((url: string, options?: { method?: string }) => {
      if (!options?.method) {
        return Promise.resolve({ data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace' })
      }
      if (url.includes('/inventory/')) return inventoryResponse.promise
      return Promise.resolve({
        data: { resource: savedResource, inventory: [newerResourceItem] }, requestId: 'save-trace',
      })
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const editor = wrapper.getComponent(ResourceEditorStub)
    const table = wrapper.getComponent(EquipmentInventoryTableStub)

    table.vm.$emit('update', {
      resourceId: 42, itemId: 7, expectedUpdatedAt: updatedAt, inventoryCode: olderItemResponse.inventoryCode,
      locationKey: 'department_equipment_room', accessMode: 'reservation', availabilityState: 'available',
      note: null, dataQualityStatus: 'verified',
    })
    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, resource: writeOf(equipment) })
    await flushPromises()
    inventoryResponse.resolve({
      data: { item: olderItemResponse, resourceUpdatedAt: olderItemResponse.updatedAt },
      requestId: 'inventory-trace',
    })
    await flushPromises()

    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe(newerResourceItem.inventoryCode)
    expect(editor.attributes('data-updated-at')).toBe(newerResourceItem.updatedAt)
  })

  it('merges mixed resource inventory snapshots by exact item version and adds response-only rows', async () => {
    const currentResource = { ...equipment, updatedAt: '2026-07-15T06:00:00.000Z' } as AdminResource
    const currentNewer = {
      ...inventoryItem,
      inventoryCode: 'CURRENT-NEWER',
      dataQualityStatus: 'quantity_check' as const,
      updatedAt: '2026-07-15T05:00:00.000Z',
    }
    const currentOlder = {
      ...secondInventoryItem,
      inventoryCode: 'CURRENT-OLDER',
      dataQualityStatus: 'quantity_check' as const,
      updatedAt: '2026-07-15T02:00:00.000Z',
    }
    const currentTie = {
      ...secondInventoryItem,
      id: 10,
      sourceRow: 10,
      inventoryCode: 'CURRENT-TIE',
      dataQualityStatus: 'quantity_check' as const,
      updatedAt: '2026-07-15T05:00:00.000Z',
    }
    const responseRows: AdminEquipmentInventoryItem[] = [
      { ...currentNewer, inventoryCode: 'RESPONSE-OLDER', dataQualityStatus: 'verified', updatedAt: '2026-07-15T04:00:00.000Z' },
      { ...currentOlder, inventoryCode: 'RESPONSE-NEWER', dataQualityStatus: 'verified', updatedAt: '2026-07-15T04:00:00.000Z' },
      { ...inventoryItem, id: 9, sourceRow: 9, inventoryCode: 'RESPONSE-ONLY', updatedAt: '2026-07-15T03:00:00.000Z' },
      { ...currentTie, inventoryCode: 'RESPONSE-TIE', dataQualityStatus: 'verified' },
    ]
    const savedResource = {
      ...equipment,
      title: '혼합 병합 완료',
      updatedAt: '2026-07-15T04:00:00.000Z',
    } as AdminResource
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => options?.method
      ? { data: { resource: savedResource, inventory: responseRows }, requestId: 'save-trace' }
      : {
          data: { resource: currentResource, inventory: [currentNewer, currentOlder, currentTie] },
          requestId: 'load-trace',
        })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const editor = wrapper.getComponent(ResourceEditorStub)
    const table = wrapper.getComponent(EquipmentInventoryTableStub)

    editor.vm.$emit('save', { expectedUpdatedAt: currentResource.updatedAt, resource: writeOf(currentResource) })
    await flushPromises()

    const items = table.props('items') as AdminEquipmentInventoryItem[]
    expect(items.find(item => item.id === 7)?.inventoryCode).toBe('CURRENT-NEWER')
    expect(items.find(item => item.id === 8)?.inventoryCode).toBe('RESPONSE-NEWER')
    expect(items.find(item => item.id === 9)?.inventoryCode).toBe('RESPONSE-ONLY')
    expect(items.find(item => item.id === 10)?.inventoryCode).toBe('CURRENT-TIE')
    expect(editor.attributes('data-updated-at')).toBe(currentResource.updatedAt)
    expect((editor.props('resource') as AdminResource & { type: 'equipment' }).metadata.confirmedQuantity).toBe(2)
  })

  it('compares all timestamp fraction digits and preserves the current representation on equal or older instants', async () => {
    const initialTimestamp = '2026-07-15T01:00:00.1234567890Z'
    const newerFraction = '2026-07-15T01:00:00.1234567891Z'
    const offsetEquivalent = '2026-07-15T10:00:00.1234567891+09:00'
    const olderFraction = '2026-07-15T01:00:00.1234567889Z'
    const initialResource = { ...equipment, updatedAt: initialTimestamp } as AdminResource
    const initialItem = { ...inventoryItem, updatedAt: initialTimestamp }
    const versions = [newerFraction, offsetEquivalent, olderFraction]
    let mutation = 0
    const fetch = vi.fn(async (url: string) => {
      if (!url.includes('/inventory/')) {
        return { data: { resource: initialResource, inventory: [initialItem] }, requestId: 'load-trace' }
      }
      const timestamp = versions[mutation++] ?? olderFraction
      return {
        data: {
          item: { ...initialItem, inventoryCode: `CAM-${mutation}`, updatedAt: timestamp },
          resourceUpdatedAt: timestamp,
        },
        requestId: `inventory-${mutation}`,
      }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const editor = wrapper.getComponent(ResourceEditorStub)
    const table = wrapper.getComponent(EquipmentInventoryTableStub)
    const update = {
      resourceId: 42, itemId: 7, expectedUpdatedAt: initialTimestamp, inventoryCode: 'CAM-NEXT',
      locationKey: 'department_equipment_room', accessMode: 'reservation', availabilityState: 'available',
      note: null, dataQualityStatus: 'verified',
    }

    table.vm.$emit('update', update)
    await flushPromises()
    expect(editor.attributes('data-updated-at')).toBe(newerFraction)

    table.vm.$emit('update', { ...update, expectedUpdatedAt: newerFraction })
    await flushPromises()
    expect(editor.attributes('data-updated-at')).toBe(newerFraction)

    table.vm.$emit('update', { ...update, expectedUpdatedAt: offsetEquivalent })
    await flushPromises()
    expect(editor.attributes('data-updated-at')).toBe(newerFraction)
  })

  it('lets different inventory item lanes finish independently and preserves the newest parent timestamp', async () => {
    const first = deferred<{ data: { item: AdminEquipmentInventoryItem, resourceUpdatedAt: string }, requestId: string }>()
    const itemSeven = { ...inventoryItem, inventoryCode: 'CAM-007-SAVED', updatedAt: '2026-07-15T04:00:00.000Z' }
    const itemEight = { ...secondInventoryItem, inventoryCode: 'CAM-008-SAVED', updatedAt: '2026-07-15T05:00:00.000Z' }
    const fetch = vi.fn((url: string) => {
      if (!url.includes('/inventory/')) {
        return Promise.resolve({ data: { resource: equipment, inventory: [inventoryItem, secondInventoryItem] }, requestId: 'load-trace' })
      }
      return url.endsWith('/7')
        ? first.promise
        : Promise.resolve({ data: { item: itemEight, resourceUpdatedAt: itemEight.updatedAt }, requestId: 'eight-trace' })
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const table = wrapper.getComponent(EquipmentInventoryTableStub)
    const common = {
      resourceId: 42, expectedUpdatedAt: updatedAt, locationKey: 'department_equipment_room',
      accessMode: 'reservation', availabilityState: 'available', note: null, dataQualityStatus: 'verified',
    }

    table.vm.$emit('update', { ...common, itemId: 7, inventoryCode: itemSeven.inventoryCode })
    table.vm.$emit('update', { ...common, itemId: 8, inventoryCode: itemEight.inventoryCode })
    await flushPromises()
    first.resolve({ data: { item: itemSeven, resourceUpdatedAt: itemSeven.updatedAt }, requestId: 'seven-trace' })
    await flushPromises()

    expect((table.props('items') as AdminEquipmentInventoryItem[]).map(item => item.inventoryCode)).toEqual([
      'CAM-007-SAVED', 'CAM-008-SAVED',
    ])
    expect(wrapper.get('[data-testid="resource-editor"]').attributes('data-updated-at')).toBe(itemEight.updatedAt)
  })

  it('lets a different inventory failure release its draft while another row succeeds later', async () => {
    const first = deferred<{ data: { item: AdminEquipmentInventoryItem, resourceUpdatedAt: string }, requestId: string }>()
    const saved = { ...inventoryItem, inventoryCode: 'CAM-007-SAVED', updatedAt: '2026-07-15T04:00:00.000Z' }
    const fetch = vi.fn((url: string) => {
      if (!url.includes('/inventory/')) {
        return Promise.resolve({ data: { resource: equipment, inventory: [inventoryItem, secondInventoryItem] }, requestId: 'load-trace' })
      }
      return url.endsWith('/7')
        ? first.promise
        : Promise.reject({ data: { error: { code: 'INTERNAL_ERROR', message: 'private' } } })
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const table = wrapper.getComponent(EquipmentInventoryTableStub)
    const common = {
      resourceId: 42, expectedUpdatedAt: updatedAt, locationKey: 'department_equipment_room',
      accessMode: 'reservation', availabilityState: 'available', note: null, dataQualityStatus: 'verified',
    }

    table.vm.$emit('update', { ...common, itemId: 7, inventoryCode: saved.inventoryCode })
    table.vm.$emit('update', { ...common, itemId: 8, inventoryCode: 'CAM-008-FAIL' })
    await flushPromises()
    expect(table.props('mutationError')).toMatchObject({ itemId: 8, expectedUpdatedAt: updatedAt })

    first.resolve({ data: { item: saved, resourceUpdatedAt: saved.updatedAt }, requestId: 'seven-trace' })
    await flushPromises()
    expect((table.props('items') as AdminEquipmentInventoryItem[])[0]?.inventoryCode).toBe(saved.inventoryCode)
    expect(table.props('mutationError')).toMatchObject({ itemId: 8 })
  })

  it('reads import JSON and validates strict rows with known resource codes without applying them', async () => {
    const validation = {
      expected: { total: 144, departmentEquipmentRoom: 83, fantasyLab: 61, reservation: 81, inquiry: 63 },
      actual: { total: 1, departmentEquipmentRoom: 1, fantasyLab: 0, reservation: 1, inquiry: 0 },
      duplicateInventoryCodeGroups: [], unidentifiedRows: [], quantityCheckRows: [], unmatchedSourceRows: [],
    }
    const row = {
      sourceRow: 1, name: '카메라', inventoryCode: 'CAM-001', locationKey: 'department_equipment_room',
      category: 'camera', accessMode: 'reservation', availabilityState: 'available', note: null,
      dataQualityStatus: 'verified', sourceDate: '2026-07-14', tags: ['photography'],
    }
    const fetch = vi.fn(async (url: string) => url.endsWith('/validate')
      ? { data: validation, requestId: 'import-trace' }
      : { data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace' })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const file = { name: 'inventory.json', text: vi.fn(async () => JSON.stringify({ rows: [row] })) } as unknown as File

    wrapper.getComponent(EquipmentInventoryTableStub).vm.$emit('validate-import', {
      file, knownResourceCodes: ['CAM-001'],
    })
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/admin/resources/equipment/import/validate', {
      method: 'POST', headers: { Authorization: 'Bearer admin-token' },
      body: { rows: [row], knownResourceCodes: ['CAM-001'] },
    })
    expect(wrapper.get('[data-testid="equipment-inventory"]').attributes('data-import-total')).toBe('1')
  })

  it.each([
    ['missing name', {
      sourceRow: 1, inventoryCode: 'CAM-001', locationKey: 'department_equipment_room', category: 'camera',
      accessMode: 'reservation', availabilityState: 'available', note: null, dataQualityStatus: 'verified',
      sourceDate: '2026-07-14', tags: ['photography'],
    }],
    ['extra row field', {
      sourceRow: 1, name: '카메라', inventoryCode: 'CAM-001', locationKey: 'department_equipment_room', category: 'camera',
      accessMode: 'reservation', availabilityState: 'available', note: null, dataQualityStatus: 'verified',
      sourceDate: '2026-07-14', tags: ['photography'], privateNote: 'no',
    }],
  ])('rejects a canonical import row with %s before fetch', async (_label, row) => {
    const fetch = vi.fn(async () => ({
      data: { resource: equipment, inventory: [inventoryItem] }, requestId: 'load-trace',
    }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountDetail()
    const file = { text: vi.fn(async () => JSON.stringify({ rows: [row] })) } as unknown as File

    wrapper.getComponent(EquipmentInventoryTableStub).vm.$emit('validate-import', {
      file, knownResourceCodes: ['CAM-001'],
    })
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('canonical JSON')
  })
})

describe('administrator layout resources navigation', () => {
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

  it('exposes the resource workflow from the administrator navigation', async () => {
    const { default: Layout } = await import('../../../app/layouts/admin.vue')
    const wrapper = mount(Layout, { global: { stubs: { NuxtLink: NuxtLinkStub } } })
    wrappers.push(wrapper)

    expect(wrapper.findAll('a').some(link => (
      link.text() === '학과 자원' && link.attributes('data-to') === JSON.stringify('/admin/resources')
    ))).toBe(true)
  })
})
