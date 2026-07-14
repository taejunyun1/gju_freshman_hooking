<script setup lang="ts">
withDefaults(defineProps<{
  variant: 'primary' | 'secondary' | 'danger'
  loading?: boolean
}>(), {
  loading: false,
})
</script>

<template>
  <button
    class="app-button"
    :class="`app-button--${variant}`"
    type="button"
    :disabled="loading"
    :aria-busy="loading ? 'true' : undefined"
  >
    <span
      v-if="loading"
      class="app-button__indicator"
      aria-hidden="true"
    />
    <span class="app-button__label"><slot /></span>
  </button>
</template>

<style scoped>
.app-button {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  padding: 0.625rem 1rem;
  font-family: var(--font-display);
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
}

.app-button--primary {
  background: var(--color-sequence);
  color: var(--color-surface);
}

.app-button--secondary {
  border-color: var(--color-resource);
  background: var(--color-surface);
  color: var(--color-resource);
}

.app-button--danger {
  background: var(--color-error);
  color: var(--color-surface);
}

.app-button:hover:not(:disabled) {
  filter: brightness(0.92);
}

.app-button:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.app-button:disabled {
  cursor: wait;
  opacity: 0.66;
}

.app-button__indicator {
  width: 0.875rem;
  height: 0.875rem;
  border: 2px solid currentcolor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: app-button-spin 700ms linear infinite;
}

@keyframes app-button-spin {
  to {
    transform: rotate(1turn);
  }
}
</style>
