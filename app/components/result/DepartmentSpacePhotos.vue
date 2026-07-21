<script setup lang="ts">
import { computed } from 'vue'
import { departmentPhotosByTrack } from '../../../shared/content/department-photos'
import type { TrackKey } from '../../../shared/types/domain'
import DepartmentPhotoCard from '../common/DepartmentPhotoCard.vue'

const props = defineProps<{ track: TrackKey }>()
const photos = computed(() => departmentPhotosByTrack[props.track])
</script>

<template>
  <section class="department-space-photos" aria-labelledby="department-space-title">
    <h3 id="department-space-title">실제 제작 공간</h3>
    <div class="department-space-photos__grid">
      <div
        v-for="photo in photos"
        :key="photo.src"
        data-department-space-photo
      >
        <DepartmentPhotoCard :photo="photo" loading="lazy" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.department-space-photos {
  display: grid;
  gap: 1rem;
}

.department-space-photos h3 {
  margin: 0;
  color: var(--color-primary-strong);
  font-family: var(--font-display);
}

.department-space-photos__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

.department-space-photos :deep(.department-photo-card__media) {
  aspect-ratio: 16 / 9;
}

@media (min-width: 720px) {
  .department-space-photos__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
