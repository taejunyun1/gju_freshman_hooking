import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FacultyEditor from '../../../app/components/admin/FacultyEditor.vue'
import { useAdminSessionStore } from '../../../app/stores/admin-session'
import type {
  AdminFaculty,
  AdminFacultyPreview,
  AdminFacultyWrite,
} from '../../../shared/schemas/admin-faculty'

const updatedAt = '2026-07-15T01:00:00.123456Z'
const faculty: AdminFaculty = {
  id: 2,
  name: '조대연',
  title: '교수',
  employmentType: 'full_time',
  consultationRole: 'primary',
  office: '호심관 19층',
  phone: '062-670-2670',
  email: 'dancho@gwangju.ac.kr',
  website: null,
  contactVisibility: { office: 'admin_only', phone: 'hidden', email: 'public', website: 'hidden' },
  expertiseSummary: '다큐멘터리·포토커뮤니케이션·사회 기록',
  bio: '사람과 사회를 기록합니다.\n\n포토스토리를 지도합니다.',
  profileSections: {
    recommendationRole: '사회·사람 기록과 포토스토리 총괄',
    education: [], careers: [], teachingFields: ['포토커뮤니케이션'], studentProjects: [],
    careerPaths: [], institutionProjects: [], majorWorks: [],
  },
  weeklyCapacity: 4,
  priority: 10,
  sourceDate: '2026-07-14',
  lastVerifiedAt: '2026-07-14T02:00:00.654321Z',
  imagePath: null,
  tags: [{ key: 'documentary', label: '다큐멘터리 사진', category: 'track', weight: 3, isPrimary: true }],
  specialistLinks: [],
  status: 'draft',
  openAssignedCount: 1,
  createdAt: '2026-07-01T01:00:00.123456Z',
  updatedAt,
}

const writeOf = (value: AdminFaculty): AdminFacultyWrite => ({
  name: value.name, title: value.title, employmentType: value.employmentType,
  consultationRole: value.consultationRole, office: value.office, phone: value.phone,
  email: value.email, website: value.website, contactVisibility: { ...value.contactVisibility },
  expertiseSummary: value.expertiseSummary, bio: value.bio,
  profileSections: JSON.parse(JSON.stringify(value.profileSections)) as AdminFacultyWrite['profileSections'],
  weeklyCapacity: value.weeklyCapacity, priority: value.priority, sourceDate: value.sourceDate,
  lastVerifiedAt: value.lastVerifiedAt, imagePath: value.imagePath,
  tags: value.tags.map(tag => ({ ...tag })), specialistLinks: value.specialistLinks.map(link => ({ ...link })),
})

const person = (id: number, name: string, role: 'primary' | 'backup' | 'specialist') => ({
  id, name, title: role === 'specialist' ? '겸임교수' : '교수', role,
  expertise: `${name} 전문분야`, reason: `${name} 연결 이유입니다.`, publicContacts: {},
})
const preview: AdminFacultyPreview = {
  scenarios: [
    { key: 'social_photo_story', label: '사회 포토스토리', trackEvidence: 'documentary', recommendation: { primary: person(1, '조대연', 'primary'), backup: person(2, '윤태준', 'backup'), specialists: [], facultyFit: 91 } },
    { key: 'local_archive', label: '지역 아카이브', trackEvidence: 'documentary', recommendation: { primary: person(3, '김사라', 'primary'), backup: person(1, '조대연', 'backup'), specialists: [], facultyFit: 89 } },
    { key: 'video_drone', label: '영상·드론', trackEvidence: 'video', recommendation: { primary: person(2, '윤태준', 'primary'), backup: person(1, '조대연', 'backup'), specialists: [person(4, '박재웅', 'specialist')], facultyFit: 96 } },
    { key: 'commercial_fashion', label: '광고·패션', trackEvidence: 'commercial', recommendation: { primary: person(1, '조대연', 'primary'), backup: person(2, '윤태준', 'backup'), specialists: [person(6, '곽동욱', 'specialist')], facultyFit: 84 } },
  ],
}

const route = reactive({
  fullPath: '/admin/faculty/2?returnTo=%2Fadmin%2Ffaculty%3Fstatus%3Ddraft',
  params: { id: '2' } as Record<string, string>,
  query: { returnTo: '/admin/faculty?status=draft' } as Record<string, string>,
})
const AppStateStub = { props: ['variant', 'message'], template: '<div :data-state="variant">{{ message }}</div>' }
const NuxtLinkStub = { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' }
const FacultyEditorStub = {
  name: 'FacultyEditor',
  props: ['faculty', 'preview', 'previewError', 'previewing', 'saving', 'publishing', 'hasConflict', 'statusMessage'],
  emits: ['save', 'preview', 'publish'],
  template: '<div data-testid="faculty-editor" :data-name="faculty.name" :data-updated-at="faculty.updatedAt" :data-status="faculty.status" :data-preview="preview?.scenarios?.[0]?.key" :data-conflict="String(hasConflict)">{{ previewError }} {{ statusMessage }}</div>',
}
const wrappers: VueWrapper[] = []

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((done, fail) => { resolve = done; reject = fail })
  return { promise, reject, resolve }
}
const setSession = () => useAdminSessionStore().setVerifiedSession({
  accessToken: 'admin-token', authenticatedAt: updatedAt,
  expiresAt: '2099-07-15T01:00:00.000Z', userId: 'admin-1',
})
const mountPage = async () => {
  const { default: Page } = await import('../../../app/pages/admin/faculty/[id].vue')
  const wrapper = mount(Page, { global: { stubs: {
    AppState: AppStateStub, FacultyEditor: FacultyEditorStub, NuxtLink: NuxtLinkStub,
  } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
const mountRealPage = async () => {
  const { default: Page } = await import('../../../app/pages/admin/faculty/[id].vue')
  const wrapper = mount(Page, { attachTo: document.body, global: { stubs: {
    AppState: AppStateStub, NuxtLink: NuxtLinkStub,
  } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('administrator faculty detail page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setSession()
    route.params = { id: '2' }
    route.query = { returnTo: '/admin/faculty?status=draft' }
    route.fullPath = '/admin/faculty/2?returnTo=%2Fadmin%2Ffaculty%3Fstatus%3Ddraft'
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

  it('strictly loads the route faculty and preserves only a safe faculty-list return URL', async () => {
    const fetch = vi.fn(async () => ({ data: { faculty }, requestId: 'load-trace' }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()

    expect(fetch).toHaveBeenCalledWith('/api/admin/faculty/2', {
      headers: { Authorization: 'Bearer admin-token' },
    })
    expect(wrapper.get('[data-testid="faculty-editor"]').attributes('data-name')).toBe('조대연')
    expect(wrapper.get('[data-action="back-to-faculty"]').attributes('data-to')).toBe(JSON.stringify('/admin/faculty?status=draft'))

    route.query = { returnTo: '//evil.example/steal' }
    await nextTick()
    expect(wrapper.get('[data-action="back-to-faculty"]').attributes('data-to')).toBe(JSON.stringify('/admin/faculty'))
  })

  it('fails closed on over-posted and wrong-id detail payloads while keeping the page heading and retry action', async () => {
    for (const data of [
      { faculty, privateNote: 'no' },
      { faculty: { ...faculty, id: 3 } },
    ]) {
      vi.stubGlobal('$fetch', vi.fn(async () => ({ data, requestId: 'invalid-trace' })))
      const wrapper = await mountPage()
      expect(wrapper.find('[data-testid="faculty-editor"]').exists()).toBe(false)
      expect(wrapper.get('h1#faculty-detail-title').exists()).toBe(true)
      expect(wrapper.get('[data-state="error"]').text()).toContain('다시 시도')
      expect(wrapper.get('button[data-action="retry"]').exists()).toBe(true)
      wrapper.unmount()
      wrappers.splice(wrappers.indexOf(wrapper), 1)
    }
  })

  it('sends exact nested save/preview bodies and the version-only publish body, then accepts strict DTOs', async () => {
    const write = { ...writeOf(faculty), bio: '첫 문단.\n\n둘째 문단.' }
    const saved = { ...faculty, ...write, updatedAt: '2026-07-15T02:00:00.123457Z' } as AdminFaculty
    const published = { ...saved, status: 'active', updatedAt: '2026-07-15T03:00:00.123458Z' } as AdminFaculty
    const fetch = vi.fn(async (url: string, options?: { method?: string }) => {
      if (url.endsWith('/preview')) return { data: preview, requestId: 'preview-trace' }
      if (url.endsWith('/publish')) return { data: { faculty: published }, requestId: 'publish-trace' }
      if (options?.method === 'PUT') return { data: { faculty: saved }, requestId: 'save-trace' }
      return { data: { faculty }, requestId: 'load-trace' }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    const editor = wrapper.getComponent(FacultyEditorStub)

    editor.vm.$emit('preview', { faculty: write })
    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, faculty: write })
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/admin/faculty/2/preview', {
      method: 'POST', headers: { Authorization: 'Bearer admin-token' }, body: { faculty: write },
    })
    expect(fetch).toHaveBeenCalledWith('/api/admin/faculty/2', {
      method: 'PUT', headers: { Authorization: 'Bearer admin-token' }, body: { expectedUpdatedAt: updatedAt, faculty: write },
    })
    expect(editor.props('preview')).toEqual(preview)
    expect(editor.props('faculty')).toEqual(saved)

    editor.vm.$emit('publish', { facultyId: 2, expectedUpdatedAt: saved.updatedAt })
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/admin/faculty/2/publish', {
      method: 'POST', headers: { Authorization: 'Bearer admin-token' }, body: { expectedUpdatedAt: saved.updatedAt },
    })
    expect(editor.props('faculty')).toEqual(published)
  })

  it('locks the real editor during a deferred save, rejects cross-lane publish, and adopts the accepted server DTO as the clean baseline', async () => {
    const accepted = {
      ...faculty,
      name: '저장 요청 조대연',
      updatedAt: '2026-07-15T02:00:00.123457Z',
    } as AdminFaculty
    const forbiddenPublish = {
      ...accepted,
      name: '실행되면 안 되는 게시',
      status: 'active',
      updatedAt: '2026-07-15T03:00:00.123458Z',
    } as AdminFaculty
    const saveResponse = deferred<{ data: { faculty: AdminFaculty }, requestId: string }>()
    const fetch = vi.fn((url: string, options?: { method?: string }) => {
      if (!options?.method) return Promise.resolve({ data: { faculty }, requestId: 'load-trace' })
      if (url.endsWith('/publish')) {
        return Promise.resolve({ data: { faculty: forbiddenPublish }, requestId: 'forbidden-publish' })
      }
      return saveResponse.promise
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountRealPage()
    const editor = wrapper.getComponent(FacultyEditor)
    const name = wrapper.get<HTMLInputElement>('input[name="name"]')
    const publish = wrapper.get<HTMLButtonElement>('button[data-action="publish-faculty"]')

    await name.setValue(accepted.name)
    await wrapper.get('button[data-action="save-faculty"]').trigger('click')
    await nextTick()
    editor.vm.$emit('publish', { facultyId: 2, expectedUpdatedAt: updatedAt })
    await flushPromises()

    const mutationCalls = fetch.mock.calls.filter(([, options]) => options?.method)
    expect(mutationCalls).toHaveLength(1)
    expect(mutationCalls[0]?.[0]).toBe('/api/admin/faculty/2')
    expect(name.element.closest('fieldset')?.hasAttribute('disabled')).toBe(true)
    expect(publish.attributes('disabled')).toBeUndefined()
    expect(publish.attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('[data-faculty-conflict]').exists()).toBe(false)
    expect(wrapper.get('.faculty-detail__header').text()).toContain('DRAFT')

    saveResponse.resolve({ data: { faculty: accepted }, requestId: 'save-trace' })
    await flushPromises()
    expect(name.element.value).toBe(accepted.name)
    expect(name.element.closest('fieldset')?.hasAttribute('disabled')).toBe(false)
    expect(publish.attributes('aria-disabled')).toBe('false')
    expect(wrapper.text()).toContain('변경 내용을 저장했습니다.')
    expect(wrapper.get('.faculty-detail__header').text()).toContain('DRAFT')
  })

  it('keeps the real publish trigger focused during a deferred publish and rejects duplicate publish plus cross-lane save', async () => {
    const published = {
      ...faculty,
      status: 'active',
      updatedAt: '2026-07-15T02:00:00.123457Z',
    } as AdminFaculty
    const forbiddenSave = {
      ...faculty,
      name: '실행되면 안 되는 저장',
      updatedAt: '2026-07-15T03:00:00.123458Z',
    } as AdminFaculty
    const publishResponse = deferred<{ data: { faculty: AdminFaculty }, requestId: string }>()
    const fetch = vi.fn((url: string, options?: { method?: string }) => {
      if (!options?.method) return Promise.resolve({ data: { faculty }, requestId: 'load-trace' })
      if (options.method === 'PUT') {
        return Promise.resolve({ data: { faculty: forbiddenSave }, requestId: 'forbidden-save' })
      }
      if (url.endsWith('/publish')) return publishResponse.promise
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountRealPage()
    const editor = wrapper.getComponent(FacultyEditor)
    const publish = wrapper.get<HTMLButtonElement>('button[data-action="publish-faculty"]')

    await publish.trigger('click')
    const confirm = wrapper.get<HTMLButtonElement>('button[data-action="confirm-publish"]')
    expect(document.activeElement).toBe(confirm.element)
    await confirm.trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(publish.element)
    expect(publish.attributes('disabled')).toBeUndefined()
    expect(publish.attributes('aria-disabled')).toBe('true')
    expect(wrapper.get('input[name="name"]').element.closest('fieldset')?.hasAttribute('disabled')).toBe(true)

    await publish.trigger('click')
    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, faculty: writeOf(faculty) })
    await flushPromises()

    const mutationCalls = fetch.mock.calls.filter(([, options]) => options?.method)
    expect(mutationCalls).toHaveLength(1)
    expect(mutationCalls[0]?.[0]).toBe('/api/admin/faculty/2/publish')
    expect(wrapper.find('button[data-action="confirm-publish"]').exists()).toBe(false)
    expect(wrapper.find('[data-faculty-conflict]').exists()).toBe(false)
    expect(wrapper.get('.faculty-detail__header').text()).toContain('DRAFT')

    publishResponse.resolve({ data: { faculty: published }, requestId: 'publish-trace' })
    await flushPromises()
    expect(wrapper.get('.faculty-detail__header').text()).toContain('ACTIVE')
    expect(wrapper.get<HTMLInputElement>('input[name="name"]').element.value).toBe(faculty.name)
    expect(publish.attributes('aria-disabled')).toBe('false')
    expect(document.activeElement).toBe(publish.element)
    expect(wrapper.text()).toContain('학생 추천에 게시했습니다.')
  })

  it('rejects a malformed or noncanonical preview and reports a stable actionable message without replacing the last good proof', async () => {
    let previewCall = 0
    const fetch = vi.fn(async (url: string) => {
      if (!url.endsWith('/preview')) return { data: { faculty }, requestId: 'load-trace' }
      previewCall += 1
      if (previewCall === 1) return { data: preview, requestId: 'good-preview' }
      return { data: { scenarios: [...preview.scenarios].reverse() }, requestId: 'bad-preview' }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    const editor = wrapper.getComponent(FacultyEditorStub)
    editor.vm.$emit('preview', { faculty: writeOf(faculty) })
    await flushPromises()
    editor.vm.$emit('preview', { faculty: writeOf(faculty) })
    await flushPromises()

    expect(editor.props('preview')).toEqual(preview)
    expect(editor.props('previewError')).toContain('사회 포토스토리부터')
  })

  it('keeps preview races isolated while rejecting a stale same-lane proof', async () => {
    const oldPreview = deferred<{ data: AdminFacultyPreview, requestId: string }>()
    let previewCalls = 0
    const fetch = vi.fn((url: string, options?: { method?: string }) => {
      if (!options?.method) return Promise.resolve({ data: { faculty }, requestId: 'load-trace' })
      if (url.endsWith('/preview')) return ++previewCalls === 1
        ? oldPreview.promise
        : Promise.resolve({ data: preview, requestId: 'new-preview' })
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    const editor = wrapper.getComponent(FacultyEditorStub)
    const write = writeOf(faculty)

    editor.vm.$emit('preview', { faculty: write })
    editor.vm.$emit('preview', { faculty: write })
    await flushPromises()
    expect(editor.props('faculty')).toEqual(faculty)
    expect(editor.props('preview')).toEqual(preview)

    oldPreview.resolve({ data: { scenarios: [...preview.scenarios].reverse() } as AdminFacultyPreview, requestId: 'old-preview' })
    await flushPromises()
    expect(editor.props('faculty')).toEqual(faculty)
    expect(editor.props('preview')).toEqual(preview)
  })

  it('reacts to a reused route and ignores every response belonging to the prior faculty ID', async () => {
    const first = deferred<{ data: { faculty: AdminFaculty }, requestId: string }>()
    const next = { ...faculty, id: 3, name: '김사라' } as AdminFaculty
    const fetch = vi.fn((url: string) => url.endsWith('/2')
      ? first.promise
      : Promise.resolve({ data: { faculty: next }, requestId: 'faculty-3' }))
    vi.stubGlobal('$fetch', fetch)
    const { default: Page } = await import('../../../app/pages/admin/faculty/[id].vue')
    const wrapper = mount(Page, { global: { stubs: {
      AppState: AppStateStub, FacultyEditor: FacultyEditorStub, NuxtLink: NuxtLinkStub,
    } } })
    wrappers.push(wrapper)
    await nextTick()
    route.params = { id: '3' }
    route.fullPath = '/admin/faculty/3'
    await nextTick()
    await flushPromises()
    expect(wrapper.get('[data-testid="faculty-editor"]').attributes('data-name')).toBe('김사라')

    first.resolve({ data: { faculty }, requestId: 'stale-faculty-2' })
    await flushPromises()
    expect(wrapper.get('[data-testid="faculty-editor"]').attributes('data-name')).toBe('김사라')
  })

  it('preserves local editing on a strict conflict and applies the same-ID server current only on explicit action', async () => {
    const current = { ...faculty, name: '서버 최신 조대연', updatedAt: '2026-07-15T02:00:00.123457Z' } as AdminFaculty
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => {
      if (!options?.method) return { data: { faculty }, requestId: 'load-trace' }
      throw { data: { error: { code: 'FACULTY_CONFLICT', message: 'private database text', current } } }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    const editor = wrapper.getComponent(FacultyEditorStub)
    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, faculty: { ...writeOf(faculty), name: '내 편집' } })
    await flushPromises()

    expect(editor.props('faculty')).toEqual(faculty)
    expect(editor.props('hasConflict')).toBe(true)
    expect(wrapper.get('[data-faculty-conflict]').text()).toContain('서버 최신 조대연')
    expect(wrapper.text()).not.toContain('private database text')

    await wrapper.get('button[data-action="apply-faculty-conflict"]').trigger('click')
    expect(editor.props('faculty')).toEqual(current)
    expect(editor.props('hasConflict')).toBe(false)
  })

  it('fails closed on wrong-ID conflict and wrong-ID mutation success payloads', async () => {
    let mode: 'conflict' | 'success' = 'conflict'
    const fetch = vi.fn(async (_url: string, options?: { method?: string }) => {
      if (!options?.method) return { data: { faculty }, requestId: 'load-trace' }
      if (mode === 'conflict') throw { data: { error: { code: 'FACULTY_CONFLICT', current: { ...faculty, id: 3 } } } }
      return { data: { faculty: { ...faculty, id: 3 } }, requestId: 'wrong-success' }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    const editor = wrapper.getComponent(FacultyEditorStub)
    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, faculty: writeOf(faculty) })
    await flushPromises()
    expect(wrapper.find('[data-faculty-conflict]').exists()).toBe(false)
    expect(editor.props('faculty')).toEqual(faculty)

    mode = 'success'
    editor.vm.$emit('save', { expectedUpdatedAt: updatedAt, faculty: writeOf(faculty) })
    await flushPromises()
    expect(editor.props('faculty')).toEqual(faculty)
    expect(editor.props('statusMessage')).toContain('저장하지 못')
  })

  it.each(['ADMIN_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'])(
    'clears the session and recovers %s at login without exposing provider detail', async (code) => {
      const navigate = vi.mocked(navigateTo)
      vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { error: { code, message: 'private provider detail' } } }))
      const wrapper = await mountPage()

      expect(useAdminSessionStore().session).toBeNull()
      expect(navigate).toHaveBeenCalledWith({
        path: '/admin/login',
        query: { redirect: '/admin/faculty/2?returnTo=%2Fadmin%2Ffaculty%3Fstatus%3Ddraft' },
      }, { replace: true })
      expect(wrapper.text()).not.toContain('private provider detail')
    },
  )

  it('maps stable preview codes to actionable Korean while keeping the editor mounted', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (!url.endsWith('/preview')) return { data: { faculty }, requestId: 'load-trace' }
      throw { data: { error: { code: 'FACULTY_CONTENT_NOT_READY', message: 'private details' } } }
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountPage()
    const editor = wrapper.getComponent(FacultyEditorStub)
    editor.vm.$emit('preview', { faculty: writeOf(faculty) })
    await flushPromises()

    expect(wrapper.find('[data-testid="faculty-editor"]').exists()).toBe(true)
    expect(editor.props('previewError')).toContain('게시 준비')
    expect(wrapper.text()).not.toContain('private details')
  })
})
