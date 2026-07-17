<script setup lang="ts">
import { onBeforeUnmount, reactive, watch } from 'vue'

import type { AdminStudentFilters } from '../../../shared/schemas/admin-students'
import { counselingStatuses, trackKeys, trackLabels } from '../../../shared/types/domain'
import AppButton from '../common/AppButton.vue'

const props = defineProps<{
  modelValue: AdminStudentFilters
}>()

const emit = defineEmits<{
  apply: [filters: AdminStudentFilters]
  reset: []
}>()

const local = reactive<AdminStudentFilters>({ ...props.modelValue })
let searchTimer: ReturnType<typeof setTimeout> | undefined

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

const statusLabels = {
  new: '신규 접수',
  assigned: '배정 완료',
  contacted: '연락 완료',
  completed: '상담 완료',
  closed: '요청 종료',
} as const

const clearSearchTimer = (): void => {
  if (searchTimer !== undefined) clearTimeout(searchTimer)
  searchTimer = undefined
}

const applyNow = (): void => {
  clearSearchTimer()
  emit('apply', { ...local })
}

const applySearchLater = (): void => {
  clearSearchTimer()
  searchTimer = setTimeout(applyNow, 350)
}

const reset = (): void => {
  clearSearchTimer()
  for (const key of Object.keys(local) as Array<keyof AdminStudentFilters>) local[key] = ''
  emit('reset')
}

watch(() => props.modelValue, value => Object.assign(local, value), { deep: true })
onBeforeUnmount(clearSearchTimer)
</script>

<template>
  <form class="student-filters" aria-label="학생 검색 필터" @submit.prevent="applyNow">
    <label class="student-filters__search">
      <span>닉네임·전화번호</span>
      <input
        v-model="local.query"
        name="query"
        type="search"
        autocomplete="off"
        maxlength="100"
        placeholder="닉네임 또는 전화번호"
        @input="applySearchLater"
      >
    </label>
    <label class="student-filters__search">
      <span>학교</span>
      <input
        v-model="local.school"
        name="school"
        type="search"
        autocomplete="off"
        maxlength="40"
        placeholder="학교명"
        @input="applySearchLater"
      >
    </label>
    <label>
      <span>학년</span>
      <select v-model="local.stage" name="stage" @change="applyNow">
        <option value="">전체 학년</option>
        <option v-for="(label, value) in stageLabels" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
    <label>
      <span>지역</span>
      <select v-model="local.region" name="region" @change="applyNow">
        <option value="">전체 지역</option>
        <option v-for="(label, value) in regionLabels" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
    <label>
      <span>관심 분야</span>
      <select v-model="local.track" name="track" @change="applyNow">
        <option value="">전체 분야</option>
        <option v-for="track in trackKeys" :key="track" :value="track">{{ trackLabels[track] }}</option>
      </select>
    </label>
    <label>
      <span>상담 상태</span>
      <select v-model="local.counselingStatus" name="counselingStatus" @change="applyNow">
        <option value="">전체 상태</option>
        <option v-for="status in counselingStatuses" :key="status" :value="status">{{ statusLabels[status] }}</option>
      </select>
    </label>
    <label>
      <span>캠페인 ID</span>
      <input v-model="local.campaign" name="campaign" type="number" inputmode="numeric" min="1" step="1" placeholder="전체">
    </label>
    <label>
      <span>참여 시작일</span>
      <input v-model="local.dateFrom" name="dateFrom" type="date">
    </label>
    <label>
      <span>참여 종료일</span>
      <input v-model="local.dateTo" name="dateTo" type="date">
    </label>
    <div class="student-filters__actions">
      <AppButton data-action="apply" variant="primary" @click="applyNow">필터 적용</AppButton>
      <AppButton data-action="reset" variant="secondary" @click="reset">초기화</AppButton>
    </div>
  </form>
</template>

<style scoped>
.student-filters {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
  background: var(--color-surface);
  padding: 1rem;
}

.student-filters label {
  grid-column: span 2;
  min-width: 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 600;
}

.student-filters__search {
  grid-column: span 3 !important;
}

.student-filters input,
.student-filters select {
  width: 100%;
  min-height: var(--touch-target);
  margin-top: 0.35rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 26%, transparent);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.55rem 0.625rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
}

.student-filters input:focus-visible,
.student-filters select:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--color-sequence) 72%, transparent);
  outline-offset: 2px;
  border-color: var(--color-sequence);
}

.student-filters__actions {
  grid-column: span 4;
  display: flex;
  align-items: end;
  gap: 0.5rem;
}

@media (max-width: 70rem) {
  .student-filters label,
  .student-filters__search,
  .student-filters__actions {
    grid-column: span 4 !important;
  }
}

@media (max-width: 44.99rem) {
  .student-filters {
    grid-template-columns: 1fr 1fr;
  }

  .student-filters label,
  .student-filters__search {
    grid-column: span 1 !important;
  }

  .student-filters__search,
  .student-filters__actions {
    grid-column: 1 / -1 !important;
  }
}
</style>
