<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  assessmentPublicId: string
}>()

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const counselingTarget = computed(() => canonicalUuidPattern.test(props.assessmentPublicId)
  ? { path: '/counseling', query: { assessmentPublicId: props.assessmentPublicId } }
  : { path: '/counseling' })
</script>

<template>
  <div class="counseling-cta">
    <p class="counseling-cta__code">NEXT EDIT / COUNSELING</p>
    <div class="counseling-cta__body">
      <h2 id="counseling-title">관심 분야를 실제 입학 준비로 이어가세요</h2>
      <p>
        이 로드맵의 실제 수업, 장비, 포트폴리오와 입학 준비가 궁금하다면 관심 분야 담당교수와 상담해보세요.
      </p>
      <NuxtLink
        class="counseling-cta__link"
        :to="counselingTarget"
      >
        상담 신청하기
        <span aria-hidden="true">→</span>
      </NuxtLink>
      <small>접수 후 관리자가 실제 상담교수를 최종 배정하며, 관심 분야에 따라 전문교원과 함께 살펴봅니다.</small>
    </div>
  </div>
</template>

<style scoped>
.counseling-cta {
  display: grid;
  gap: 1.2rem;
  border-radius: var(--radius-panel);
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

@media (min-width: 1024px) {
  .counseling-cta {
    grid-template-columns: 12rem minmax(0, 1fr);
    align-items: start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .counseling-cta__link span { transition: none; }
}
</style>
