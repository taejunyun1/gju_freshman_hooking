import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAdminSessionStore } from '../../../app/stores/admin-session'

const downloadRosterWorkbook = vi.fn()
vi.mock('../../../app/composables/useRosterWorkbook', () => ({
  createCredentialWorkbook: vi.fn(() => ({ xlsx: { writeBuffer: vi.fn(async () => new ArrayBuffer(0)) } })),
  createRosterTemplate: vi.fn(),
  downloadRosterWorkbook,
}))

const cycle = { id: '11111111-1111-4111-8111-111111111111', year: 2027, status: 'current', rosterVersion: 2, passwordKeyVersion: 1, createdAt: '2026-07-17T00:00:00.000Z', archivedAt: null }
const preview = { cycleId: cycle.id, rosterVersion: 2, counts: { add: 200, update: 0, inactive: 0, unchanged: 0 }, rows: [], inactiveApplicantIds: [] }
const envelope = (data: unknown) => ({ data, requestId: 'trace-id' })

describe('annual applicant roster page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAdminSessionStore().setVerifiedSession({ accessToken: 'token', authenticatedAt: '2026-07-17T00:00:00.000Z', expiresAt: '2099-07-17T00:00:00.000Z', userId: 'admin-1' })
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('navigateTo', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the current cycle and preview difference counts', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => envelope([cycle])))
    const { default: Page } = await import('../../../app/pages/admin/students/roster.vue')
    const wrapper = mount(Page, { global: { stubs: { RosterImportPanel: true, RosterPreviewTable: true } } })
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('연간 지원자 명단')
    await (wrapper.vm as unknown as { setPreviewForTest: (value: unknown) => void }).setPreviewForTest(preview)
    await flushPromises()
    expect(wrapper.get('[data-count="add"]').text()).toContain('신규 200')
    expect(wrapper.get('[data-count="inactive"]').text()).toContain('비활성 0')
  })

  it('redirects recent-auth failures to the roster login return path', async () => {
    const failure = Object.assign(new Error('reauth'), { data: { error: { code: 'REAUTH_REQUIRED' } } })
    vi.stubGlobal('$fetch', vi.fn(async () => { throw failure }))
    const { default: Page } = await import('../../../app/pages/admin/students/roster.vue')
    mount(Page, { global: { stubs: { RosterImportPanel: true, RosterPreviewTable: true } } })
    await flushPromises()
    expect(navigateTo).toHaveBeenCalledWith('/admin/login?redirect=/admin/students/roster', { replace: true })
  })

  it('reloads the current preview after a stale roster conflict instead of retrying the stale version', async () => {
    const refreshedCycle = { ...cycle, rosterVersion: 3 }
    const refreshedPreview = { ...preview, rosterVersion: 3 }
    const conflict = Object.assign(new Error('conflict'), { data: { error: { code: 'ROSTER_CONFLICT' } } })
    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/admin/admission-cycles') return envelope([fetch.mock.calls.filter(([call]) => call === path).length > 1 ? refreshedCycle : cycle])
      if (path === '/api/admin/students/roster/apply') throw conflict
      if (path === '/api/admin/students/roster/preview') return envelope(refreshedPreview)
      throw new Error(`Unexpected path: ${path}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const { default: Page } = await import('../../../app/pages/admin/students/roster.vue')
    const wrapper = mount(Page)
    await flushPromises()
    ;(wrapper.vm as unknown as { setImportForTest: (value: unknown) => void }).setImportForTest({
      rows: [{ name: '학생', phone: '01012345678', highSchool: '광주고', grade: 'high3' }], preview, confirmation: '2027 명단 적용', idempotencyKey: 'same-key',
    })
    await flushPromises()

    await wrapper.get('[data-action="apply"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-action="reload-preview"]').text()).toContain('최신 비교 결과 다시 불러오기')

    await wrapper.get('[data-action="reload-preview"]').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/admin/students/roster/preview', expect.objectContaining({ body: expect.objectContaining({ cycleId: cycle.id }) }))
    expect(wrapper.get('[data-action="apply"]').attributes('disabled')).toBeDefined()
  })

  it('does not download current credentials from an invalid success envelope', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (path: string) => path === '/api/admin/admission-cycles' ? envelope([cycle]) : { data: [] }))
    const { default: Page } = await import('../../../app/pages/admin/students/roster.vue')
    const wrapper = mount(Page)
    await flushPromises()

    await wrapper.get('[data-action="download-current-credentials"]').trigger('click')
    await flushPromises()
    expect(downloadRosterWorkbook).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('현재 자격증명을 내려받지 못했습니다')
  })
})
