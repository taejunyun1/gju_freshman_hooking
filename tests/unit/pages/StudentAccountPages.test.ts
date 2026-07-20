import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'

const renderAccountPage = async (component: Parameters<typeof createSSRApp>[0]): Promise<string> => {
  const app = createSSRApp(component)
  app.use(createPinia())
  app.component('NuxtLink', defineComponent({
    setup(_, { slots }) {
      return () => h('a', slots.default?.())
    },
  }))
  return renderToString(app)
}

const dispatchPaste = (input: HTMLInputElement, text: string): Event => {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (format: string) => format === 'text' ? text : '',
    },
  })
  input.dispatchEvent(event)
  return event
}

describe('student account pages', () => {
  it('uses numeric PIN guidance without exposing backend authentication details', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('unexpected backend detail'))
    vi.stubGlobal('$fetch', fetch)
    const { default: LoginPage } = await import('../../../app/pages/login.vue')
    const wrapper = mount(LoginPage, { global: { stubs: { NuxtLink: true } } })

    expect(wrapper.get('[data-department-brand]').text()).toBe('광주대학교 사진영상미디어학과 · PHOTO:NEXT')
    expect(wrapper.text()).toContain('광주대학교 사진영상미디어학과에서 받은 휴대전화 번호와 PIN')

    await wrapper.find('input[name="phone"]').setValue('010-12가34 5678')
    expect(wrapper.find('input[name="phone"]').element.value).toBe('010-1234-5678')
    expect(wrapper.find('input[name="phone"]').attributes('inputmode')).toBe('numeric')
    expect(wrapper.find('input[name="phone"]').attributes('maxlength')).toBe('13')

    await wrapper.find('input[name="password"]').setValue('269442')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/student/login', {
      body: { phone: '01012345678', password: '269442' },
      method: 'POST',
    })

    expect(wrapper.find('input[name="phone"]').attributes('autocomplete')).toBe('tel')
    expect(wrapper.find('input[name="password"]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.find('input[name="password"]').attributes('inputmode')).toBe('numeric')
    expect(wrapper.find('input[name="password"]').attributes('maxlength')).toBe('6')
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('label[for="password"]').text()).toBe('PIN')
    expect(wrapper.find('nuxt-link-stub[to="/password/reset"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.')
    expect(wrapper.text()).not.toContain('unexpected backend detail')
  })

  it('disables the login form fieldset in SSR until hydration', async () => {
    const { default: LoginPage } = await import('../../../app/pages/login.vue')
    const loginHtml = await renderAccountPage(LoginPage)

    expect(loginHtml).toMatch(/<fieldset class="login-form__fieldset"[^>]*disabled/u)
  })

  it('formats complete mixed clipboard text before maxlength can truncate it', async () => {
    const { default: LoginPage } = await import('../../../app/pages/login.vue')
    const wrapper = mount(LoginPage, { global: { stubs: { NuxtLink: true } } })
    const phone = wrapper.get<HTMLInputElement>('input[name="phone"]')
    await phone.setValue('010-9999-0000')
    phone.element.setSelectionRange(0, phone.element.value.length)

    const event = dispatchPaste(phone.element, '010-12가34 5678...')

    expect(event.defaultPrevented).toBe(true)
    expect(phone.element.value).toBe('010-1234-5678')
    expect(phone.element.selectionStart).toBe(13)
    expect(phone.element.selectionEnd).toBe(13)
  })

  it('replaces the selected phone range and restores the logical paste caret', async () => {
    const { default: LoginPage } = await import('../../../app/pages/login.vue')
    const wrapper = mount(LoginPage, { global: { stubs: { NuxtLink: true } } })
    const phone = wrapper.get<HTMLInputElement>('input[name="phone"]')
    await phone.setValue('010-9999-0000')
    phone.element.setSelectionRange(4, 8)

    const event = dispatchPaste(phone.element, '12가34')

    expect(event.defaultPrevented).toBe(true)
    expect(phone.element.value).toBe('010-1234-0000')
    expect(phone.element.selectionStart).toBe(8)
    expect(phone.element.selectionEnd).toBe(8)
    expect(phone.element.selectionStart).not.toBe(phone.element.value.length)
  })

  it.each([
    ['start', () => import('../../../app/pages/start.vue')],
    ['credentials', () => import('../../../app/pages/credentials.vue')],
  ])('redirects the legacy %s page to roster login', async (_name, loader) => {
    const navigateTo = vi.fn()
    vi.stubGlobal('navigateTo', navigateTo)
    const { default: Page } = await loader()
    mount(Page, { global: { plugins: [createPinia()], stubs: { NuxtLink: true } } })
    await flushPromises()

    expect(navigateTo).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('states the reset deletion boundary before a student can restart', async () => {
    const { default: ResetPage } = await import('../../../app/pages/password/reset.vue')
    const wrapper = mount(ResetPage, { global: { plugins: [createPinia()], stubs: { NuxtLink: true } } })

    expect(wrapper.text()).toContain('관심사와 결과 기록은 삭제됩니다')
    expect(wrapper.text()).toContain('상담신청 내용과 처리 상태는 유지됩니다')
    expect(wrapper.find('input[name="deleteInterestHistory"]').attributes('type')).toBe('checkbox')
    expect(wrapper.find('input[name="phone"]').attributes('inputmode')).toBe('tel')
  })

  it('provides a compact signed-in PIN change form with three numeric fields', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => url === '/api/student/session'
      ? { data: { csrfToken: 'csrf-token', prospectId: 42, nickname: '학생', expiresAt: '2026-07-20T12:00:00.000Z' }, requestId: 'request-id' }
      : { data: { kind: 'authenticated', expiresAt: '2026-07-20T12:00:00.000Z' }, requestId: 'request-id' }))
    const { default: PinPage } = await import('../../../app/pages/pin.vue')
    const wrapper = mount(PinPage, { global: { plugins: [createPinia()], stubs: { NuxtLink: true } } })
    await flushPromises()

    expect(wrapper.text()).toContain('내 PIN 바꾸기')
    expect(wrapper.findAll('input[inputmode="numeric"]')).toHaveLength(3)
    expect(wrapper.find('input[name="nextPinConfirm"]').exists()).toBe(true)
  })
})
