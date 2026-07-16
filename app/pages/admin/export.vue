<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'

import type { AdminExportFilter } from '../../../shared/schemas/admin-export'
import { counselingStatuses, trackKeys, trackLabels } from '../../../shared/types/domain'
import AppButton from '../../components/common/AppButton.vue'
import { useXlsxExport } from '../../composables/useXlsxExport'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const { dispose, start, state } = useXlsxExport()
const form = reactive({
  query: '',
  school: '',
  stage: '',
  region: '',
  track: '',
  campaignId: '',
  counselingStatus: '',
  dateFrom: '',
  dateTo: '',
})
const campaignError = ref('')

const stageLabels = {
  high1: '고1',
  high2: '고2',
  high3: '고3',
  graduate: '고교 졸업',
  ged: '검정고시',
  other: '기타',
} as const
const regionLabels = {
  gwangju: '광주',
  jeonbuk: '전북',
  capital: '수도권',
  chungcheong: '충청권',
  gyeongsang: '경상권',
  gangwon_jeju: '강원·제주',
  overseas: '해외',
  other: '기타',
} as const
const counselingLabels = {
  new: '신규 접수',
  assigned: '배정 완료',
  contacted: '연락 완료',
  completed: '상담 완료',
  closed: '요청 종료',
} as const
const steps = ['범위 확인', '최근 인증', '행 수집', '워크북 생성']
const sheets = [
  { name: '학생목록', description: '지원자 기본 정보와 관심 분야, 최근 상담 상태' },
  { name: '최근참여이력', description: '검사별 선택과 네 가지 진로 분야 점수' },
  { name: '상담현황', description: '추천·배정 교수와 상담 진행 기록' },
]
const currentStep = computed(() => {
  if (state.value.phase === 'checking') return 0
  if (state.value.phase === 'authenticating') return 1
  if (state.value.phase === 'collecting') return 2
  if (['building', 'finalizing', 'completed'].includes(state.value.phase)) return 3
  return -1
})

const normalizedFilters = (): AdminExportFilter | null => {
  const filters: AdminExportFilter = {}
  const query = form.query.trim()
  const school = form.school.trim()
  if (query) filters.query = query
  if (school) filters.school = school
  if (form.stage) filters.stage = form.stage as AdminExportFilter['stage']
  if (form.region) filters.region = form.region as AdminExportFilter['region']
  if (form.track) filters.track = form.track as AdminExportFilter['track']
  if (form.counselingStatus) filters.counselingStatus = form.counselingStatus as AdminExportFilter['counselingStatus']
  if (form.dateFrom) filters.dateFrom = form.dateFrom
  if (form.dateTo) filters.dateTo = form.dateTo
  const campaignId = form.campaignId.trim()
  if (campaignId) {
    if (!/^[1-9]\d{0,15}$/u.test(campaignId) || !Number.isSafeInteger(Number(campaignId))) {
      campaignError.value = '캠페인 ID는 1 이상의 안전한 양의 정수로 입력해 주세요.'
      return null
    }
    filters.campaignId = Number(campaignId)
  }
  campaignError.value = ''
  return filters
}
const beginExport = (): void => {
  if (state.value.busy) return
  const filters = normalizedFilters()
  if (filters !== null) void start(filters)
}
const resetFilters = (): void => {
  if (state.value.busy) return
  for (const key of Object.keys(form) as Array<keyof typeof form>) form[key] = ''
  campaignError.value = ''
}
const formatCount = (value: number): string => value.toLocaleString('ko-KR')

onBeforeUnmount(dispose)
</script>

<template>
  <section class="export-page">
    <header class="export-page__header">
      <p class="export-page__eyebrow">EXPORT / PRIVATE WORKBOOK</p>
      <h1>데이터 내보내기</h1>
      <p>필요한 학생 범위만 고르고, 검증된 운영 데이터를 세 개의 시트로 받습니다.</p>
    </header>

    <ol class="export-sequence" aria-label="내보내기 진행 순서">
      <li
        v-for="(step, index) in steps"
        :key="step"
        data-export-step
        :data-active="currentStep === index ? 'true' : undefined"
        :data-complete="currentStep > index || state.phase === 'completed' ? 'true' : undefined"
      >{{ step }}</li>
    </ol>

    <div class="export-page__grid">
      <form class="export-filter" aria-label="내보내기 범위" @submit.prevent="beginExport">
        <div class="export-filter__heading">
          <div>
            <p>RANGE / FILTER SNAPSHOT</p>
            <h2>내보낼 범위</h2>
          </div>
          <button type="button" :disabled="state.busy" @click="resetFilters">전체 초기화</button>
        </div>

        <fieldset :disabled="state.busy">
          <label class="export-filter__wide">
            <span>닉네임·검색어</span>
            <input v-model="form.query" name="query" type="search" maxlength="100" autocomplete="off" placeholder="닉네임 또는 검색어">
          </label>
          <label class="export-filter__wide">
            <span>학교</span>
            <input v-model="form.school" name="school" type="search" maxlength="40" autocomplete="off" placeholder="학교명">
          </label>
          <label>
            <span>학년</span>
            <select v-model="form.stage" name="stage">
              <option value="">전체 학년</option>
              <option v-for="(label, value) in stageLabels" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label>
            <span>지역</span>
            <select v-model="form.region" name="region">
              <option value="">전체 지역</option>
              <option v-for="(label, value) in regionLabels" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label>
            <span>관심 분야</span>
            <select v-model="form.track" name="track">
              <option value="">전체 분야</option>
              <option v-for="track in trackKeys" :key="track" :value="track">{{ trackLabels[track] }}</option>
            </select>
          </label>
          <label>
            <span>상담 상태</span>
            <select v-model="form.counselingStatus" name="counselingStatus">
              <option value="">전체 상태</option>
              <option v-for="status in counselingStatuses" :key="status" :value="status">{{ counselingLabels[status] }}</option>
            </select>
          </label>
          <label>
            <span>캠페인 ID</span>
            <input
              v-model="form.campaignId"
              name="campaignId"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              aria-describedby="campaign-id-error"
              :aria-invalid="campaignError ? 'true' : undefined"
              placeholder="전체"
            >
          </label>
          <label>
            <span>참여 시작일</span>
            <input v-model="form.dateFrom" name="dateFrom" type="date" :max="form.dateTo || undefined">
          </label>
          <label>
            <span>참여 종료일</span>
            <input v-model="form.dateTo" name="dateTo" type="date" :min="form.dateFrom || undefined">
          </label>
        </fieldset>
        <p
          v-if="campaignError"
          id="campaign-id-error"
          class="export-filter__error"
          data-campaign-error
          role="alert"
        >{{ campaignError }}</p>

        <div class="export-filter__notice">
          <span aria-hidden="true">15</span>
          <p><strong>최근 인증 15분</strong>을 넘겼다면 시작 직후 로그인 화면으로 안내됩니다.</p>
        </div>

        <div class="export-filter__actions">
          <AppButton
            v-if="state.phase !== 'failed'"
            variant="primary"
            :loading="state.busy"
            data-action="start"
            @click="beginExport"
          >
            {{ state.busy ? '내보내기 진행 중' : 'XLSX 만들기' }}
          </AppButton>
          <AppButton
            v-if="state.phase === 'failed' && state.canRetry"
            variant="secondary"
            data-action="retry"
            @click="beginExport"
          >다시 시도</AppButton>
        </div>
      </form>

      <aside class="export-status" aria-label="워크북 생성 상태">
        <div class="export-status__head">
          <p>WORKBOOK / 03 SHEETS</p>
          <span :data-phase="state.phase">{{
            state.phase === 'completed'
              ? 'READY'
              : state.phase === 'failed'
                ? 'FAILED'
                : state.busy
                  ? 'RUNNING'
                  : 'STANDBY'
          }}</span>
        </div>

        <div class="export-ledger">
          <article v-for="(sheet, index) in sheets" :key="sheet.name" data-sheet-ledger>
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            <div>
              <h2 data-sheet-name>{{ sheet.name }}</h2>
              <p>{{ sheet.description }}</p>
            </div>
          </article>
        </div>

        <dl class="export-counts" data-row-counts>
          <div><dt>학생</dt><dd>{{ formatCount(state.rows.students) }}행</dd></div>
          <div><dt>참여</dt><dd>{{ formatCount(state.rows.assessments) }}행</dd></div>
          <div><dt>상담</dt><dd>{{ formatCount(state.rows.counseling) }}행</dd></div>
        </dl>

        <div class="export-live" aria-live="polite" aria-atomic="true">
          <span v-if="state.currentSheet">{{ state.currentSheet }}</span>
          <p>{{ state.message }}</p>
          <strong v-if="state.filename">{{ state.filename }}</strong>
        </div>
        <p v-if="state.error" class="export-error" role="alert">{{ state.error }}</p>

        <p class="export-status__privacy">XLSX에는 검증된 학생·참여·상담 데이터만 포함됩니다. 운영 후 파일 보관 위치를 확인해 주세요.</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.export-page {
  display: grid;
  gap: 1.5rem;
}

.export-page__header {
  max-width: 52rem;
}

.export-page__eyebrow,
.export-filter__heading p,
.export-status__head p {
  margin: 0 0 0.5rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 650;
  letter-spacing: 0.12em;
}

.export-page__header h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 6vw, 4.75rem);
  font-weight: 850;
  letter-spacing: -0.065em;
  line-height: 0.94;
}

.export-page__header > p:last-child {
  max-width: 42rem;
  margin: 1rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  line-height: 1.7;
}

.export-sequence {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent);
  background: var(--color-ink);
  color: color-mix(in srgb, var(--color-surface) 58%, transparent);
  list-style: none;
}

.export-sequence li {
  min-height: var(--touch-target);
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid color-mix(in srgb, var(--color-surface) 16%, transparent);
  padding: 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 600;
  text-align: center;
}

.export-sequence li:last-child { border-right: 0; }
.export-sequence li[data-active="true"] { background: var(--color-sequence); color: var(--color-surface); }
.export-sequence li[data-complete="true"] { color: #C9B7EC; }

.export-page__grid {
  display: grid;
  gap: 1rem;
}

.export-filter,
.export-status {
  border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  background: var(--color-surface);
}

.export-filter { padding: clamp(1rem, 3vw, 1.75rem); }

.export-filter__heading,
.export-status__head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
}

.export-filter__heading h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.5rem;
  letter-spacing: -0.035em;
}

.export-filter__heading button {
  min-height: var(--touch-target);
  border: 0;
  background: transparent;
  color: var(--color-resource);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 650;
  cursor: pointer;
}

.export-filter fieldset {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  margin: 1.5rem 0 0;
  padding: 0;
  border: 0;
}

.export-filter label {
  min-width: 0;
  color: color-mix(in srgb, var(--color-ink) 66%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 600;
}

.export-filter__wide { grid-column: 1 / -1; }

.export-filter input,
.export-filter select {
  width: 100%;
  min-height: var(--touch-target);
  margin-top: 0.35rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 24%, transparent);
  border-radius: 0.25rem;
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.6rem 0.7rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
}

.export-filter input:focus-visible,
.export-filter select:focus-visible,
.export-filter__heading button:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--color-sequence) 70%, transparent);
  outline-offset: 2px;
}

.export-filter fieldset:disabled { opacity: 0.58; }
.export-filter__error {
  margin: 0.75rem 0 0;
  border-left: 3px solid #B34E48;
  background: color-mix(in srgb, #B34E48 8%, var(--color-surface));
  color: #8B302B;
  padding: 0.65rem 0.75rem;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.export-filter__notice {
  display: grid;
  grid-template-columns: 3rem 1fr;
  gap: 0.875rem;
  align-items: center;
  margin-top: 1.25rem;
  border-top: 1px solid color-mix(in srgb, var(--color-ink) 14%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 14%, transparent);
  padding-block: 0.875rem;
}

.export-filter__notice > span {
  color: var(--color-sequence);
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 850;
  letter-spacing: -0.06em;
}

.export-filter__notice p { margin: 0; font-size: 0.8125rem; line-height: 1.55; }
.export-filter__actions { display: flex; flex-wrap: wrap; gap: 0.625rem; margin-top: 1.25rem; }

.export-status {
  align-self: start;
  background: var(--color-ink);
  color: var(--color-surface);
  padding: clamp(1rem, 3vw, 1.5rem);
}

.export-status__head p { color: #BCA7E4; }

.export-status__head > span {
  border: 1px solid color-mix(in srgb, var(--color-surface) 26%, transparent);
  padding: 0.35rem 0.5rem;
  color: color-mix(in srgb, var(--color-surface) 66%, transparent);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.1em;
}

.export-status__head > span[data-phase="completed"] { border-color: #8BC6BC; color: #A9DDD4; }
.export-status__head > span[data-phase="failed"] { border-color: #D77973; color: #FFD5D2; }

.export-ledger { margin-top: 1.25rem; border-top: 1px solid color-mix(in srgb, var(--color-surface) 20%, transparent); }

.export-ledger article {
  display: grid;
  grid-template-columns: 2rem 1fr;
  gap: 0.75rem;
  padding-block: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface) 20%, transparent);
}

.export-ledger article > span { color: #BCA7E4; font-family: var(--font-mono); font-size: 0.6875rem; }
.export-ledger h2 { margin: 0; font-family: var(--font-display); font-size: 1rem; }
.export-ledger p { margin: 0.35rem 0 0; color: color-mix(in srgb, var(--color-surface) 62%, transparent); font-size: 0.75rem; line-height: 1.55; }

.export-counts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 1rem 0 0;
  border: 1px solid color-mix(in srgb, var(--color-surface) 20%, transparent);
}

.export-counts div { padding: 0.75rem; border-right: 1px solid color-mix(in srgb, var(--color-surface) 20%, transparent); }
.export-counts div:last-child { border-right: 0; }
.export-counts dt { color: color-mix(in srgb, var(--color-surface) 56%, transparent); font-family: var(--font-mono); font-size: 0.625rem; }
.export-counts dd { margin: 0.25rem 0 0; font-family: var(--font-display); font-weight: 750; }

.export-live {
  min-height: 5.5rem;
  margin-top: 1rem;
  border-left: 3px solid var(--color-sequence);
  background: color-mix(in srgb, var(--color-surface) 6%, transparent);
  padding: 0.875rem 1rem;
}

.export-live span { color: #BCA7E4; font-family: var(--font-mono); font-size: 0.6875rem; }
.export-live p { margin: 0.35rem 0 0; line-height: 1.55; }
.export-live strong { display: block; margin-top: 0.5rem; overflow-wrap: anywhere; color: #A9DDD4; font-family: var(--font-mono); font-size: 0.75rem; }
.export-error { margin: 0.75rem 0 0; border: 1px solid #D77973; padding: 0.75rem; color: #FFD5D2; font-size: 0.8125rem; line-height: 1.55; }
.export-status__privacy { margin: 1rem 0 0; color: color-mix(in srgb, var(--color-surface) 52%, transparent); font-size: 0.6875rem; line-height: 1.6; }

@media (min-width: 36rem) {
  .export-filter fieldset { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (min-width: 62rem) {
  .export-page__grid { grid-template-columns: minmax(0, 1.55fr) minmax(20rem, 0.75fr); gap: 1.25rem; }
  .export-filter fieldset { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .export-filter label { grid-column: span 2; }
  .export-filter__wide { grid-column: span 3 !important; }
}

@media (max-width: 35rem) {
  .export-sequence { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .export-sequence li:nth-child(2) { border-right: 0; }
  .export-sequence li:nth-child(-n + 2) { border-bottom: 1px solid color-mix(in srgb, var(--color-surface) 16%, transparent); }
}
</style>
