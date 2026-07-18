<script setup lang="ts">
import type { VisualKey } from '../../../shared/types/domain'

withDefaults(defineProps<{
  visualKey: VisualKey
  code: string
  selected?: boolean
}>(), {
  selected: false,
})
</script>

<template>
  <span
    class="selection-graphic"
    :class="`selection-graphic--${visualKey}`"
    data-selection-graphic
    aria-hidden="true"
  >
    <span class="selection-graphic__code">{{ code }}</span>
    <span class="selection-graphic__art" />
    <span
      v-if="selected"
      class="selection-graphic__grease-mark"
    >✓</span>
  </span>
</template>

<style scoped>
.selection-graphic {
  position: relative;
  min-height: 6.75rem;
  display: block;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  background: var(--color-primary-soft);
}

.selection-graphic::before,
.selection-graphic::after,
.selection-graphic__art::before,
.selection-graphic__art::after {
  position: absolute;
  display: block;
  content: '';
}

.selection-graphic__code {
  position: absolute;
  z-index: 2;
  top: 0.5rem;
  left: 0.5rem;
  max-width: calc(100% - 1rem);
  overflow: hidden;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: 0.06em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.selection-graphic--photo_frame::before,
.selection-graphic--studio_still::before {
  inset: 1.8rem 1.25rem 0.9rem;
  border: 1px solid var(--color-primary);
}

.selection-graphic--photo_frame::after,
.selection-graphic--studio_still::after {
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--color-primary);
  border-radius: 50%;
  background: var(--color-surface);
  inset: 2.45rem auto auto calc(50% - 1.125rem);
}

.selection-graphic--video_frame::before,
.selection-graphic--music_cuts::before {
  inset: 1.8rem 0.75rem 0.75rem;
  border-block: 0.45rem dotted var(--color-primary);
}

.selection-graphic--video_frame::after,
.selection-graphic--music_cuts::after {
  inset: 2.7rem 1.25rem 1.65rem;
  border: 1px solid var(--color-primary);
}

.selection-graphic--music_cuts .selection-graphic__art::before {
  width: 2.5rem;
  height: 1px;
  top: 3.7rem;
  left: calc(50% - 1.25rem);
  background: var(--color-primary);
  box-shadow: 0 -0.65rem 0 var(--color-primary), 0 0.65rem 0 var(--color-primary);
  transform: rotate(-12deg);
}

.selection-graphic--edit_timeline::before {
  inset: 2rem 0.75rem 0.75rem;
  border-block: 1px solid color-mix(in srgb, var(--color-primary) 42%, transparent);
  box-shadow: inset 0 1.25rem 0 -1.2rem var(--color-primary), inset 0 -1.25rem 0 -1.2rem var(--color-primary);
}

.selection-graphic--edit_timeline::after {
  width: 2px;
  inset: 1.65rem auto 0.6rem 62%;
  background: var(--color-primary);
  box-shadow: -2.8rem 1.7rem 0 0.35rem var(--color-primary), 1.25rem 3.1rem 0 0.35rem var(--color-primary);
}

.selection-graphic--interview_strip::before,
.selection-graphic--location_board::before,
.selection-graphic--project_board::before,
.selection-graphic--contact_sheet::before,
.selection-graphic--gallery_grid::before,
.selection-graphic--photobook_spread::before {
  inset: 1.8rem 0.75rem 0.75rem;
  border: 1px solid var(--color-primary);
  background: var(--color-surface);
}

.selection-graphic--interview_strip .selection-graphic__art::before {
  width: 1.6rem;
  height: 2.7rem;
  top: 2.45rem;
  left: 1.2rem;
  border: 1px solid var(--color-primary);
  box-shadow: 2rem 0 0 -1px var(--color-surface), 2rem 0 0 0 var(--color-primary), 4rem 0 0 -1px var(--color-surface), 4rem 0 0 0 var(--color-primary);
}

.selection-graphic--location_board .selection-graphic__art::before {
  width: 2.4rem;
  height: 2.4rem;
  top: 2.7rem;
  left: calc(50% - 1.2rem);
  border: 1px solid var(--color-primary);
  transform: rotate(45deg);
}

.selection-graphic--project_board .selection-graphic__art::before,
.selection-graphic--contact_sheet .selection-graphic__art::before {
  width: 1.75rem;
  height: 1.25rem;
  top: 2.55rem;
  left: 1.2rem;
  border: 1px solid var(--color-primary);
  box-shadow: 2.15rem 0 0 -1px var(--color-surface), 2.15rem 0 0 0 var(--color-primary), 4.3rem 0 0 -1px var(--color-surface), 4.3rem 0 0 0 var(--color-primary), 0 1.65rem 0 -1px var(--color-surface), 0 1.65rem 0 0 var(--color-primary), 2.15rem 1.65rem 0 -1px var(--color-surface), 2.15rem 1.65rem 0 0 var(--color-primary);
}

.selection-graphic--project_board .selection-graphic__art::after {
  width: 3.5rem;
  height: 1px;
  right: 1.2rem;
  bottom: 1.5rem;
  background: var(--color-primary);
}

.selection-graphic--gallery_grid .selection-graphic__art::before {
  width: 2.1rem;
  height: 1.55rem;
  top: 2.45rem;
  left: 1.2rem;
  border: 1px solid var(--color-primary);
  box-shadow: 2.65rem 0 0 -1px var(--color-surface), 2.65rem 0 0 0 var(--color-primary), 1.3rem 2rem 0 -1px var(--color-surface), 1.3rem 2rem 0 0 var(--color-primary);
}

.selection-graphic--photobook_spread .selection-graphic__art::before {
  width: 1px;
  top: 1.8rem;
  bottom: 0.75rem;
  left: 50%;
  background: var(--color-primary);
}

.selection-graphic__grease-mark {
  position: absolute;
  z-index: 3;
  right: 0.55rem;
  bottom: 0.25rem;
  color: var(--color-primary);
  font-family: var(--font-display);
  font-size: 3.5rem;
  font-weight: 900;
  line-height: 1;
  text-shadow: 2px 2px 0 var(--color-surface), -1px -1px 0 var(--color-surface);
  transform: rotate(-8deg);
}
</style>
