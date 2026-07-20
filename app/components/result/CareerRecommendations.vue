<script setup lang="ts">
import { computed } from 'vue'
import type { CareerResultResource } from '../../../shared/types/result'
import ResourceCard from './ResourceCard.vue'

const CAREER_ARCHIVE_URL = 'https://gjphoto94.notion.site/2a163cb8bb55800c9057c4973527db76?source=copy_link'

const props = defineProps<{
  career: readonly CareerResultResource[]
}>()

const featured = computed(() => props.career.slice(0, 2))
const compact = computed(() => props.career.slice(2, 4))
</script>

<template>
  <div class="career-recommendations" data-career-recommendations>
    <div
      v-for="resource in featured"
      :key="resource.id"
      class="career-recommendations__featured"
      data-career-featured
      :data-career-resource-id="resource.id"
    >
      <ResourceCard :resource="resource" variant="outcome" />
    </div>

    <p
      v-if="career.length === 0"
      class="career-recommendations__empty"
    >확인된 학과 데이터를 준비 중입니다</p>

    <div
      v-if="compact.length > 0"
      class="career-recommendations__more"
    >
      <p>더 살펴볼 졸업생</p>
      <ul>
        <li
          v-for="(resource, index) in compact"
          :key="resource.id"
          data-career-compact
          :data-career-resource-id="resource.id"
        >
          <a
            :href="CAREER_ARCHIVE_URL"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="`${resource.title}, 졸업생 인터뷰에서 확인 (새 창)`"
          >
            <span class="career-recommendations__index" aria-hidden="true">0{{ index + 3 }}</span>
            <strong>{{ resource.title }}</strong>
            <span class="career-recommendations__action">인터뷰 보기 <span>(새 창)</span></span>
          </a>
        </li>
      </ul>
    </div>

    <a
      class="career-recommendations__archive"
      data-career-archive-link
      :href="CAREER_ARCHIVE_URL"
      target="_blank"
      rel="noopener noreferrer"
    >
      졸업생 인터뷰 아카이브에서 더 보기 <span>(새 창)</span>
    </a>
  </div>
</template>

<style scoped>
.career-recommendations {
  display: grid;
  min-width: 0;
  gap: 0.65rem;
}

.career-recommendations__featured {
  min-width: 0;
}

.career-recommendations__more {
  overflow: hidden;
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--color-primary-soft) 34%, var(--color-surface));
}

.career-recommendations__more > p {
  margin: 0;
  padding: 0.55rem 0.7rem 0.45rem;
  color: color-mix(in srgb, var(--color-ink) 58%, transparent);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.055em;
}

.career-recommendations__more ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.career-recommendations__more li + li {
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 14%, transparent);
}

.career-recommendations__more a {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  padding: 0.65rem 0.7rem;
  color: var(--color-ink);
  text-decoration: none;
}

.career-recommendations__more a:hover,
.career-recommendations__more a:focus-visible {
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
}

.career-recommendations__more a:focus-visible,
.career-recommendations__archive:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.career-recommendations__index {
  color: var(--color-primary);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 700;
}

.career-recommendations__more strong {
  min-width: 0;
  font-family: var(--font-display);
  font-size: 0.75rem;
  letter-spacing: -0.02em;
  line-height: 1.4;
  overflow-wrap: anywhere;
  word-break: keep-all;
}

.career-recommendations__action,
.career-recommendations__archive {
  color: var(--color-primary-strong);
  font-size: 0.6875rem;
  font-weight: 700;
}

.career-recommendations__action span,
.career-recommendations__archive span {
  white-space: nowrap;
}

.career-recommendations__archive {
  justify-self: start;
  border-radius: 0.5rem;
  padding: 0.45rem 0.1rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  word-break: keep-all;
}

.career-recommendations__empty {
  margin: 0;
  border: 1px dashed color-mix(in srgb, var(--color-ink) 28%, transparent);
  border-radius: var(--radius-card);
  padding: 1rem;
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  line-height: 1.55;
}

@media (max-width: 30rem) {
  .career-recommendations__more a {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .career-recommendations__action {
    grid-column: 2;
  }
}
</style>
