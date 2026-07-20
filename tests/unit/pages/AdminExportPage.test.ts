import { readFileSync } from 'node:fs'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizationHeaders: vi.fn(() => ({ Authorization: 'Bearer test-admin-session' })),
  fetch: vi.fn(),
  useXlsxExport: vi.fn(),
}))
vi.mock('../../../app/composables/useXlsxExport', () => ({ useXlsxExport: mocks.useXlsxExport }))
vi.mock('../../../app/stores/admin-session', () => ({
  useAdminSessionStore: () => ({ authorizationHeaders: mocks.authorizationHeaders }),
}))

const wrappers: VueWrapper[] = []
const start = vi.fn()
const dispose = vi.fn()
const state = ref({
  phase: 'idle',
  busy: false,
  canRetry: false,
  error: '',
  filename: '',
  currentSheet: null,
  message: '내보낼 범위를 확인해 주세요.',
  rows: { students: 0, assessments: 0, counseling: 0 },
})
const faculty = {
  id: 2,
  name: '윤태준',
  title: '교수',
  employmentType: 'full_time' as const,
  consultationRole: 'primary' as const,
  status: 'active' as const,
  weeklyCapacity: 12,
  openAssignedCount: 1,
  lastVerifiedAt: '2026-07-20T00:00:00.000Z',
  primaryTags: [],
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const mountPage = async () => {
  const { default: Page } = await import('../../../app/pages/admin/export.vue')
  const wrapper = mount(Page, {
    global: {
      stubs: {
        AppButton: { template: '<button type="button" v-bind="$attrs"><slot /></button>' },
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('administrator export page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('$fetch', mocks.fetch)
    state.value = {
      phase: 'idle', busy: false, canRetry: false, error: '', filename: '', currentSheet: null,
      message: '내보낼 범위를 확인해 주세요.', rows: { students: 0, assessments: 0, counseling: 0 },
    }
    start.mockReset()
    dispose.mockReset()
    mocks.authorizationHeaders.mockClear()
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue({ data: { items: [faculty], nextCursor: null }, requestId: 'faculty-list' })
    mocks.useXlsxExport.mockReturnValue({ dispose, start, state })
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
    vi.unstubAllGlobals()
  })

  it('presents the approved export flow, filter-first hierarchy, and compact three-sheet ledger', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get('h1').text()).toBe('데이터 내보내기')
    expect(wrapper.text()).toContain('EXPORT / PRIVATE WORKBOOK')
    expect(wrapper.findAll('[data-export-step]').map(node => node.text())).toEqual([
      '범위 확인', '최근 인증', '행 수집', '워크북 생성',
    ])
    expect(wrapper.findAll('[data-sheet-ledger]').map(node => node.get('[data-sheet-name]').text())).toEqual([
      '학생목록', '최근참여이력', '상담현황',
    ])
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('범위')
    expect(wrapper.text()).toContain('15분')
    expect(wrapper.text()).not.toMatch(/장비 목록|시설 카탈로그|교교 재고/u)
  })

  it('submits operation filters with the selected active faculty and locks the fieldset while running', async () => {
    const wrapper = await mountPage()
    await flushPromises()
    await wrapper.get('input[name="query"]').setValue('  선명  ')
    await wrapper.get('select[name="exportSegment"]').setValue('completed_without_counseling')
    await wrapper.get('select[name="assignedFaculty"]').setValue('2')
    await wrapper.get('select[name="track"]').setValue('art_photo')
    await wrapper.get('input[name="campaignId"]').setValue('7')
    await wrapper.get('input[name="dateFrom"]').setValue('2026-07-01')
    await wrapper.get('form').trigger('submit')

    expect(start).toHaveBeenCalledWith({
      query: '선명',
      exportSegment: 'completed_without_counseling',
      assignedFaculty: 2,
      track: 'art_photo',
      campaignId: 7,
      dateFrom: '2026-07-01',
    })

    state.value = { ...state.value, busy: true, phase: 'collecting', message: '학생목록 1,000행 수집', rows: { students: 1_000, assessments: 0, counseling: 0 } }
    await flushPromises()
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-row-counts]').text()).toContain('1,000')
    expect(wrapper.text()).not.toContain('%')
  })

  it('loads active faculty once and keeps an honest fallback when the list is unavailable', async () => {
    const wrapper = await mountPage()
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/faculty', {
      headers: { Authorization: 'Bearer test-admin-session' },
      query: { status: 'active', limit: '50' },
    })
    expect(wrapper.get('select[name="assignedFaculty"]').text()).toContain('윤태준 교수')
    expect(wrapper.get('select[name="assignedFaculty"]').text()).toContain('미배정')

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    mocks.fetch.mockRejectedValueOnce(new Error('offline'))
    const unavailable = await mountPage()
    await flushPromises()
    expect(unavailable.get('[data-faculty-load-error]').text()).toContain('담당 교수 목록을 불러오지 못했습니다')
    expect(unavailable.get('select[name="assignedFaculty"]').text()).toContain('전체 담당 교수')
  })

  it('uses operation controls first, keeps personal lookup optional, and resets every filter', async () => {
    const wrapper = await mountPage()
    await flushPromises()
    const controls = wrapper.findAll('fieldset > label').map(label => label.get('span').text())
    expect(controls.slice(0, 2)).toEqual(['내보내기 대상', '담당 교수'])
    expect(wrapper.get('details').get('summary').text()).toBe('추가 검색')

    await wrapper.get('select[name="exportSegment"]').setValue('not_completed')
    await wrapper.get('select[name="assignedFaculty"]').setValue('unassigned')
    await wrapper.get('input[name="query"]').setValue('학생1')
    await wrapper.get('button[type="button"]').trigger('click')

    expect((wrapper.get('select[name="exportSegment"]').element as HTMLSelectElement).value).toBe('')
    expect((wrapper.get('select[name="assignedFaculty"]').element as HTMLSelectElement).value).toBe('')
    expect((wrapper.get('input[name="query"]').element as HTMLInputElement).value).toBe('')
  })

  it('renders a private recoverable error and exposes retry only after a failed terminal', async () => {
    const wrapper = await mountPage()
    state.value = { ...state.value, phase: 'failed', busy: false, canRetry: true, error: '내보내기를 완료하지 못했습니다.', message: '작업을 종료했습니다.' }
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('완료하지 못했습니다')
    expect(wrapper.get('[data-action="retry"]').text()).toContain('다시 시도')
    expect(wrapper.find('[data-action="start"]').exists()).toBe(false)
    expect(wrapper.get('[data-phase="failed"]').text()).toBe('FAILED')
  })

  it.each(['0', '1.5', '9007199254740992', 'campaign-seven'])(
    'rejects invalid non-empty campaign ID %s without widening the export scope',
    async (campaignId) => {
      const wrapper = await mountPage()
      await wrapper.get('input[name="campaignId"]').setValue(campaignId)
      await wrapper.get('form').trigger('submit')

      expect(start).not.toHaveBeenCalled()
      expect(wrapper.get('[data-campaign-error]').text()).toContain('양의 정수')
    },
  )

  it('uses one filter column on mobile and two columns before the desktop six-column layout', async () => {
    const css = readFileSync('app/pages/admin/export.vue', 'utf8')
    expect(css).toMatch(/\.export-filter fieldset\s*\{[^}]*grid-template-columns:\s*1fr/su)
    expect(css).toMatch(/@media \(min-width: 36rem\)[\s\S]*?grid-template-columns:\s*repeat\(2,/u)
  })

  it('announces the completed filename and disposes the run on unmount', async () => {
    const wrapper = await mountPage()
    state.value = { ...state.value, phase: 'completed', filename: 'PHOTO_NEXT_students_2026-07-16.xlsx', message: '다운로드를 완료했습니다.' }
    await flushPromises()
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('PHOTO_NEXT_students_2026-07-16.xlsx')

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
