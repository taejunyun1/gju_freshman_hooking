<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { adminStudentPhoneRevealSchema } from '../../../shared/schemas/admin-students'
import type { ApiSuccess } from '../../../shared/types/api'
import { useAdminSessionStore } from '../../stores/admin-session'
import AppButton from '../common/AppButton.vue'

const props = defineProps<{
  studentId: number
  nickname: string
  maskedPhone: string
  loginRedirect: string
}>()

const emit = defineEmits<{ close: [] }>()
const adminSession = useAdminSessionStore()
const dialog = ref<HTMLDialogElement | null>(null)
const revealButton = ref<{ $el?: HTMLButtonElement } | null>(null)
const revealedPhone = ref('')
const busy = ref(false)
const errorMessage = ref('')
const expired = ref(false)
let opener: HTMLElement | null = null
let revealTimer: ReturnType<typeof setTimeout> | undefined
let active = true

const hasControlCharacters = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
})

const clearPhone = (): void => {
  if (revealTimer !== undefined) clearTimeout(revealTimer)
  revealTimer = undefined
  revealedPhone.value = ''
}

const safeLoginRedirect = (): string => {
  const fallback = `/admin/students/${props.studentId}`
  if (props.loginRedirect.length > 2_000
    || hasControlCharacters(props.loginRedirect)) return fallback
  try {
    const parsed = new URL(props.loginRedirect, 'https://photo-next.invalid')
    return parsed.origin === 'https://photo-next.invalid' && parsed.pathname === fallback
      ? `${parsed.pathname}${parsed.search}`
      : fallback
  }
  catch {
    return fallback
  }
}

const apiErrorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object' || !('data' in error)) return ''
  const data = (error as { data?: unknown }).data
  if (!data || typeof data !== 'object' || !('error' in data)) return ''
  const publicError = (data as { error?: unknown }).error
  if (!publicError || typeof publicError !== 'object' || !('code' in publicError)) return ''
  const code = (publicError as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

const routeToLogin = async (): Promise<void> => {
  clearPhone()
  adminSession.clear()
  await navigateTo({
    path: '/admin/login',
    query: { redirect: safeLoginRedirect() },
  }, { replace: true })
}

const reveal = async (): Promise<void> => {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  expired.value = false
  clearPhone()
  try {
    const response = await $fetch<ApiSuccess<unknown>>(
      `/api/admin/students/${props.studentId}/reveal-phone`,
      {
        headers: adminSession.authorizationHeaders(),
        method: 'POST',
      },
    )
    if (!active) return
    revealedPhone.value = adminStudentPhoneRevealSchema.parse(response.data).phone
    revealTimer = setTimeout(() => {
      clearPhone()
      expired.value = true
    }, 60_000)
  }
  catch (error) {
    if (!active) return
    const code = apiErrorCode(error)
    if (code === 'REAUTH_REQUIRED' || code === 'MFA_REQUIRED' || code === 'ADMIN_REQUIRED') {
      await routeToLogin()
      return
    }
    if (code === '' && !adminSession.hasVerifiedSession()) {
      await routeToLogin()
      return
    }
    errorMessage.value = '전화번호를 확인하지 못했습니다. 최근 인증 상태를 확인하고 다시 시도하세요.'
  }
  finally {
    if (active) busy.value = false
  }
}

const close = async (): Promise<void> => {
  clearPhone()
  errorMessage.value = ''
  const currentDialog = dialog.value
  if (currentDialog?.open && typeof currentDialog.close === 'function') {
    try {
      currentDialog.close()
    }
    catch {
      currentDialog.removeAttribute('open')
    }
  }
  else {
    currentDialog?.removeAttribute('open')
  }
  emit('close')
  await nextTick()
  opener?.focus()
}

const handleCancel = (event: Event): void => {
  event.preventDefault()
  void close()
}

const trapFocus = (event: KeyboardEvent): void => {
  if (event.key !== 'Tab') return
  const currentDialog = dialog.value
  if (!currentDialog) return
  const focusable = [...currentDialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )]
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  const currentDialog = dialog.value
  if (currentDialog && !currentDialog.open) {
    if (typeof currentDialog.showModal === 'function') {
      try {
        currentDialog.showModal()
      }
      catch {
        currentDialog.setAttribute('open', '')
      }
    }
    else {
      currentDialog.setAttribute('open', '')
    }
  }
  revealButton.value?.$el?.focus()
})

onBeforeUnmount(() => {
  active = false
  clearPhone()
  opener?.focus()
  opener = null
})
</script>

<template>
  <dialog
    ref="dialog"
    class="phone-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="phone-dialog-title"
    aria-describedby="phone-dialog-description"
    @cancel="handleCancel"
    @keydown.esc.prevent="close"
    @keydown="trapFocus"
  >
    <div class="phone-dialog__header">
      <p>PRIVATE CONTACT / 60 SEC</p>
      <h2 id="phone-dialog-title">{{ nickname }} 연락처 확인</h2>
    </div>
    <p id="phone-dialog-description">최근 비밀번호 로그인을 확인한 뒤 전화번호를 60초간만 표시합니다.</p>
    <dl>
      <div>
        <dt>기본 표시</dt>
        <dd>{{ maskedPhone }}</dd>
      </div>
      <div v-if="revealedPhone" class="phone-dialog__revealed" aria-live="polite">
        <dt>전화번호</dt>
        <dd>{{ revealedPhone }}</dd>
      </div>
    </dl>
    <p v-if="expired" class="phone-dialog__notice" aria-live="polite">안전을 위해 전화번호 표시 시간이 종료됐습니다.</p>
    <p v-if="errorMessage" class="phone-dialog__error" role="alert">{{ errorMessage }}</p>
    <div class="phone-dialog__actions">
      <AppButton
        ref="revealButton"
        data-action="reveal-phone"
        variant="primary"
        :loading="busy"
        @click="reveal"
      >전화번호 확인</AppButton>
      <AppButton data-action="close-phone" variant="secondary" @click="close">닫기</AppButton>
    </div>
  </dialog>
</template>

<style scoped>
.phone-dialog {
  width: min(100% - 2rem, 34rem);
  border: 1px solid color-mix(in srgb, var(--color-primary) 26%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  color: var(--color-primary-strong);
  padding: 1.25rem;
}

.phone-dialog::backdrop {
  background: color-mix(in srgb, var(--color-primary-strong) 68%, transparent);
}

.phone-dialog__header p {
  margin: 0 0 0.5rem;
  color: var(--color-primary);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.phone-dialog h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.5rem;
  letter-spacing: -0.035em;
}

#phone-dialog-description {
  color: color-mix(in srgb, var(--color-primary-strong) 68%, transparent);
  line-height: 1.6;
}

.phone-dialog dl {
  display: grid;
  gap: 0.625rem;
  margin: 1rem 0;
}

.phone-dialog dl > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  padding-top: 0.625rem;
}

.phone-dialog dt {
  color: color-mix(in srgb, var(--color-primary-strong) 62%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.phone-dialog dd {
  margin: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.phone-dialog__revealed dd {
  color: var(--color-primary);
  font-size: 1.25rem;
}

.phone-dialog__notice,
.phone-dialog__error {
  margin: 0.75rem 0;
  padding: 0.75rem;
}

.phone-dialog__notice {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.phone-dialog__error {
  border-left: 3px solid var(--color-error);
  color: var(--color-error);
}

.phone-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
  margin-top: 1rem;
}
</style>
