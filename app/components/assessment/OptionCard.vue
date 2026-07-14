<script setup lang="ts">
import type { PublicAssessmentOption } from '../../../shared/types/api'

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
    <span
      class="option-card__frame"
      :class="`option-card__frame--${option.visualKey}`"
      aria-hidden="true"
    >
      <span class="option-card__frame-code">{{ option.key.split('.')[1] }}</span>
      <span class="option-card__frame-art" />
      <span
        v-if="selected"
        class="option-card__grease-mark"
      >✓</span>
    </span>
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
  border: 1px solid color-mix(in srgb, var(--color-ink) 34%, transparent);
  background: var(--color-surface);
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.option-card:hover {
  border-color: var(--color-ink);
}

.option-card:has(input:focus-visible) {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.option-card--selected {
  border: 2px solid var(--color-sequence);
  background: color-mix(in srgb, var(--color-sequence) 8%, var(--color-surface));
  box-shadow: 4px 4px 0 color-mix(in srgb, var(--color-sequence) 24%, transparent);
}

.option-card__frame {
  position: relative;
  min-height: 6.75rem;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 24%, transparent);
  background: #DDE2EA;
}

.option-card__frame::before,
.option-card__frame::after,
.option-card__frame-art::before,
.option-card__frame-art::after {
  position: absolute;
  display: block;
  content: '';
}

.option-card__frame-code {
  position: absolute;
  z-index: 2;
  top: 0.5rem;
  left: 0.5rem;
  max-width: calc(100% - 1rem);
  overflow: hidden;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: 0.06em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.option-card__frame--photo_frame::before,
.option-card__frame--studio_still::before {
  inset: 1.8rem 1.25rem 0.9rem;
  border: 1px solid var(--color-ink);
}

.option-card__frame--photo_frame::after,
.option-card__frame--studio_still::after {
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--color-ink);
  border-radius: 50%;
  background: var(--color-surface);
  inset: 2.45rem auto auto calc(50% - 1.125rem);
}

.option-card__frame--video_frame::before,
.option-card__frame--music_cuts::before {
  inset: 1.8rem 0.75rem 0.75rem;
  border-block: 0.45rem dotted var(--color-ink);
}

.option-card__frame--video_frame::after,
.option-card__frame--music_cuts::after {
  inset: 2.7rem 1.25rem 1.65rem;
  border: 1px solid var(--color-ink);
}

.option-card__frame--music_cuts .option-card__frame-art::before {
  width: 2.5rem;
  height: 1px;
  top: 3.7rem;
  left: calc(50% - 1.25rem);
  background: var(--color-ink);
  box-shadow: 0 -0.65rem 0 var(--color-sequence), 0 0.65rem 0 var(--color-ink);
  transform: rotate(-12deg);
}

.option-card__frame--edit_timeline::before {
  inset: 2rem 0.75rem 0.75rem;
  border-block: 1px solid color-mix(in srgb, var(--color-ink) 42%, transparent);
  box-shadow: inset 0 1.25rem 0 -1.2rem var(--color-ink), inset 0 -1.25rem 0 -1.2rem var(--color-ink);
}

.option-card__frame--edit_timeline::after {
  width: 2px;
  inset: 1.65rem auto 0.6rem 62%;
  background: var(--color-sequence);
  box-shadow: -2.8rem 1.7rem 0 0.35rem var(--color-ink), 1.25rem 3.1rem 0 0.35rem var(--color-ink);
}

.option-card__frame--interview_strip::before {
  inset: 1.8rem 0.75rem 0.75rem;
  border: 1px solid var(--color-ink);
  background: var(--color-surface);
}

.option-card__frame--interview_strip .option-card__frame-art::before {
  width: 1.6rem;
  height: 2.7rem;
  top: 2.45rem;
  left: 1.2rem;
  border: 1px solid var(--color-ink);
  box-shadow: 2rem 0 0 -1px var(--color-surface), 2rem 0 0 0 var(--color-ink), 4rem 0 0 -1px var(--color-surface), 4rem 0 0 0 var(--color-ink);
}

.option-card__frame--location_board::before,
.option-card__frame--project_board::before,
.option-card__frame--contact_sheet::before {
  inset: 1.8rem 0.75rem 0.75rem;
  border: 1px solid var(--color-ink);
  background: var(--color-surface);
}

.option-card__frame--location_board .option-card__frame-art::before {
  width: 2.4rem;
  height: 2.4rem;
  top: 2.7rem;
  left: calc(50% - 1.2rem);
  border: 1px solid var(--color-ink);
  transform: rotate(45deg);
}

.option-card__frame--project_board .option-card__frame-art::before,
.option-card__frame--contact_sheet .option-card__frame-art::before {
  width: 1.75rem;
  height: 1.25rem;
  top: 2.55rem;
  left: 1.2rem;
  border: 1px solid var(--color-ink);
  box-shadow: 2.15rem 0 0 -1px var(--color-surface), 2.15rem 0 0 0 var(--color-ink), 4.3rem 0 0 -1px var(--color-surface), 4.3rem 0 0 0 var(--color-ink), 0 1.65rem 0 -1px var(--color-surface), 0 1.65rem 0 0 var(--color-ink), 2.15rem 1.65rem 0 -1px var(--color-surface), 2.15rem 1.65rem 0 0 var(--color-ink);
}

.option-card__frame--project_board .option-card__frame-art::after {
  width: 3.5rem;
  height: 1px;
  right: 1.2rem;
  bottom: 1.5rem;
  background: var(--color-sequence);
}

.option-card__frame--gallery_grid::before {
  inset: 1.8rem 0.75rem 0.75rem;
  border: 1px solid var(--color-ink);
  background: var(--color-surface);
}

.option-card__frame--gallery_grid .option-card__frame-art::before {
  width: 2.1rem;
  height: 1.55rem;
  top: 2.45rem;
  left: 1.2rem;
  border: 1px solid var(--color-ink);
  box-shadow: 2.65rem 0 0 -1px var(--color-surface), 2.65rem 0 0 0 var(--color-ink), 1.3rem 2rem 0 -1px var(--color-surface), 1.3rem 2rem 0 0 var(--color-ink);
}

.option-card__frame--photobook_spread::before {
  inset: 1.8rem 0.75rem 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-ink);
  box-shadow: 0.25rem 0.25rem 0 color-mix(in srgb, var(--color-ink) 18%, transparent);
}

.option-card__frame--photobook_spread .option-card__frame-art::before {
  width: 1px;
  top: 1.8rem;
  bottom: 0.75rem;
  left: 50%;
  background: var(--color-ink);
}

.option-card__grease-mark {
  position: absolute;
  z-index: 3;
  right: 0.55rem;
  bottom: 0.25rem;
  color: var(--color-sequence);
  font-family: var(--font-display);
  font-size: 3.5rem;
  font-weight: 900;
  line-height: 1;
  text-shadow: 2px 2px 0 var(--color-surface), -1px -1px 0 var(--color-surface);
  transform: rotate(-8deg);
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
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  font-size: 0.75rem;
  line-height: 1.45;
}

.option-card__control {
  min-height: var(--touch-target);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-top: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
  padding: 0.625rem 0.875rem;
  color: color-mix(in srgb, var(--color-ink) 70%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
}

.option-card__control input {
  width: 1.125rem;
  height: 1.125rem;
  margin: 0;
  accent-color: var(--color-sequence);
}

.option-card--selected .option-card__control {
  color: var(--color-sequence);
}
</style>
