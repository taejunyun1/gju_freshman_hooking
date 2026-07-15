<script setup lang="ts">
import type { ResultFaculty } from '../../../shared/types/result'
import FacultyCard from './FacultyCard.vue'

defineProps<{
  faculty: ResultFaculty
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
      <p
        v-else
        class="faculty-recommendation__empty"
      >확인된 학과 데이터를 준비 중입니다</p>
    </section>
  </div>
</template>

<style scoped>
.faculty-recommendation {
  display: grid;
  border: 1px solid color-mix(in srgb, var(--color-ink) 23%, transparent);
  background: var(--color-surface);
}

.faculty-recommendation__group {
  min-width: 0;
  border-top: 0.25rem solid var(--color-sequence);
  padding: 1rem;
}

.faculty-recommendation__group + .faculty-recommendation__group {
  border-top-width: 1px;
  border-top-color: color-mix(in srgb, var(--color-ink) 20%, transparent);
}

.faculty-recommendation__group--specialists {
  background: color-mix(in srgb, var(--color-signal) 5%, var(--color-surface));
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
}

.faculty-recommendation__empty {
  margin: 0;
  color: color-mix(in srgb, var(--color-ink) 63%, transparent);
}

@media (min-width: 1024px) {
  .faculty-recommendation {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .faculty-recommendation__group + .faculty-recommendation__group {
    border-top-width: 0.25rem;
    border-left: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent);
  }

  .faculty-recommendation__group--backup { border-top-color: var(--color-resource); }

  .faculty-recommendation__group--specialists {
    grid-column: 1 / -1;
    border-top: 1px solid color-mix(in srgb, var(--color-signal) 40%, transparent) !important;
    border-left: 0 !important;
  }

  .faculty-recommendation__specialist-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
