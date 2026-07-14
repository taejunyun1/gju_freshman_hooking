<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ApiSuccess } from '../../../shared/types/api'
import AdminRecovery, { type AdminRecoveryRequest } from '../../components/admin/AdminRecovery.vue'
import AppButton from '../../components/common/AppButton.vue'
import AppState from '../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const adminSession = useAdminSessionStore()
const requests = ref<AdminRecoveryRequest[]>([])
const loading = ref(true)
const errorMessage = ref('')

const loadQueue = async (): Promise<void> => {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<{ requests: AdminRecoveryRequest[] }>>('/api/admin/recovery', {
      headers: adminSession.authorizationHeaders(),
    })
    requests.value = response.data.requests
  }
  catch {
    errorMessage.value = '복구 대기열을 불러오지 못했습니다. 세션을 확인한 뒤 다시 시도하세요.'
  }
  finally {
    loading.value = false
  }
}

const removeRequest = (requestId: number): void => {
  requests.value = requests.value.filter(request => request.id !== requestId)
}

onMounted(loadQueue)
</script>

<template>
  <section class="recovery-queue" aria-labelledby="recovery-queue-title">
    <header class="recovery-queue__header">
      <div>
        <p class="recovery-queue__eyebrow">ACCOUNT / RECOVERY</p>
        <h1 id="recovery-queue-title">복구 대기열</h1>
        <p>만료되지 않은 승인 대기 요청만 표시됩니다.</p>
      </div>
      <AppButton
        variant="secondary"
        :loading="loading"
        @click="loadQueue"
      >
        새로고침
      </AppButton>
    </header>

    <AppState
      v-if="loading"
      variant="loading"
      message="복구 요청을 확인하고 있습니다."
    />
    <AppState
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />
    <AppState
      v-else-if="requests.length === 0"
      variant="empty"
      message="승인을 기다리는 복구 요청이 없습니다."
    />
    <div
      v-else
      class="recovery-queue__records"
    >
      <AdminRecovery
        v-for="request in requests"
        :key="request.id"
        :request="request"
        @code-cleared="removeRequest"
      />
    </div>
  </section>
</template>

<style scoped>
.recovery-queue__header {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 2rem;
}

.recovery-queue__eyebrow {
  margin: 0 0 0.625rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.recovery-queue h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2rem, 6vw, 3.25rem);
  letter-spacing: -0.05em;
}

.recovery-queue__header p:last-child {
  margin: 0.75rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
}

.recovery-queue__records {
  display: grid;
  gap: 1rem;
}

@media (max-width: 40rem) {
  .recovery-queue__header :deep(button) { width: 100%; }
}
</style>
