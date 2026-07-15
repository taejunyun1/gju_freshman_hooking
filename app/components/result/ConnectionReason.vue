<script setup lang="ts">
defineProps<{
  reason: string
}>()
</script>

<template>
  <p class="connection-reason">
    <span aria-hidden="true">↳</span>
    {{ reason }}
  </p>
</template>

<style scoped>
.connection-reason {
  min-width: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.45rem;
  margin: 0.8rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  font-size: 0.8125rem;
  line-height: 1.65;
  overflow-wrap: anywhere;
  word-break: keep-all;
}

.connection-reason span {
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-weight: 700;
}
</style>
