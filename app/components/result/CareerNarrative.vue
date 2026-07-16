<script setup lang="ts">
import type { CareerNarrative } from '../../../shared/types/career-narrative'
import CareerNarrativeReport from './CareerNarrativeReport.vue'

defineProps<{
  assessmentPublicId: string
  narrative: CareerNarrative
}>()
</script>

<template>
  <section
    class="career-narrative"
    data-career-narrative
    data-result-section="career-narrative"
    aria-labelledby="career-narrative-title"
  >
    <header class="career-narrative__header">
      <p>DIRECTION CUT / 04</p>
      <h2 id="career-narrative-title">관심을 전공과 진로로 이어보는 제안</h2>
    </header>

    <ol class="career-narrative__sequence">
      <li
        v-for="(sentence, index) in narrative.sentences"
        :key="sentence.slot"
        :data-narrative-slot="sentence.slot"
      >
        <span
          data-cut-number
          aria-hidden="true"
        >{{ String(index + 1).padStart(2, '0') }}</span>
        <p>{{ sentence.text }}</p>
      </li>
    </ol>

    <div class="career-narrative__notes">
      <p class="career-narrative__note">
        선택과 확인된 학과 자료를 바탕으로 정리한 탐색 제안입니다. 실제 교과 운영과 상담 배정은 학과 확인 후 확정됩니다.
      </p>
      <p class="career-narrative__ai-note">
        일부 표현 선택에 AI가 도움을 줄 수 있지만, AI는 진로를 결정하지 않습니다. 불편하거나 사실과 다른 내용은 바로 알려주세요.
      </p>
      <CareerNarrativeReport :assessment-public-id="assessmentPublicId" />
    </div>
  </section>
</template>

<style scoped>
.career-narrative {
  width: min(calc(100% - 2.5rem), var(--content));
  margin-inline: auto;
}

.career-narrative__header {
  max-width: 44rem;
}

.career-narrative__header > p {
  margin: 0;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.07em;
}

.career-narrative__header h2 {
  margin: 0.45rem 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.6rem, 5.5vw, 2.45rem);
  letter-spacing: -0.05em;
  line-height: 1.18;
  word-break: keep-all;
}

.career-narrative__sequence {
  max-width: 68ch;
  display: grid;
  gap: 0;
  margin: 1.4rem 0 0;
  padding: 0;
  list-style: none;
}

.career-narrative__sequence li {
  position: relative;
  display: grid;
  grid-template-columns: 2.8rem minmax(0, 1fr);
  gap: 0.85rem;
  border-left: 1px solid color-mix(in srgb, var(--color-sequence) 56%, transparent);
  padding: 0.15rem 0 1.35rem 1rem;
}

.career-narrative__sequence li:last-child {
  border-left-color: transparent;
  padding-bottom: 0.2rem;
}

.career-narrative__sequence li::before {
  position: absolute;
  top: 0.3rem;
  left: -0.26rem;
  width: 0.45rem;
  height: 0.45rem;
  border: 1px solid var(--color-sequence);
  background: var(--color-surface);
  content: '';
}

.career-narrative__sequence span {
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.7;
}

.career-narrative__sequence p {
  margin: 0;
  font-size: clamp(0.96rem, 3.4vw, 1.08rem);
  font-weight: 620;
  line-height: 1.72;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

.career-narrative__notes {
  max-width: 68ch;
  margin-top: 1.4rem;
  border-top: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
  padding-top: 0.85rem;
}

.career-narrative__note,
.career-narrative__ai-note {
  margin: 0;
  color: color-mix(in srgb, var(--color-ink) 63%, transparent);
  font-size: 0.76rem;
  line-height: 1.62;
  word-break: keep-all;
}

.career-narrative__ai-note {
  margin-top: 0.35rem;
}

@media (min-width: 1024px) {
  .career-narrative {
    display: grid;
    grid-template-columns: minmax(12rem, 0.65fr) minmax(0, 1.35fr);
    column-gap: 2.5rem;
  }

  .career-narrative__sequence {
    margin-top: 0;
  }

  .career-narrative__notes {
    grid-column: 2;
  }
}
</style>
