<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { z } from 'zod'
import { DEPARTMENT_NAME, HOME_ARIA_LABEL } from '../../shared/constants/department-brand'
import { selectedInterestSchema } from '../../shared/schemas/result'
import { trackKeys, trackLabels, type TrackKey } from '../../shared/types/domain'
import type { SelectedInterest } from '../../shared/types/result'

type HistoryState = 'loading' | 'ready' | 'empty' | 'error' | 'unauthenticated'

type HistoryItem = {
  publicId: string
  completedAt: string
  topTrack: TrackKey
  environmentScore: number
  selectedInterests: SelectedInterest[]
}

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const offsetDateTimeSchema = z.iso.datetime({ offset: true }).max(32)
const state = ref<HistoryState>('loading')
const items = ref<HistoryItem[]>([])
let requestGeneration = 0

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

const errorCode = (error: unknown): string | null => {
  if (!isRecord(error)) return null
  const responseData = isRecord(error.response) ? error.response._data : undefined
  const payload = isRecord(error.data) ? error.data : isRecord(responseData) ? responseData : null
  if (!payload || !isRecord(payload.error) || typeof payload.error.code !== 'string') return null
  return payload.error.code
}

const decodeHistoryItem = (value: unknown): HistoryItem => {
  if (!isRecord(value)
    || typeof value.publicId !== 'string'
    || !canonicalUuidPattern.test(value.publicId)
    || typeof value.completedAt !== 'string'
    || !offsetDateTimeSchema.safeParse(value.completedAt).success
    || !Number.isFinite(Date.parse(value.completedAt))
    || !trackKeys.includes(value.topTrack as TrackKey)
    || typeof value.environmentScore !== 'number'
    || !Number.isFinite(value.environmentScore)
    || value.environmentScore < 0
    || value.environmentScore > 100
    || !Array.isArray(value.selectedInterests)
    || value.selectedInterests.length < 1
    || value.selectedInterests.length > 11) {
    throw new Error('HISTORY_ITEM_INVALID')
  }

  const selectedInterests = value.selectedInterests.map((interest) => {
    const parsed = selectedInterestSchema.safeParse(interest)
    if (!parsed.success) throw new Error('HISTORY_INTEREST_INVALID')
    return parsed.data as SelectedInterest
  })
  const interestIdentities = selectedInterests.map(interest => `${interest.group}:${interest.key}`)
  if (new Set(interestIdentities).size !== interestIdentities.length) {
    throw new Error('HISTORY_INTEREST_DUPLICATE')
  }

  return {
    publicId: value.publicId,
    completedAt: value.completedAt,
    topTrack: value.topTrack as TrackKey,
    environmentScore: value.environmentScore,
    selectedInterests,
  }
}

const decodeEnvelope = (value: unknown): HistoryItem[] => {
  if (!isRecord(value)
    || !hasExactKeys(value, ['data', 'requestId'])
    || typeof value.requestId !== 'string'
    || value.requestId.length === 0
    || !isRecord(value.data)
    || !hasExactKeys(value.data, ['items'])
    || !Array.isArray(value.data.items)) {
    throw new Error('HISTORY_RESPONSE_INVALID')
  }

  const decoded = value.data.items.map(decodeHistoryItem)
  if (new Set(decoded.map(item => item.publicId)).size !== decoded.length) {
    throw new Error('HISTORY_RESULT_DUPLICATE')
  }
  return decoded
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
    .slice(0, 3)
}

const loadHistory = async (): Promise<void> => {
  const generation = ++requestGeneration
  state.value = 'loading'
  items.value = []
  try {
    const response = await $fetch<unknown>('/api/assessment/history')
    if (generation !== requestGeneration) return
    items.value = decodeEnvelope(response)
    state.value = items.value.length > 0 ? 'ready' : 'empty'
  }
  catch (error) {
    if (generation !== requestGeneration) return
    if (errorCode(error) === 'AUTH_FAILED') {
      state.value = 'unauthenticated'
      await navigateTo('/login', { replace: true })
      return
    }
    state.value = 'error'
  }
}

const formatCompletedAt = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(new Date(value))

const selectedSummary = (item: HistoryItem): string => item.selectedInterests
  .map(interest => interest.label)
  .join(' · ')

const stateMessage = computed(() => state.value === 'empty'
  ? '아직 저장된 결과가 없습니다.'
  : state.value === 'unauthenticated'
    ? '로그인 정보가 만료되었습니다.'
    : '최근 편집본을 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.')

onMounted(loadHistory)
</script>

<template>
  <main class="history-page">
    <header class="history-page__masthead">
      <NuxtLink
        class="history-page__brand"
        to="/"
        :aria-label="HOME_ARIA_LABEL"
      >
        PHOTO:<span>NEXT</span>
      </NuxtLink>
      <span>RESULT ARCHIVE / 03 MAX</span>
    </header>

    <section class="history-page__intro">
      <p>MASTER SEQUENCE / HISTORY</p>
      <h1>최근 편집본</h1>
      <p>{{ DEPARTMENT_NAME }}와 연결해 본 관심사를 다시 열어보세요. 최근 결과는 세 개까지 보관됩니다.</p>
    </section>

    <section
      v-if="state === 'loading'"
      class="history-page__loading"
      aria-busy="true"
      aria-label="최근 편집본을 불러오는 중"
    >
      <span
        v-for="index in 3"
        :key="index"
        aria-hidden="true"
      />
    </section>

    <ol
      v-else-if="state === 'ready'"
      class="history-page__list"
    >
      <li
        v-for="(item, index) in items"
        :key="item.publicId"
        data-testid="history-card"
      >
        <NuxtLink :to="`/result/${item.publicId}`">
          <span class="history-page__take">TAKE {{ String(index + 1).padStart(2, '0') }}</span>
          <span class="history-page__date">
            <time :datetime="item.completedAt">{{ formatCompletedAt(item.completedAt) }}</time>
          </span>
          <strong>{{ trackLabels[item.topTrack] }}</strong>
          <span class="history-page__score">학과 기반 연결도 {{ item.environmentScore.toFixed(1) }}점</span>
          <span class="history-page__interests">{{ selectedSummary(item) }}</span>
          <span class="history-page__open" aria-hidden="true">편집본 열기 →</span>
        </NuxtLink>
      </li>
    </ol>

    <section
      v-else
      class="history-page__state"
    >
      <p :role="state === 'error' || state === 'unauthenticated' ? 'alert' : 'status'">
        {{ stateMessage }}
      </p>
      <button
        v-if="state === 'error'"
        type="button"
        @click="loadHistory"
      >
        최근 편집본 다시 불러오기
      </button>
      <NuxtLink
        v-else-if="state === 'empty'"
        to="/assessment"
      >
        새 연결 경로 만들기
      </NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.history-page {
  min-height: 100vh;
  background: var(--color-canvas);
  color: var(--color-ink);
  padding-bottom: 4rem;
}

.history-page__masthead,
.history-page__intro,
.history-page__list,
.history-page__loading,
.history-page__state {
  width: min(calc(100% - 2.5rem), var(--content));
  margin-inline: auto;
}

.history-page__masthead {
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 22%, transparent);
}

.history-page__brand {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

.history-page__brand span { color: var(--color-sequence); }

.history-page__masthead > span,
.history-page__intro > p:first-child,
.history-page__take,
.history-page__score {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.07em;
}

.history-page__masthead > span {
  color: color-mix(in srgb, var(--color-ink) 58%, transparent);
  text-align: right;
}

.history-page__intro { padding-block: clamp(3rem, 10vw, 5.5rem) 2rem; }

.history-page__intro > p:first-child {
  margin: 0 0 0.75rem;
  color: var(--color-sequence);
  font-weight: 700;
}

.history-page__intro h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  letter-spacing: -0.065em;
  line-height: 0.95;
}

.history-page__intro > p:last-child {
  max-width: 34rem;
  margin: 1.25rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 70%, transparent);
  line-height: 1.65;
}

.history-page__list {
  list-style: none;
  margin-block: 0;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  overflow: hidden;
  padding: 0;
}

.history-page__list li + li { border-top: 1px solid color-mix(in srgb, var(--color-primary) 14%, transparent); }

.history-page__list a {
  min-height: calc(var(--touch-target) * 2);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.45rem 1rem;
  color: var(--color-ink);
  padding: 1.25rem 0.75rem;
  text-decoration: none;
  transition: background-color 160ms ease;
}

.history-page__take { color: var(--color-sequence); }
.history-page__date { justify-self: end; color: var(--color-muted); font-size: 0.8125rem; }

.history-page__list strong {
  grid-column: 1 / -1;
  font-family: var(--font-display);
  font-size: clamp(1.25rem, 4vw, 1.625rem);
  letter-spacing: -0.045em;
}

.history-page__score,
.history-page__interests,
.history-page__open { grid-column: 1 / -1; }
.history-page__score { color: var(--color-primary-strong); font-weight: 700; }
.history-page__interests { line-height: 1.55; }
.history-page__open { margin-top: 0.5rem; font-family: var(--font-display); font-weight: 750; }

.history-page__list a:hover { background: var(--color-surface); }

.history-page__loading {
  display: grid;
  gap: 0;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-panel);
  overflow: hidden;
}

.history-page__loading span {
  min-height: 9rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  background: var(--color-surface);
}

.history-page__state {
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  padding: 1.25rem;
}

.history-page__state p { margin: 0; line-height: 1.6; }

.history-page__state button,
.history-page__state a {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  margin-top: 1.25rem;
  border: 1px solid var(--color-sequence);
  border-radius: var(--radius-control);
  background: var(--color-sequence);
  color: var(--color-surface);
  padding: 0.625rem 1rem;
  font-family: var(--font-display);
  font-weight: 750;
  text-decoration: none;
  cursor: pointer;
}

.history-page a:focus-visible,
.history-page button:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

@media (min-width: 48rem) {
  .history-page__list a {
    grid-template-columns: 5rem minmax(8rem, 0.7fr) minmax(12rem, 1.5fr) auto;
    align-items: center;
    gap: 1rem;
    padding: 1.5rem 1rem;
  }

  .history-page__date { justify-self: start; }
  .history-page__list strong,
  .history-page__score,
  .history-page__interests,
  .history-page__open { grid-column: auto; }
  .history-page__score { grid-column: 2; }
  .history-page__interests { grid-column: 3; }
  .history-page__open { grid-column: 4; grid-row: 1 / 3; justify-self: end; margin-top: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .history-page__list a { transition: none; }
}
</style>
