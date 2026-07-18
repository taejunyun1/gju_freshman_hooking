<script setup lang="ts">
import type { ResultFaculty } from '../../../shared/types/result'
import type { TrackKey } from '../../../shared/types/domain'
import FacultyCard from './FacultyCard.vue'
import ResultExampleGrid from './ResultExampleGrid.vue'

defineProps<{
  faculty: ResultFaculty
  track: TrackKey
}>()

</script>

<template>
  <div class="faculty-recommendation">
    <section class="faculty-recommendation__group">
      <h3 data-faculty-role>추천 총괄교수</h3>
      <FacultyCard :person="faculty.primary" />
    </section>

    <section class="faculty-recommendation__group faculty-recommendation__group--backup">
      <h3 data-faculty-role>예비 상담교수</h3>
      <FacultyCard :person="faculty.backup" />
    </section>

    <section class="faculty-recommendation__group faculty-recommendation__group--specialists">
      <h3 data-faculty-role>함께 연결되는 전문분야</h3>
      <div
        v-if="faculty.specialists.length > 0"
        class="faculty-recommendation__specialist-list"
      >
        <FacultyCard
          v-for="person in faculty.specialists"
          :key="person.id"
          :person="person"
        />
      </div>
      <ResultExampleGrid :track="track" kind="specialty" />
    </section>
  </div>
</template>

<style scoped>
.faculty-recommendation {
  display: grid;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  overflow: hidden;
}

.faculty-recommendation__group {
  min-width: 0;
  padding: 1rem;
}

.faculty-recommendation__group + .faculty-recommendation__group {
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.faculty-recommendation__group--specialists {
  background: var(--color-primary-soft);
}

.faculty-recommendation__group > h3 {
  margin: 0 0 0.8rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.025em;
}

.faculty-recommendation__group--specialists > h3 { color: var(--color-signal); }

.faculty-recommendation__specialist-list {
  display: grid;
  gap: 1rem;
  margin-bottom: 1rem;
}

@media (min-width: 1024px) {
  .faculty-recommendation {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .faculty-recommendation__group + .faculty-recommendation__group {
    border-top: 0;
    border-left: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  }

  .faculty-recommendation__group--specialists {
    grid-column: 1 / -1;
    border-top: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent) !important;
    border-left: 0 !important;
  }

  .faculty-recommendation__specialist-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
