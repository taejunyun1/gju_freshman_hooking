<script setup lang="ts">
import { trackKeys, trackLabels, type TrackKey } from '../../../shared/types/domain'

const props = defineProps<{
  scores: Readonly<Record<TrackKey, number>>
  environmentScore: number
}>()

const tracks: readonly TrackKey[] = trackKeys
const scoreText = (score: number) => Number.isInteger(score) ? String(score) : score.toFixed(1)
</script>

<template>
  <div class="track-score">
    <div class="track-score__explanation">
      <p>CONNECTION SCORE</p>
      <h2>응답 기반 관심 방향</h2>
      <span>선택한 응답 점수와 네 관심 분야의 가까움을 설명합니다.</span>
    </div>

    <dl class="track-score__tracks">
      <div
        v-for="track in tracks"
        :key="track"
      >
        <dt>{{ trackLabels[track] }}</dt>
        <dd>
          <meter
            min="0"
            max="100"
            :value="props.scores[track]"
          >{{ scoreText(props.scores[track]) }}점</meter>
          <strong>{{ scoreText(props.scores[track]) }}점</strong>
        </dd>
      </div>
      <div class="track-score__environment">
        <dt>교육환경 근거 충족도</dt>
        <dd>
          <meter
            min="0"
            max="100"
            :value="environmentScore"
          >{{ scoreText(environmentScore) }}점</meter>
          <strong>{{ scoreText(environmentScore) }}점</strong>
        </dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.track-score {
  display: grid;
  gap: 1.25rem;
  border-radius: var(--radius-card);
  padding: 0.25rem;
}

.track-score__explanation p {
  margin: 0;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.track-score__explanation h2 {
  margin: 0.4rem 0 0;
  font-family: var(--font-display);
  font-size: 1.25rem;
  letter-spacing: -0.035em;
}

.track-score__explanation span {
  display: block;
  margin-top: 0.4rem;
  color: color-mix(in srgb, var(--color-ink) 65%, transparent);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.track-score__tracks {
  display: grid;
  gap: 0.75rem;
  margin: 0;
}

.track-score__tracks > div {
  display: grid;
  grid-template-columns: minmax(7.5rem, 1fr) minmax(8rem, 1.4fr);
  align-items: center;
  gap: 0.75rem;
}

.track-score__tracks dt {
  min-width: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.track-score__tracks dd {
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr 3.5rem;
  align-items: center;
  gap: 0.65rem;
  margin: 0;
}

.track-score meter {
  min-width: 0;
  width: 100%;
  height: 0.45rem;
  border: 0;
  background: color-mix(in srgb, var(--color-ink) 12%, transparent);
}

.track-score meter::-webkit-meter-bar {
  border: 0;
  background: color-mix(in srgb, var(--color-ink) 12%, transparent);
}

.track-score meter::-webkit-meter-optimum-value { background: var(--color-sequence); }
.track-score meter::-moz-meter-bar { background: var(--color-sequence); }

.track-score strong {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  text-align: right;
}

.track-score__environment {
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
  padding-top: 0.75rem;
}

.track-score__environment dt,
.track-score__environment strong { color: var(--color-signal); }

@media (max-width: 20rem) {
  .track-score__tracks > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.35rem;
  }
}

@media (min-width: 1024px) {
  .track-score {
    grid-template-columns: minmax(14rem, 0.7fr) minmax(0, 1.6fr);
    gap: 2rem;
  }
}
</style>
