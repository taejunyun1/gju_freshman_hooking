<script setup lang="ts">
import { ref } from 'vue'
import type { DepartmentPhoto } from '../../../shared/content/department-photos'

withDefaults(defineProps<{
  photo: DepartmentPhoto
  loading?: 'eager' | 'lazy'
}>(), { loading: 'lazy' })

const imageFailed = ref(false)
</script>

<template>
  <figure class="department-photo-card" data-department-photo-card>
    <div v-if="!imageFailed" class="department-photo-card__media">
      <img
        :src="photo.src"
        :alt="photo.alt"
        :width="photo.width"
        :height="photo.height"
        :loading="loading"
        decoding="async"
        @error="imageFailed = true"
      >
    </div>
    <figcaption>
      <strong>{{ photo.label }}</strong>
      <span>{{ photo.description }}</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.department-photo-card {
  margin: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
}

.department-photo-card__media {
  overflow: hidden;
  aspect-ratio: var(--department-photo-aspect, 16 / 9);
}

.department-photo-card__media img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.department-photo-card figcaption {
  display: grid;
  gap: 0.25rem;
  padding: 1rem;
}

.department-photo-card strong {
  color: var(--color-primary-strong);
  font-family: var(--font-display);
}

.department-photo-card span {
  color: var(--color-muted);
  line-height: 1.6;
}
</style>
