import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CounselingQueue from '../../../app/components/admin/CounselingQueue.vue'
import { useAdminSessionStore } from '../../../app/stores/admin-session'
import type { AdminCounselingQueueItem } from '../../../shared/schemas/counseling'

const requestId = '11111111-1111-4111-8111-111111111111'

const faculty = [
  { id: 11, name: '윤태준', title: '교수' },
  { id: 12, name: '조대연', title: '교수' },
]

const request = (status: AdminCounselingQueueItem['status'] = 'new'): AdminCounselingQueueItem => ({
  id: requestId,
  assessmentPublicId: '22222222-2222-4222-8222-222222222222',
  primaryTrack: 'art_photo',
  secondaryTrack: 'video',
  selectedWorkLabels: ['사진과 영상을 결합한 전시'],
  selectedCareerLabels: ['미디어아티스트'],
  nickname: '빛의기록27',
  nameStatus: 'available',
  maskedPhone: '010-****-5678',
  phoneStatus: 'available',
  schoolName: '광주고등학교',
  applicantStage: 'high3',
  region: 'gwangju',
  contactMethod: 'phone',
  availability: 'weekday_afternoon',
  consentedAt: '2026-07-15T01:00:00.000Z',
  createdAt: '2026-07-15T01:00:00.000Z',
  updatedAt: '2026-07-15T01:00:00.000Z',
  assignedAt: status === 'new' ? null : '2026-07-15T02:00:00.000Z',
  contactedAt: ['contacted', 'completed'].includes(status) ? '2026-07-15T03:00:00.000Z' : null,
  completedAt: status === 'completed' ? '2026-07-15T04:00:00.000Z' : null,
  closedAt: status === 'closed' ? '2026-07-15T04:00:00.000Z' : null,
  status,
  version: status === 'new' ? 0 : 1,
  assignedFaculty: status === 'new' ? null : faculty[0]!,
  recommendations: [
    { ...faculty[0]!, role: 'primary', rank: 1 },
    { ...faculty[1]!, role: 'backup', rank: 1 },
  ],
})

const envelope = (data: unknown) => ({ data, requestId: 'trace-id' })
const current = (status: AdminCounselingQueueItem['status'], version = 1) => {
  const item = request(status)
  return {
    id: item.id,
    status: item.status,
    version,
    assignedAt: item.assignedAt,
    contactedAt: item.contactedAt,
    completedAt: item.completedAt,
    closedAt: item.closedAt,
    updatedAt: item.updatedAt,
    assignedFaculty: item.assignedFaculty,
  }
}
const apiError = (code: string, current?: unknown) => Object.assign(new Error(code), {
  data: { error: { code, message: 'private detail', ...(current ? { current } : {}) }, requestId: 'private-id' },
})

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

const wrappers: VueWrapper[] = []

const mountQueue = (item = request()) => {
  const wrapper = mount(CounselingQueue, { attachTo: document.body, props: { faculty, items: [item] } })
  wrappers.push(wrapper)
  return wrapper
}

describe('administrator counseling queue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'short-lived-access-token',
      authenticatedAt: '2026-07-15T01:00:00.000Z',
      expiresAt: '2099-07-15T09:00:00.000Z',
      userId: 'admin-1',
    })
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('keeps the phone masked and prioritizes interests, careers, and recommendation roles', () => {
    const wrapper = mountQueue()

    expect(wrapper.text()).toContain('010-****-5678')
    expect(wrapper.text()).not.toContain('010-1234-5678')
    expect(wrapper.text()).toContain('예술사진')
    expect(wrapper.text()).toContain('사진과 영상을 결합한 전시')
    expect(wrapper.text()).toContain('미디어아티스트')
    expect(wrapper.text()).toMatch(/총괄 윤태준/u)
    expect(wrapper.text()).toMatch(/예비 조대연/u)
    expect(wrapper.text()).not.toMatch(/장비|기자재|facility/u)
  })

  it('marks an undecryptable stored phone for verification without exposing unusable actions', () => {
    const unavailable = {
      ...request(),
      maskedPhone: null,
      phoneStatus: 'verification_required',
    } as unknown as AdminCounselingQueueItem
    const wrapper = mountQueue(unavailable)

    expect(wrapper.text()).toContain('저장된 연락처를 확인할 수 없습니다')
    expect(wrapper.text()).toContain('원본 명단과 암호화 설정 확인이 필요합니다')
    expect(wrapper.find('button[data-action="reveal-phone"]').exists()).toBe(false)
    expect(wrapper.find('button[data-action="copy-summary"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/010[-\d]+/u)
  })

  it('marks an unavailable roster applicant name for source verification', () => {
    const unavailable = {
      ...request(),
      nickname: '학생 이름 확인 필요',
      nameStatus: 'verification_required',
    } as unknown as AdminCounselingQueueItem
    const wrapper = mountQueue(unavailable)

    expect(wrapper.text()).toContain('학생 이름 확인 필요')
    expect(wrapper.text()).toContain('원본 명단과 암호화 설정에서 이름을 확인해 주세요')
    expect(wrapper.text()).not.toContain('roster:')
  })

  it('assigns an explicitly selected faculty member with the current version and authorization', async () => {
    const fetch = vi.fn(async () => envelope(current('assigned')))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountQueue()

    await wrapper.get(`select[data-action="faculty-${requestId}"]`).setValue('11')
    await wrapper.get('button[data-action="assign"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(`/api/admin/counseling/${requestId}/assign`, {
      body: { assignedFacultyId: 11, expectedVersion: 0 },
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'POST',
    })
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('blocks duplicate mutations while the first request is pending', async () => {
    const response = deferred<unknown>()
    const fetch = vi.fn(() => response.promise)
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountQueue()

    await wrapper.get(`select[data-action="faculty-${requestId}"]`).setValue('11')
    const action = wrapper.get('button[data-action="assign"]')
    await action.trigger('click')
    await action.trigger('click')

    expect(fetch).toHaveBeenCalledTimes(1)
    response.resolve(envelope(current('assigned')))
    await flushPromises()
  })

  it.each([
    ['assigned', 'contacted', '연락 완료'],
    ['contacted', 'completed', '상담 완료'],
    ['new', 'closed', '요청 종료'],
  ] as const)('offers the allowed %s to %s transition with expectedVersion', async (from, to, buttonLabel) => {
    const fetch = vi.fn(async () => envelope(current(to, 2)))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountQueue(request(from))

    await wrapper.get(`button[aria-label="${buttonLabel}"]`).trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(`/api/admin/counseling/${requestId}/transition`, {
      body: { expectedVersion: request(from).version, to },
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'POST',
    })
  })

  it('does not close a request when the identity-and-target confirmation is cancelled', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    vi.mocked(confirm).mockReturnValueOnce(false)
    const wrapper = mountQueue()

    await wrapper.get('button[aria-label="요청 종료"]').trigger('click')

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/빛의기록27.*신규 접수.*요청 종료/su))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not repeat the close confirmation or API call while closure is pending', async () => {
    const response = deferred<unknown>()
    const fetch = vi.fn(() => response.promise)
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountQueue()
    const action = wrapper.get('button[aria-label="요청 종료"]')

    await action.trigger('click')
    await action.trigger('click')

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    response.resolve(envelope(current('closed', 1)))
    await flushPromises()
  })

  it('requires a reason to reopen terminal records and sends the current version', async () => {
    const fetch = vi.fn(async () => envelope(current('new', 2)))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountQueue(request('completed'))

    await wrapper.get('button[data-action="reopen"]').trigger('click')
    expect(fetch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('재오픈 사유를 입력')

    await wrapper.get('textarea[name="reopenReason"]').setValue('학생의 추가 상담 요청')
    await wrapper.get('button[data-action="reopen"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(`/api/admin/counseling/${requestId}/reopen`, {
      body: { expectedVersion: 1, reason: '학생의 추가 상담 요청' },
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'POST',
    })
  })

  it('does not reopen a request when the identity, target, and reason confirmation is cancelled', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    vi.mocked(confirm).mockReturnValueOnce(false)
    const wrapper = mountQueue(request('completed'))

    await wrapper.get('textarea[name="reopenReason"]').setValue('학생의 추가 상담 요청')
    await wrapper.get('button[data-action="reopen"]').trigger('click')

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/빛의기록27.*신규 접수.*학생의 추가 상담 요청/su))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows a closed request as the explicit terminal progress stage', () => {
    const wrapper = mountQueue({
      ...request('closed'),
      assignedAt: null,
      assignedFaculty: null,
    })
    const stages = wrapper.findAll('[data-counseling-progress]')

    expect(stages).toHaveLength(5)
    expect(stages.at(-1)?.text()).toBe('요청 종료')
    expect(stages.map(stage => stage.attributes('data-state'))).toEqual([
      'done',
      'upcoming',
      'upcoming',
      'upcoming',
      'active',
    ])
  })

  it.each([
    {
      label: 'assigned then closed',
      assignedAt: '2026-07-15T02:00:00.000Z',
      contactedAt: null,
      expected: ['done', 'done', 'upcoming', 'upcoming', 'active'],
    },
    {
      label: 'contacted then closed',
      assignedAt: '2026-07-15T02:00:00.000Z',
      contactedAt: '2026-07-15T03:00:00.000Z',
      expected: ['done', 'done', 'done', 'upcoming', 'active'],
    },
  ])('marks only timestamp-backed stages done when $label', ({ assignedAt, contactedAt, expected }) => {
    const wrapper = mountQueue({ ...request('closed'), assignedAt, contactedAt })
    expect(wrapper.findAll('[data-counseling-progress]').map(stage => stage.attributes('data-state'))).toEqual(expected)
  })

  it('uses a validated conflict snapshot, blocks another stale action, and requests a refresh', async () => {
    const current = {
      id: requestId,
      status: 'assigned',
      version: 4,
      assignedAt: '2026-07-15T02:00:00.000Z',
      contactedAt: null,
      completedAt: null,
      closedAt: null,
      updatedAt: '2026-07-15T02:00:00.000Z',
      assignedFaculty: faculty[0],
    }
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(apiError('COUNSELING_CONFLICT', current)))
    const wrapper = mountQueue()

    await wrapper.get(`select[data-action="faculty-${requestId}"]`).setValue('11')
    await wrapper.get('button[data-action="assign"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('다른 관리자가 먼저 처리')
    expect(wrapper.text()).toContain('배정 완료')
    expect(wrapper.find('button[data-action="assign"]').exists()).toBe(false)
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('prefers a newer authoritative prop snapshot for rendering and the next expectedVersion', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(envelope(current('assigned', 1)))
      .mockResolvedValueOnce(envelope(current('completed', 3)))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountQueue()

    await wrapper.get(`select[data-action="faculty-${requestId}"]`).setValue('11')
    await wrapper.get('button[data-action="assign"]').trigger('click')
    await flushPromises()
    await wrapper.setProps({
      items: [{
        ...request('contacted'),
        assignedFaculty: faculty[1]!,
        updatedAt: '2026-07-15T05:00:00.000Z',
        version: 2,
      }],
    })

    expect(wrapper.text()).toContain('실제 담당 · 조대연 교수')
    await wrapper.get('button[aria-label="상담 완료"]').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith(`/api/admin/counseling/${requestId}/transition`, {
      body: { expectedVersion: 2, to: 'completed' },
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'POST',
    })
  })

  it('keeps a higher-version local snapshot when props regress and uses its expectedVersion', async () => {
    const localCurrent = {
      id: requestId,
      status: 'assigned',
      version: 4,
      assignedAt: '2026-07-15T02:00:00.000Z',
      contactedAt: null,
      completedAt: null,
      closedAt: null,
      updatedAt: '2026-07-15T05:00:00.000Z',
      assignedFaculty: faculty[0],
    }
    const fetch = vi.fn()
      .mockRejectedValueOnce(apiError('COUNSELING_CONFLICT', localCurrent))
      .mockResolvedValueOnce(envelope(current('contacted', 5)))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountQueue()

    await wrapper.get(`select[data-action="faculty-${requestId}"]`).setValue('11')
    await wrapper.get('button[data-action="assign"]').trigger('click')
    await flushPromises()
    await wrapper.setProps({
      items: [{
        ...request('new'),
        updatedAt: '2026-07-15T04:00:00.000Z',
        version: 3,
      }],
    })

    expect(wrapper.text()).toContain('배정 완료')
    expect(wrapper.find('button[data-action="assign"]').exists()).toBe(false)
    await wrapper.get('button[aria-label="연락 완료"]').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith(`/api/admin/counseling/${requestId}/transition`, {
      body: { expectedVersion: 4, to: 'contacted' },
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'POST',
    })
  })

  it('treats equal-version props as authoritative and cleans local record state when an item is removed', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => envelope(current('assigned', 1))))
    const wrapper = mountQueue()
    const state = wrapper.vm.$.setupState as { currentSnapshots: Record<string, unknown> }

    await wrapper.get(`select[data-action="faculty-${requestId}"]`).setValue('11')
    await wrapper.get('button[data-action="assign"]').trigger('click')
    await flushPromises()
    expect(state.currentSnapshots).toHaveProperty(requestId)

    await wrapper.setProps({
      items: [{
        ...request('assigned'),
        assignedFaculty: faculty[1]!,
        updatedAt: '2026-07-15T05:00:00.000Z',
        version: 1,
      }],
    })
    expect(wrapper.text()).toContain('실제 담당 · 조대연 교수')
    expect(state.currentSnapshots).not.toHaveProperty(requestId)

    await wrapper.setProps({ items: [] })
    expect(state.currentSnapshots).toEqual({})
  })

  it('does not recreate local record state when a mutation resolves after its item was removed', async () => {
    const response = deferred<unknown>()
    vi.stubGlobal('$fetch', vi.fn(() => response.promise))
    const wrapper = mountQueue()
    const state = wrapper.vm.$.setupState as {
      busyRequests: Record<string, boolean>
      currentSnapshots: Record<string, unknown>
    }

    await wrapper.get(`select[data-action="faculty-${requestId}"]`).setValue('11')
    await wrapper.get('button[data-action="assign"]').trigger('click')
    await wrapper.setProps({ items: [] })
    response.resolve(envelope(current('assigned', 1)))
    await flushPromises()

    expect(state.currentSnapshots).toEqual({})
    expect(state.busyRequests).toEqual({})
    expect(wrapper.emitted('refresh')).toBeUndefined()
  })

  it.each(['MFA_REQUIRED', 'REAUTH_REQUIRED'])('opens a native modal dialog for %s and clears the session before navigation', async (code) => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(apiError(code)))
    const wrapper = mountQueue()

    const trigger = wrapper.get<HTMLButtonElement>('button[data-action="reveal-phone"]')
    trigger.element.focus()
    await trigger.trigger('click')
    await flushPromises()

    const dialog = wrapper.get('dialog[role="dialog"]')
    expect(dialog.attributes()).toHaveProperty('open')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.text()).toContain('비밀번호 재로그인이 필요합니다')
    expect(dialog.text()).toContain('이메일과 비밀번호로 다시 로그인하세요')
    expect(dialog.text()).not.toContain('2단계 인증')
    expect(dialog.find('button[data-action="cancel-reauthentication"]').exists()).toBe(true)
    expect(dialog.get('button[data-action="reauthenticate"]').text()).toBe('비밀번호로 다시 로그인')
    await dialog.get('button[data-action="reauthenticate"]').trigger('click')

    expect(useAdminSessionStore().session).toBeNull()
    expect(navigateTo).toHaveBeenCalledWith({ path: '/admin/login', query: { redirect: '/admin/counseling' } }, { replace: true })
  })

  it('closes the native reauthentication dialog on cancel and restores focus to its trigger', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(apiError('REAUTH_REQUIRED')))
    const wrapper = mountQueue()
    const trigger = wrapper.get<HTMLButtonElement>('button[data-action="reveal-phone"]')
    trigger.element.focus()

    await trigger.trigger('click')
    await flushPromises()
    const dialog = wrapper.get('dialog[role="dialog"]')

    const reauthenticate = dialog.get<HTMLButtonElement>('button[data-action="reauthenticate"]')
    const cancel = dialog.get<HTMLButtonElement>('button[data-action="cancel-reauthentication"]')
    expect(document.activeElement).toBe(reauthenticate.element)
    await reauthenticate.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(cancel.element)
    await cancel.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(reauthenticate.element)

    await dialog.trigger('cancel')
    await flushPromises()

    expect(dialog.attributes()).not.toHaveProperty('open')
    expect(document.activeElement).toBe(trigger.element)
    expect(useAdminSessionStore().session).not.toBeNull()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('keeps a revealed phone only in component memory for 60 seconds and clears it on unmount', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => envelope({ phone: '01012345678' }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mountQueue()
    const state = wrapper.vm.$.setupState as { revealedPhones: Record<string, string> }

    await wrapper.get('button[data-action="reveal-phone"]').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith(`/api/admin/counseling/${requestId}/reveal-phone`, {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'POST',
    })
    expect(wrapper.text()).toContain('010-1234-5678')
    expect(wrapper.text()).not.toContain('01012345678')
    expect(sessionStorage.getItem('01012345678')).toBeNull()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(wrapper.text()).not.toContain('010-1234-5678')

    await wrapper.get('button[data-action="reveal-phone"]').trigger('click')
    await flushPromises()
    wrapper.unmount()
    expect(state.revealedPhones).toEqual({})
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['010-1234-5678', '0101234567', '010123456789', '01112345678'])('rejects an invalid or non-canonical phone response: %s', async (phone) => {
    vi.useFakeTimers()
    vi.stubGlobal('$fetch', vi.fn(async () => envelope({ phone })))
    const wrapper = mountQueue()

    await wrapper.get('button[data-action="reveal-phone"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('010-****-5678')
    expect(wrapper.text()).not.toContain('010-1234-5678')
    expect(wrapper.text()).toContain('요청을 처리하지 못했습니다')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('copies a summary directly without rendering or sending its plaintext', async () => {
    const summary = '상담요약\n전화: 010-1234-5678\n관심: 예술사진'
    const fetch = vi.fn(async () => envelope({ summary }))
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('$fetch', fetch)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const wrapper = mountQueue()

    await wrapper.get('button[data-action="copy-summary"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(`/api/admin/counseling/${requestId}/summary`, {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'GET',
    })
    expect(writeText).toHaveBeenCalledWith(summary)
    expect(wrapper.text()).toContain('상담 요약을 복사했습니다')
    expect(wrapper.text()).not.toContain('010-1234-5678')
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(summary)
    expect(JSON.stringify(wrapper.emitted())).not.toContain(summary)
  })

  it('ignores a sensitive response that resolves after unmount', async () => {
    const response = deferred<unknown>()
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('$fetch', vi.fn(() => response.promise))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const wrapper = mountQueue()

    await wrapper.get('button[data-action="reveal-phone"]').trigger('click')
    wrapper.unmount()
    response.resolve(envelope({ phone: '01012345678' }))
    await flushPromises()

    expect(writeText).not.toHaveBeenCalled()
    expect(JSON.stringify(wrapper.emitted())).not.toContain('010-1234-5678')
  })
})
