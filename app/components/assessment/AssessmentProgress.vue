<script setup lang="ts">
defineProps<{
  step: number
  groupLabel: string
}>()
</script>

<template>
  <div
    class="assessment-progress"
    aria-label="진단 진행 상황"
  >
    <div class="assessment-progress__readout">
      <span>{{ String(step + 1).padStart(2, '0') }} / 04</span>
      <strong>{{ groupLabel }}</strong>
    </div>
    <ol aria-hidden="true">
      <li
        v-for="index in 4"
        :key="index"
        :class="{
          'assessment-progress__past': index < step + 1,
          'assessment-progress__active': index === step + 1,
        }"
      />
    </ol>
  </div>
</template>

<style scoped>
.assessment-progress {
  border-block: 1px solid color-mix(in srgb, var(--color-ink) 24%, transparent);
  padding-block: 0.75rem;
}

.assessment-progress__readout {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.assessment-progress__readout span {
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.assessment-progress__readout strong {
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 720;
}

.assessment-progress ol {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.375rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.assessment-progress li {
  height: 0.1875rem;
  background: color-mix(in srgb, var(--color-ink) 18%, transparent);
  transition: background-color 160ms ease, transform 160ms ease;
}

.assessment-progress .assessment-progress__past {
  background: color-mix(in srgb, var(--color-sequence) 48%, var(--color-surface));
}

.assessment-progress .assessment-progress__active {
  background: var(--color-sequence);
  transform: scaleY(2);
  transform-origin: center;
}
</style>
