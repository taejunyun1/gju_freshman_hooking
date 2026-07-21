<script setup lang="ts">
import { computed } from 'vue'
import { trackKeys, trackLabels, type TrackKey } from '../../../shared/types/domain'
import type { ResultResource } from '../../../shared/types/result'
import ConnectionReason from './ConnectionReason.vue'

const props = defineProps<{
  resource: ResultResource
  variant?: 'course' | 'project' | 'project-experience' | 'outcome' | 'support'
}>()

const isTrackKey = (value: string): value is TrackKey => trackKeys.some(track => track === value)
const projectTrackLabel = computed(() => (
  isTrackKey(props.resource.primaryTag)
    ? trackLabels[props.resource.primaryTag]
    : '\uC735\uD569 \uD504\uB85C\uC81D\uD2B8'
))

const labels = Object.freeze({
  reference: '\uAE30\uC900',
  majorRequired: '\uC804\uACF5\uD544\uC218',
  grade: '\uD559\uB144',
  term: '\uD559\uAE30',
  credit: '\uD559\uC810',
  details: '\uC0C1\uC138 \uBCF4\uAE30',
  programCategory: '\uD504\uB85C\uADF8\uB7A8 \uD615\uD0DC',
  activities: '\uD559\uC0DD \uD65C\uB3D9',
  outcomes: '\uACB0\uACFC\uBB3C',
  locations: '\uCC38\uC5EC \uAE30\uAD00\u00B7\uC7A5\uC18C',
})
</script>

<template>
  <component
    :is="resource.type === 'project' ? 'details' : 'article'"
    class="resource-card"
    :class="`resource-card--${variant ?? 'outcome'}`"
    :data-course-resource="resource.type === 'course' ? resource.id : undefined"
    :data-project-resource="resource.type === 'project' ? resource.id : undefined"
  >
    <summary
      v-if="resource.type === 'project'"
      class="resource-card__project-summary"
      :aria-label="`${resource.title} 상세 보기`"
    >
      <div class="resource-card__project-topline">
        <span
          class="resource-card__track-badge"
          data-project-track-badge
        >{{ projectTrackLabel }}</span>
        <time :datetime="resource.sourceDate">{{ labels.reference }} {{ resource.sourceDate }}</time>
      </div>
      <h4 class="resource-card__project-title">{{ resource.title }}</h4>
      <p class="resource-card__project-preview">{{ resource.summary }}</p>
      <div class="resource-card__project-footer">
        <p
          v-if="resource.displayMetadata.statusLabel || resource.displayMetadata.periodLabel"
          class="resource-card__project-meta"
        >
          <span v-if="resource.displayMetadata.statusLabel">{{ resource.displayMetadata.statusLabel }}</span>
          <span v-if="resource.displayMetadata.periodLabel">{{ resource.displayMetadata.periodLabel }}</span>
        </p>
        <span class="resource-card__disclosure-label">
          {{ labels.details }}
          <span aria-hidden="true">&#8595;</span>
        </span>
      </div>
    </summary>

    <template v-else>
      <div class="resource-card__header">
        <div class="resource-card__course-type">
          <span class="resource-card__type">
            <template v-if="resource.type === 'course'">COURSE</template>
            <template v-else-if="resource.type === 'extracurricular'">EXTRA</template>
            <template v-else-if="resource.type === 'student_work'">WORK</template>
            <template v-else-if="resource.type === 'career'">CAREER</template>
            <template v-else-if="resource.type === 'support'">SUPPORT</template>
          </span>
          <span
            v-if="resource.type === 'course' && resource.displayMetadata.requirementType === 'major_required'"
            class="resource-card__required-badge"
            data-course-requirement="major_required"
          >{{ labels.majorRequired }}</span>
        </div>
        <time :datetime="resource.sourceDate">{{ labels.reference }} {{ resource.sourceDate }}</time>
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
          <dt>{{ labels.grade }}</dt>
          <dd>{{ resource.displayMetadata.gradeYear }}{{ labels.grade }}</dd>
        </div>
        <div>
          <dt>{{ labels.term }}</dt>
          <dd>{{ resource.displayMetadata.term }}</dd>
        </div>
        <div>
          <dt>{{ labels.credit }}</dt>
          <dd>{{ resource.displayMetadata.credits }}{{ labels.credit }}</dd>
        </div>
      </dl>

      <ConnectionReason :reason="resource.connectionReason" />
    </template>

    <div
      v-if="resource.type === 'project'"
      class="resource-card__project-details"
      data-project-details
    >
      <p
        v-if="resource.displayMetadata.programGroup"
        class="resource-card__program-group"
      >{{ resource.displayMetadata.programGroup }}</p>
      <dl
        v-if="resource.displayMetadata.category
          || resource.displayMetadata.activities
          || resource.displayMetadata.outcomes
          || resource.displayMetadata.locations"
        class="resource-card__project-facts"
        data-project-facts
      >
        <div v-if="resource.displayMetadata.category">
          <dt>{{ labels.programCategory }}</dt>
          <dd>{{ resource.displayMetadata.category }}</dd>
        </div>
        <div v-if="resource.displayMetadata.activities">
          <dt>{{ labels.activities }}</dt>
          <dd>{{ resource.displayMetadata.activities }}</dd>
        </div>
        <div v-if="resource.displayMetadata.outcomes">
          <dt>{{ labels.outcomes }}</dt>
          <dd>{{ resource.displayMetadata.outcomes }}</dd>
        </div>
        <div v-if="resource.displayMetadata.locations">
          <dt>{{ labels.locations }}</dt>
          <dd>{{ resource.displayMetadata.locations }}</dd>
        </div>
      </dl>
      <ConnectionReason :reason="resource.connectionReason" />
    </div>
  </component>
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
  border-top-width: 3px;
  border-top-color: color-mix(in srgb, var(--color-primary) 72%, transparent);
  background: var(--color-surface);
}

details.resource-card {
  overflow: hidden;
  padding: 0;
}

.resource-card--project-experience {
  background: color-mix(in srgb, var(--color-surface) 78%, var(--color-primary-soft));
}

.resource-card--project-experience:not(details) { padding: 0.75rem; }

.resource-card--support { background: var(--color-primary-soft); }

.resource-card__header,
.resource-card__project-topline {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
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

.resource-card__required-badge,
.resource-card__track-badge {
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 9%, var(--color-surface));
  padding: 0.18rem 0.48rem;
  color: var(--color-primary);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1.35;
}

.resource-card__header time,
.resource-card__project-topline time {
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

.resource-card__summary,
.resource-card__project-preview {
  margin: 0.4rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 70%, transparent);
  font-size: 0.8125rem;
  line-height: 1.55;
  overflow-wrap: anywhere;
  word-break: keep-all;
}

.resource-card__project-summary {
  min-width: 0;
  min-height: 44px;
  display: block;
  cursor: pointer;
  padding: 0.9rem;
  list-style: none;
}

.resource-card__project-summary::-webkit-details-marker { display: none; }
.resource-card__project-summary::marker { content: ''; }

.resource-card__project-summary:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: -3px;
}

.resource-card__project-title {
  overflow-wrap: anywhere;
}

.resource-card__project-preview {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.resource-card__project-footer {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 0.65rem;
  margin-top: 0.65rem;
}

.resource-card__project-meta {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.6rem;
  margin: 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  line-height: 1.45;
}

.resource-card__project-meta span + span::before {
  margin-right: 0.6rem;
  color: color-mix(in srgb, var(--color-primary) 65%, transparent);
  content: '\2022';
}

.resource-card__disclosure-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  color: var(--color-primary);
  font-size: 0.6875rem;
  font-weight: 700;
  white-space: nowrap;
}

.resource-card__disclosure-label span { transition: transform 180ms ease; }
details[open] .resource-card__disclosure-label span { transform: rotate(180deg); }

.resource-card__project-details {
  min-width: 0;
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  background: color-mix(in srgb, var(--color-primary-soft) 38%, var(--color-surface));
  padding: 0.9rem;
}

.resource-card__program-group {
  margin: 0 0 0.7rem;
  color: var(--color-primary-strong);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.resource-card__project-facts {
  display: grid;
  gap: 0.65rem;
  margin: 0;
}

.resource-card__project-facts div {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(5.25rem, 0.34fr) minmax(0, 1fr);
  gap: 0.65rem;
}

.resource-card__project-facts dt {
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-size: 0.6875rem;
  font-weight: 700;
}

.resource-card__project-facts dd {
  min-width: 0;
  margin: 0;
  color: color-mix(in srgb, var(--color-ink) 78%, transparent);
  font-size: 0.75rem;
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

.resource-card__course-meta div { display: flex; gap: 0.3rem; }
.resource-card__course-meta dt { color: color-mix(in srgb, var(--color-ink) 57%, transparent); }
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

@media (max-width: 420px) {
  .resource-card__project-facts div { grid-template-columns: minmax(0, 1fr); gap: 0.2rem; }
}

@media (prefers-reduced-motion: reduce) {
  .resource-card__disclosure-label span { transition: none; }
}
</style>
