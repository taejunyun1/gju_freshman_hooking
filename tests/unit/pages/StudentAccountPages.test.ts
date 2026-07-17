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

describe('student account pages', () => {
  it('uses the generic login failure copy with phone and current-password autocomplete', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('unexpected backend detail')))
    const { default: LoginPage } = await import('../../../app/pages/login.vue')
    const wrapper = mount(LoginPage, { global: { stubs: { NuxtLink: true } } })

    await wrapper.find('input[name="phone"]').setValue('01012345678')
    await wrapper.find('input[name="password"]').setValue('5678AB')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('input[name="phone"]').attributes('autocomplete')).toBe('tel')
    expect(wrapper.find('input[name="password"]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('label[for="password"]').text()).toBe('임시 비밀번호')
    expect(wrapper.text()).toContain('입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.')
    expect(wrapper.text()).not.toContain('unexpected backend detail')
  })

  it('disables the login form fieldset in SSR until hydration', async () => {
    const { default: LoginPage } = await import('../../../app/pages/login.vue')
    const loginHtml = await renderAccountPage(LoginPage)

    expect(loginHtml).toMatch(/<fieldset class="login-form__fieldset"[^>]*disabled/u)
  })

  it.each([
    ['start', () => import('../../../app/pages/start.vue')],
    ['credentials', () => import('../../../app/pages/credentials.vue')],
    ['password reset', () => import('../../../app/pages/password/reset.vue')],
  ])('redirects the legacy %s page to roster login', async (_name, loader) => {
    const navigateTo = vi.fn()
    vi.stubGlobal('navigateTo', navigateTo)
    const { default: Page } = await loader()
    mount(Page, { global: { plugins: [createPinia()], stubs: { NuxtLink: true } } })
    await flushPromises()

    expect(navigateTo).toHaveBeenCalledWith('/login', { replace: true })
  })
})
