<script setup lang="ts">
import type { ResultResource } from '../../../shared/types/result'
import ConnectionReason from './ConnectionReason.vue'

defineProps<{
  resource: ResultResource
  variant?: 'course' | 'project' | 'project-experience' | 'outcome' | 'support'
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
      <div class="resource-card__course-type">
        <span class="resource-card__type">
          <template v-if="resource.type === 'course'">COURSE</template>
          <template v-else-if="resource.type === 'project'">PROJECT</template>
          <template v-else-if="resource.type === 'extracurricular'">EXTRA</template>
          <template v-else-if="resource.type === 'student_work'">WORK</template>
          <template v-else-if="resource.type === 'career'">CAREER</template>
          <template v-else-if="resource.type === 'support'">SUPPORT</template>
        </span>
        <span
          v-if="resource.type === 'course' && resource.displayMetadata.requirementType === 'major_required'"
          class="resource-card__required-badge"
          data-course-requirement="major_required"
        >전공필수</span>
      </div>
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

    <p
      v-if="resource.type === 'project' && (
        resource.displayMetadata.statusLabel
        || resource.displayMetadata.periodLabel
        || resource.displayMetadata.programGroup
      )"
      class="resource-card__project-meta"
    >
      <span v-if="resource.displayMetadata.statusLabel">{{ resource.displayMetadata.statusLabel }}</span>
      <span v-if="resource.displayMetadata.periodLabel">{{ resource.displayMetadata.periodLabel }}</span>
      <span v-if="resource.displayMetadata.programGroup">{{ resource.displayMetadata.programGroup }}</span>
    </p>

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
  border: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--color-primary-soft) 44%, var(--color-surface));
  padding: 0.9rem;
}

.resource-card--course {
  background: var(--color-surface);
}

.resource-card--project-experience {
  background: color-mix(in srgb, var(--color-surface) 78%, var(--color-primary-soft));
  padding: 0.75rem;
}

.resource-card--support {
  background: var(--color-primary-soft);
}

.resource-card__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: color-mix(in srgb, var(--color-ink) 60%, transparent);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: 0.035em;
}

.resource-card__course-type {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.resource-card__type {
  color: var(--color-resource);
  font-weight: 700;
}

.resource-card__required-badge {
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-radius: 0.4rem;
  background: color-mix(in srgb, var(--color-primary) 9%, var(--color-surface));
  padding: 0.12rem 0.35rem;
  color: var(--color-primary);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
}

.resource-card__header time {
  margin-left: auto;
  white-space: nowrap;
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

.resource-card__project-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.6rem;
  margin: 0.65rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 64%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6rem;
  line-height: 1.45;
}

.resource-card__project-meta span + span::before {
  margin-right: 0.6rem;
  color: color-mix(in srgb, var(--color-primary) 65%, transparent);
  content: '•';
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
  border-radius: var(--radius-card);
  background: var(--color-canvas);
}

.resource-card__work-frame img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
</style>
