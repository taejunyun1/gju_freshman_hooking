<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import {
  adminNarrativeReportListSchema,
  adminNarrativeReportReviewSchema,
  adminNarrativeReportResolutions,
  type AdminNarrativeReportItem,
  type AdminNarrativeReportResolution,
  type AdminNarrativeReportReview,
} from '../../../shared/schemas/admin-narrative-reports'
import { trackLabels } from '../../../shared/types/domain'
import type { ApiSuccess } from '../../../shared/types/api'
import AppButton from '../../components/common/AppButton.vue'
import AppState from '../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const adminSession = useAdminSessionStore()
const items = ref<AdminNarrativeReportItem[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const loadingNext = ref(false)
const refreshing = ref(false)
const resolvingId = ref<number | null>(null)
const errorMessage = ref('')
const paginationErrorMessage = ref('')
const announcement = ref('')
const resolutionById = reactive<Record<number, AdminNarrativeReportResolution>>({})
const resultDetail = ref<AdminNarrativeReportReview | null>(null)
const resultLoadingId = ref<number | null>(null)
const resultErrorId = ref<number | null>(null)
const resultHeading = ref<HTMLElement | null>(null)
const resultRetryButton = ref<{ $el?: HTMLElement } | HTMLElement | null>(null)
const lastResultTrigger = ref<HTMLElement | null>(null)
let active = true
let requestVersion = 0

const categoryLabels = {
  inaccurate: '사실 오류',
  unsafe: '안전 문제',
  confusing: '표현 혼동',
} as const

const resolutionLabels: Record<AdminNarrativeReportResolution, string> = {
  resolved_inaccurate: '사실 오류로 처리',
  resolved_unsafe: '안전 문제로 처리',
  resolved_copy: '표현 개선으로 처리',
  dismissed: '문제 없음',
}

const groupLabels = {
  work: '하고 싶은 작업',
  result: '만들고 싶은 결과',
  style: '선호 작업 방식',
  career: '관심 진로',
} as const

const formattedDate = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

const mergeItems = (
  current: AdminNarrativeReportItem[],
  incoming: AdminNarrativeReportItem[],
): AdminNarrativeReportItem[] => {
  const byId = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()]
}

const initializeResolutions = (incoming: AdminNarrativeReportItem[]): void => {
  for (const item of incoming) {
    resolutionById[item.id] ??= item.category === 'unsafe'
      ? 'resolved_unsafe'
      : item.category === 'inaccurate'
        ? 'resolved_inaccurate'
        : 'resolved_copy'
  }
}

const loadQueue = async (append = false, background = false): Promise<void> => {
  if (append && nextCursor.value === null) return
  const thisRequest = ++requestVersion
  if (append) loadingNext.value = true
  else if (background) refreshing.value = true
  else loading.value = true
  if (append) paginationErrorMessage.value = ''
  else errorMessage.value = ''

  try {
    const response = await $fetch<ApiSuccess<unknown>>('/api/admin/narrative-reports', {
      headers: adminSession.authorizationHeaders(),
      query: {
        ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
        limit: '20',
      },
    })
    if (!active || thisRequest !== requestVersion) return
    const parsed = adminNarrativeReportListSchema.parse(response.data)
    initializeResolutions(parsed.items)
    items.value = append ? mergeItems(items.value, parsed.items) : parsed.items
    nextCursor.value = parsed.nextCursor
  }
  catch {
    if (!active || thisRequest !== requestVersion) return
    if (append) {
      paginationErrorMessage.value = '다음 신고를 불러오지 못했습니다. 현재 목록을 유지한 채 다시 시도하세요.'
    }
    else {
      errorMessage.value = '신고 대기열을 불러오지 못했습니다. 관리자 세션을 확인하고 다시 시도하세요.'
    }
  }
  finally {
    if (active && thisRequest === requestVersion) {
      loading.value = false
      loadingNext.value = false
      refreshing.value = false
    }
  }
}

const refreshQueue = async (): Promise<void> => {
  nextCursor.value = null
  await loadQueue(false, items.value.length > 0)
}

const resolveReport = async (item: AdminNarrativeReportItem): Promise<void> => {
  const resolution = resolutionById[item.id]
  if (!resolution || resolvingId.value !== null) return
  resolvingId.value = item.id
  announcement.value = ''
  try {
    await $fetch(`/api/admin/narrative-reports/${item.id}/resolve`, {
      method: 'POST',
      headers: adminSession.authorizationHeaders(),
      body: {
        expectedUpdatedAt: item.updatedAt,
        resolution,
      },
    })
    items.value = items.value.filter(candidate => candidate.id !== item.id)
    if (resultDetail.value?.reportId === item.id) resultDetail.value = null
    announcement.value = `신고 #${item.id}을 처리했습니다.`
  }
  catch (error) {
    const code = (error as {
      data?: { error?: { code?: unknown } }
    })?.data?.error?.code
    if (code === 'NARRATIVE_REPORT_CONFLICT') {
      announcement.value = `신고 #${item.id}은 다른 관리자가 먼저 처리했습니다. 최신 목록을 불러왔습니다.`
      await refreshQueue()
    }
    else {
      announcement.value = `신고 #${item.id}을 처리하지 못했습니다. 최근 인증과 네트워크를 확인한 뒤 다시 시도하세요.`
    }
  }
  finally {
    resolvingId.value = null
  }
}

const componentElement = (
  value: { $el?: HTMLElement } | HTMLElement | null,
): HTMLElement | null => value instanceof HTMLElement ? value : value?.$el ?? null

const loadResult = async (
  item: AdminNarrativeReportItem,
  event?: MouseEvent,
): Promise<void> => {
  if (event?.currentTarget instanceof HTMLElement) lastResultTrigger.value = event.currentTarget
  resultLoadingId.value = item.id
  resultErrorId.value = null
  resultDetail.value = null
  try {
    const response = await $fetch<ApiSuccess<unknown>>(item.resultPath, {
      headers: adminSession.authorizationHeaders(),
    })
    if (!active || resultLoadingId.value !== item.id) return
    resultDetail.value = adminNarrativeReportReviewSchema.parse(response.data)
    await nextTick()
    resultHeading.value?.focus({ preventScroll: true })
    resultHeading.value?.scrollIntoView?.({ block: 'start' })
  }
  catch {
    if (active && resultLoadingId.value === item.id) {
      resultErrorId.value = item.id
      await nextTick()
      componentElement(resultRetryButton.value)?.focus()
    }
  }
  finally {
    if (active && resultLoadingId.value === item.id) resultLoadingId.value = null
  }
}

const closeResult = (): void => {
  resultDetail.value = null
  resultErrorId.value = null
  resultLoadingId.value = null
  void nextTick(() => lastResultTrigger.value?.focus())
}

const retryResult = (): void => {
  const item = items.value.find(candidate => candidate.id === resultErrorId.value)
  if (item !== undefined) void loadResult(item)
}

onMounted(() => loadQueue())
onBeforeUnmount(() => {
  active = false
  requestVersion += 1
})
</script>

<template>
  <section class="narrative-reports" aria-labelledby="narrative-reports-title">
    <header class="narrative-reports__header">
      <div>
        <p class="narrative-reports__eyebrow">SAFETY DESK / CONTACT SHEET</p>
        <h1 id="narrative-reports-title">AI 문장 신고</h1>
        <p>학생이 신고한 진로 제안을 안전 우선으로 확인하고, 저장된 결과를 바꾸지 않은 채 처리 상태만 기록합니다.</p>
      </div>
      <AppButton
        variant="secondary"
        :loading="loading || refreshing"
        @click="refreshQueue"
      >새로고침</AppButton>
    </header>

    <div class="narrative-reports__rule">
      <strong>안전 우선</strong>
      <span>안전 문제 신고를 먼저, 그다음 오래된 신고부터 확인합니다.</span>
    </div>

    <p
      v-if="announcement"
      class="narrative-reports__status"
      data-resolution-status
      role="status"
      aria-live="polite"
    >{{ announcement }}</p>

    <AppState v-if="loading" variant="loading" message="열린 신고를 확인하고 있습니다." />
    <div v-else-if="errorMessage" class="narrative-reports__state">
      <AppState variant="error" :message="`${errorMessage} 다시 시도할 수 있습니다.`" />
      <AppButton data-action="retry" variant="secondary" @click="loadQueue()">다시 시도</AppButton>
    </div>
    <AppState
      v-else-if="items.length === 0"
      variant="empty"
      message="현재 열린 신고가 없습니다."
    />

    <template v-else>
      <div class="report-queue" role="list" aria-label="열린 AI 문장 신고">
        <article
          v-for="item in items"
          :key="item.id"
          class="report-card"
          :class="{ 'report-card--urgent': item.priority === 'urgent' }"
          :data-report-id="item.id"
          role="listitem"
        >
          <div class="report-card__number">
            <span>REPORT</span>
            <strong>#{{ item.id }}</strong>
          </div>
          <div class="report-card__category">
            <span>분류</span>
            <strong>{{ categoryLabels[item.category] }}</strong>
          </div>
          <div class="report-card__time">
            <span>접수</span>
            <time :datetime="item.createdAt">{{ formattedDate(item.createdAt) }}</time>
          </div>
          <div class="report-card__result">
            <span>저장 결과</span>
            <p class="report-card__meta">
              <b>{{ item.priority === 'urgent' ? '긴급' : '일반' }}</b>
              <b>{{ item.status === 'open' ? '열림' : item.status }}</b>
              <code>{{ item.assessmentPublicId }}</code>
            </p>
            <a
              data-result-link
              :href="item.resultPath"
              :aria-busy="resultLoadingId === item.id ? 'true' : undefined"
              @click.prevent="loadResult(item, $event)"
            >{{ resultLoadingId === item.id ? '결과 확인 중' : '결과와 근거 확인' }}</a>
          </div>
          <div class="report-card__action">
            <label :for="`resolution-${item.id}`">처리 결과</label>
            <select
              :id="`resolution-${item.id}`"
              v-model="resolutionById[item.id]"
              :name="`resolution-${item.id}`"
              :disabled="resolvingId !== null"
            >
              <option
                v-for="resolution in adminNarrativeReportResolutions"
                :key="resolution"
                :value="resolution"
              >{{ resolutionLabels[resolution] }}</option>
            </select>
            <AppButton
              :data-action="`resolve-${item.id}`"
              variant="primary"
              :loading="resolvingId === item.id"
              @click="resolveReport(item)"
            >처리 확정</AppButton>
          </div>
        </article>
      </div>

      <div v-if="paginationErrorMessage" class="narrative-reports__pagination" role="alert">
        <p>{{ paginationErrorMessage }}</p>
        <AppButton
          data-action="retry-next-page"
          variant="secondary"
          :loading="loadingNext"
          @click="loadQueue(true)"
        >다음 신고 다시 불러오기</AppButton>
      </div>
      <div v-else-if="nextCursor" class="narrative-reports__pagination">
        <AppButton
          data-action="next-page"
          variant="secondary"
          :loading="loadingNext"
          @click="loadQueue(true)"
        >다음 신고 불러오기</AppButton>
      </div>
    </template>

    <section
      v-if="resultDetail"
      class="result-review"
      data-result-detail
      aria-labelledby="result-review-title"
    >
      <header>
        <div>
          <p>IMMUTABLE RESULT / REPORT #{{ resultDetail.reportId }}</p>
          <h2
            id="result-review-title"
            ref="resultHeading"
            tabindex="-1"
          >신고된 결과 근거</h2>
        </div>
        <AppButton data-action="close-result" variant="secondary" @click="closeResult">결과 닫기</AppButton>
      </header>

      <div class="result-review__grid">
        <section>
          <h3>학생 선택 관심사</h3>
          <dl class="result-review__interests">
            <div v-for="entry in resultDetail.selectedInterests" :key="`${entry.group}:${entry.label}`">
              <dt>{{ groupLabels[entry.group] }}</dt>
              <dd>{{ entry.label }}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>추천 전공 순서</h3>
          <ol>
            <li v-for="track in resultDetail.rankedTracks" :key="track">{{ trackLabels[track] }}</li>
          </ol>
        </section>
        <section>
          <h3>연결 교과</h3>
          <ul v-if="resultDetail.learningCourseTitles.length > 0">
            <li v-for="course in resultDetail.learningCourseTitles" :key="course">{{ course }}</li>
          </ul>
          <p v-else>결과에 공개 교과 근거가 없습니다.</p>
        </section>
        <section>
          <h3>교수 연결</h3>
          <p><strong>{{ resultDetail.faculty.primary.name }} {{ resultDetail.faculty.primary.title }}</strong></p>
          <p>{{ resultDetail.faculty.primary.expertise }}</p>
          <ul v-if="resultDetail.faculty.specialists.length > 0">
            <li v-for="member in resultDetail.faculty.specialists" :key="`${member.name}:${member.title}`">
              {{ member.name }} {{ member.title }} · {{ member.expertise }}
            </li>
          </ul>
        </section>
      </div>

      <section class="result-review__narrative">
        <h3>학생에게 표시된 네 문장</h3>
        <ol>
          <li v-for="sentence in resultDetail.narrativeSentences" :key="sentence">{{ sentence }}</li>
        </ol>
      </section>
    </section>

    <div
      v-else-if="resultErrorId !== null"
      class="result-review-error"
      data-result-error
      role="alert"
      aria-live="assertive"
    >
      <p>저장된 결과를 불러오지 못했습니다. 관리자 세션을 확인하고 다시 시도하세요.</p>
      <AppButton
        ref="resultRetryButton"
        data-action="retry-result"
        variant="secondary"
        @click="retryResult"
      >결과 다시 불러오기</AppButton>
    </div>
  </section>
</template>

<style scoped>
.narrative-reports {
  container-type: inline-size;
  display: grid;
  gap: 1.5rem;
}

.narrative-reports__header {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
}

.narrative-reports__eyebrow,
.result-review header p {
  margin: 0 0 0.625rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.narrative-reports h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  letter-spacing: -0.045em;
}

.narrative-reports__header > div > p:last-child {
  max-width: 46rem;
  margin-bottom: 0;
  color: var(--color-resource);
}

.narrative-reports__rule {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.75rem;
  border-block: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  padding-block: 0.875rem;
}

.narrative-reports__rule strong {
  color: var(--color-error);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
}

.narrative-reports__status {
  margin: 0;
  border-left: 0.25rem solid var(--color-sequence);
  background: color-mix(in srgb, var(--color-sequence) 8%, var(--color-surface));
  padding: 0.75rem 1rem;
}

.report-queue {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.report-card {
  display: grid;
  gap: 1rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  border-left: 0.375rem solid var(--color-sequence);
  background: var(--color-surface);
  padding: 1rem;
}

.report-card--urgent {
  border-left-color: var(--color-error);
}

.report-card span,
.report-card label {
  display: block;
  margin-bottom: 0.25rem;
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.report-card__number strong {
  font-family: var(--font-mono);
  font-size: 1.125rem;
}

.report-card__category strong { font-family: var(--font-display); }
.report-card__time time { font-size: 0.875rem; }

.report-card__result a {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  color: var(--color-sequence);
  font-family: var(--font-display);
  font-weight: 750;
  text-underline-offset: 0.2em;
}

.report-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem 0.5rem;
  margin: 0 0 0.375rem;
}

.report-card__meta b {
  border: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent);
  padding: 0.125rem 0.375rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
}

.report-card__meta code {
  flex-basis: 100%;
  color: var(--color-resource);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  overflow-wrap: anywhere;
}

.report-card__action {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 0.625rem;
}

.report-card__action label { grid-column: 1 / -1; margin: 0; }

.report-card select {
  min-height: var(--touch-target);
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--color-ink) 24%, transparent);
  border-radius: 0.25rem;
  background: var(--color-surface);
  color: var(--color-ink);
  padding-inline: 0.75rem;
}

.report-card a:focus-visible,
.report-card select:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.narrative-reports__state,
.narrative-reports__pagination,
.result-review-error {
  display: grid;
  justify-items: start;
  gap: 0.75rem;
}

.narrative-reports__pagination p,
.result-review-error p { margin: 0; }

.result-review,
.result-review-error {
  border: 1px solid var(--color-sequence);
  background: var(--color-surface);
  padding: clamp(1rem, 3vw, 2rem);
}

.result-review header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
}

.result-review h2,
.result-review h3 { font-family: var(--font-display); }
.result-review h2 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.25rem); }
.result-review h3 { margin-block: 0 0.75rem; font-size: 1rem; }

.result-review__grid {
  display: grid;
  gap: 1rem;
  margin-top: 1.5rem;
}

.result-review__grid > section {
  border-top: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  padding-top: 1rem;
}

.result-review__interests { display: grid; gap: 0.5rem; margin: 0; }
.result-review__interests div { display: grid; grid-template-columns: 8rem 1fr; gap: 0.75rem; }
.result-review__interests dt { color: var(--color-resource); font-size: 0.75rem; }
.result-review__interests dd { margin: 0; }
.result-review ol,
.result-review ul { margin: 0; padding-left: 1.25rem; }

.result-review__narrative {
  margin-top: 1.5rem;
  border-top: 2px solid var(--color-ink);
  padding-top: 1.25rem;
}

.result-review__narrative li + li { margin-top: 0.75rem; }

@container (min-width: 48rem) {
  .result-review__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (min-width: 70rem) {
  .report-card {
    grid-template-columns: 5rem 7rem 9rem minmax(13rem, 1fr) minmax(18rem, 1.2fr);
    align-items: center;
  }

  .report-card__action {
    grid-template-columns: minmax(10rem, 1fr) auto;
  }
}
</style>
