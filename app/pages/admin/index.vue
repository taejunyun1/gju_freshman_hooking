<script setup lang="ts">
import AppState from '../../components/common/AppState.vue'

definePageMeta({ middleware: 'admin' })
</script>

<template>
  <NuxtLayout name="admin">
    <section class="admin-dashboard" aria-labelledby="admin-dashboard-title">
      <p class="admin-dashboard__eyebrow">OPERATIONS / HOME</p>
      <h1 id="admin-dashboard-title">운영 홈</h1>
      <p class="admin-dashboard__intro">확인할 운영 작업을 선택하세요.</p>
      <AppState
        variant="empty"
        message="운영 항목이 아직 없습니다. 복구 요청은 복구 대기열에서 확인하세요."
      />
    </section>
  </NuxtLayout>
</template>

<style scoped>
.admin-dashboard { max-width: 58rem; }

.admin-dashboard__eyebrow {
  margin: 0 0 0.625rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.admin-dashboard h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2rem, 6vw, 3.25rem);
  letter-spacing: -0.05em;
}

.admin-dashboard__intro {
  margin: 0.75rem 0 2rem;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
}
</style>
