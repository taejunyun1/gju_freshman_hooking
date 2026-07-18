<script setup lang="ts">
import AppState from '../../components/common/AppState.vue'
import { DEPARTMENT_NAME } from '../../../shared/constants/department-brand'

definePageMeta({ layout: 'admin', middleware: 'admin' })
</script>

<template>
  <section class="admin-dashboard" aria-labelledby="admin-dashboard-title">
    <p class="admin-dashboard__eyebrow">OPERATIONS / HOME</p>
    <h1 id="admin-dashboard-title">운영 홈</h1>
    <p class="admin-dashboard__intro">{{ DEPARTMENT_NAME }}의 운영 작업을 선택하세요.</p>
    <AppState
      variant="empty"
      message="운영 항목이 아직 없습니다. 복구 요청은 복구 대기열에서 확인하세요."
    />
  </section>
</template>

<style scoped>
.admin-dashboard {
  max-width: 58rem;
  border: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  padding: clamp(1.25rem, 4vw, 2rem);
}

.admin-dashboard__eyebrow {
  margin: 0 0 0.625rem;
  color: var(--color-primary);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.admin-dashboard h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  letter-spacing: -0.05em;
}

.admin-dashboard__intro {
  margin: 0.75rem 0 2rem;
  color: color-mix(in srgb, var(--color-primary-strong) 68%, transparent);
}
</style>
