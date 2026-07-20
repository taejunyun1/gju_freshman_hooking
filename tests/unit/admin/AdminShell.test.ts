import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdminSessionStore } from '../../../app/stores/admin-session'
import { HOME_ARIA_LABEL } from '../../../shared/constants/department-brand'

const adminAuthMocks = vi.hoisted(() => ({
  getAdminSupabaseClient: vi.fn(() => ({ auth: { signOut: vi.fn() } })),
  signInAdminWithPassword: vi.fn(),
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
    vi.stubGlobal('$fetch', vi.fn())
    vi.setSystemTime(new Date('2026-07-14T10:00:00.000Z'))
  })

  it('renders page content through the canonical Nuxt layout outlet', () => {
    const app = readFileSync('app/app.vue', 'utf8')

    expect(app).toMatch(/<NuxtLayout>\s*<NuxtPage\s*\/>\s*<\/NuxtLayout>/u)
  })

  it('assigns the admin layout and middleware as protected-page metadata without manual wrappers', () => {
    for (const pagePath of [
      'app/pages/admin/index.vue',
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

  it('offers one email and password form without MFA or public signup', async () => {
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')
    const wrapper = mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })

    expect(wrapper.findAll('form')).toHaveLength(1)
    expect(wrapper.find('input[type="email"]').attributes('autocomplete')).toBe('email')
    expect(wrapper.find('input[type="password"]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.text()).toContain('관리자 로그인')
    expect(wrapper.text()).not.toMatch(/2단계|6자리|AAL2|TOTP|QR|인증 앱|회원가입|계정 만들기/u)
    expect(wrapper.find('input[autocomplete="one-time-code"]').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('identifies the department as the administrator login operator', async () => {
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')
    const wrapper = mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })

    expect(wrapper.text()).toContain('광주대학교 사진영상미디어학과 운영')
  })

  it('labels the administrator login home link with the shared department brand', async () => {
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')
    const wrapper = mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })

    expect(HOME_ARIA_LABEL).toBe('광주대학교 사진영상미디어학과 PHOTO:NEXT 홈')
    expect(wrapper.get('a[href="/"]').attributes('aria-label')).toBe(HOME_ARIA_LABEL)
  })

  it('verifies the password token with the server and stores only the capped access session', async () => {
    vi.stubGlobal('useRoute', () => ({ query: { redirect: '/admin/counseling' } }))
    adminAuthMocks.signInAdminWithPassword.mockResolvedValueOnce({
      accessToken: 'short-lived-aal1-token',
      expiresIn: 24 * 60 * 60,
      refreshToken: 'must-never-enter-the-page',
      userId: 'admin-1',
    })
    vi.mocked($fetch).mockResolvedValueOnce({
      data: {
        aal: 'aal1',
        authenticatedAt: '2026-07-14T10:00:00.000Z',
        role: 'admin',
        userId: 'admin-1',
      },
      requestId: 'request-1',
    })
    const client = { auth: {} }
    adminAuthMocks.getAdminSupabaseClient.mockReturnValue(client as never)
    const { default: AdminLoginPage } = await import('../../../app/pages/admin/login.vue')
    const wrapper = mount(AdminLoginPage, { global: { stubs: { NuxtLink: NuxtLinkStub } } })

    await wrapper.get('input[type="email"]').setValue('admin@example.test')
    await wrapper.get('input[type="password"]').setValue('password-from-form')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(adminAuthMocks.signInAdminWithPassword).toHaveBeenCalledWith(
      client,
      'admin@example.test',
      'password-from-form',
    )
    expect($fetch).toHaveBeenCalledWith('/api/admin/session', {
      headers: { Authorization: 'Bearer short-lived-aal1-token' },
    })
    expect(JSON.parse(sessionStorage.getItem('photo_next_admin_session_v1') ?? 'null')).toEqual({
      accessToken: 'short-lived-aal1-token',
      authenticatedAt: '2026-07-14T10:00:00.000Z',
      expiresAt: '2026-07-14T18:00:00.000Z',
      userId: 'admin-1',
    })
    expect(sessionStorage.getItem('photo_next_admin_session_v1')).not.toContain('must-never-enter-the-page')
    expect(wrapper.get('input[type="password"]').element).toHaveProperty('value', '')
    expect(navigateTo).toHaveBeenCalledWith('/admin/counseling', { replace: true })
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

  it('uses AppState for the empty dashboard instead of invented metrics', async () => {
    const { default: AdminDashboard } = await import('../../../app/pages/admin/index.vue')
    const wrapper = mount(AdminDashboard)

    expect(wrapper.get('.app-state--empty').text()).toContain('운영 항목이 아직 없습니다')
    expect(wrapper.text()).not.toMatch(/전환율|신청자 수|성공률/u)
  })

  it('identifies the department as the administrator dashboard operator', async () => {
    const { default: AdminDashboard } = await import('../../../app/pages/admin/index.vue')
    const wrapper = mount(AdminDashboard)

    expect(wrapper.text()).toContain('광주대학교 사진영상미디어학과의 운영 작업')
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

    expect(wrapper.get('nav').text()).not.toContain('복구 대기열')
    expect(wrapper.get('nav').text()).toContain('상담 운영')
    expect(wrapper.get('nav').text()).toContain('학생 찾기')
    expect(wrapper.get('nav').text()).toContain('데이터 내보내기')
    expect(wrapper.get('nav').text()).not.toContain('캠페인 운영')
    expect(wrapper.get('nav').text()).not.toContain('AI 문장 신고')
    expect(wrapper.html()).not.toContain('/admin/campaigns')
    expect(wrapper.html()).not.toContain('/admin/narrative-reports')
    expect(wrapper.text()).toContain('세션 만료')
    expect(wrapper.text()).toContain('operator content')
    expect(wrapper.get('a[href="/admin"]').attributes('aria-label'))
      .toBe('광주대학교 사진영상미디어학과 PHOTO:NEXT 관리자 홈')
  })
})
