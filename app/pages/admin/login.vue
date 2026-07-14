<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { ApiSuccess } from '../../../shared/types/api'
import AppButton from '../../components/common/AppButton.vue'
import { useAdminSessionStore } from '../../stores/admin-session'
import {
  beginAdminAuthentication,
  cancelAdminEnrollment,
  getAdminSupabaseClient,
  verifyAdminTotp,
  type AdminAuthenticationStep,
} from '../../utils/admin-supabase'

definePageMeta({ layout: false, middleware: 'admin' })

type LoginStep = 'credentials' | 'totp'
type AdminSessionResponse = {
  aal: 'aal2'
  authenticatedAt: string
  role: 'admin'
  userId: string
}

const route = useRoute()
const adminSession = useAdminSessionStore()
const step = ref<LoginStep>('credentials')
const submitting = ref(false)
const errorMessage = ref('')
const credentials = reactive({ email: '', password: '' })
const totpCode = ref('')
const authentication = ref<AdminAuthenticationStep | null>(null)

const safeRedirect = (): string => {
  const redirect = route.query.redirect
  if (
    typeof redirect === 'string'
    && (redirect === '/admin' || redirect.startsWith('/admin/'))
    && !redirect.startsWith('/admin/login')
  ) return redirect
  return '/admin'
}

const clearEnrollment = (): void => {
  authentication.value = null
  totpCode.value = ''
}

const submitCredentials = async (): Promise<void> => {
  submitting.value = true
  errorMessage.value = ''
  try {
    authentication.value = await beginAdminAuthentication(
      getAdminSupabaseClient(),
      credentials.email,
      credentials.password,
    )
    step.value = 'totp'
  }
  catch {
    errorMessage.value = '관리자 로그인 정보를 확인하세요.'
  }
  finally {
    credentials.password = ''
    submitting.value = false
  }
}

const submitTotp = async (): Promise<void> => {
  if (!authentication.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    const verified = await verifyAdminTotp(
      getAdminSupabaseClient(),
      authentication.value.factorId,
      totpCode.value,
    )
    const confirmed = await $fetch<ApiSuccess<AdminSessionResponse>>('/api/admin/session', {
      headers: { Authorization: `Bearer ${verified.accessToken}` },
    })
    const authenticatedAt = new Date(confirmed.data.authenticatedAt)
    if (Number.isNaN(authenticatedAt.getTime())) throw new Error('ADMIN_SESSION_INVALID')
    const tokenExpiry = Date.now() + verified.expiresIn * 1000
    const absoluteExpiry = authenticatedAt.getTime() + 8 * 60 * 60 * 1000
    adminSession.setVerifiedSession({
      accessToken: verified.accessToken,
      authenticatedAt: authenticatedAt.toISOString(),
      expiresAt: new Date(Math.min(tokenExpiry, absoluteExpiry)).toISOString(),
      userId: confirmed.data.userId,
    })
    clearEnrollment()
    await navigateTo(safeRedirect(), { replace: true })
  }
  catch {
    errorMessage.value = '2단계 인증 코드를 확인하거나 다시 로그인하세요.'
  }
  finally {
    submitting.value = false
  }
}

const restart = async (): Promise<void> => {
  if (submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  const currentAuthentication = authentication.value
  const client = getAdminSupabaseClient()

  try {
    if (currentAuthentication?.enrollment) {
      await cancelAdminEnrollment(client, currentAuthentication.factorId)
    }
  }
  catch {
    errorMessage.value = '2단계 인증 등록을 취소하지 못했습니다. 다시 시도하세요.'
    submitting.value = false
    return
  }

  try {
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw new Error('ADMIN_AUTH_FAILED')
    clearEnrollment()
    step.value = 'credentials'
  }
  catch {
    if (currentAuthentication?.enrollment) {
      clearEnrollment()
      step.value = 'credentials'
    }
    errorMessage.value = '로그인을 초기화하지 못했습니다. 다시 시도하세요.'
  }
  finally {
    submitting.value = false
  }
}

onMounted(async () => {
  if (adminSession.hasVerifiedSession()) await navigateTo(safeRedirect(), { replace: true })
})

onBeforeUnmount(clearEnrollment)
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
        <p class="admin-login__eyebrow">ADMIN / AAL2 REQUIRED</p>
        <h1 id="admin-login-title">관리자 접근</h1>
        <p class="admin-login__intro">비밀번호 확인 후 등록된 인증 앱으로 2단계 인증을 완료하세요.</p>

        <form
          v-if="step === 'credentials'"
          class="admin-login__form"
          @submit.prevent="submitCredentials"
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
            :loading="submitting"
            @click="submitCredentials"
          >
            비밀번호 확인
          </AppButton>
        </form>

        <form
          v-else
          class="admin-login__form"
          @submit.prevent="submitTotp"
        >
          <div
            v-if="authentication?.enrollment"
            class="admin-login__enrollment"
          >
            <p>인증 앱에 새 계정을 등록한 뒤 표시된 6자리 코드를 입력하세요.</p>
            <img
              :src="authentication.enrollment.qrCode"
              alt="PHOTO:NEXT 관리자 TOTP 등록 QR 코드"
            >
            <label for="admin-totp-secret">
              수동 등록키
              <input
                id="admin-totp-secret"
                :value="authentication.enrollment.secret"
                type="password"
                autocomplete="off"
                readonly
              >
            </label>
          </div>
          <label for="admin-totp">
            2단계 인증 코드
            <input
              id="admin-totp"
              v-model="totpCode"
              type="text"
              name="totp"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              maxlength="6"
              required
            >
          </label>
          <div class="admin-login__actions">
            <AppButton
              variant="primary"
              :loading="submitting"
              @click="submitTotp"
            >
              2단계 인증 완료
            </AppButton>
            <AppButton
              variant="secondary"
              :loading="submitting"
              @click="restart"
            >
              다시 로그인
            </AppButton>
          </div>
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
  background:
    linear-gradient(90deg, var(--color-ink) 0 0.5rem, transparent 0.5rem),
    var(--color-canvas);
  padding: 1.25rem;
}

.admin-login__panel {
  width: min(100%, 34rem);
  border: 1px solid color-mix(in srgb, var(--color-ink) 28%, transparent);
  background: var(--color-surface);
  box-shadow: 0.625rem 0.625rem 0 color-mix(in srgb, var(--color-ink) 8%, transparent);
}

.admin-login__header {
  min-height: 4rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
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

.admin-login__header a span { color: var(--color-sequence); }

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
  color: var(--color-sequence);
  font-weight: 700;
}

.admin-login h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2rem, 8vw, 3rem);
  letter-spacing: -0.055em;
}

.admin-login__intro {
  margin: 1rem 0 2rem;
  color: color-mix(in srgb, var(--color-ink) 70%, transparent);
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
  border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
  border-radius: 0.25rem;
  background: var(--color-surface);
  padding: 0.75rem;
}

.admin-login__enrollment {
  display: grid;
  gap: 1rem;
  border-left: 3px solid var(--color-resource);
  background: color-mix(in srgb, var(--color-resource) 7%, var(--color-surface));
  padding: 1rem;
}

.admin-login__enrollment p { margin: 0; line-height: 1.6; }

.admin-login__enrollment img {
  width: min(14rem, 100%);
  aspect-ratio: 1;
  justify-self: center;
}

.admin-login__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
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
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

@media (max-width: 36rem) {
  .admin-login__actions :deep(button),
  .admin-login__form > :deep(button) {
    width: 100%;
  }
}
</style>
