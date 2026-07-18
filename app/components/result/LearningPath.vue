<script setup lang="ts">
import type {
  ExtracurricularResultResource,
  LearningPathYear,
  ProjectResultResource,
} from '../../../shared/types/result'
import ResourceCard from './ResourceCard.vue'

defineProps<{
  years: readonly [LearningPathYear, LearningPathYear, LearningPathYear, LearningPathYear]
  projects: readonly ProjectResultResource[]
  extracurricular: readonly ExtracurricularResultResource[]
}>()

const yearTitles = {
  1: '1Y 기초',
  2: '2Y 제작·후반',
  3: '3Y 전공심화·프로젝트',
  4: '4Y 캡스톤·포트폴리오',
} as const
</script>

<template>
  <div class="learning-path">
    <div
      class="learning-path__ruler"
      data-sequence-ruler
      aria-label="관심에서 결과물까지 이어지는 4년 경로"
    >
      <span>IN</span>
      <span
        class="learning-path__playhead"
        data-playhead
        aria-hidden="true"
      />
      <span>OUT</span>
    </div>

    <ol
      class="learning-path__years"
      data-learning-years
    >
      <li
        v-for="bucket in years"
        :key="bucket.year"
        class="learning-path__year"
        :data-learning-year="bucket.year"
      >
        <div class="learning-path__year-heading">
          <span aria-hidden="true" />
          <h3 data-year-title>{{ yearTitles[bucket.year] }}</h3>
        </div>
        <div class="learning-path__courses">
          <ResourceCard
            v-for="course in bucket.resources"
            :key="course.id"
            :resource="course"
            variant="course"
          />
          <p
            v-if="bucket.resources.length === 0"
            class="learning-path__empty"
          >
            확인된 학과 데이터를 준비 중입니다
          </p>
        </div>
      </li>
    </ol>

    <aside
      class="learning-path__project-lane"
      data-project-lane
      aria-labelledby="project-lane-title"
    >
      <div class="learning-path__project-heading">
        <p>SECONDARY LANE</p>
        <h3 id="project-lane-title">연결 프로젝트</h3>
        <span>특정 학년을 임의로 지정하지 않은 학과 프로젝트입니다.</span>
      </div>
      <div
        v-if="projects.length + extracurricular.length > 0"
        class="learning-path__projects"
      >
        <ResourceCard
          v-for="project in projects"
          :key="`project-${project.id}`"
          :resource="project"
          variant="project"
        />
        <ResourceCard
          v-for="activity in extracurricular"
          :key="`extra-${activity.id}`"
          :resource="activity"
          variant="project"
        />
      </div>
      <p
        v-else
        class="learning-path__empty"
      >
        확인된 학과 데이터를 준비 중입니다
      </p>
    </aside>
  </div>
</template>

<style scoped>
.learning-path {
  border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  overflow: hidden;
}

.learning-path__ruler {
  position: relative;
  min-height: 2.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  background: var(--color-primary-soft);
  padding-inline: 0.9rem;
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.learning-path__ruler::before {
  position: absolute;
  right: 3.2rem;
  left: 3.2rem;
  border-top: 1px dashed color-mix(in srgb, var(--color-sequence) 45%, transparent);
  content: '';
}

.learning-path__playhead {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  left: 3.1rem;
  width: 2px;
  background: var(--color-sequence);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-surface) 75%, transparent);
  animation: master-playhead 480ms cubic-bezier(0.33, 1, 0.68, 1) both;
}

.learning-path__playhead::before {
  position: absolute;
  top: 0;
  left: 50%;
  border: 0.3rem solid transparent;
  border-top-color: var(--color-sequence);
  content: '';
  transform: translateX(-50%);
}

.learning-path__years {
  position: relative;
  display: grid;
  gap: 0;
  margin: 0;
  padding: 1rem;
  list-style: none;
}

.learning-path__years::before {
  position: absolute;
  top: 1.8rem;
  bottom: 1.8rem;
  left: 1.68rem;
  width: 2px;
  background: var(--color-sequence);
  content: '';
}

.learning-path__year {
  position: relative;
  padding: 0 0 1.5rem 2.25rem;
}

.learning-path__year:last-child { padding-bottom: 0.5rem; }

.learning-path__year-heading {
  min-height: 2rem;
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.learning-path__year-heading > span {
  position: absolute;
  left: -0.98rem;
  z-index: 1;
  width: 1rem;
  height: 1rem;
  border: 3px solid var(--color-surface);
  border-radius: 50%;
  background: var(--color-sequence);
  box-shadow: 0 0 0 1px var(--color-sequence);
}

.learning-path__year h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1rem;
  letter-spacing: -0.025em;
}

.learning-path__courses {
  display: grid;
  gap: 0.65rem;
  margin-top: 0.65rem;
}

.learning-path__empty {
  margin: 0;
  border: 1px dashed color-mix(in srgb, var(--color-ink) 28%, transparent);
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  padding: 0.9rem;
  border-radius: var(--radius-card);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.learning-path__project-lane {
  display: grid;
  gap: 0.85rem;
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  background: color-mix(in srgb, var(--color-primary-soft) 58%, var(--color-surface));
  padding: 1rem;
}

.learning-path__project-heading p {
  margin: 0;
  color: var(--color-resource);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.learning-path__project-heading h3 {
  margin: 0.3rem 0 0;
  font-family: var(--font-display);
  font-size: 1.1rem;
}

.learning-path__project-heading span {
  display: block;
  margin-top: 0.35rem;
  color: color-mix(in srgb, var(--color-ink) 65%, transparent);
  font-size: 0.75rem;
  line-height: 1.5;
}

.learning-path__projects {
  display: grid;
  gap: 0.65rem;
}

@keyframes master-playhead {
  from { left: 3.1rem; }
  to { left: calc(100% - 3.1rem); }
}

@media (min-width: 1024px) {
  .learning-path__years {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
    padding: 1.4rem 1.2rem 1.25rem;
  }

  .learning-path__years::before {
    top: 2rem;
    right: 2rem;
    bottom: auto;
    left: 2rem;
    width: auto;
    height: 2px;
  }

  .learning-path__year,
  .learning-path__year:last-child {
    padding: 2rem 0 0;
  }

  .learning-path__year-heading > span {
    top: 0.08rem;
    left: 0.6rem;
  }

  .learning-path__courses { align-content: start; }

  .learning-path__project-lane {
    grid-template-columns: minmax(12rem, 0.7fr) minmax(0, 2fr);
    align-items: start;
    padding: 1.2rem;
  }

  .learning-path__projects {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

}

@media (prefers-reduced-motion: reduce) {
  .learning-path__playhead {
    animation: none;
    transition: none;
    left: auto;
    right: 3.1rem;
  }
}
</style>
