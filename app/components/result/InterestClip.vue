<script setup lang="ts">
import type { SelectedInterest } from '../../../shared/types/result'

defineProps<{
  interest: SelectedInterest
}>()

const groupLabels = {
  work: '하고 싶은 작업',
  result: '만들고 싶은 결과물',
  style: '작업 방식',
  career: '진로 방향',
} as const
</script>

<template>
  <li
    class="interest-clip"
    data-interest-clip
    :data-interest-group="interest.group"
  >
    <span
      class="interest-clip__group"
      data-interest-group-label
    >{{ groupLabels[interest.group] }}</span>
    <strong>{{ interest.label }}</strong>
  </li>
</template>

<style scoped>
.interest-clip {
  position: relative;
  min-width: 0;
  flex: 0 0 min(16rem, 78vw);
  border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  padding: 0.85rem 1rem 1rem;
  scroll-snap-align: start;
}

.interest-clip::after {
  content: none;
}

.interest-clip__group {
  display: block;
  margin-bottom: 0.55rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.interest-clip strong {
  min-width: 0;
  display: block;
  padding-right: 1.8rem;
  font-family: var(--font-display);
  font-size: 0.9375rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  word-break: keep-all;
}

@media (min-width: 1024px) {
  .interest-clip { flex-basis: auto; }
}
</style>
