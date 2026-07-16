import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdminSessionStore } from '../../../app/stores/admin-session'

const adminAuthMocks = vi.hoisted(() => ({
  beginAdminAuthentication: vi.fn(),
  cancelAdminEnrollment: vi.fn(),
  getAdminSupabaseClient: vi.fn(() => ({ auth: { signOut: vi.fn() } })),
  verifyAdminTotp: vi.fn(),
}))

vi.mock('../../../app/utils/admin-supabase', () => adminAuthMocks)

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
}

describe('administrator shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    setActivePinia(createPinia())
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useRoute', () => ({ query: {} }))
  })

  it('renders page content through the canonical Nuxt layout outlet', () => {
    const app = readFileSync('app/app.vue', 'utf8')

    expect(app).toMatch(/<NuxtLayout>\s*<NuxtPage\s*\/>\s*<\/NuxtLayout>/u)
  })

  it('assigns the admin layout and middleware as protected-page metadata without manual wrappers', () => {
    for (const pagePath of [
      'app/pages/admin/index.vue',
      'app/pages/admin/recovery.vue',
      'app/pages/admin/counseling.vue',
      'app/pages/admin/students/index.vue',
      'app/pages/admin/students/[id].vue',
      'app/pages/admin/export.vue',
    ]) {
      const page = readFileSync(pagePath, 'utf8')

      expect(page).toContain("definePageMeta({ layout: 'admin', middleware: 'admin' })")
      expect(page).not.toContain('<NuxtLayout')
    }
  })

  it('keeps the administrator login in the root outlet while retaining its redirect middleware', () => {
    const login = readFileSync('app/pages/admin/login.vue', 'utf8')

    expect(login).toContain("definePageMeta({ layout: false, middleware: 'admin' })")
    expect(login).not.toContain('<NuxtLayout')
  })

  it('starts session-backed student requests only after the client-side session guard has mounted', () => {
    const listPage = readFileSync('app/pages/admin/students/index.vue', 'utf8')
    const detailPage = readFileSync('app/pages/admin/students/[id].vue', 'utf8')

    expect(listPage).toContain('onMounted(() =>')
    expect(listPage.indexOf('onMounted(() =>')).toBeLessThan(
      listPage.indexOf("watch(() => route.fullPath, loadStudents, { immediate: true })"),
    )
    expect(detailPage).toContain('onMounted(() =>')
    expect(detailPage.indexOf('onMounted(() =>')).toBeLessThan(
      detailPage.indexOf('watch(studentId, loadDetail, { immediate: true })'),
    )
    expect(detailPage).not.toContain('void loadDetail()')
  })

  it('offers password plus explicit TOTP sign-in without public signup', async () => {
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')
    const wrapper = mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })

    expect(wrapper.find('input[type="email"]').attributes('autocomplete')).toBe('email')
    expect(wrapper.find('input[type="password"]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.text()).toContain('2단계 인증')
    expect(wrapper.text()).not.toMatch(/회원가입|계정 만들기/u)
  })

  it('restores a valid browser session before redirecting away from the login route', async () => {
    sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
      accessToken: 'short-lived-token',
      authenticatedAt: '2099-07-14T09:59:00.000Z',
      expiresAt: '2099-07-14T11:00:00.000Z',
      userId: 'admin-1',
    }))
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')

    mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })
    await flushPromises()

    expect(navigateTo).toHaveBeenCalledWith('/admin', { replace: true })
  })

  it('renders the full Supabase TOTP QR data URL without wrapping or re-encoding it', async () => {
    const qrCode = 'data:image/svg+xml;utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M0%200h1v1H0z%22%2F%3E%3C%2Fsvg%3E'
    adminAuthMocks.beginAdminAuthentication.mockResolvedValueOnce({
      enrollment: { qrCode, secret: 'auth-generated-secret' },
      factorId: 'new-factor',
    })
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')
    const wrapper = mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('img').attributes('src')).toBe(qrCode)
  })

  it('removes the current unverified factor before signing out on restart', async () => {
    const signOut = vi.fn(async () => ({ error: null }))
    const client = { auth: { signOut } }
    adminAuthMocks.getAdminSupabaseClient.mockReturnValue(client as never)
    adminAuthMocks.beginAdminAuthentication.mockResolvedValueOnce({
      enrollment: { qrCode: 'data:image/svg+xml;utf-8,%3Csvg%2F%3E', secret: 'enrollment-secret' },
      factorId: 'new-factor',
    })
    adminAuthMocks.cancelAdminEnrollment.mockResolvedValueOnce(undefined)
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')
    const wrapper = mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('.admin-login__actions button.app-button--secondary').trigger('click')
    await flushPromises()

    expect(adminAuthMocks.cancelAdminEnrollment).toHaveBeenCalledWith(client, 'new-factor')
    expect(adminAuthMocks.cancelAdminEnrollment.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]!)
    expect(wrapper.find('input[type="email"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('enrollment-secret')
  })

  it('keeps the enrollment retryable and does not sign out when restart cleanup fails', async () => {
    const signOut = vi.fn()
    adminAuthMocks.getAdminSupabaseClient.mockReturnValue({ auth: { signOut } } as never)
    adminAuthMocks.beginAdminAuthentication.mockResolvedValueOnce({
      enrollment: { qrCode: 'data:image/svg+xml;utf-8,%3Csvg%2F%3E', secret: 'enrollment-secret' },
      factorId: 'new-factor',
    })
    adminAuthMocks.cancelAdminEnrollment.mockRejectedValueOnce(new Error('provider-secret-detail'))
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')
    const wrapper = mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('.admin-login__actions button.app-button--secondary').trigger('click')
    await flushPromises()

    expect(signOut).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('등록을 취소하지 못했습니다')
    expect(wrapper.text()).not.toContain('provider-secret-detail')
    expect(wrapper.find('#admin-totp').exists()).toBe(true)
  })

  it('uses AppState for the empty dashboard instead of invented metrics', async () => {
    const { default: AdminDashboard } = await import('../../../app/pages/admin/index.vue')
    const wrapper = mount(AdminDashboard)

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
    expect(wrapper.get('nav').text()).toContain('상담 운영')
    expect(wrapper.get('nav').text()).toContain('학생 찾기')
    expect(wrapper.get('nav').text()).toContain('데이터 내보내기')
    expect(wrapper.text()).toContain('세션 만료')
    expect(wrapper.text()).toContain('operator content')
  })
})
