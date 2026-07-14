import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdminSessionStore } from '../../../app/stores/admin-session'

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
}

const NuxtLayoutStub = {
  template: '<div data-layout><slot /></div>',
}

describe('administrator shell', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useRoute', () => ({ query: {} }))
  })

  it('offers password plus explicit TOTP sign-in without public signup', async () => {
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')
    const wrapper = mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })

    expect(wrapper.find('input[type="email"]').attributes('autocomplete')).toBe('email')
    expect(wrapper.find('input[type="password"]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.text()).toContain('2단계 인증')
    expect(wrapper.text()).not.toMatch(/회원가입|계정 만들기/u)
  })

  it('uses AppState for the empty dashboard instead of invented metrics', async () => {
    const { default: AdminDashboard } = await import('../../../app/pages/admin/index.vue')
    const wrapper = mount(AdminDashboard, { global: { stubs: { NuxtLayout: NuxtLayoutStub } } })

    expect(wrapper.get('.app-state--empty').text()).toContain('운영 항목이 아직 없습니다')
    expect(wrapper.text()).not.toMatch(/전환율|신청자 수|성공률/u)
  })

  it('shows administrator navigation and the verified session expiry', async () => {
    useAdminSessionStore().setVerifiedSession({
      accessToken: 'short-lived-token',
      authenticatedAt: '2026-07-14T09:59:00.000Z',
      expiresAt: '2026-07-14T11:00:00.000Z',
      userId: 'admin-1',
    })
    const { default: AdminLayout } = await import('../../../app/layouts/admin.vue')
    const wrapper = mount(AdminLayout, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
      slots: { default: '<main>operator content</main>' },
    })

    expect(wrapper.get('nav').text()).toContain('복구 대기열')
    expect(wrapper.text()).toContain('세션 만료')
    expect(wrapper.text()).toContain('operator content')
  })
})
