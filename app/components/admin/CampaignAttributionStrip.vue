<script setup lang="ts">
import { computed } from 'vue'

import type { AdminCampaign } from '../../../shared/schemas/admin'

const props = defineProps<{
  metrics: AdminCampaign['metrics']
  sentCount: number
}>()

const frames = computed(() => [
  { key: 'sent', label: '발송', value: new Intl.NumberFormat('ko-KR').format(props.sentCount) },
  { key: 'visits', label: '방문', value: props.metrics.visits ?? '집계 준비 중' },
  { key: 'assessments', label: '검사 완료', value: props.metrics.assessmentCompletions ?? '집계 준비 중' },
  { key: 'counseling', label: '상담 전환', value: props.metrics.counselingConversions ?? '집계 준비 중' },
])
</script>

<template>
  <ol class="attribution-strip" aria-label="캠페인 기여 흐름">
    <li
      v-for="(frame, index) in frames"
      :key="frame.key"
      data-attribution-frame
    >
      <span class="attribution-strip__index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
      <span data-frame-label>{{ frame.label }}</span>
      <strong data-frame-value>{{ frame.value }}</strong>
    </li>
  </ol>
</template>

<style scoped>
.attribution-strip {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  padding: 1px;
  background: color-mix(in srgb, var(--color-sequence) 35%, var(--color-ink));
  list-style: none;
}

.attribution-strip li {
  min-width: 0;
  min-height: 5rem;
  display: grid;
  align-content: space-between;
  gap: 0.25rem;
  background: var(--color-ink);
  color: var(--color-surface);
  padding: 0.55rem;
}

.attribution-strip__index {
  color: #CDBBEF;
  font-family: var(--font-mono);
  font-size: 0.625rem;
}

[data-frame-label] {
  color: color-mix(in srgb, var(--color-surface) 72%, transparent);
  font-size: 0.6875rem;
  font-weight: 650;
  line-height: 1.25;
}

[data-frame-value] {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.3;
}

@media (max-width: 24rem) {
  .attribution-strip li { padding: 0.45rem; }
  [data-frame-label] { font-size: 0.625rem; }
  [data-frame-value] { font-size: 0.6875rem; }
}

@media (prefers-reduced-motion: reduce) {
  .attribution-strip * { transition-duration: 0.01ms !important; }
}
</style>
