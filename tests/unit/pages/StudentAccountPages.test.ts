import { flushPromises, mount } from '@vue/test-utils'
import { readFile } from 'node:fs/promises'
import { createPinia, setActivePinia } from 'pinia'
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
  it.each([
    ['app/pages/start.vue', 'account-page__brand'],
    ['app/pages/login.vue', 'login-page__brand'],
    ['app/pages/credentials.vue', 'credentials-page__brand'],
  ])('gives the %s home link a 44px logical touch target', async (file, className) => {
    const source = await readFile(file, 'utf8')
    const selector = className.replaceAll('-', '\\-')
    const rule = new RegExp(`\\.${selector}\\s*\\{[^}]*min-block-size:\\s*2\\.75rem;[^}]*min-inline-size:\\s*2\\.75rem;`, 's')

    expect(source).toMatch(rule)
  })

  it('shows each required registration choice in the mobile intake form', async () => {
    const { default: StartPage } = await import('../../../app/pages/start.vue')
    const wrapper = mount(StartPage, { global: { plugins: [createPinia()], stubs: { NuxtLink: true } } })
    await flushPromises()

    expect(wrapper.text()).toContain('고1')
    expect(wrapper.text()).toContain('고2')
    expect(wrapper.text()).toContain('고3')
    expect(wrapper.text()).toContain('고교 졸업생')
    expect(wrapper.text()).toContain('검정고시 준비·합격')
    expect(wrapper.text()).toContain('광주광역시')
    expect(wrapper.text()).toContain('강원·제주')
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('label[for="phone"]').text()).toBe('휴대전화 번호')
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
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('label[for="password"]').text()).toBe('임시 비밀번호')
    expect(wrapper.text()).toContain('입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.')
    expect(wrapper.text()).not.toContain('unexpected backend detail')
  })

  it('disables each account form fieldset in SSR until hydration', async () => {
    const [{ default: StartPage }, { default: LoginPage }] = await Promise.all([
      import('../../../app/pages/start.vue'),
      import('../../../app/pages/login.vue'),
    ])

    const [startHtml, loginHtml] = await Promise.all([
      renderAccountPage(StartPage),
      renderAccountPage(LoginPage),
    ])

    expect(startHtml).toMatch(/<fieldset class="account-form__fieldset"[^>]*disabled/u)
    expect(loginHtml).toMatch(/<fieldset class="login-form__fieldset"[^>]*disabled/u)
  })

  it('reveals initial credentials from memory once and links to login with replace history', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useStudentSessionStore } = await import('../../../app/stores/student-session')
    const store = useStudentSessionStore()
    store.setInitialCredentials({ nickname: '선명한프레임01', initialPassword: 'AB-5678' })
    const { default: CredentialsPage } = await import('../../../app/pages/credentials.vue')
    const wrapper = mount(CredentialsPage, {
      global: {
        plugins: [pinia],
        stubs: {
          NuxtLink: {
            name: 'NuxtLink',
            props: {
              replace: Boolean,
              to: String,
            },
            template: '<a :href="to"><slot /></a>',
          },
        },
      },
    })

    expect(wrapper.get('[data-testid="nickname"]').text()).toBe('선명한프레임01')
    expect(wrapper.get('[data-testid="initial-password"]').text()).toBe('AB-5678')
    expect(store.initialCredentials).toBeNull()
    const loginLink = wrapper.getComponent('.credentials-page__continue')
    expect(loginLink.props('to')).toBe('/login')
    expect(loginLink.props('replace')).toBe(true)
    expect(loginLink.text()).toContain('로그인하러 가기')
  })
})
