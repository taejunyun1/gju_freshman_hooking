<script setup lang="ts">
import { z } from 'zod'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  adminFacultyConsultationRoles,
  adminFacultyEmploymentTypes,
  adminFacultyListItemSchema,
  adminFacultyStatuses,
  type AdminFacultyListItem,
} from '../../../../shared/schemas/admin-faculty'
import type { ApiSuccess } from '../../../../shared/types/api'
import AppState from '../../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const router = useRouter()
const adminSession = useAdminSessionStore()
const items = ref<AdminFacultyListItem[]>([])
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
  'query', 'employmentType', 'consultationRole', 'status', 'tag', 'limit',
] as const
type FilterKey = typeof filterKeys[number]

const facultyListSchema = z.object({
  items: z.array(adminFacultyListItemSchema).max(50),
  nextCursor: z.string().min(1).max(200).nullable(),
}).strict()

const employmentLabels: Record<AdminFacultyListItem['employmentType'], string> = {
  full_time: '전임',
  adjunct: '겸임',
  practitioner: '현장 전문가',
}
const consultationLabels: Record<AdminFacultyListItem['consultationRole'], string> = {
  primary: '주 상담',
  specialist: '전문 상담',
}
const statusLabels: Record<AdminFacultyListItem['status'], string> = {
  draft: '초안',
  active: '운영',
  archived: '보관',
}

const hasControlCharacters = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
})

const routeString = (key: string): string => {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

const allowedValue = (key: FilterKey, value: string): string => {
  if (!value || value !== value.trim() || hasControlCharacters(value)) return ''
  if (key === 'query') return value.length <= 100 ? value : ''
  if (key === 'employmentType') {
    return adminFacultyEmploymentTypes.includes(value as typeof adminFacultyEmploymentTypes[number])
      ? value
      : ''
  }
  if (key === 'consultationRole') {
    return adminFacultyConsultationRoles.includes(value as typeof adminFacultyConsultationRoles[number])
      ? value
      : ''
  }
  if (key === 'status') {
    return adminFacultyStatuses.includes(value as typeof adminFacultyStatuses[number]) ? value : ''
  }
  if (key === 'tag') return /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : ''
  return /^(?:[1-9]|[1-4][0-9]|50)$/u.test(value) ? value : ''
}

const cursorValue = (): string => {
  const value = routeString('cursor')
  return value.length <= 200 && value === value.trim() && !hasControlCharacters(value) ? value : ''
}

const apiQuery = (): Record<string, string> => {
  const query: Record<string, string> = {}
  for (const key of filterKeys) {
    const value = allowedValue(key, routeString(key))
    if (value) query[key] = value
  }
  if (!query.limit) query.limit = '20'
  const cursor = cursorValue()
  if (cursor) query.cursor = cursor
  return query
}

const safeListUrl = computed(() => {
  const fallback = '/admin/faculty'
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
  ? { path: '/admin/faculty', query: { ...apiQuery(), cursor: nextCursor.value } }
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

const loadFaculty = async (): Promise<void> => {
  const thisRequest = ++requestVersion
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<unknown>>('/api/admin/faculty', {
      headers: adminSession.authorizationHeaders(),
      query: apiQuery(),
    })
    if (!active || thisRequest !== requestVersion) return
    const parsed = facultyListSchema.parse(response.data)
    items.value = parsed.items
    nextCursor.value = parsed.nextCursor
  }
  catch (error) {
    if (!active || thisRequest !== requestVersion) return
    items.value = []
    nextCursor.value = null
    if (!await recoverAuthentication(error)) {
      errorMessage.value = '교수진 운영 목록을 불러오지 못했습니다. 세션과 필터를 확인한 뒤 다시 시도하세요.'
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
  const normalized = allowedValue(key, value.trim())
  if (normalized) query[key] = normalized
  await router.replace({ path: '/admin/faculty', query })
}

const filterChanged = (key: Exclude<FilterKey, 'query' | 'limit'>, event: Event) => {
  void replaceFilter(key, (event.target as HTMLInputElement | HTMLSelectElement).value)
}

const formatTimestamp = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'short',
  hour12: false,
}).format(new Date(value))

const capacityMax = (faculty: AdminFacultyListItem): number => Math.max(
  faculty.weeklyCapacity,
  faculty.openAssignedCount,
  1,
)

onMounted(() => {
  stopQueryWatch = watch(queryText, (value) => {
    if (value === allowedValue('query', routeString('query'))) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { void replaceFilter('query', value) }, 350)
  })
  stopRouteWatch = watch(() => route.fullPath, () => {
    const routeQuery = allowedValue('query', routeString('query'))
    if (queryText.value !== routeQuery) queryText.value = routeQuery
    void loadFaculty()
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
  <section class="faculty-list" aria-labelledby="faculty-list-title">
    <header class="faculty-list__header">
      <div>
        <p class="faculty-list__eyebrow">ASSIGNMENT LEDGER / FACULTY REVIEW</p>
        <h1 id="faculty-list-title">교수진 추천 운영</h1>
        <p>상담 역할과 배정 여유, 검증 상태를 한눈에 확인합니다.</p>
      </div>
      <button type="button" :disabled="loading" @click="loadFaculty">
        새로고침
      </button>
    </header>

    <form class="faculty-list__filters" aria-label="교수진 목록 필터" @submit.prevent>
      <fieldset>
        <legend>목록 필터</legend>
        <label class="faculty-list__query">검색
          <input
            v-model="queryText"
            name="query"
            type="search"
            maxlength="100"
            placeholder="이름이나 직위"
          >
        </label>
        <label>고용 형태
          <select
            :value="allowedValue('employmentType', routeString('employmentType'))"
            name="employmentType"
            @change="filterChanged('employmentType', $event)"
          >
            <option value="">전체</option>
            <option v-for="employment in adminFacultyEmploymentTypes" :key="employment" :value="employment">
              {{ employmentLabels[employment] }}
            </option>
          </select>
        </label>
        <label>상담 역할
          <select
            :value="allowedValue('consultationRole', routeString('consultationRole'))"
            name="consultationRole"
            @change="filterChanged('consultationRole', $event)"
          >
            <option value="">전체</option>
            <option v-for="role in adminFacultyConsultationRoles" :key="role" :value="role">
              {{ consultationLabels[role] }}
            </option>
          </select>
        </label>
        <label>상태
          <select
            :value="allowedValue('status', routeString('status'))"
            name="status"
            @change="filterChanged('status', $event)"
          >
            <option value="">전체</option>
            <option v-for="status in adminFacultyStatuses" :key="status" :value="status">
              {{ statusLabels[status] }}
            </option>
          </select>
        </label>
        <label>태그
          <input
            :value="allowedValue('tag', routeString('tag'))"
            name="tag"
            pattern="[a-z][a-z0-9_]*"
            maxlength="64"
            placeholder="art_photo"
            @change="filterChanged('tag', $event)"
          >
        </label>
      </fieldset>
    </form>

    <p class="faculty-list__summary" aria-live="polite">
      현재 페이지 {{ items.length }}명
    </p>
    <AppState
      v-if="loading"
      variant="loading"
      message="교수진의 배정 여유와 최근 검증 시점을 확인하고 있습니다."
    />
    <div v-else-if="errorMessage" class="faculty-list__state">
      <AppState variant="error" :message="errorMessage" />
      <button type="button" data-action="retry" @click="loadFaculty">
        다시 시도
      </button>
    </div>
    <AppState
      v-else-if="items.length === 0"
      variant="empty"
      message="조건에 맞는 교수진이 없습니다. 검색어나 필터를 조정해 보세요."
    />
    <template v-else>
      <div class="faculty-list__table-wrap">
        <table aria-label="교수진 운영 목록">
          <thead>
            <tr>
              <th scope="col">교수진</th>
              <th scope="col">고용·상담</th>
              <th scope="col">상태</th>
              <th scope="col">배정 여유</th>
              <th scope="col">기본 태그</th>
              <th scope="col">최근 검증</th>
              <th scope="col">수정</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="faculty in items" :key="faculty.id">
              <th scope="row">
                <NuxtLink
                  data-faculty-link
                  :to="{ path: `/admin/faculty/${faculty.id}`, query: { returnTo: safeListUrl } }"
                >
                  <span>{{ faculty.name }}</span>
                  <small>{{ faculty.title }}</small>
                </NuxtLink>
              </th>
              <td>
                {{ employmentLabels[faculty.employmentType] }}
                <small>{{ consultationLabels[faculty.consultationRole] }}</small>
              </td>
              <td><span class="faculty-list__status">{{ statusLabels[faculty.status] }}</span></td>
              <td>
                <div class="faculty-list__capacity">
                  <span :aria-label="`배정 가능 ${faculty.openAssignedCount}명, 주간 정원 ${faculty.weeklyCapacity}명`">
                    {{ faculty.openAssignedCount }} / {{ faculty.weeklyCapacity }}
                  </span>
                  <meter
                    :value="faculty.openAssignedCount"
                    :max="capacityMax(faculty)"
                    aria-hidden="true"
                  />
                </div>
              </td>
              <td>
                <ul v-if="faculty.primaryTags.length" class="faculty-list__tags">
                  <li v-for="tag in faculty.primaryTags" :key="`${tag.category}:${tag.key}`">{{ tag.label }}</li>
                </ul>
                <span v-else>미지정</span>
              </td>
              <td>
                <time v-if="faculty.lastVerifiedAt" :datetime="faculty.lastVerifiedAt">
                  {{ formatTimestamp(faculty.lastVerifiedAt) }}
                </time>
                <span v-else>미검증</span>
              </td>
              <td><time :datetime="faculty.updatedAt">{{ formatTimestamp(faculty.updatedAt) }}</time></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="faculty-list__cards" aria-label="모바일 교수진 운영 목록">
        <article v-for="faculty in items" :key="faculty.id" data-faculty-card>
          <h2>
            <NuxtLink
              data-faculty-link
              :to="{ path: `/admin/faculty/${faculty.id}`, query: { returnTo: safeListUrl } }"
            >
              {{ faculty.name }}
            </NuxtLink>
          </h2>
          <dl>
            <div><dt>직위</dt><dd>{{ faculty.title }}</dd></div>
            <div><dt>고용 형태</dt><dd>{{ employmentLabels[faculty.employmentType] }}</dd></div>
            <div><dt>상담 역할</dt><dd>{{ consultationLabels[faculty.consultationRole] }}</dd></div>
            <div><dt>상태</dt><dd>{{ statusLabels[faculty.status] }}</dd></div>
            <div>
              <dt>배정 여유</dt>
              <dd>
                <span :aria-label="`배정 가능 ${faculty.openAssignedCount}명, 주간 정원 ${faculty.weeklyCapacity}명`">
                  {{ faculty.openAssignedCount }} / {{ faculty.weeklyCapacity }}
                </span>
              </dd>
            </div>
            <div>
              <dt>기본 태그</dt>
              <dd>{{ faculty.primaryTags.map(tag => tag.label).join(', ') || '미지정' }}</dd>
            </div>
            <div>
              <dt>최근 검증</dt>
              <dd>
                <time v-if="faculty.lastVerifiedAt" :datetime="faculty.lastVerifiedAt">
                  {{ formatTimestamp(faculty.lastVerifiedAt) }}
                </time>
                <span v-else>미검증</span>
              </dd>
            </div>
            <div><dt>수정</dt><dd><time :datetime="faculty.updatedAt">{{ formatTimestamp(faculty.updatedAt) }}</time></dd></div>
          </dl>
        </article>
      </div>

      <nav v-if="nextTarget" class="faculty-list__pagination" aria-label="교수진 목록 페이지">
        <NuxtLink data-next-page :to="nextTarget">다음 교수진 보기</NuxtLink>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.faculty-list {
  min-width: 0;
  display: grid;
  gap: 1.25rem;
}

.faculty-list__header {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
}

.faculty-list__header > div { max-width: 52rem; }
.faculty-list__eyebrow {
  margin: 0 0 0.625rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.faculty-list h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2rem, 6vw, 3.25rem);
  letter-spacing: -0.05em;
}

.faculty-list__header p:last-child {
  margin: 0.75rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
}

.faculty-list :is(input, select, button) {
  min-width: 0;
  min-height: var(--touch-target);
  border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
  border-radius: 0;
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.625rem;
}

.faculty-list button {
  cursor: pointer;
  font-family: var(--font-display);
  font-weight: 700;
}

.faculty-list :is(input, select, button, a):focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 2px;
}

.faculty-list__filters {
  border-top: 0.25rem solid var(--color-sequence);
  background: var(--color-surface);
  padding: 1rem;
}

.faculty-list__filters fieldset {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
  gap: 0.75rem;
  margin: 0;
  border: 0;
  padding: 0;
}

.faculty-list__filters legend {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.faculty-list__filters label {
  min-width: 0;
  display: grid;
  gap: 0.35rem;
  font-size: 0.8125rem;
  font-weight: 650;
}

.faculty-list__filters :is(input, select) { width: 100%; }
.faculty-list__query { grid-column: span 2; }
.faculty-list__summary {
  margin: 0;
  color: color-mix(in srgb, var(--color-ink) 65%, transparent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.faculty-list__state {
  display: grid;
  justify-items: start;
  gap: 0.75rem;
}

.faculty-list__table-wrap {
  min-width: 0;
  overflow-x: auto;
  background: var(--color-surface);
}

.faculty-list table {
  width: 100%;
  border-collapse: collapse;
}

.faculty-list :is(th, td) {
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 13%, transparent);
  padding: 0.75rem;
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}

.faculty-list thead th {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
}

.faculty-list td small,
.faculty-list [data-faculty-link] small {
  display: block;
  margin-top: 0.2rem;
  color: color-mix(in srgb, var(--color-ink) 58%, transparent);
  font-size: 0.75rem;
  font-weight: 500;
}

.faculty-list a {
  color: var(--color-sequence);
  font-weight: 700;
}

.faculty-list [data-faculty-link] {
  min-height: var(--touch-target);
  display: inline-flex;
  flex-direction: column;
  justify-content: center;
}

.faculty-list__status {
  display: inline-flex;
  border: 1px solid currentColor;
  padding: 0.2rem 0.45rem;
  font-size: 0.75rem;
  font-weight: 700;
}

.faculty-list__capacity {
  display: grid;
  gap: 0.35rem;
  min-width: 6.5rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 700;
}

.faculty-list__capacity meter {
  width: 100%;
  height: 0.35rem;
  accent-color: var(--color-sequence);
}

.faculty-list__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.faculty-list__tags li {
  border: 1px solid color-mix(in srgb, var(--color-sequence) 45%, transparent);
  padding: 0.2rem 0.4rem;
  font-size: 0.75rem;
}

.faculty-list__cards { display: none; }
.faculty-list__pagination { display: flex; justify-content: flex-end; }
.faculty-list__pagination a {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-sequence);
  background: var(--color-surface);
  padding: 0.625rem 1rem;
  text-decoration: none;
}

@media (max-width: 44.99rem) {
  .faculty-list__query { grid-column: auto; }
  .faculty-list__table-wrap { display: none; }
  .faculty-list__cards { display: grid; gap: 0.75rem; }
  .faculty-list__cards article {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
    border-left: 0.25rem solid var(--color-sequence);
    background: var(--color-surface);
    padding: 1rem;
  }

  .faculty-list__cards h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.1rem;
  }

  .faculty-list__cards dl { display: grid; gap: 0.45rem; margin-bottom: 0; }
  .faculty-list__cards dl div {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(5.5rem, 0.45fr) minmax(0, 1fr);
    gap: 0.5rem;
  }

  .faculty-list__cards dt { color: color-mix(in srgb, var(--color-ink) 60%, transparent); }
  .faculty-list__cards dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
}

@media (prefers-reduced-motion: reduce) {
  .faculty-list * { scroll-behavior: auto !important; }
}
</style>
