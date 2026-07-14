<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import AppButton from '../common/AppButton.vue'
import { useAdminSessionStore } from '../../stores/admin-session'

export type AdminRecoveryRequest = {
  age: string
  id: number
  maskedPhone: string
  nickname: string
  region: string
  state: string
}

const props = defineProps<{ request: AdminRecoveryRequest }>()

const emit = defineEmits<{
  approve: [requestId: number]
  'code-cleared': [requestId: number]
}>()

const adminSession = useAdminSessionStore()
const code = ref<string | null>(null)
const codeExpiresAt = ref<string | null>(null)
const errorMessage = ref('')
const approving = ref(false)
const copying = ref(false)
const copied = ref(false)
const approved = ref(false)
let active = true
let clearCodeTimer: ReturnType<typeof setTimeout> | undefined

const clearCode = (notify = false): void => {
  code.value = null
  codeExpiresAt.value = null
  copied.value = false
  if (clearCodeTimer !== undefined) clearTimeout(clearCodeTimer)
  clearCodeTimer = undefined
  if (notify) emit('code-cleared', props.request.id)
}

const approve = async (request: AdminRecoveryRequest): Promise<void> => {
  if (!window.confirm('이 요청을 승인하고 1회용 복구 코드를 발급할까요?')) return

  approving.value = true
  errorMessage.value = ''
  emit('approve', request.id)
  try {
    const response = await $fetch<{ data: { code: string, expiresAt: string } }>(`/api/admin/recovery/${request.id}/approve`, {
      headers: adminSession.authorizationHeaders(),
      method: 'POST',
    })
    if (!active) return
    clearCode()
    code.value = response.data.code
    codeExpiresAt.value = response.data.expiresAt
    approved.value = true
    clearCodeTimer = setTimeout(() => clearCode(true), 60_000)
  }
  catch {
    if (active) errorMessage.value = '승인하지 못했습니다. 다시 인증한 뒤 재시도하세요.'
  }
  finally {
    if (active) approving.value = false
  }
}

const copy = async (request: AdminRecoveryRequest): Promise<void> => {
  if (!code.value) return
  copying.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/admin/recovery/${request.id}/copy`, {
      body: { requestId: request.id },
      headers: adminSession.authorizationHeaders(),
      method: 'POST',
    })
    if (!code.value) throw new Error('RECOVERY_CODE_CLEARED')
    await navigator.clipboard.writeText(code.value)
    copied.value = true
  }
  catch {
    errorMessage.value = '복사하지 못했습니다. 코드를 직접 전달하세요.'
  }
  finally {
    copying.value = false
  }
}

onBeforeUnmount(() => {
  active = false
  clearCode()
})
</script>

<template>
  <article class="recovery-record">
    <header class="recovery-record__identity">
      <div>
        <p class="recovery-record__eyebrow">RECOVERY / {{ request.id }}</p>
        <h2>{{ request.nickname }}</h2>
      </div>
      <span class="recovery-record__state">{{ approved ? '코드 발급됨' : request.state }}</span>
    </header>

    <dl class="recovery-record__details">
      <div>
        <dt>휴대전화</dt>
        <dd>{{ request.maskedPhone }}</dd>
      </div>
      <div>
        <dt>지역</dt>
        <dd>{{ request.region }}</dd>
      </div>
      <div>
        <dt>요청 경과</dt>
        <dd>{{ request.age }}</dd>
      </div>
    </dl>

    <div
      v-if="code"
      class="recovery-record__code"
      aria-live="assertive"
    >
      <p>복구 코드: <strong>{{ code }}</strong></p>
      <p v-if="codeExpiresAt">코드는 서버가 안내한 만료 시각까지 한 번만 사용할 수 있습니다.</p>
      <AppButton
        data-action="copy"
        variant="secondary"
        :loading="copying"
        @click="copy(request)"
      >
        {{ copied ? '복사함' : '코드 복사' }}
      </AppButton>
    </div>

    <p
      v-if="errorMessage"
      class="recovery-record__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <footer
      v-if="!approved"
      class="recovery-record__actions"
    >
      <AppButton
        data-action="approve"
        variant="primary"
        :loading="approving"
        @click="approve(request)"
      >
        복구 승인
      </AppButton>
    </footer>
  </article>
</template>

<style scoped>
.recovery-record {
  border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  background: var(--color-surface);
}

.recovery-record__identity,
.recovery-record__details,
.recovery-record__actions,
.recovery-record__code {
  padding: 1rem;
}

.recovery-record__identity {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
}

.recovery-record__eyebrow,
.recovery-record__identity h2,
.recovery-record__details,
.recovery-record__code p,
.recovery-record__error {
  margin: 0;
}

.recovery-record__eyebrow,
.recovery-record__state,
.recovery-record__details dt {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
}

.recovery-record__eyebrow {
  margin-bottom: 0.375rem;
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
}

.recovery-record__identity h2 {
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.recovery-record__state {
  border: 1px solid var(--color-signal);
  padding: 0.375rem 0.5rem;
  color: var(--color-ink);
  white-space: nowrap;
}

.recovery-record__details {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.recovery-record__details div {
  min-width: 0;
}

.recovery-record__details dt {
  margin-bottom: 0.375rem;
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
}

.recovery-record__details dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.recovery-record__code {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  border-block: 1px solid color-mix(in srgb, var(--color-resource) 40%, transparent);
  background: color-mix(in srgb, var(--color-resource) 8%, var(--color-surface));
}

.recovery-record__code p:first-child {
  flex: 1 1 18rem;
  font-family: var(--font-mono);
}

.recovery-record__code p:nth-child(2) {
  flex: 1 1 100%;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  font-size: 0.875rem;
}

.recovery-record__error {
  padding: 0 1rem;
  color: var(--color-error);
}

.recovery-record__actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 640px) {
  .recovery-record__details {
    grid-template-columns: 1fr;
  }

  .recovery-record__actions :deep(button),
  .recovery-record__code :deep(button) {
    width: 100%;
  }
}
</style>
