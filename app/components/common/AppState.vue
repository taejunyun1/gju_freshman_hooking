<script setup lang="ts">
defineProps<{
  variant: 'loading' | 'empty' | 'error'
  message: string
}>()
</script>

<template>
  <div
    class="app-state"
    :class="`app-state--${variant}`"
    aria-live="polite"
  >
    <span
      class="app-state__mark"
      aria-hidden="true"
    >
      <template v-if="variant === 'loading'">···</template>
      <template v-else-if="variant === 'empty'">○</template>
      <template v-else>!</template>
    </span>
    <p>{{ message }}</p>
  </div>
</template>

<style scoped>
.app-state {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  padding: 1rem;
}

.app-state p {
  margin: 0;
}

.app-state__mark {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid currentcolor;
  border-radius: 50%;
  font-family: var(--font-mono);
  font-weight: 700;
}

.app-state--loading {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.app-state--empty {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.app-state--error {
  border-color: var(--color-error);
  color: var(--color-error);
}
</style>
