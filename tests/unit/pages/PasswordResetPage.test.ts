import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

describe('password reset page', () => {
  it('shows the anonymous request state and never claims that a text was sent', async () => {
    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/student/session') throw new Error('not signed in')
      return { accepted: true }
    })
    vi.stubGlobal('$fetch', fetch)
    const { default: PasswordResetPage } = await import('../../../app/pages/password/reset.vue')
    const wrapper = mount(PasswordResetPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })
    await flushPromises()

    expect(wrapper.find('input[name="phone"]').attributes('autocomplete')).toBe('tel')
    expect(wrapper.find('input[name="nickname"]').exists()).toBe(true)
    expect(wrapper.find('input[name="newPassword"]').exists()).toBe(false)
    await wrapper.find('input[name="phone"]').setValue('01012345678')
    await wrapper.find('input[name="nickname"]').setValue('빛의기록27')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('요청을 접수했습니다. 학과 확인 절차가 필요한 경우 안내받은 연락 방식으로 복구 코드를 전달합니다.')
    expect(wrapper.text()).not.toMatch(/문자.*발송|SMS.*발송/u)
    expect(fetch).toHaveBeenCalledWith('/api/student/password/recovery/request', expect.objectContaining({ method: 'POST' }))
  })

  it('shows a current-password change form only for an active student session', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({
      data: { expiresAt: '2026-07-14T22:00:00.000Z', nickname: '빛의기록27', prospectId: 44 },
    })))
    const { default: PasswordResetPage } = await import('../../../app/pages/password/reset.vue')
    const wrapper = mount(PasswordResetPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })
    await flushPromises()

    expect(wrapper.find('input[name="currentPassword"]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.find('input[name="newPassword"]').attributes('autocomplete')).toBe('new-password')
    expect(wrapper.find('input[name="phone"]').exists()).toBe(false)
  })
})
