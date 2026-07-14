import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('student assessment handoff', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('navigateTo', vi.fn())
  })

  it('loads the current session and gives an honest S2 handoff', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      data: { csrfToken: 'csrf-memory-token', expiresAt: '2026-07-14T12:00:00.000Z', nickname: '고요한프레임27', prospectId: 27 },
      requestId: 'request-id',
    }))
    const { default: AssessmentPage } = await import('../../../app/pages/assessment.vue')
    const wrapper = mount(AssessmentPage, { global: { stubs: { NuxtLink: true } } })

    await flushPromises()

    expect(globalThis.$fetch).toHaveBeenCalledWith('/api/student/session')
    expect(wrapper.text()).toContain('고요한프레임27님')
    expect(wrapper.text()).toContain('관심 선택 기능은 다음 단계에서 제공됩니다.')
    expect(wrapper.text()).not.toContain('AB-5678')
    expect(wrapper.text()).not.toContain('결과')
  })

  it('redirects an unauthenticated visitor to login', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('unauthenticated')))
    const { default: AssessmentPage } = await import('../../../app/pages/assessment.vue')
    mount(AssessmentPage, { global: { stubs: { NuxtLink: true } } })

    await flushPromises()

    expect(globalThis.navigateTo).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('logs out through the API and replaces the route with login', async () => {
    vi.stubGlobal('$fetch', vi.fn()
      .mockResolvedValueOnce({
        data: { csrfToken: 'csrf-memory-token', expiresAt: '2026-07-14T12:00:00.000Z', nickname: '고요한프레임27', prospectId: 27 },
        requestId: 'session-request',
      })
      .mockResolvedValueOnce({ data: { ok: true }, requestId: 'logout-request' }))
    const { default: AssessmentPage } = await import('../../../app/pages/assessment.vue')
    const wrapper = mount(AssessmentPage, { global: { stubs: { NuxtLink: true } } })
    await flushPromises()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(globalThis.$fetch).toHaveBeenLastCalledWith('/api/student/logout', {
      headers: { 'x-photo-next-csrf': 'csrf-memory-token' },
      method: 'POST',
    })
    expect(globalThis.navigateTo).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('stays authenticated and restores an accessible error when logout fails', async () => {
    vi.stubGlobal('$fetch', vi.fn()
      .mockResolvedValueOnce({
        data: { csrfToken: 'csrf-memory-token', expiresAt: '2026-07-14T12:00:00.000Z', nickname: '고요한프레임27', prospectId: 27 },
        requestId: 'session-request',
      })
      .mockRejectedValueOnce(new Error('sensitive upstream detail')))
    const { default: AssessmentPage } = await import('../../../app/pages/assessment.vue')
    const wrapper = mount(AssessmentPage, { global: { stubs: { NuxtLink: true } } })
    await flushPromises()

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(globalThis.navigateTo).not.toHaveBeenCalled()
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('button').text()).toBe('로그아웃')
    expect(wrapper.get('[role="alert"]').text()).toBe('로그아웃하지 못했습니다. 다시 시도하세요.')
    expect(wrapper.text()).not.toContain('sensitive upstream detail')
  })
})
