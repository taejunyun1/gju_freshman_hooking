<script setup lang="ts">
import { computed } from 'vue'
import { resultExamplesFor } from '../../../shared/content/result-examples'
import type { TrackKey } from '../../../shared/types/domain'
import SelectionGraphic from '../visual/SelectionGraphic.vue'

const props = defineProps<{
  track: TrackKey
  kind: 'specialty' | 'portfolio'
}>()

const examples = computed(() => resultExamplesFor(props.track, props.kind))
</script>

<template>
  <section :data-result-example-kind="kind" class="result-example-grid">
    <p class="result-example-grid__label">관심사 기반 예시</p>
    <div class="result-example-grid__items">
      <article v-for="example in examples" :key="example.key" data-result-example>
        <SelectionGraphic :visual-key="example.visualKey" code="EXAMPLE" />
        <span class="result-example-grid__badge">예시</span>
        <h4>{{ example.title }}</h4>
        <p>{{ example.description }}</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.result-example-grid {
  display: grid;
  gap: 0.65rem;
}

.result-example-grid__label {
  margin: 0;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.07em;
}

.result-example-grid__items {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.65rem;
}

.result-example-grid__items > article {
  min-width: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.result-example-grid__items :deep(.selection-graphic) {
  min-height: 5.25rem;
}

.result-example-grid__badge {
  display: inline-block;
  margin: 0.65rem 0.7rem 0;
  color: var(--color-primary-strong);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.result-example-grid h4,
.result-example-grid__items > article > p {
  margin: 0.35rem 0.7rem 0;
  overflow-wrap: anywhere;
  word-break: keep-all;
}

.result-example-grid h4 {
  font-family: var(--font-display);
  font-size: 0.875rem;
  letter-spacing: -0.025em;
  line-height: 1.35;
}

.result-example-grid__items > article > p {
  margin-bottom: 0.75rem;
  color: color-mix(in srgb, var(--color-ink) 64%, transparent);
  font-size: 0.75rem;
  line-height: 1.5;
}

@media (min-width: 45rem) {
  .result-example-grid__items {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
