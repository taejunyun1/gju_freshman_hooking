<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  assessmentPublicId: string
  variant?: 'standard' | 'compact'
  headingId?: string
}>()

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const counselingTarget = computed(() => canonicalUuidPattern.test(props.assessmentPublicId)
  ? { path: '/counseling', query: { assessmentPublicId: props.assessmentPublicId } }
  : { path: '/counseling' })
const compact = computed(() => props.variant === 'compact')
const resolvedHeadingId = computed(() => props.headingId ?? (
  compact.value ? 'counseling-midpoint-title' : 'counseling-title'
))
</script>

<template>
  <div
    class="counseling-cta"
    :class="{ 'counseling-cta--compact': compact }"
    :data-counseling-cta="compact ? 'compact' : 'standard'"
  >
    <p class="counseling-cta__code">
      {{ compact ? 'NEXT STEP / COUNSELING' : 'NEXT EDIT / COUNSELING' }}
    </p>
    <div class="counseling-cta__body">
      <h2 :id="resolvedHeadingId">
        {{ compact ? '추천 경로를 상담으로 한 번 더 확인하세요' : '관심 분야를 실제 입학 준비로 이어가세요' }}
      </h2>
      <p>
        {{ compact
          ? '교과·프로젝트와 실제 입학 준비가 궁금하다면 관심 분야 교수진과 다음 단계를 살펴보세요.'
          : '이 로드맵의 실제 수업, 장비, 포트폴리오와 입학 준비가 궁금하다면 관심 분야 담당교수와 상담해보세요.' }}
      </p>
      <NuxtLink
        class="counseling-cta__link"
        :to="counselingTarget"
      >
        {{ compact ? '이 경로로 상담 이어가기' : '상담 신청하기' }}
        <span aria-hidden="true">→</span>
      </NuxtLink>
      <small>
        {{ compact
          ? '실제 상담교수는 접수 후 학과가 최종 배정합니다.'
          : '접수 후 관리자가 실제 상담교수를 최종 배정하며, 관심 분야에 따라 전문교원과 함께 살펴봅니다.' }}
      </small>
    </div>
  </div>
</template>

<style scoped>
.counseling-cta {
  display: grid;
  gap: 1.2rem;
  border-radius: var(--radius-panel);
}

.counseling-cta--compact {
  gap: 0.7rem;
  border: 1px solid color-mix(in srgb, var(--color-signal) 24%, transparent);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--color-primary-soft) 82%, var(--color-surface));
  box-shadow: inset 0.25rem 0 var(--color-signal);
  padding: clamp(1rem, 4vw, 1.4rem);
}

.counseling-cta__code {
  margin: 0;
  color: var(--color-signal);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.07em;
}

.counseling-cta__body {
  min-width: 0;
}

.counseling-cta h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.35rem, 5vw, 2rem);
  letter-spacing: -0.04em;
  line-height: 1.25;
  word-break: keep-all;
}

.counseling-cta__body > p {
  max-width: 36rem;
  margin: 0.65rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 74%, transparent);
  line-height: 1.7;
  word-break: keep-all;
}

.counseling-cta__link {
  min-height: var(--touch-target);
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1.25rem;
  border: 1px solid var(--color-signal);
  border-radius: var(--radius-control);
  background: var(--color-signal);
  color: var(--color-surface);
  padding: 0.625rem 1rem;
  font-family: var(--font-display);
  font-weight: 750;
  text-decoration: none;
}

.counseling-cta__link span {
  font-family: var(--font-mono);
  transition: transform 160ms ease;
}

.counseling-cta__link:hover span { transform: translateX(0.2rem); }

.counseling-cta__link:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.counseling-cta small {
  display: block;
  max-width: 32rem;
  margin-top: 0.8rem;
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-size: 0.75rem;
  line-height: 1.55;
  word-break: keep-all;
}

.counseling-cta--compact h2 {
  max-width: 21ch;
  font-size: clamp(1.2rem, 4vw, 1.5rem);
}

.counseling-cta--compact .counseling-cta__body > p {
  max-width: 32rem;
  margin-top: 0.45rem;
  font-size: 0.875rem;
}

.counseling-cta--compact .counseling-cta__link {
  margin-top: 0.9rem;
}

.counseling-cta--compact small {
  margin-top: 0.55rem;
  color: color-mix(in srgb, var(--color-ink) 74%, transparent);
  font-size: 0.6875rem;
}

@media (min-width: 1024px) {
  .counseling-cta {
    grid-template-columns: 12rem minmax(0, 1fr);
    align-items: start;
  }

  .counseling-cta--compact {
    grid-template-columns: 8rem minmax(0, 1fr);
    align-items: center;
  }

  .counseling-cta--compact .counseling-cta__body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 1.5rem;
  }

  .counseling-cta--compact h2,
  .counseling-cta--compact .counseling-cta__body > p,
  .counseling-cta--compact small {
    grid-column: 1;
  }

  .counseling-cta--compact .counseling-cta__link {
    grid-column: 2;
    grid-row: 1 / span 3;
    margin-top: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .counseling-cta__link span { transition: none; }
}
</style>
