<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { z } from 'zod'
import {
  studentCounselingStatusSchema,
  type StudentCounselingStatus,
} from '../../shared/schemas/counseling'
import CounselingForm from '../components/counseling/CounselingForm.vue'
import CounselingStatus from '../components/counseling/CounselingStatus.vue'
import AppState from '../components/common/AppState.vue'

type PageState = 'loading' | 'form' | 'status' | 'empty' | 'error' | 'unauthenticated'

const canonicalUuidSchema = z.string().uuid()
const responseSchema = z.object({
  data: studentCounselingStatusSchema.nullable(),
  requestId: z.string().min(1),
}).strict()

const route = useRoute()
const state = ref<PageState>('loading')
const request = ref<StudentCounselingStatus | null>(null)
let requestGeneration = 0

const queryAssessmentPublicId = computed(() => {
  const value = route.query.assessmentPublicId
  return typeof value === 'string' && canonicalUuidSchema.safeParse(value).success ? value : null
})
const returnPath = computed(() => queryAssessmentPublicId.value
  ? `/counseling?assessmentPublicId=${encodeURIComponent(queryAssessmentPublicId.value)}`
  : '/counseling')

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

const publicErrorCode = (error: unknown): string | null => {
  if (!isRecord(error)) return null
  const responseData = isRecord(error.response) ? error.response._data : undefined
  const payload = isRecord(error.data) ? error.data : isRecord(responseData) ? responseData : null
  if (!payload || !isRecord(payload.error) || typeof payload.error.code !== 'string') return null
  return payload.error.code
}

const loadCurrent = async (): Promise<void> => {
  const generation = ++requestGeneration
  state.value = 'loading'
  request.value = null
  try {
    const response = await $fetch<unknown>('/api/counseling')
    if (generation !== requestGeneration) return
    const parsed = responseSchema.safeParse(response)
    if (!parsed.success) throw new Error('COUNSELING_RESPONSE_INVALID')
    request.value = parsed.data.data
    const terminalRequest = parsed.data.data?.status === 'completed'
      || parsed.data.data?.status === 'closed'
    state.value = parsed.data.data && !(queryAssessmentPublicId.value && terminalRequest)
      ? 'status'
      : queryAssessmentPublicId.value
        ? 'form'
        : 'empty'
  }
  catch (error) {
    if (generation !== requestGeneration) return
    if (publicErrorCode(error) === 'AUTH_FAILED') {
      state.value = 'unauthenticated'
      return
    }
    state.value = 'error'
  }
}

const showStatus = (submitted: StudentCounselingStatus): void => {
  request.value = submitted
  state.value = 'status'
}

onMounted(() => {
  void loadCurrent()
})

watch(queryAssessmentPublicId, () => {
  void loadCurrent()
})
</script>

<template>
  <main class="counseling-page">
    <header class="counseling-page__masthead">
      <div class="counseling-page__masthead-inner">
        <NuxtLink
          class="counseling-page__brand"
          to="/"
          aria-label="PHOTO:NEXT 홈"
        >PHOTO:<span>NEXT</span></NuxtLink>
        <NuxtLink class="counseling-page__history" to="/history">최근 편집본</NuxtLink>
      </div>
    </header>

    <div class="counseling-page__content">
      <AppState
        v-if="state === 'loading'"
        variant="loading"
        message="상담 신청 상태를 확인하고 있습니다."
      />

      <div
        v-else-if="state === 'form' && queryAssessmentPublicId"
        class="counseling-page__application"
      >
        <CounselingForm
          :assessment-public-id="queryAssessmentPublicId"
          @submitted="showStatus"
        />
        <details
          v-if="request && (request.status === 'completed' || request.status === 'closed')"
          class="counseling-page__prior"
          data-testid="prior-counseling"
        >
          <summary>이전 상담 상태 보기</summary>
          <p>이전 상담 기록은 그대로 보관됩니다. 위 폼에서 이 결과를 기준으로 새 상담을 신청할 수 있습니다.</p>
          <CounselingStatus
            :request="request"
            compact
          />
        </details>
      </div>

      <CounselingStatus
        v-else-if="state === 'status' && request"
        :request="request"
      />

      <section
        v-else-if="state === 'empty'"
        class="counseling-page__direction"
        aria-labelledby="counseling-empty-title"
      >
        <AppState
          variant="empty"
          message="상담에 연결할 결과를 먼저 선택해 주세요."
        />
        <h1 id="counseling-empty-title">내 관심 경로를 확인한 뒤 상담을 신청할 수 있습니다.</h1>
        <NuxtLink to="/history">최근 결과에서 선택하기</NuxtLink>
      </section>

      <section
        v-else-if="state === 'unauthenticated'"
        class="counseling-page__direction"
        aria-labelledby="counseling-auth-title"
      >
        <AppState
          variant="error"
          message="로그인 정보가 만료되었습니다. 로그인한 뒤 다시 확인해 주세요."
        />
        <h1 id="counseling-auth-title">상담 신청은 학생 본인만 확인할 수 있습니다.</h1>
        <NuxtLink :to="{ path: '/login', query: { redirect: returnPath } }">로그인하기</NuxtLink>
      </section>

      <section
        v-else
        class="counseling-page__direction"
        aria-labelledby="counseling-error-title"
      >
        <AppState
          variant="error"
          message="상담 신청 상태를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."
        />
        <h1 id="counseling-error-title">잠시 후 상담 상태를 다시 확인해 주세요.</h1>
        <button type="button" @click="loadCurrent">다시 불러오기</button>
      </section>
    </div>
  </main>
</template>

<style scoped>
.counseling-page {
  min-height: 100vh;
  background: var(--color-canvas);
  color: var(--color-ink);
}

.counseling-page__masthead {
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  background: var(--color-surface);
}

.counseling-page__masthead-inner {
  width: min(100%, var(--content));
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-inline: auto;
  padding-inline: 1.25rem;
}

.counseling-page__brand,
.counseling-page__history {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-weight: 750;
  text-decoration: none;
}

.counseling-page__brand {
  font-size: 1.125rem;
  letter-spacing: -0.04em;
}

.counseling-page__brand span { color: var(--color-sequence); }

.counseling-page__history {
  font-size: 0.8125rem;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--color-sequence) 45%, transparent);
  text-underline-offset: 0.25rem;
}

.counseling-page__content {
  width: min(calc(100% - 2.5rem), var(--content));
  margin-inline: auto;
  padding-block: clamp(2.5rem, 8vw, 5rem);
}

.counseling-page__application {
  display: grid;
  gap: 1.25rem;
}

.counseling-page__prior {
  border: 1px solid color-mix(in srgb, var(--color-ink) 22%, transparent);
  background: var(--color-surface);
}

.counseling-page__prior summary {
  min-height: var(--touch-target);
  display: flex;
  align-items: center;
  border-left: 0.3rem solid var(--color-resource);
  padding: 0.75rem 1rem;
  font-family: var(--font-display);
  font-weight: 750;
  cursor: pointer;
}

.counseling-page__prior summary:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.counseling-page__prior > p {
  margin: 0;
  border-top: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
  color: color-mix(in srgb, var(--color-ink) 66%, transparent);
  padding: 1rem;
  line-height: 1.6;
  word-break: keep-all;
}

.counseling-page__direction {
  display: grid;
  gap: 1.25rem;
  border-top: 0.3rem solid var(--color-sequence);
  background: var(--color-surface);
  padding: clamp(1.25rem, 5vw, 2rem);
}

.counseling-page__direction h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  letter-spacing: -0.04em;
  line-height: 1.25;
  word-break: keep-all;
}

.counseling-page__direction a,
.counseling-page__direction button {
  min-height: var(--touch-target);
  width: fit-content;
  display: inline-flex;
  align-items: center;
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

.counseling-page a:focus-visible,
.counseling-page button:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

@media (min-width: 64rem) {
  .counseling-page__masthead-inner { padding-inline: 0; }
}
</style>
