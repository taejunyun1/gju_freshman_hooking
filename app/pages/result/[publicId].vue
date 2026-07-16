<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'
import { decodeResultSnapshot } from '../../../shared/schemas/result'
import type { ResultSnapshot } from '../../../shared/types/result'

type ResultPageState = 'loading' | 'ready' | 'not-found' | 'error' | 'unauthenticated'

const sectionKeys = [
  'summary',
  'career-narrative',
  'interests',
  'learning-path',
  'outcomes',
  'capability-evidence',
  'scores',
  'faculty',
  'counseling',
] as const

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const route = useRoute()
const routePublicId = computed(() => (
  typeof route.params.publicId === 'string' ? route.params.publicId : ''
))
const state = ref<ResultPageState>('loading')
const snapshot = ref<ResultSnapshot | null>(null)
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

const decodeEnvelope = (value: unknown): ResultSnapshot => {
  if (!isRecord(value)
    || !hasExactKeys(value, ['data', 'requestId'])
    || typeof value.requestId !== 'string'
    || value.requestId.length === 0) {
    throw new Error('RESULT_RESPONSE_INVALID')
  }
  return decodeResultSnapshot(value.data)
}

const loadResult = async (publicId: string): Promise<void> => {
  const generation = ++requestGeneration
  state.value = 'loading'
  snapshot.value = null

  if (!canonicalUuidPattern.test(publicId)) {
    state.value = 'not-found'
    return
  }

  try {
    const response = await $fetch<unknown>(`/api/result/${encodeURIComponent(publicId)}`)
    if (generation !== requestGeneration) return
    snapshot.value = decodeEnvelope(response)
    state.value = 'ready'
  }
  catch (error) {
    if (generation !== requestGeneration) return
    const code = errorCode(error)
    if (code === 'RESULT_NOT_FOUND') {
      state.value = 'not-found'
      return
    }
    if (code === 'AUTH_FAILED') {
      state.value = 'unauthenticated'
      await navigateTo('/login', { replace: true })
      return
    }
    state.value = 'error'
  }
}

onMounted(() => {
  void loadResult(routePublicId.value)
})

onBeforeRouteUpdate((to) => {
  const publicId = typeof to.params.publicId === 'string' ? to.params.publicId : ''
  void loadResult(publicId)
})
</script>

<template>
  <main class="result-page">
    <header class="result-page__masthead">
      <div class="result-page__masthead-inner">
        <NuxtLink
          class="result-page__brand"
          to="/"
          aria-label="PHOTO:NEXT 홈"
        >
          PHOTO:<span>NEXT</span>
        </NuxtLink>
        <NuxtLink
          class="result-page__history-link"
          to="/history"
        >
          최근 편집본
        </NuxtLink>
      </div>
    </header>

    <section
      v-if="state === 'loading'"
      class="result-page__skeleton"
      data-testid="result-skeleton"
      aria-busy="true"
      aria-label="결과를 불러오는 중"
    >
      <div
        v-for="section in sectionKeys"
        :key="section"
        class="result-page__skeleton-section"
        :class="`result-page__skeleton-section--${section}`"
        data-skeleton-section
        aria-hidden="true"
      >
        <span />
        <i />
        <i />
      </div>
    </section>

    <ResultTimeline
      v-else-if="state === 'ready' && snapshot"
      :snapshot="snapshot"
      :result-public-id="routePublicId"
    />

    <section
      v-else
      class="result-page__state"
      aria-labelledby="result-state-title"
    >
      <p class="result-page__state-code">RESULT / INTERRUPTED</p>
      <h1 id="result-state-title">
        {{ state === 'not-found' ? '확인할 결과가 없습니다.' : '결과 연결을 확인해 주세요.' }}
      </h1>
      <p role="alert">
        {{ state === 'not-found'
          ? '결과를 찾을 수 없습니다.'
          : state === 'unauthenticated'
            ? '로그인 정보가 만료되었습니다.'
            : '결과를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.' }}
      </p>
      <button
        v-if="state === 'error'"
        data-testid="result-retry"
        type="button"
        @click="loadResult(routePublicId)"
      >
        결과 다시 불러오기
      </button>
      <NuxtLink
        v-else-if="state === 'not-found'"
        to="/history"
      >
        최근 편집본 보기
      </NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.result-page {
  min-height: 100vh;
  background: var(--color-canvas);
  color: var(--color-ink);
}

.result-page__masthead {
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  background: var(--color-surface);
}

.result-page__masthead-inner {
  width: min(100%, var(--timeline));
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-inline: auto;
  padding-inline: 1.25rem;
}

.result-page__brand,
.result-page__history-link,
.result-page__state a {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-weight: 750;
  text-decoration: none;
}

.result-page__brand {
  font-size: 1.125rem;
  letter-spacing: -0.04em;
}

.result-page__brand span,
.result-page__state-code { color: var(--color-sequence); }

.result-page__history-link {
  font-size: 0.8125rem;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--color-sequence) 45%, transparent);
  text-underline-offset: 0.25rem;
}

.result-page__skeleton {
  width: min(100%, var(--timeline));
  display: grid;
  gap: 1rem;
  margin-inline: auto;
  padding: 1.25rem;
}

.result-page__skeleton-section {
  min-height: 8rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 15%, transparent);
  background: var(--color-surface);
  padding: 1rem;
}

.result-page__skeleton-section--summary { min-height: 14rem; }
.result-page__skeleton-section--career-narrative { min-height: 18rem; }
.result-page__skeleton-section--learning-path { min-height: 20rem; }

.result-page__skeleton-section span,
.result-page__skeleton-section i {
  display: block;
  background: color-mix(in srgb, var(--color-ink) 9%, var(--color-surface));
}

.result-page__skeleton-section span {
  width: min(16rem, 62%);
  height: 1.15rem;
  margin-bottom: 1.25rem;
}

.result-page__skeleton-section i {
  width: 100%;
  height: 0.75rem;
  margin-top: 0.625rem;
}

.result-page__skeleton-section i:last-child { width: 72%; }

.result-page__state {
  width: min(calc(100% - 2.5rem), var(--content));
  margin: 4rem auto;
  border-top: 0.3rem solid var(--color-sequence);
  background: var(--color-surface);
  padding: clamp(1.25rem, 5vw, 2rem);
}

.result-page__state-code {
  margin: 0 0 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.result-page__state h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 8vw, 2.75rem);
  letter-spacing: -0.05em;
  line-height: 1.08;
}

.result-page__state [role='alert'] {
  margin: 1rem 0 0;
  line-height: 1.6;
}

.result-page__state button,
.result-page__state a {
  min-height: var(--touch-target);
  margin-top: 1.5rem;
  border: 1px solid var(--color-sequence);
  border-radius: 0.125rem;
  background: var(--color-sequence);
  color: var(--color-surface);
  padding: 0.625rem 1rem;
  font-family: var(--font-display);
  font-weight: 750;
  cursor: pointer;
}

.result-page a:focus-visible,
.result-page button:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

@media (min-width: 64rem) {
  .result-page__masthead-inner { padding-inline: 0; }
  .result-page__skeleton { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .result-page__skeleton-section--summary,
  .result-page__skeleton-section--career-narrative,
  .result-page__skeleton-section--learning-path { grid-column: 1 / -1; }
}

@media (prefers-reduced-motion: reduce) {
  .result-page *,
  .result-page *::before,
  .result-page *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
