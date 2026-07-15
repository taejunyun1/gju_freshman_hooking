<script setup lang="ts">
import type { TrackKey } from '../../../shared/types/domain'

const props = defineProps<{
  scores: Readonly<Record<TrackKey, number>>
  environmentScore: number
}>()

const trackLabels: Readonly<Record<TrackKey, string>> = {
  documentary: '다큐멘터리·기록',
  art_photo: '예술사진·현대이미지',
  commercial: '광고사진·브랜드',
  video: '영상·드론',
}

const tracks: readonly TrackKey[] = ['documentary', 'art_photo', 'commercial', 'video']
const scoreText = (score: number) => Number.isInteger(score) ? String(score) : score.toFixed(1)
</script>

<template>
  <div class="track-score">
    <div class="track-score__explanation">
      <p>CONNECTION SCORE</p>
      <h2>관심 분야 연결 점수</h2>
      <span>선택한 관심사와 확인된 학과 데이터의 연결 정도를 설명합니다.</span>
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
        <dt>교육환경 연결도</dt>
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
  border-block: 1px solid color-mix(in srgb, var(--color-ink) 24%, transparent);
  padding-block: 1.25rem;
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
  font-size: 0.8125rem;
  line-height: 1.4;
}

.track-score__tracks dd {
  display: grid;
  grid-template-columns: 1fr 3.5rem;
  align-items: center;
  gap: 0.65rem;
  margin: 0;
}

.track-score meter {
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
  border-top: 1px dashed color-mix(in srgb, var(--color-signal) 45%, transparent);
  padding-top: 0.75rem;
}

.track-score__environment dt,
.track-score__environment strong { color: var(--color-signal); }

@media (min-width: 1024px) {
  .track-score {
    grid-template-columns: minmax(14rem, 0.7fr) minmax(0, 1.6fr);
    gap: 2rem;
  }
}
</style>
