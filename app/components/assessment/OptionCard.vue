<script setup lang="ts">
import type { PublicAssessmentOption } from '../../../shared/types/api'
import SelectionGraphic from '../visual/SelectionGraphic.vue'

const props = defineProps<{
  option: PublicAssessmentOption
  selected: boolean
}>()

const emit = defineEmits<{
  toggle: [key: string]
}>()

const onChange = (): void => emit('toggle', props.option.key)
</script>

<template>
  <label
    class="option-card"
    :class="{ 'option-card--selected': selected }"
  >
    <SelectionGraphic
      :visual-key="option.visualKey"
      :code="option.key.split('.')[1] ?? option.key"
      :selected="selected"
    />
    <span class="option-card__copy">
      <strong>{{ option.label }}</strong>
      <small v-if="option.description">{{ option.description }}</small>
    </span>
    <span class="option-card__control">
      <input
        :data-key="option.key"
        type="checkbox"
        :checked="selected"
        @click="onChange"
      >
      <span>{{ selected ? '선택됨' : '선택' }}</span>
    </span>
  </label>
</template>

<style scoped>
.option-card {
  min-width: 0;
  min-height: var(--touch-target);
  display: grid;
  grid-template-rows: auto 1fr auto;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.option-card:hover {
  border-color: color-mix(in srgb, var(--color-primary) 52%, transparent);
}

.option-card:has(input:focus-visible) {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.option-card--selected {
  border: 2px solid var(--color-primary);
  background: var(--color-primary-soft);
  box-shadow: var(--shadow-raised);
}

.option-card__copy {
  display: grid;
  align-content: start;
  gap: 0.375rem;
  padding: 0.875rem 0.875rem 0.625rem;
}

.option-card__copy strong {
  font-size: 0.9375rem;
  line-height: 1.45;
  word-break: keep-all;
}

.option-card__copy small {
  color: var(--color-muted);
  font-size: 0.75rem;
  line-height: 1.45;
}

.option-card__control {
  min-height: var(--touch-target);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  padding: 0.625rem 0.875rem;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
}

.option-card__control input {
  width: 1.125rem;
  height: 1.125rem;
  margin: 0;
  accent-color: var(--color-primary);
}

.option-card--selected .option-card__control {
  color: var(--color-primary);
}
</style>
