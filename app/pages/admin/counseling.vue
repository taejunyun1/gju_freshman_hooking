<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  adminCounselingQueueSchema,
  counselingStatuses,
  type AdminCounselingQueue,
  type AdminCounselingQueueItem,
} from '../../../shared/schemas/counseling'
import { trackKeys, trackLabels } from '../../../shared/types/domain'
import type { ApiSuccess } from '../../../shared/types/api'
import CounselingQueue from '../../components/admin/CounselingQueue.vue'
import AppButton from '../../components/common/AppButton.vue'
import AppState from '../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const adminSession = useAdminSessionStore()
const items = ref<AdminCounselingQueueItem[]>([])
const faculty = ref<AdminCounselingQueue['faculty']>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const loadingNext = ref(false)
const refreshing = ref(false)
const errorMessage = ref('')
const paginationErrorMessage = ref('')
const refreshErrorMessage = ref('')
const filters = reactive({
  assignedFacultyId: '',
  campaignId: '',
  createdFrom: '',
  createdTo: '',
  primaryTrack: '',
  status: '',
})
let active = true
let requestVersion = 0

const statusLabels = {
  new: '신규 접수',
  assigned: '배정 완료',
  contacted: '연락 완료',
  completed: '상담 완료',
  closed: '요청 종료',
} as const

const startOfKoreanDate = (date: string): string => new Date(`${date}T00:00:00+09:00`).toISOString()
const endOfKoreanDate = (date: string): string => new Date(`${date}T23:59:59.999+09:00`).toISOString()

const queueQuery = (cursor?: string): Record<string, string> => {
  const query: Record<string, string> = { limit: '20' }
  if (cursor) query.cursor = cursor
  if (filters.status) query.status = filters.status
  if (filters.primaryTrack) query.primaryTrack = filters.primaryTrack
  if (filters.campaignId) query.campaignId = String(filters.campaignId)
  if (filters.assignedFacultyId) query.assignedFacultyId = String(filters.assignedFacultyId)
  if (filters.createdFrom) query.createdFrom = startOfKoreanDate(filters.createdFrom)
  if (filters.createdTo) query.createdTo = endOfKoreanDate(filters.createdTo)
  return query
}

const mergeItems = (
  current: AdminCounselingQueueItem[],
  incoming: AdminCounselingQueueItem[],
): AdminCounselingQueueItem[] => {
  const byId = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()]
}

const loadQueue = async (append = false, background = false): Promise<void> => {
  if (append && !nextCursor.value) return
  const thisRequest = ++requestVersion
  if (append) loadingNext.value = true
  else if (background) refreshing.value = true
  else loading.value = true
  if (append) {
    paginationErrorMessage.value = ''
  }
  else if (background) {
    refreshErrorMessage.value = ''
  }
  else {
    errorMessage.value = ''
    paginationErrorMessage.value = ''
    refreshErrorMessage.value = ''
  }

  try {
    const response = await $fetch<ApiSuccess<AdminCounselingQueue>>('/api/admin/counseling', {
      headers: adminSession.authorizationHeaders(),
      query: queueQuery(append ? nextCursor.value ?? undefined : undefined),
    })
    if (!active || thisRequest !== requestVersion) return
    const parsed = adminCounselingQueueSchema.parse(response.data)
    items.value = append ? mergeItems(items.value, parsed.items) : parsed.items
    faculty.value = parsed.faculty
    nextCursor.value = parsed.nextCursor
  }
  catch {
    if (active && thisRequest === requestVersion) {
      if (append) paginationErrorMessage.value = '다음 요청을 불러오지 못했습니다. 현재 목록을 유지한 채 다시 시도하세요.'
      else if (background) refreshErrorMessage.value = '최신 상담 상태를 불러오지 못했습니다. 현재 표시 내용을 확인한 뒤 다시 시도하세요.'
      else errorMessage.value = '상담 대기열을 불러오지 못했습니다. 세션을 확인하고 다시 시도하세요.'
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
  await loadQueue(false, items.value.length > 0)
}

const resetAndLoad = async (): Promise<void> => {
  requestVersion += 1
  items.value = []
  nextCursor.value = null
  await loadQueue(false)
}

const clearFilters = async (): Promise<void> => {
  Object.assign(filters, {
    assignedFacultyId: '',
    campaignId: '',
    createdFrom: '',
    createdTo: '',
    primaryTrack: '',
    status: '',
  })
  await resetAndLoad()
}

onMounted(() => loadQueue())
onBeforeUnmount(() => {
  active = false
  requestVersion += 1
})
</script>

<template>
  <section class="counseling-operations" aria-labelledby="counseling-operations-title">
    <header class="counseling-operations__header">
      <div>
        <p class="counseling-operations__eyebrow">ADMISSIONS / COUNSELING DESK</p>
        <h1 id="counseling-operations-title">상담 운영</h1>
        <p>학생의 관심 분야와 희망 진로를 읽고 담당 교수와 다음 상담 단계를 확정합니다.</p>
      </div>
      <AppButton
        variant="secondary"
        :loading="loading || refreshing"
        @click="refreshQueue"
      >새로고침</AppButton>
    </header>

    <form class="counseling-filters" aria-label="상담 대기열 필터" @submit.prevent="resetAndLoad">
      <label>
        상태
        <select v-model="filters.status" name="status" @change="resetAndLoad">
          <option value="">전체 상태</option>
          <option v-for="status in counselingStatuses" :key="status" :value="status">{{ statusLabels[status] }}</option>
        </select>
      </label>
      <label>
        관심 분야
        <select v-model="filters.primaryTrack" name="primaryTrack" @change="resetAndLoad">
          <option value="">전체 분야</option>
          <option v-for="track in trackKeys" :key="track" :value="track">{{ trackLabels[track] }}</option>
        </select>
      </label>
      <label>
        캠페인
        <input v-model="filters.campaignId" name="campaignId" type="number" inputmode="numeric" min="1" step="1" placeholder="전체">
      </label>
      <label>
        담당 교수
        <select v-model="filters.assignedFacultyId" name="assignedFacultyId">
          <option value="">전체 교수</option>
          <option v-for="member in faculty" :key="member.id" :value="String(member.id)">{{ member.name }} {{ member.title }}</option>
        </select>
      </label>
      <label>
        접수 시작일
        <input v-model="filters.createdFrom" name="createdFrom" type="date">
      </label>
      <label>
        접수 종료일
        <input v-model="filters.createdTo" name="createdTo" type="date">
      </label>
      <div class="counseling-filters__actions">
        <AppButton data-action="apply-filters" variant="primary" :loading="loading" @click="resetAndLoad">필터 적용</AppButton>
        <AppButton variant="secondary" :loading="loading" @click="clearFilters">초기화</AppButton>
      </div>
    </form>

    <div class="counseling-operations__count" aria-live="polite">
      <span>표시 중</span>
      <strong>{{ items.length }}</strong>
      <span>건</span>
    </div>

    <AppState v-if="loading" variant="loading" message="상담 요청을 확인하고 있습니다." />
    <div v-else-if="errorMessage" class="counseling-operations__state">
      <AppState variant="error" :message="`${errorMessage} 다시 시도할 수 있습니다.`" />
      <AppButton data-action="retry" variant="secondary" @click="resetAndLoad">다시 시도</AppButton>
    </div>
    <AppState v-else-if="items.length === 0" variant="empty" message="조건에 맞는 상담 요청이 없습니다." />
    <template v-else>
      <CounselingQueue :items="items" :faculty="faculty" @refresh="refreshQueue" />
      <p v-if="refreshErrorMessage" class="counseling-operations__inline-error" role="alert">{{ refreshErrorMessage }}</p>
      <div v-if="paginationErrorMessage" class="counseling-operations__pagination-error" aria-live="polite">
        <p>{{ paginationErrorMessage }}</p>
        <AppButton
          data-action="retry-next-page"
          variant="secondary"
          :loading="loadingNext"
          @click="loadQueue(true)"
        >다음 요청 다시 불러오기</AppButton>
      </div>
      <div v-else-if="nextCursor" class="counseling-operations__next">
        <AppButton
          data-action="next-page"
          variant="secondary"
          :loading="loadingNext"
          @click="loadQueue(true)"
        >다음 요청 불러오기</AppButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.counseling-operations { display: grid; gap: 1.5rem; }

.counseling-operations__header {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
}

.counseling-operations__eyebrow {
  margin: 0 0 0.625rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.counseling-operations h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  letter-spacing: -0.05em;
}

.counseling-operations__header p:last-child {
  max-width: 48rem;
  margin: 0.75rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
}

.counseling-filters {
  display: grid;
  grid-template-columns: repeat(6, minmax(8.5rem, 1fr));
  gap: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--color-primary-strong) 16%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  padding: 1rem;
}

.counseling-filters label {
  min-width: 0;
  color: color-mix(in srgb, var(--color-ink) 70%, transparent);
  font-size: 0.75rem;
  font-weight: 700;
}

.counseling-filters select,
.counseling-filters input {
  width: 100%;
  min-height: var(--touch-target);
  display: block;
  margin-top: 0.4rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  padding: 0.55rem 0.65rem;
  color: var(--color-ink);
}

.counseling-filters select:focus-visible,
.counseling-filters input:focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 2px; }

.counseling-filters__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.counseling-operations__count {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
}
.counseling-operations__count strong { color: var(--color-sequence); font-size: 1.5rem; }
.counseling-operations__state { display: grid; gap: 0.75rem; justify-items: start; }
.counseling-operations__next { display: flex; justify-content: center; }
.counseling-operations__inline-error,
.counseling-operations__pagination-error p { margin: 0; color: var(--color-error); }
.counseling-operations__pagination-error { display: grid; justify-items: center; gap: 0.75rem; }

@media (max-width: 80rem) {
  .counseling-filters { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 48rem) {
  .counseling-operations__header :deep(button),
  .counseling-operations__next :deep(button) { width: 100%; }
  .counseling-filters { grid-template-columns: 1fr 1fr; }
  .counseling-filters__actions { display: grid; grid-template-columns: 1fr 1fr; }
}

@media (max-width: 34rem) {
  .counseling-filters { grid-template-columns: 1fr; }
  .counseling-filters__actions { grid-template-columns: 1fr; }
}
</style>
