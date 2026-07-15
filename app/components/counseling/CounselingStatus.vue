<script setup lang="ts">
import { computed } from 'vue'
import type { StudentCounselingStatus } from '../../../shared/schemas/counseling'

const props = withDefaults(defineProps<{
  request: StudentCounselingStatus
  compact?: boolean
}>(), {
  compact: false,
})

const methodLabels = {
  phone: '전화',
  text: '문자',
  visit: '방문',
} as const
const availabilityLabels = {
  weekday_morning: '평일 오전',
  weekday_afternoon: '평일 오후',
  weekday_evening: '평일 저녁',
  weekend: '주말',
} as const
const activeIndexes: Record<Exclude<StudentCounselingStatus['status'], 'closed'>, number> = {
  new: 0,
  assigned: 1,
  contacted: 2,
  completed: 3,
}

const primaryRecommendation = computed(() => props.request.recommendations.find(
  recommendation => recommendation.role === 'primary' && recommendation.rank === 1,
))

const stageDefinitions = computed(() => [
  { label: '신청 접수', at: props.request.consentedAt },
  { label: '교수 배정', at: props.request.assignedAt },
  { label: '연락 완료', at: props.request.contactedAt },
  { label: '상담 완료', at: props.request.completedAt },
  { label: '종료', at: props.request.closedAt },
])

const stageState = (index: number): 'completed' | 'current' | 'upcoming' => {
  if (props.request.status === 'closed') {
    if (index === 4) return 'current'
    return stageDefinitions.value[index]?.at ? 'completed' : 'upcoming'
  }
  const current = activeIndexes[props.request.status]
  if (index < current) return 'completed'
  return index === current ? 'current' : 'upcoming'
}

const formatDate = (value: string | null): string => {
  if (value === null) return '진행 전'
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
</script>

<template>
  <article
    class="counseling-status"
    :class="{ 'counseling-status--compact': compact }"
    aria-labelledby="counseling-status-title"
    aria-live="polite"
  >
    <header class="counseling-status__heading">
      <p>REQUEST CARD / LIVE</p>
      <component
        :is="compact ? 'h2' : 'h1'"
        id="counseling-status-title"
      >{{ compact ? '이전 상담 진행 기록' : '상담 진행 상태' }}</component>
      <span>접수부터 상담 완료까지의 현재 위치를 확인할 수 있습니다.</span>
    </header>

    <section
      class="counseling-status__faculty"
      :aria-labelledby="request.assignedFaculty ? 'assigned-faculty-title' : 'recommended-faculty-title'"
    >
      <template v-if="request.assignedFaculty">
        <p id="assigned-faculty-title">담당 교수</p>
        <h2>{{ request.assignedFaculty.name }} {{ request.assignedFaculty.title }}</h2>
        <span>{{ request.assignedFaculty.expertise }}</span>
        <small>관리자가 상담 내용을 확인하고 확정한 담당 교수입니다.</small>
      </template>
      <template v-else-if="primaryRecommendation">
        <p id="recommended-faculty-title">추천 총괄교수</p>
        <h2>{{ primaryRecommendation.name }} {{ primaryRecommendation.title }}</h2>
        <span>{{ primaryRecommendation.expertise }}</span>
        <small>관심 분야를 바탕으로 한 상담 시작점이며, 실제 상담교수는 접수 후 확정됩니다.</small>
      </template>
    </section>

    <ol class="counseling-status__timeline" aria-label="상담 진행 단계">
      <li
        v-for="(stage, index) in stageDefinitions"
        :key="stage.label"
        data-counseling-stage
        :data-state="stageState(index)"
        :aria-current="stageState(index) === 'current' ? 'step' : undefined"
      >
        <span class="counseling-status__frame" aria-hidden="true">
          {{ String(index + 1).padStart(2, '0') }}
        </span>
        <div>
          <strong>{{ stage.label }}</strong>
          <time v-if="stage.at" :datetime="stage.at">{{ formatDate(stage.at) }}</time>
          <span v-else>진행 전</span>
        </div>
      </li>
    </ol>

    <dl class="counseling-status__request">
      <div>
        <dt>상담 방법</dt>
        <dd>{{ methodLabels[request.contactMethod] }}</dd>
      </div>
      <div>
        <dt>연락 가능 시간</dt>
        <dd>{{ availabilityLabels[request.availability] }}</dd>
      </div>
      <div v-if="request.inquiry">
        <dt>문의 내용</dt>
        <dd>{{ request.inquiry }}</dd>
      </div>
    </dl>
  </article>
</template>

<style scoped>
.counseling-status {
  display: grid;
  gap: 2.25rem;
  border-top: 0.4rem solid var(--color-resource);
  background: var(--color-surface);
  padding: clamp(1.25rem, 5vw, 2rem);
}

.counseling-status__heading > p,
.counseling-status__faculty > p {
  margin: 0;
  color: var(--color-resource);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.counseling-status__heading h1,
.counseling-status__heading h2 {
  margin: 0.45rem 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.85rem, 7vw, 2.75rem);
  letter-spacing: -0.05em;
  line-height: 1.12;
}

.counseling-status--compact {
  gap: 1.5rem;
  border-top-width: 0.25rem;
  padding: 1rem;
}

.counseling-status--compact .counseling-status__heading h2 { font-size: 1.4rem; }

.counseling-status__heading > span {
  display: block;
  margin-top: 0.75rem;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  line-height: 1.65;
  word-break: keep-all;
}

.counseling-status__faculty {
  border: 1px solid color-mix(in srgb, var(--color-sequence) 32%, transparent);
  border-left: 0.35rem solid var(--color-sequence);
  background: color-mix(in srgb, var(--color-sequence) 5%, var(--color-surface));
  padding: 1rem;
}

.counseling-status__faculty > p { color: var(--color-sequence); }

.counseling-status__faculty h2 {
  margin: 0.4rem 0 0;
  font-family: var(--font-display);
  font-size: 1.35rem;
  letter-spacing: -0.035em;
}

.counseling-status__faculty > span,
.counseling-status__faculty > small {
  display: block;
  overflow-wrap: anywhere;
}

.counseling-status__faculty > span {
  margin-top: 0.35rem;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  line-height: 1.55;
}

.counseling-status__faculty > small {
  margin-top: 0.55rem;
  color: color-mix(in srgb, var(--color-ink) 58%, transparent);
  line-height: 1.5;
}

.counseling-status__timeline {
  margin: 0;
  padding: 0;
  list-style: none;
}

.counseling-status__timeline li {
  position: relative;
  min-height: 4.5rem;
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr);
  gap: 1rem;
  padding-bottom: 1rem;
}

.counseling-status__timeline li:not(:last-child)::after {
  position: absolute;
  top: 2.5rem;
  bottom: 0;
  left: 1.21rem;
  width: 1px;
  background: color-mix(in srgb, var(--color-ink) 24%, transparent);
  content: '';
}

.counseling-status__frame {
  position: relative;
  z-index: 1;
  width: 2.5rem;
  height: 2.5rem;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
  background: var(--color-surface);
  color: color-mix(in srgb, var(--color-ink) 48%, transparent);
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 700;
}

.counseling-status__timeline li > div {
  min-width: 0;
  padding-top: 0.1rem;
}

.counseling-status__timeline strong,
.counseling-status__timeline time,
.counseling-status__timeline li > div > span { display: block; }

.counseling-status__timeline strong {
  font-family: var(--font-display);
  font-size: 1rem;
}

.counseling-status__timeline time,
.counseling-status__timeline li > div > span {
  margin-top: 0.25rem;
  color: color-mix(in srgb, var(--color-ink) 55%, transparent);
  font-size: 0.75rem;
}

.counseling-status__timeline [data-state='completed'] .counseling-status__frame {
  border-color: var(--color-resource);
  background: var(--color-resource);
  color: var(--color-surface);
}

.counseling-status__timeline [data-state='current'] .counseling-status__frame {
  border: 0.2rem solid var(--color-sequence);
  color: var(--color-sequence);
}

.counseling-status__timeline [data-state='current'] strong { color: var(--color-sequence); }

.counseling-status__request {
  display: grid;
  gap: 0;
  margin: 0;
  border-top: 1px solid var(--color-ink);
}

.counseling-status__request > div {
  display: grid;
  grid-template-columns: minmax(7rem, 0.35fr) minmax(0, 1fr);
  gap: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent);
  padding-block: 0.85rem;
}

.counseling-status__request dt {
  color: color-mix(in srgb, var(--color-ink) 58%, transparent);
  font-size: 0.75rem;
}

.counseling-status__request dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  line-height: 1.55;
}

@media (min-width: 42rem) {
  .counseling-status__timeline { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .counseling-status__timeline li {
    min-height: 7.5rem;
    display: block;
    border-top: 1px solid color-mix(in srgb, var(--color-ink) 24%, transparent);
    padding: 1rem 0.6rem 0 0;
  }
  .counseling-status__timeline li:not(:last-child)::after { content: none; }
  .counseling-status__frame { margin-top: -2.3rem; margin-bottom: 0.9rem; }
}
</style>
