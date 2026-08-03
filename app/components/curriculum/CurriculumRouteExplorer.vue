<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  curriculumRoutes,
  curriculumTrackOrder,
  resolveCurriculumTrack,
  type CurriculumTrackKey,
} from '../../../shared/content/curriculum-routes'

const props = withDefaults(defineProps<{
  defaultTrack?: CurriculumTrackKey
  variant?: 'compact' | 'detailed'
}>(), {
  defaultTrack: 'video',
  variant: 'detailed',
})

const activeTrack = ref(resolveCurriculumTrack(props.defaultTrack))
const route = computed(() => curriculumRoutes[activeTrack.value])

const selectTrack = (track: CurriculumTrackKey) => {
  activeTrack.value = track
}
</script>

<template>
  <section
    class="curriculum-route-explorer"
    :class="`curriculum-route-explorer--${variant}`"
    data-curriculum-route-explorer
    :data-active-track="activeTrack"
    :data-variant="variant"
    :aria-label="`${route.label} 1학년부터 4학년까지 커리큘럼 루트`"
  >
    <header class="curriculum-route-explorer__heading">
      <p>CURRICULUM / 01—04</p>
      <div>
        <h2>{{ variant === 'compact' ? '관심사별 4년 커리큘럼 루트' : `${route.label} 4년 커리큘럼 루트` }}</h2>
        <span>{{ route.summary }}</span>
      </div>
    </header>

    <div
      class="curriculum-route-explorer__tracks"
      role="group"
      aria-label="관심 분야별 커리큘럼 선택"
    >
      <button
        v-for="track in curriculumTrackOrder"
        :key="track"
        class="curriculum-route-explorer__track"
        :class="{ 'curriculum-route-explorer__track--active': activeTrack === track }"
        type="button"
        :aria-pressed="activeTrack === track"
        :data-curriculum-track="track"
        @click="selectTrack(track)"
      >
        <span>{{ curriculumRoutes[track].label }}</span>
        <small v-if="activeTrack === track">선택됨</small>
      </button>
    </div>

    <div class="curriculum-route-explorer__timeline">
      <article
        v-for="stage in route.stages"
        :key="stage.year"
        class="curriculum-route-explorer__stage"
        :class="`curriculum-route-explorer__stage--${stage.kind}`"
        :data-curriculum-stage="stage.year"
      >
        <p class="curriculum-route-explorer__year">{{ stage.year }}학년</p>
        <h3>{{ stage.phase }}</h3>
        <ul>
          <li
            v-for="item in stage.items"
            :key="item"
          >{{ item }}</li>
        </ul>
        <p class="curriculum-route-explorer__outcome">{{ stage.outcome }}</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.curriculum-route-explorer {
  border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  padding: clamp(1.25rem, 4vw, 2rem);
}

.curriculum-route-explorer__heading {
  display: grid;
  gap: 0.55rem;
}

.curriculum-route-explorer__heading > p,
.curriculum-route-explorer__year {
  margin: 0;
  color: var(--color-primary);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.065em;
}

.curriculum-route-explorer__heading h2,
.curriculum-route-explorer__stage h3 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  letter-spacing: -0.035em;
}

.curriculum-route-explorer__heading h2 {
  font-size: clamp(1.25rem, 3vw, 1.625rem);
  line-height: 1.2;
}

.curriculum-route-explorer__heading span {
  display: block;
  margin-top: 0.5rem;
  color: var(--color-muted);
  line-height: 1.6;
  word-break: keep-all;
}

.curriculum-route-explorer__tracks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 1.25rem;
}

.curriculum-route-explorer__track {
  min-block-size: var(--touch-target);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border: 1px solid color-mix(in srgb, var(--color-primary) 24%, transparent);
  border-radius: var(--radius-control);
  background: var(--color-canvas);
  color: var(--color-ink);
  padding: 0.625rem 0.75rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.curriculum-route-explorer__track:hover,
.curriculum-route-explorer__track--active {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));
}

.curriculum-route-explorer__track:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.curriculum-route-explorer__track small {
  color: var(--color-primary-strong);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.04em;
}

.curriculum-route-explorer__timeline {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}

.curriculum-route-explorer__stage {
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-canvas);
  padding: 1rem;
}

.curriculum-route-explorer__stage--outcome {
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
}

.curriculum-route-explorer__stage h3 {
  margin-top: 0.35rem;
  font-size: 1rem;
}

.curriculum-route-explorer__stage ul {
  display: grid;
  gap: 0.35rem;
  margin: 0.85rem 0;
  padding-left: 1.1rem;
  line-height: 1.5;
}

.curriculum-route-explorer__stage li::marker {
  color: var(--color-primary);
}

.curriculum-route-explorer__outcome {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.875rem;
  line-height: 1.55;
  word-break: keep-all;
}

.curriculum-route-explorer--compact .curriculum-route-explorer__heading span,
.curriculum-route-explorer--compact .curriculum-route-explorer__outcome {
  font-size: 0.8125rem;
}

.curriculum-route-explorer--compact .curriculum-route-explorer__stage {
  padding: 0.875rem;
}

@media (min-width: 1024px) {
  .curriculum-route-explorer__tracks {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .curriculum-route-explorer__timeline {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
