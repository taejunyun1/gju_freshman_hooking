<script setup lang="ts">
import { z } from 'zod'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  adminResourceSchema,
  adminResourceStatuses,
  adminResourceTypes,
  adminResourceVisibilities,
  type AdminResource,
} from '../../../../shared/schemas/admin-resources'
import type { ApiSuccess } from '../../../../shared/types/api'
import AppState from '../../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const router = useRouter()
const adminSession = useAdminSessionStore()
const items = ref<AdminResource[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const queryText = ref('')
let active = true
let requestVersion = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let stopRouteWatch: (() => void) | undefined
let stopQueryWatch: (() => void) | undefined

const filterKeys = [
  'query', 'type', 'status', 'visibility', 'tag', 'sourceDateFrom', 'sourceDateTo',
] as const
type FilterKey = typeof filterKeys[number]

const resourcesListSchema = z.object({
  items: z.array(adminResourceSchema).max(50),
  nextCursor: z.string().min(1).max(200).nullable(),
}).strict()

const typeLabels: Record<AdminResource['type'], string> = {
  course: '교과', equipment: '기자재', facility: '시설', extracurricular: '비교과',
  project: '프로젝트', student_work: '학생 작품', career: '진로', support: '지원',
}
const statusLabels: Record<AdminResource['status'], string> = {
  draft: '초안', active: '게시', next_year_confirmed: '다음 학년 확정', archived: '보관',
}
const visibilityLabels: Record<AdminResource['visibility'], string> = {
  hidden: '숨김', admin_only: '관리자만', public: '학생 공개',
}

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

const apiQuery = (): Record<string, string> => {
  const query: Record<string, string> = {}
  for (const key of filterKeys) {
    const value = routeString(key)
    if (value) query[key] = value
  }
  query.limit = pageLimit()
  const cursor = routeString('cursor')
  if (cursor) query.cursor = cursor
  return query
}

const safeListUrl = computed(() => {
  const fallback = '/admin/resources'
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
  ? { path: '/admin/resources', query: { ...apiQuery(), cursor: nextCursor.value } }
  : null)

const errorCode = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return ''
  const data = (error as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return ''
  const failure = (data as { error?: unknown }).error
  if (typeof failure !== 'object' || failure === null) return ''
  return typeof (failure as { code?: unknown }).code === 'string'
    ? (failure as { code: string }).code
    : ''
}

const recoverAuthentication = async (error: unknown): Promise<boolean> => {
  if (!['ADMIN_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'].includes(errorCode(error))) return false
  adminSession.clear()
  await navigateTo({
    path: '/admin/login',
    query: { redirect: safeListUrl.value },
  }, { replace: true })
  return true
}

const loadResources = async (): Promise<void> => {
  const thisRequest = ++requestVersion
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<unknown>>('/api/admin/resources', {
      headers: adminSession.authorizationHeaders(),
      query: apiQuery(),
    })
    if (!active || thisRequest !== requestVersion) return
    const parsed = resourcesListSchema.parse(response.data)
    items.value = parsed.items
    nextCursor.value = parsed.nextCursor
  }
  catch (error) {
    if (!active || thisRequest !== requestVersion) return
    items.value = []
    nextCursor.value = null
    if (!await recoverAuthentication(error)) {
      errorMessage.value = '학과 자원 목록을 불러오지 못했습니다. 세션과 필터를 확인한 뒤 다시 시도하세요.'
    }
  }
  finally {
    if (active && thisRequest === requestVersion) loading.value = false
  }
}

const replaceFilter = async (key: FilterKey, value: string): Promise<void> => {
  const query = Object.fromEntries(Object.entries(apiQuery()).filter(([entryKey]) => (
    entryKey !== 'cursor' && entryKey !== key
  )))
  const normalized = value.trim()
  if (normalized) query[key] = normalized
  await router.replace({ path: '/admin/resources', query })
}

const filterChanged = (key: Exclude<FilterKey, 'query'>, event: Event) => {
  void replaceFilter(key, (event.target as HTMLInputElement | HTMLSelectElement).value)
}

const primaryTag = (resource: AdminResource): string => (
  resource.tags.find(tag => tag.isPrimary)?.key ?? '—'
)

const formatUpdatedAt = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short', timeStyle: 'short', hour12: false,
}).format(new Date(value))

onMounted(() => {
  stopQueryWatch = watch(queryText, (value) => {
    if (value === routeString('query')) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { void replaceFilter('query', value) }, 350)
  })
  stopRouteWatch = watch(() => route.fullPath, () => {
    const routeQuery = routeString('query')
    if (queryText.value !== routeQuery) queryText.value = routeQuery
    void loadResources()
  }, { immediate: true })
})

onBeforeUnmount(() => {
  active = false
  requestVersion += 1
  if (debounceTimer) clearTimeout(debounceTimer)
  stopQueryWatch?.()
  stopRouteWatch?.()
})
</script>

<template>
  <section class="resources-list" aria-labelledby="resources-list-title">
    <header class="resources-list__header">
      <div>
        <p class="resources-list__eyebrow">EVIDENCE LIBRARY / SOURCE REVIEW</p>
        <h1 id="resources-list-title">학과 자원</h1>
        <p>학생의 관심을 뒷받침할 교과·프로젝트·기자재·시설 근거를 검토하고 게시합니다.</p>
      </div>
      <button type="button" :disabled="loading" @click="loadResources">새로고침</button>
    </header>

    <form class="resources-list__filters" aria-label="학과 자원 필터" @submit.prevent>
      <label class="resources-list__query">검색
        <input v-model="queryText" name="query" type="search" maxlength="100" placeholder="제목이나 요약">
      </label>
      <label>유형
        <select :value="routeString('type')" name="type" @change="filterChanged('type', $event)">
          <option value="">전체</option>
          <option v-for="type in adminResourceTypes" :key="type" :value="type">{{ typeLabels[type] }}</option>
        </select>
      </label>
      <label>상태
        <select :value="routeString('status')" name="status" @change="filterChanged('status', $event)">
          <option value="">전체</option>
          <option v-for="status in adminResourceStatuses" :key="status" :value="status">{{ statusLabels[status] }}</option>
        </select>
      </label>
      <label>공개
        <select :value="routeString('visibility')" name="visibility" @change="filterChanged('visibility', $event)">
          <option value="">전체</option>
          <option v-for="visibility in adminResourceVisibilities" :key="visibility" :value="visibility">{{ visibilityLabels[visibility] }}</option>
        </select>
      </label>
      <label>태그
        <input :value="routeString('tag')" name="tag" pattern="[a-z][a-z0-9_]*" @change="filterChanged('tag', $event)">
      </label>
      <label>기준일 시작
        <input :value="routeString('sourceDateFrom')" name="sourceDateFrom" type="date" @change="filterChanged('sourceDateFrom', $event)">
      </label>
      <label>기준일 끝
        <input :value="routeString('sourceDateTo')" name="sourceDateTo" type="date" @change="filterChanged('sourceDateTo', $event)">
      </label>
    </form>

    <p class="resources-list__summary" aria-live="polite">현재 페이지 {{ items.length }}개</p>
    <AppState v-if="loading" variant="loading" message="학과 자원과 출처 기준일을 확인하고 있습니다." />
    <div v-else-if="errorMessage" class="resources-list__state">
      <AppState variant="error" :message="errorMessage" />
      <button type="button" data-action="retry" @click="loadResources">다시 시도</button>
    </div>
    <AppState v-else-if="items.length === 0" variant="empty" message="조건에 맞는 학과 자원이 없습니다. 필터를 조정해 보세요." />
    <template v-else>
      <div class="resources-list__table-wrap">
        <table aria-label="학과 자원 목록">
          <thead><tr><th scope="col">제목</th><th scope="col">유형</th><th scope="col">상태</th><th scope="col">공개</th><th scope="col">기준일</th><th scope="col">수정</th><th scope="col">기본 태그</th></tr></thead>
          <tbody>
            <tr v-for="resource in items" :key="resource.id">
              <th scope="row"><NuxtLink data-resource-link :to="{ path: `/admin/resources/${resource.id}`, query: { returnTo: safeListUrl } }">{{ resource.title }}</NuxtLink></th>
              <td>{{ typeLabels[resource.type] }}</td><td>{{ statusLabels[resource.status] }}</td><td>{{ visibilityLabels[resource.visibility] }}</td>
              <td><time v-if="resource.sourceDate" :datetime="resource.sourceDate">{{ resource.sourceDate }}</time><span v-else>미입력</span></td>
              <td><time :datetime="resource.updatedAt">{{ formatUpdatedAt(resource.updatedAt) }}</time></td><td><code>{{ primaryTag(resource) }}</code></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="resources-list__cards" aria-label="모바일 학과 자원 목록">
        <article v-for="resource in items" :key="resource.id" data-resource-card>
          <h2><NuxtLink data-resource-link :to="{ path: `/admin/resources/${resource.id}`, query: { returnTo: safeListUrl } }">{{ resource.title }}</NuxtLink></h2>
          <dl>
            <div><dt>유형</dt><dd>{{ typeLabels[resource.type] }}</dd></div>
            <div><dt>상태</dt><dd>{{ statusLabels[resource.status] }}</dd></div>
            <div><dt>공개</dt><dd>{{ visibilityLabels[resource.visibility] }}</dd></div>
            <div><dt>기준일</dt><dd>{{ resource.sourceDate ?? '미입력' }}</dd></div>
            <div><dt>수정</dt><dd>{{ formatUpdatedAt(resource.updatedAt) }}</dd></div>
            <div><dt>기본 태그</dt><dd><code>{{ primaryTag(resource) }}</code></dd></div>
          </dl>
        </article>
      </div>

      <nav v-if="nextTarget" class="resources-list__pagination" aria-label="학과 자원 목록 페이지">
        <NuxtLink data-next-page :to="nextTarget">다음 자원 보기</NuxtLink>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.resources-list { display: grid; gap: 1.25rem; }
.resources-list__header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 1rem; }
.resources-list__header > div { max-width: 52rem; }
.resources-list__eyebrow { margin: 0 0 0.625rem; color: var(--color-resource); font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.08em; }
.resources-list h1 { margin: 0; font-family: var(--font-display); font-size: clamp(1.75rem, 4vw, 2rem); letter-spacing: -0.05em; }
.resources-list__header p:last-child { margin: 0.75rem 0 0; color: color-mix(in srgb, var(--color-ink) 68%, transparent); }
.resources-list :is(input, select, button) { min-height: var(--touch-target); border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-ink); padding: 0.625rem; }
.resources-list button { cursor: pointer; font-family: var(--font-display); font-weight: 700; }
.resources-list :is(input, select, button, a):focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 2px; }
.resources-list__filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.75rem; border-top: 0.25rem solid var(--color-resource); background: var(--color-surface); padding: 1rem; }
.resources-list__filters label { display: grid; gap: 0.35rem; font-size: 0.8125rem; font-weight: 650; }
.resources-list__query { grid-column: span 2; }
.resources-list__summary { margin: 0; color: color-mix(in srgb, var(--color-ink) 65%, transparent); font-family: var(--font-mono); font-size: 0.75rem; }
.resources-list__state { display: grid; justify-items: start; gap: 0.75rem; }
.resources-list__table-wrap { overflow-x: auto; background: var(--color-surface); }
.resources-list table { width: 100%; border-collapse: collapse; }
.resources-list :is(th, td) { border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 13%, transparent); padding: 0.75rem; text-align: left; white-space: nowrap; }
.resources-list thead th { font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.04em; }
.resources-list a { color: var(--color-resource); font-weight: 700; }
.resources-list__cards { display: none; }
.resources-list__pagination { display: flex; justify-content: flex-end; }
.resources-list__pagination a { min-height: var(--touch-target); display: inline-flex; align-items: center; border: 1px solid var(--color-resource); background: var(--color-surface); padding: 0.625rem 1rem; text-decoration: none; }
@media (max-width: 44.99rem) {
  .resources-list__query { grid-column: auto; }
  .resources-list__table-wrap { display: none; }
  .resources-list__cards { display: grid; gap: 0.75rem; }
  .resources-list__cards article { border: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent); background: var(--color-surface); padding: 1rem; }
  .resources-list__cards h2 { margin: 0; font-family: var(--font-display); font-size: 1.1rem; }
  .resources-list__cards dl { display: grid; gap: 0.4rem; margin-bottom: 0; }
  .resources-list__cards dl div { display: grid; grid-template-columns: 6rem 1fr; gap: 0.5rem; }
  .resources-list__cards dt { color: color-mix(in srgb, var(--color-ink) 60%, transparent); }
  .resources-list__cards dd { margin: 0; }
}
@media (prefers-reduced-motion: reduce) { .resources-list * { scroll-behavior: auto !important; } }
</style>
