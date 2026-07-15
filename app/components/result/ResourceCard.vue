<script setup lang="ts">
import type { ResultResource } from '../../../shared/types/result'
import ConnectionReason from './ConnectionReason.vue'

defineProps<{
  resource: ResultResource
  variant?: 'course' | 'project' | 'outcome' | 'support'
}>()
</script>

<template>
  <article
    class="resource-card"
    :class="`resource-card--${variant ?? 'outcome'}`"
    :data-course-resource="resource.type === 'course' ? resource.id : undefined"
    :data-project-resource="resource.type === 'project' ? resource.id : undefined"
  >
    <div class="resource-card__header">
      <span class="resource-card__type">
        <template v-if="resource.type === 'course'">COURSE</template>
        <template v-else-if="resource.type === 'project'">PROJECT</template>
        <template v-else-if="resource.type === 'extracurricular'">EXTRA</template>
        <template v-else-if="resource.type === 'student_work'">WORK</template>
        <template v-else-if="resource.type === 'career'">CAREER</template>
        <template v-else-if="resource.type === 'support'">SUPPORT</template>
      </span>
      <time :datetime="resource.sourceDate">기준 {{ resource.sourceDate }}</time>
    </div>

    <template v-if="resource.type === 'student_work'">
      <div class="resource-card__work-frame">
        <img
          :src="`/${resource.displayMetadata.imagePath}`"
          :alt="resource.displayMetadata.imageAlt"
        >
      </div>
    </template>

    <h4>{{ resource.title }}</h4>
    <p class="resource-card__summary">{{ resource.summary }}</p>

    <dl
      v-if="resource.type === 'course'"
      class="resource-card__course-meta"
    >
      <div>
        <dt>학년</dt>
        <dd>{{ resource.displayMetadata.gradeYear }}학년</dd>
      </div>
      <div>
        <dt>학기</dt>
        <dd>{{ resource.displayMetadata.term }}</dd>
      </div>
      <div>
        <dt>학점</dt>
        <dd>{{ resource.displayMetadata.credits }}학점</dd>
      </div>
    </dl>

    <ConnectionReason :reason="resource.connectionReason" />
  </article>
</template>

<style scoped>
.resource-card {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--color-ink) 19%, transparent);
  background: var(--color-surface);
  padding: 0.9rem;
}

.resource-card--course {
  border-top: 0.25rem solid var(--color-sequence);
}

.resource-card--project {
  border-left: 0.3rem solid var(--color-resource);
}

.resource-card--support {
  background: color-mix(in srgb, var(--color-canvas) 56%, var(--color-surface));
}

.resource-card__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  color: color-mix(in srgb, var(--color-ink) 60%, transparent);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: 0.035em;
}

.resource-card__type {
  color: var(--color-resource);
  font-weight: 700;
}

.resource-card h4 {
  margin: 0.7rem 0 0;
  font-family: var(--font-display);
  font-size: 1rem;
  letter-spacing: -0.025em;
  line-height: 1.4;
  overflow-wrap: anywhere;
  word-break: keep-all;
}

.resource-card__summary {
  margin: 0.4rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 70%, transparent);
  font-size: 0.8125rem;
  line-height: 1.55;
  overflow-wrap: anywhere;
  word-break: keep-all;
}

.resource-card__course-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin: 0.8rem 0 0;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.resource-card__course-meta div {
  display: flex;
  gap: 0.3rem;
}

.resource-card__course-meta dt {
  color: color-mix(in srgb, var(--color-ink) 57%, transparent);
}

.resource-card__course-meta dd { margin: 0; }

.resource-card__work-frame {
  aspect-ratio: 16 / 10;
  overflow: hidden;
  margin-top: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  background: var(--color-canvas);
}

.resource-card__work-frame img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
</style>
