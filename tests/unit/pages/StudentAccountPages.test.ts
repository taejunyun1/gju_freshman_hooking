import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

describe('student account pages', () => {
  it('shows each required registration choice in the mobile intake form', async () => {
    const { default: StartPage } = await import('../../../app/pages/start.vue')
    const wrapper = mount(StartPage, { global: { plugins: [createPinia()], stubs: { NuxtLink: true } } })

    expect(wrapper.text()).toContain('고1')
    expect(wrapper.text()).toContain('고2')
    expect(wrapper.text()).toContain('고3')
    expect(wrapper.text()).toContain('고교 졸업생')
    expect(wrapper.text()).toContain('검정고시 준비·합격')
    expect(wrapper.text()).toContain('광주광역시')
    expect(wrapper.text()).toContain('강원·제주')
    expect(wrapper.find('input[name="phone"]').attributes('autocomplete')).toBe('tel')
  })

  it('uses the generic login failure copy with phone and current-password autocomplete', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('unexpected backend detail')))
    const { default: LoginPage } = await import('../../../app/pages/login.vue')
    const wrapper = mount(LoginPage, { global: { stubs: { NuxtLink: true } } })

    await wrapper.find('input[name="phone"]').setValue('01012345678')
    await wrapper.find('input[name="password"]').setValue('WRONG99')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('input[name="phone"]').attributes('autocomplete')).toBe('tel')
    expect(wrapper.find('input[name="password"]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.text()).toContain('입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.')
    expect(wrapper.text()).not.toContain('unexpected backend detail')
  })

  it('reveals initial credentials from memory once and replaces history when continuing', async () => {
    vi.stubGlobal('navigateTo', vi.fn())
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useStudentSessionStore } = await import('../../../app/stores/student-session')
    const store = useStudentSessionStore()
    store.setInitialCredentials({ nickname: '선명한프레임01', initialPassword: 'AB-5678' })
    const { default: CredentialsPage } = await import('../../../app/pages/credentials.vue')
    const wrapper = mount(CredentialsPage, { global: { plugins: [pinia], stubs: { NuxtLink: true } } })

    expect(wrapper.text()).toContain('선명한프레임01')
    expect(wrapper.text()).toContain('AB-5678')
    expect(store.initialCredentials).toBeNull()
    await wrapper.find('button').trigger('click')
    expect(globalThis.navigateTo).toHaveBeenCalledWith('/assessment', { replace: true })
  })
})
