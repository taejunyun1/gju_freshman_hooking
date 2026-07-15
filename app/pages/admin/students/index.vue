<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  adminStudentFilterKeys,
  adminStudentsListSchema,
  type AdminStudentFilters,
  type AdminStudentListItem,
} from '../../../../shared/schemas/admin-students'
import type { ApiSuccess } from '../../../../shared/types/api'
import DataTable from '../../../components/admin/DataTable.vue'
import StudentFilters from '../../../components/admin/StudentFilters.vue'
import AppButton from '../../../components/common/AppButton.vue'
import AppState from '../../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const router = useRouter()
const adminSession = useAdminSessionStore()
const items = ref<AdminStudentListItem[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const errorMessage = ref('')
let active = true
let requestVersion = 0
let stopRouteWatch: (() => void) | undefined

const hasControlCharacters = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
})

const routeString = (key: string): string => {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

const pageLimit = (): string => {
  const value = routeString('limit')
  return /^(?:[1-9]|[1-4][0-9]|50)$/u.test(value) ? value : '20'
}

const filterModel = computed<AdminStudentFilters>(() => Object.fromEntries(
  adminStudentFilterKeys.map(key => [key, routeString(key)]),
) as AdminStudentFilters)

const apiQuery = (): Record<string, string> => {
  const query: Record<string, string> = {}
  for (const key of adminStudentFilterKeys) {
    const value = routeString(key)
    if (value) query[key] = value
  }
  query.limit = pageLimit()
  const cursor = routeString('cursor')
  if (cursor) query.cursor = cursor
  return query
}

const safeListUrl = computed(() => {
  const fallback = '/admin/students'
  if (typeof route.fullPath !== 'string'
    || route.fullPath.length > 2_000
    || hasControlCharacters(route.fullPath)) return fallback
  try {
    const parsed = new URL(route.fullPath, 'https://photo-next.invalid')
    return parsed.origin === 'https://photo-next.invalid' && parsed.pathname === fallback
      ? `${parsed.pathname}${parsed.search}`
      : fallback
  }
  catch {
    return fallback
  }
})

const nextTarget = computed(() => nextCursor.value
  ? {
      path: '/admin/students',
      query: { ...apiQuery(), cursor: nextCursor.value },
    }
  : null)

const loadStudents = async (): Promise<void> => {
  const thisRequest = ++requestVersion
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<unknown>>('/api/admin/students', {
      headers: adminSession.authorizationHeaders(),
      query: apiQuery(),
    })
    if (!active || thisRequest !== requestVersion) return
    const parsed = adminStudentsListSchema.parse(response.data)
    items.value = parsed.items
    nextCursor.value = parsed.nextCursor
  }
  catch {
    if (!active || thisRequest !== requestVersion) return
    items.value = []
    nextCursor.value = null
    errorMessage.value = '학생 목록을 불러오지 못했습니다. 세션을 확인한 뒤 다시 시도하세요.'
  }
  finally {
    if (active && thisRequest === requestVersion) loading.value = false
  }
}

const applyFilters = async (filters: AdminStudentFilters): Promise<void> => {
  const query: Record<string, string> = {}
  for (const key of adminStudentFilterKeys) {
    const value = filters[key].trim()
    if (value) query[key] = value
  }
  query.limit = pageLimit()
  await router.replace({ path: '/admin/students', query })
}

const resetFilters = async (): Promise<void> => {
  await router.replace({ path: '/admin/students', query: { limit: pageLimit() } })
}

onMounted(() => {
  stopRouteWatch = watch(() => route.fullPath, loadStudents, { immediate: true })
})
onBeforeUnmount(() => {
  active = false
  requestVersion += 1
  stopRouteWatch?.()
})
</script>

<template>
  <section class="student-operations" aria-labelledby="student-operations-title">
    <header class="student-operations__header">
      <div>
        <p class="student-operations__eyebrow">ADMISSIONS / STUDENT CONTACT SHEET</p>
        <h1 id="student-operations-title">학생 찾기</h1>
        <p>학생의 참여 기록과 상담 흐름을 확인하고, 필요한 다음 연락을 준비합니다.</p>
      </div>
      <AppButton variant="secondary" :loading="loading" @click="loadStudents">새로고침</AppButton>
    </header>

    <StudentFilters :model-value="filterModel" @apply="applyFilters" @reset="resetFilters" />

    <div class="student-operations__summary" aria-live="polite">
      <span>현재 페이지</span>
      <strong>{{ items.length }}</strong>
      <span>명</span>
    </div>

    <AppState v-if="loading" variant="loading" message="학생 참여 기록을 확인하고 있습니다." />
    <div v-else-if="errorMessage" class="student-operations__state">
      <AppState variant="error" :message="errorMessage" />
      <AppButton data-action="retry" variant="secondary" @click="loadStudents">다시 시도</AppButton>
    </div>
    <AppState v-else-if="items.length === 0" variant="empty" message="조건에 맞는 학생이 없습니다. 필터를 조정해 보세요." />
    <template v-else>
      <DataTable :items="items" :list-url="safeListUrl" />
      <nav v-if="nextTarget" class="student-operations__pagination" aria-label="학생 목록 페이지">
        <NuxtLink :to="nextTarget">다음 학생 보기</NuxtLink>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.student-operations {
  display: grid;
  gap: 1.25rem;
}

.student-operations__header {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
}

.student-operations__header > div {
  max-width: 50rem;
}

.student-operations__eyebrow {
  margin: 0 0 0.625rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.student-operations h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2rem, 6vw, 3.25rem);
  letter-spacing: -0.05em;
}

.student-operations__header p:last-child {
  margin: 0.75rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
}

.student-operations__summary {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  color: color-mix(in srgb, var(--color-ink) 64%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.student-operations__summary strong {
  color: var(--color-ink);
  font-size: 1.1rem;
}

.student-operations__state {
  display: grid;
  justify-items: start;
  gap: 0.75rem;
}

.student-operations__pagination {
  display: flex;
  justify-content: flex-end;
}

.student-operations__pagination a {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-resource);
  background: var(--color-surface);
  color: var(--color-resource);
  padding: 0.625rem 1rem;
  font-family: var(--font-display);
  font-weight: 700;
  text-decoration: none;
}

.student-operations__pagination a:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}
</style>
