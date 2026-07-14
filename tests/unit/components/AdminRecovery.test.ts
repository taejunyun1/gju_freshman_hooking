import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminRecovery from '../../../app/components/admin/AdminRecovery.vue'
import { useAdminSessionStore } from '../../../app/stores/admin-session'

const pendingRequest = {
  age: '요청 12분 경과',
  id: 77,
  maskedPhone: '010-****-5678',
  nickname: '빛의기록27',
  region: '광주광역시',
  state: '승인 대기',
}

const approvedCode = 'BwcHBwcHBwcHBwcHBwcHBw'

describe('AdminRecovery', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'short-lived-access-token',
      authenticatedAt: '2026-07-14T10:00:00.000Z',
      expiresAt: '2026-07-14T18:00:00.000Z',
      userId: 'admin-1',
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('reveals a one-time code only after explicit approval', async () => {
    const fetch = vi.fn(async () => ({
      data: { code: approvedCode, expiresAt: '2026-07-14T10:15:00.000Z' },
      requestId: 'trace-1',
    }))
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mount(AdminRecovery, { props: { request: pendingRequest } })

    expect(wrapper.text()).not.toContain('복구 코드:')
    await wrapper.get('button[data-action="approve"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith('이 요청을 승인하고 1회용 복구 코드를 발급할까요?')
    expect(wrapper.emitted('approve')).toEqual([[77]])
    expect(fetch).toHaveBeenCalledWith('/api/admin/recovery/77/approve', {
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'POST',
    })
    expect(wrapper.text()).toContain(`복구 코드: ${approvedCode}`)
    expect(wrapper.text()).toContain('코드 발급됨')
    expect(wrapper.find('button[data-action="approve"]').exists()).toBe(false)
  })

  it('does not approve when explicit confirmation is declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const fetch = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mount(AdminRecovery, { props: { request: pendingRequest } })

    await wrapper.get('button[data-action="approve"]').trigger('click')

    expect(fetch).not.toHaveBeenCalled()
    expect(wrapper.emitted('approve')).toBeUndefined()
    expect(wrapper.text()).not.toContain('복구 코드:')
  })

  it('copies from memory and sends only the request id to the copy audit endpoint', async () => {
    const fetch = vi.fn(async (path: string) => path.endsWith('/approve')
      ? { data: { code: approvedCode, expiresAt: '2026-07-14T10:15:00.000Z' }, requestId: 'trace-1' }
      : { data: { recorded: true }, requestId: 'trace-2' })
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('$fetch', fetch)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const wrapper = mount(AdminRecovery, { props: { request: pendingRequest } })

    await wrapper.get('button[data-action="approve"]').trigger('click')
    await flushPromises()
    await wrapper.get('button[data-action="copy"]').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(approvedCode)
    expect(fetch).toHaveBeenLastCalledWith('/api/admin/recovery/77/copy', {
      body: { requestId: 77 },
      headers: { Authorization: 'Bearer short-lived-access-token' },
      method: 'POST',
    })
    expect(fetch.mock.invocationCallOrder.at(-1)).toBeLessThan(writeText.mock.invocationCallOrder[0]!)
    expect(JSON.stringify(fetch.mock.calls.at(-1))).not.toContain(approvedCode)
  })

  it('clears the one-time code from component state after 60 seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('$fetch', vi.fn(async () => ({
      data: { code: approvedCode, expiresAt: '2026-07-14T10:15:00.000Z' },
      requestId: 'trace-1',
    })))
    const wrapper = mount(AdminRecovery, { props: { request: pendingRequest } })

    await wrapper.get('button[data-action="approve"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(approvedCode)

    await vi.advanceTimersByTimeAsync(59_999)
    expect(wrapper.text()).toContain(approvedCode)
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.text()).not.toContain(approvedCode)
    expect(wrapper.text()).not.toContain('복구 코드:')
    expect(wrapper.emitted('code-cleared')).toEqual([[77]])
  })

  it('discards a deferred approval response that resolves after unmount', async () => {
    vi.useFakeTimers()
    let resolveApproval!: (value: {
      data: { code: string, expiresAt: string }
      requestId: string
    }) => void
    const approvalResponse = new Promise<{
      data: { code: string, expiresAt: string }
      requestId: string
    }>(resolve => {
      resolveApproval = resolve
    })
    const fetch = vi.fn(() => approvalResponse)
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mount(AdminRecovery, { props: { request: pendingRequest } })
    const setupState = wrapper.vm.$.setupState as { code: string | null }

    await wrapper.get('button[data-action="approve"]').trigger('click')
    expect(fetch).toHaveBeenCalledOnce()
    wrapper.unmount()

    resolveApproval({
      data: { code: approvedCode, expiresAt: '2026-07-14T10:15:00.000Z' },
      requestId: 'trace-after-unmount',
    })
    await flushPromises()

    expect(setupState.code).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    expect(JSON.stringify(wrapper.emitted())).not.toContain(approvedCode)
    expect(wrapper.emitted('code-cleared')).toBeUndefined()
  })
})
