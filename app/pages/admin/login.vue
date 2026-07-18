<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { ApiSuccess } from '../../../shared/types/api'
import AppButton from '../../components/common/AppButton.vue'
import { useAdminSessionStore } from '../../stores/admin-session'
import { DEPARTMENT_NAME } from '../../../shared/constants/department-brand'
import {
  getAdminSupabaseClient,
  signInAdminWithPassword,
} from '../../utils/admin-supabase'

definePageMeta({ layout: false, middleware: 'admin' })

type AdminSessionResponse = {
  aal: 'aal1' | 'aal2'
  authenticatedAt: string
  role: 'admin'
  userId: string
}

const route = useRoute()
const adminSession = useAdminSessionStore()
const hydrated = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const credentials = reactive({ email: '', password: '' })

const safeRedirect = (): string => {
  const redirect = route.query.redirect
  if (
    typeof redirect === 'string'
    && (redirect === '/admin' || redirect.startsWith('/admin/'))
    && !redirect.startsWith('/admin/login')
  ) return redirect
  return '/admin'
}

const submitLogin = async (): Promise<void> => {
  submitting.value = true
  errorMessage.value = ''
  try {
    const signedIn = await signInAdminWithPassword(
      getAdminSupabaseClient(),
      credentials.email,
      credentials.password,
    )
    const confirmed = await $fetch<ApiSuccess<AdminSessionResponse>>('/api/admin/session', {
      headers: { Authorization: `Bearer ${signedIn.accessToken}` },
    })
    const authenticatedAt = new Date(confirmed.data.authenticatedAt)
    if (Number.isNaN(authenticatedAt.getTime())) throw new Error('ADMIN_SESSION_INVALID')
    const tokenExpiry = Date.now() + signedIn.expiresIn * 1000
    const absoluteExpiry = authenticatedAt.getTime() + 8 * 60 * 60 * 1000
    adminSession.setVerifiedSession({
      accessToken: signedIn.accessToken,
      authenticatedAt: authenticatedAt.toISOString(),
      expiresAt: new Date(Math.min(tokenExpiry, absoluteExpiry)).toISOString(),
      userId: confirmed.data.userId,
    })
    await navigateTo(safeRedirect(), { replace: true })
  }
  catch {
    errorMessage.value = '관리자 로그인 정보를 확인하세요.'
  }
  finally {
    credentials.password = ''
    submitting.value = false
  }
}

onMounted(async () => {
  hydrated.value = true
  adminSession.restoreFromSessionStorage()
  if (adminSession.hasVerifiedSession()) await navigateTo(safeRedirect(), { replace: true })
})

</script>

<template>
  <main class="admin-login">
    <section
      class="admin-login__panel"
      aria-labelledby="admin-login-title"
    >
      <header class="admin-login__header">
        <NuxtLink to="/" aria-label="PHOTO:NEXT 홈">PHOTO:<span>NEXT</span></NuxtLink>
        <span>SECURE OPERATIONS</span>
      </header>

      <div class="admin-login__body">
        <p class="admin-login__eyebrow">{{ DEPARTMENT_NAME }} 운영</p>
        <h1 id="admin-login-title">관리자 접근</h1>
        <p class="admin-login__intro">승인된 관리자 이메일과 비밀번호로 운영 화면에 로그인하세요.</p>

        <form
          class="admin-login__form"
          data-auth-mode="ADMIN / PASSWORD ACCESS"
          @submit.prevent="submitLogin"
        >
          <label for="admin-email">
            이메일
            <input
              id="admin-email"
              v-model="credentials.email"
              type="email"
              name="email"
              autocomplete="email"
              required
            >
          </label>
          <label for="admin-password">
            비밀번호
            <input
              id="admin-password"
              v-model="credentials.password"
              type="password"
              name="password"
              autocomplete="current-password"
              required
            >
          </label>
          <AppButton
            variant="primary"
            :loading="!hydrated || submitting"
            @click="submitLogin"
          >
            관리자 로그인
          </AppButton>
        </form>

        <p
          v-if="errorMessage"
          class="admin-login__error"
          role="alert"
        >
          {{ errorMessage }}
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.admin-login {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--color-canvas);
  padding: 1.25rem;
}

.admin-login__panel {
  width: min(100%, 34rem);
  border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
}

.admin-login__header {
  min-height: 4rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-primary-strong) 18%, transparent);
  padding: 0.625rem 1rem;
}

.admin-login__header a {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  font-family: var(--font-display);
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

.admin-login__header a span { color: var(--color-primary); }

.admin-login__header > span,
.admin-login__eyebrow {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

.admin-login__header > span { color: color-mix(in srgb, var(--color-ink) 62%, transparent); }

.admin-login__body { padding: clamp(1.25rem, 6vw, 2.5rem); }

.admin-login__eyebrow {
  margin: 0 0 0.75rem;
  color: var(--color-primary);
  font-weight: 700;
}

.admin-login h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  letter-spacing: -0.055em;
}

.admin-login__intro {
  margin: 1rem 0 2rem;
  color: color-mix(in srgb, var(--color-primary-strong) 70%, transparent);
  line-height: 1.65;
  word-break: keep-all;
}

.admin-login__form { display: grid; gap: 1rem; }

.admin-login__form label {
  display: grid;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 700;
}

.admin-login__form input {
  min-height: 3.25rem;
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--color-primary-strong) 26%, transparent);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  padding: 0.75rem;
}

.admin-login__error {
  margin: 1rem 0 0;
  border-left: 2px solid var(--color-error);
  color: var(--color-error);
  padding: 0.5rem 0 0.5rem 0.75rem;
  line-height: 1.5;
}

.admin-login__header a:focus-visible,
.admin-login__form input:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

@media (max-width: 36rem) {
  .admin-login__form > :deep(button) {
    width: 100%;
  }
}
</style>
