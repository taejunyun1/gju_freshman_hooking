<script setup lang="ts">
import { computed } from 'vue'
import { trackLabels } from '../../../shared/types/domain'
import type { ResultSnapshot } from '../../../shared/types/result'
import CounselingCTA from '../counseling/CounselingCTA.vue'
import CapabilityEvidence from './CapabilityEvidence.vue'
import CareerNarrative from './CareerNarrative.vue'
import FacultyRecommendation from './FacultyRecommendation.vue'
import InterestClip from './InterestClip.vue'
import LearningPath from './LearningPath.vue'
import ResourceCard from './ResourceCard.vue'
import TrackScore from './TrackScore.vue'

const props = defineProps<{
  snapshot: ResultSnapshot
  resultPublicId: string
}>()

const primaryConnection = computed(() => trackLabels[props.snapshot.rankedTracks[0]])
const hasOutcomes = computed(() => (
  props.snapshot.resources.student_work.length
  + props.snapshot.resources.career.length
  + props.snapshot.resources.support.length
) > 0)
</script>

<template>
  <article class="result-timeline">
    <section
      class="result-timeline__summary"
      data-result-section="summary"
      aria-labelledby="result-title"
    >
      <p class="result-timeline__eyebrow">MASTER SEQUENCE / 04Y</p>
      <h1 id="result-title">선택한 관심사는 4년 동안 이렇게 이어집니다</h1>
      <p class="result-timeline__lead">
        선택한 관심사는 <strong>{{ primaryConnection }}</strong> 경로와 가장 높은 연결을 보입니다.
        점수보다 실제 교과와 프로젝트, 결과물의 순서부터 확인해 보세요.
      </p>
    </section>

    <CareerNarrative
      :assessment-public-id="resultPublicId"
      :narrative="snapshot.careerNarrative"
    />

    <section
      class="result-timeline__section result-timeline__section--interests"
      data-result-section="interests"
      aria-labelledby="interest-title"
    >
      <header class="result-timeline__section-heading">
        <p>SOURCE CLIPS</p>
        <h2 id="interest-title">내가 선택한 관심</h2>
      </header>
      <ul class="result-timeline__interests">
        <InterestClip
          v-for="interest in snapshot.selectedInterests"
          :key="`${interest.group}-${interest.key}`"
          :interest="interest"
        />
      </ul>
    </section>

    <section
      class="result-timeline__section result-timeline__section--wide"
      data-result-section="learning-path"
      aria-labelledby="learning-path-title"
    >
      <header class="result-timeline__section-heading">
        <p>IN → OUT / FOUR YEARS</p>
        <h2 id="learning-path-title">관심에서 포트폴리오까지 이어지는 학습경로</h2>
        <span>학년별 교과는 확인된 개설 정보만 표시하며, 프로젝트는 특정 학년에 임의 배정하지 않습니다.</span>
      </header>
      <LearningPath
        :years="snapshot.learningPath"
        :projects="snapshot.resources.project"
        :extracurricular="snapshot.resources.extracurricular"
      />
    </section>

    <section
      class="result-timeline__section"
      data-result-section="outcomes"
      aria-labelledby="outcomes-title"
    >
      <header class="result-timeline__section-heading result-timeline__section-heading--signal">
        <p>OUT / WORK & CAREER</p>
        <h2 id="outcomes-title">이 경로에서 만들어볼 결과물</h2>
        <span>수업과 프로젝트에서 익힌 역량이 작품과 진로로 어떻게 이어지는지 보여드립니다.</span>
      </header>

      <div
        v-if="hasOutcomes"
        class="result-timeline__outcomes"
      >
        <div class="result-timeline__outcome-lane">
          <h3>작품·포트폴리오</h3>
          <ResourceCard
            v-for="resource in snapshot.resources.student_work"
            :key="resource.id"
            :resource="resource"
            variant="outcome"
          />
          <p
            v-if="snapshot.resources.student_work.length === 0"
            class="result-timeline__empty"
          >확인된 학과 데이터를 준비 중입니다</p>
        </div>
        <div class="result-timeline__outcome-lane">
          <h3>연결 진로</h3>
          <ResourceCard
            v-for="resource in snapshot.resources.career"
            :key="resource.id"
            :resource="resource"
            variant="outcome"
          />
          <p
            v-if="snapshot.resources.career.length === 0"
            class="result-timeline__empty"
          >확인된 학과 데이터를 준비 중입니다</p>
        </div>
        <aside
          v-if="snapshot.resources.support.length > 0"
          class="result-timeline__support-lane"
          aria-labelledby="support-title"
        >
          <h3 id="support-title">학습·포트폴리오 지원</h3>
          <ResourceCard
            v-for="resource in snapshot.resources.support"
            :key="resource.id"
            :resource="resource"
            variant="support"
          />
        </aside>
      </div>
      <p
        v-else
        class="result-timeline__empty"
      >확인된 학과 데이터를 준비 중입니다</p>
    </section>

    <section
      class="result-timeline__section result-timeline__section--capability"
      data-result-section="capability-evidence"
      aria-labelledby="capability-title"
    >
      <header class="result-timeline__section-heading result-timeline__section-heading--resource">
        <p>SUPPORTING EVIDENCE</p>
        <h2 id="capability-title">이 제작을 가능하게 하는 학과 기반</h2>
        <span>장비와 시설은 추천의 주인공이 아니라, 위 학습경로를 실제로 수행할 수 있음을 뒷받침하는 근거입니다.</span>
      </header>
      <CapabilityEvidence
        :equipment="snapshot.resources.equipment"
        :facility="snapshot.resources.facility"
        :result-public-id="resultPublicId"
      />
    </section>

    <section
      class="result-timeline__section"
      data-result-section="scores"
      aria-label="관심 분야 연결 점수"
    >
      <TrackScore
        :scores="snapshot.trackScores"
        :environment-score="snapshot.environmentScore"
      />
    </section>

    <section
      class="result-timeline__section"
      data-result-section="faculty"
      aria-labelledby="faculty-title"
    >
      <header class="result-timeline__section-heading">
        <p>NEXT / FACULTY</p>
        <h2 id="faculty-title">이 학습경로를 함께 살펴볼 교수진</h2>
      </header>
      <FacultyRecommendation :faculty="snapshot.faculty" />
      <p class="result-timeline__faculty-note">
        추천은 학생의 관심 분야를 바탕으로 한 상담 시작점이며, 실제 담당 교수가 확정된 상태를 뜻하지 않습니다.
      </p>
    </section>

    <section
      class="result-timeline__section result-timeline__counseling"
      data-result-section="counseling"
      aria-labelledby="counseling-title"
    >
      <CounselingCTA :assessment-public-id="resultPublicId" />
    </section>
  </article>
</template>

<style scoped>
.result-timeline {
  --result-gutter: 1.25rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(3.5rem, 10vw, 6.5rem);
  padding-block: clamp(2.75rem, 8vw, 5.5rem) 5rem;
}

.result-timeline__summary,
.result-timeline__section {
  width: min(calc(100% - (var(--result-gutter) * 2)), var(--content));
  margin-inline: auto;
}

.result-timeline__section--wide {
  width: min(calc(100% - (var(--result-gutter) * 2)), var(--timeline));
}

.result-timeline__summary {
  padding-top: 1rem;
}

.result-timeline__eyebrow,
.result-timeline__section-heading > p {
  margin: 0;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.07em;
}

.result-timeline__summary h1 {
  max-width: 13ch;
  margin: 0.8rem 0 0;
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 9vw, 4.4rem);
  font-weight: 760;
  letter-spacing: -0.06em;
  line-height: 1.08;
  word-break: keep-all;
}

.result-timeline__lead {
  max-width: 37rem;
  margin: 1.25rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 74%, transparent);
  font-size: clamp(0.975rem, 3.5vw, 1.1rem);
  line-height: 1.75;
  word-break: keep-all;
}

.result-timeline__lead strong { color: var(--color-sequence); }

.result-timeline__section-heading {
  margin-bottom: 1rem;
}

.result-timeline__section-heading h2 {
  margin: 0.45rem 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.5rem, 5vw, 2.25rem);
  letter-spacing: -0.045em;
  line-height: 1.2;
  word-break: keep-all;
}

.result-timeline__section-heading > span {
  display: block;
  max-width: 38rem;
  margin-top: 0.55rem;
  color: color-mix(in srgb, var(--color-ink) 66%, transparent);
  font-size: 0.85rem;
  line-height: 1.6;
  word-break: keep-all;
}

.result-timeline__section-heading--signal > p { color: var(--color-signal); }
.result-timeline__section-heading--resource > p { color: var(--color-resource); }

.result-timeline__interests {
  display: flex;
  gap: 0.65rem;
  overflow-x: auto;
  margin: 0;
  padding: 0 0 0.65rem;
  list-style: none;
  scroll-snap-type: x mandatory;
}

.result-timeline__outcomes {
  display: grid;
  gap: 1.5rem;
}

.result-timeline__outcome-lane,
.result-timeline__support-lane {
  display: grid;
  align-content: start;
  gap: 0.65rem;
}

.result-timeline__outcome-lane > h3,
.result-timeline__support-lane > h3 {
  margin: 0;
  border-left: 0.3rem solid var(--color-signal);
  padding: 0.35rem 0 0.35rem 0.7rem;
  font-family: var(--font-display);
  font-size: 1rem;
  letter-spacing: -0.02em;
}

.result-timeline__support-lane {
  border-top: 1px dashed color-mix(in srgb, var(--color-ink) 25%, transparent);
  padding-top: 1rem;
}

.result-timeline__support-lane > h3 {
  border-left-color: var(--color-resource);
  color: color-mix(in srgb, var(--color-ink) 74%, transparent);
}

.result-timeline__empty {
  margin: 0;
  border: 1px dashed color-mix(in srgb, var(--color-ink) 28%, transparent);
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  padding: 1rem;
  line-height: 1.55;
}

.result-timeline__section--capability {
  border: 1px solid color-mix(in srgb, var(--color-resource) 36%, transparent);
  background: var(--color-surface);
}

.result-timeline__section--capability .result-timeline__section-heading {
  margin: 0;
  padding: 1rem;
}

.result-timeline__faculty-note {
  margin: 0.8rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 64%, transparent);
  font-size: 0.75rem;
  line-height: 1.55;
}

.result-timeline__counseling {
  border: 1px solid var(--color-signal);
  border-left: 0.45rem solid var(--color-signal);
  background: color-mix(in srgb, var(--color-signal) 6%, var(--color-surface));
  padding: clamp(1.25rem, 5vw, 2rem);
}

@media (min-width: 1024px) {
  .result-timeline { --result-gutter: 2.5rem; }

  .result-timeline__interests {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: visible;
    padding-bottom: 0;
  }

  .result-timeline__outcomes {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .result-timeline__support-lane { grid-column: 1 / -1; }
}
</style>
