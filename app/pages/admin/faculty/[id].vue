<script setup lang="ts">
import { z } from 'zod'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  adminFacultyPreviewSchema,
  adminFacultySchema,
  type AdminFaculty,
  type AdminFacultyPreview,
  type AdminFacultyWrite,
} from '../../../../shared/schemas/admin-faculty'
import type { ApiSuccess } from '../../../../shared/types/api'
import FacultyEditor from '../../../components/admin/FacultyEditor.vue'
import AppState from '../../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

type SavePayload = { expectedUpdatedAt: string, faculty: AdminFacultyWrite }
type PreviewPayload = { faculty: AdminFacultyWrite }
type PublishPayload = { facultyId: number, expectedUpdatedAt: string }
type LaneKind = 'save' | 'preview' | 'publish'
type Lane = { kind: LaneKind, epoch: number, version: number, id: number }

const detailSchema = z.object({ faculty: adminFacultySchema }).strict()
const canonicalScenarios = [
  { key: 'social_photo_story', label: '사회 포토스토리', trackEvidence: 'documentary' },
  { key: 'local_archive', label: '지역 아카이브', trackEvidence: 'documentary' },
  { key: 'video_drone', label: '영상·드론', trackEvidence: 'video' },
  { key: 'commercial_fashion', label: '광고·패션', trackEvidence: 'commercial' },
] as const

const route = useRoute()
const adminSession = useAdminSessionStore()
const faculty = ref<AdminFaculty | null>(null)
const proof = ref<AdminFacultyPreview | null>(null)
const facultyConflict = ref<AdminFaculty | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const previewError = ref('')
const saveMessage = ref('')
const publishMessage = ref('')
const saving = ref(false)
const previewing = ref(false)
const publishing = ref(false)
let active = true
let routeEpoch = 0
const laneVersions: Record<LaneKind, number> = { save: 0, preview: 0, publish: 0 }
let stopFacultyWatch: (() => void) | undefined

const hasControlCharacters = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
})
const facultyId = computed(() => {
  const value = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
  return /^(?:[1-9][0-9]{0,15})$/u.test(String(value)) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : 0
})
const safeLocalUrl = (value: unknown, expectedPath: string, fallback: string): string => {
  if (typeof value !== 'string' || value.length > 2_000 || hasControlCharacters(value)) return fallback
  try {
    const parsed = new URL(value, 'https://photo-next.invalid')
    return parsed.origin === 'https://photo-next.invalid' && parsed.pathname === expectedPath
      ? `${parsed.pathname}${parsed.search}`
      : fallback
  }
  catch { return fallback }
}
const listUrl = computed(() => safeLocalUrl(route.query.returnTo, '/admin/faculty', '/admin/faculty'))
const loginRedirect = computed(() => safeLocalUrl(
  route.fullPath,
  `/admin/faculty/${facultyId.value}`,
  `/admin/faculty/${facultyId.value}`,
))
const statusMessage = computed(() => publishMessage.value || saveMessage.value)

const errorPayload = (error: unknown): { code: string, current?: unknown } => {
  if (typeof error !== 'object' || error === null) return { code: '' }
  const data = (error as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return { code: '' }
  const failure = (data as { error?: unknown }).error
  if (typeof failure !== 'object' || failure === null) return { code: '' }
  const record = failure as { code?: unknown, current?: unknown }
  return {
    code: typeof record.code === 'string' ? record.code : '',
    ...(record.current === undefined ? {} : { current: record.current }),
  }
}
const recoverAuthentication = async (error: unknown): Promise<boolean> => {
  if (!['ADMIN_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'].includes(errorPayload(error).code)) return false
  adminSession.clear()
  await navigateTo({ path: '/admin/login', query: { redirect: loginRedirect.value } }, { replace: true })
  return true
}

const decodeFaculty = (input: unknown, expectedId: number): AdminFaculty => {
  const decoded = detailSchema.parse(input).faculty
  if (decoded.id !== expectedId) throw new Error('ADMIN_FACULTY_ENDPOINT_MISMATCH')
  return decoded
}
const decodePreview = (input: unknown): AdminFacultyPreview => {
  const decoded = adminFacultyPreviewSchema.parse(input)
  const canonical = decoded.scenarios.every((scenario, index) => {
    const expected = canonicalScenarios[index]
    return expected !== undefined
      && scenario.key === expected.key
      && scenario.label === expected.label
      && scenario.trackEvidence === expected.trackEvidence
  })
  if (!canonical) throw new Error('ADMIN_FACULTY_PREVIEW_ORDER_INVALID')
  return decoded
}
const decodeConflict = (error: unknown, expectedId: number): AdminFaculty | null => {
  const failure = errorPayload(error)
  if (failure.code !== 'FACULTY_CONFLICT') return null
  const current = adminFacultySchema.safeParse(failure.current)
  return current.success && current.data.id === expectedId ? current.data : null
}

const timestampInstant = (value: string): { seconds: number, fraction: string } => {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value)
  if (!match) throw new Error('ADMIN_FACULTY_TIMESTAMP_INVALID')
  const milliseconds = Date.parse(`${match[1]}${match[3]}`)
  if (!Number.isFinite(milliseconds)) throw new Error('ADMIN_FACULTY_TIMESTAMP_INVALID')
  return { seconds: milliseconds / 1_000, fraction: match[2] ?? '' }
}
const compareTimestamps = (leftValue: string, rightValue: string): number => {
  const left = timestampInstant(leftValue)
  const right = timestampInstant(rightValue)
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1
  const length = Math.max(left.fraction.length, right.fraction.length)
  const leftFraction = left.fraction.padEnd(length, '0')
  const rightFraction = right.fraction.padEnd(length, '0')
  return leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1
}
const applyFaculty = (candidate: AdminFaculty): void => {
  if (faculty.value && compareTimestamps(candidate.updatedAt, faculty.value.updatedAt) < 0) return
  faculty.value = candidate
}

const invalidateRequests = (): number => {
  routeEpoch += 1
  laneVersions.save += 1
  laneVersions.preview += 1
  laneVersions.publish += 1
  return routeEpoch
}
const isCurrentRoute = (epoch: number, id: number): boolean => (
  active && epoch === routeEpoch && id === facultyId.value
)
const beginLane = (kind: LaneKind): Lane => ({
  kind,
  epoch: routeEpoch,
  version: ++laneVersions[kind],
  id: facultyId.value,
})
const isCurrentLane = (lane: Lane): boolean => (
  isCurrentRoute(lane.epoch, lane.id) && lane.version === laneVersions[lane.kind]
)

const loadFaculty = async (): Promise<void> => {
  const epoch = invalidateRequests()
  const id = facultyId.value
  loading.value = true
  errorMessage.value = ''
  previewError.value = ''
  saveMessage.value = ''
  publishMessage.value = ''
  faculty.value = null
  proof.value = null
  facultyConflict.value = null
  saving.value = false
  previewing.value = false
  publishing.value = false
  if (id === 0) {
    errorMessage.value = '교수진 번호를 확인할 수 없습니다. 목록에서 다시 선택하세요.'
    loading.value = false
    return
  }
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/faculty/${id}`, {
      headers: adminSession.authorizationHeaders(),
    })
    if (!isCurrentRoute(epoch, id)) return
    faculty.value = decodeFaculty(response.data, id)
  }
  catch (error) {
    if (!isCurrentRoute(epoch, id)) return
    if (!await recoverAuthentication(error)) {
      errorMessage.value = '교수진 상세를 불러오지 못했습니다. 목록에서 다시 선택하거나 다시 시도하세요.'
    }
  }
  finally {
    if (isCurrentRoute(epoch, id)) loading.value = false
  }
}

const applyMutationFailure = async (error: unknown, lane: Lane, kind: 'save' | 'publish'): Promise<void> => {
  if (!isCurrentLane(lane)) return
  if (await recoverAuthentication(error)) return
  const current = decodeConflict(error, lane.id)
  if (current) {
    facultyConflict.value = current
    const message = '다른 관리자가 먼저 변경했습니다. 현재 편집은 보존되며 서버 최신본은 직접 적용해야 합니다.'
    if (kind === 'save') saveMessage.value = message
    else publishMessage.value = message
    return
  }
  if (kind === 'save') saveMessage.value = '변경 내용을 저장하지 못했습니다. 입력값과 연결 상태를 확인해 주세요.'
  else publishMessage.value = '게시하지 못했습니다. 검증·용량·태그 이슈를 확인해 주세요.'
}

const saveFaculty = async (payload: SavePayload): Promise<void> => {
  if (saving.value || publishing.value) return
  const lane = beginLane('save')
  saving.value = true
  saveMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/faculty/${lane.id}`, {
      method: 'PUT',
      headers: adminSession.authorizationHeaders(),
      body: { expectedUpdatedAt: payload.expectedUpdatedAt, faculty: payload.faculty },
    })
    if (!isCurrentLane(lane)) return
    applyFaculty(decodeFaculty(response.data, lane.id))
    facultyConflict.value = null
    saveMessage.value = '변경 내용을 저장했습니다.'
  }
  catch (error) { await applyMutationFailure(error, lane, 'save') }
  finally { if (isCurrentLane(lane)) saving.value = false }
}

const previewFailureMessage = (code: string): string => {
  if (code === 'FACULTY_CONTENT_NOT_READY') return '게시 준비 중인 교수진 내용·용량·전문 연계를 확인한 뒤 다시 미리보기하세요.'
  if (code === 'FACULTY_INVALID') return '입력 검증 항목을 수정한 뒤 다시 미리보기하세요.'
  return '추천 미리보기를 완성하지 못했습니다. 사회 포토스토리부터 네 시나리오 순서와 게시 준비 상태를 확인하세요.'
}
const previewFaculty = async (payload: PreviewPayload): Promise<void> => {
  const lane = beginLane('preview')
  previewing.value = true
  previewError.value = ''
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/faculty/${lane.id}/preview`, {
      method: 'POST', headers: adminSession.authorizationHeaders(), body: { faculty: payload.faculty },
    })
    if (!isCurrentLane(lane)) return
    proof.value = decodePreview(response.data)
  }
  catch (error) {
    if (!isCurrentLane(lane)) return
    if (!await recoverAuthentication(error)) previewError.value = previewFailureMessage(errorPayload(error).code)
  }
  finally { if (isCurrentLane(lane)) previewing.value = false }
}

const publishFaculty = async (payload: PublishPayload): Promise<void> => {
  if (saving.value || publishing.value || payload.facultyId !== facultyId.value) return
  const lane = beginLane('publish')
  publishing.value = true
  publishMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/faculty/${lane.id}/publish`, {
      method: 'POST', headers: adminSession.authorizationHeaders(), body: { expectedUpdatedAt: payload.expectedUpdatedAt },
    })
    if (!isCurrentLane(lane)) return
    applyFaculty(decodeFaculty(response.data, lane.id))
    facultyConflict.value = null
    publishMessage.value = '교수진 정보를 학생 추천에 게시했습니다.'
  }
  catch (error) { await applyMutationFailure(error, lane, 'publish') }
  finally { if (isCurrentLane(lane)) publishing.value = false }
}

const applyFacultyConflict = (): void => {
  const current = facultyConflict.value
  if (!current || current.id !== facultyId.value) return
  faculty.value = current
  facultyConflict.value = null
  saveMessage.value = '서버 최신본을 편집 기준으로 적용했습니다.'
  publishMessage.value = ''
}

onMounted(() => {
  stopFacultyWatch = watch(facultyId, () => { void loadFaculty() }, { immediate: true })
})
onBeforeUnmount(() => {
  active = false
  invalidateRequests()
  stopFacultyWatch?.()
})
</script>

<template>
  <section class="faculty-detail" aria-labelledby="faculty-detail-title">
    <NuxtLink data-action="back-to-faculty" class="faculty-detail__back" :to="listUrl">← 교수진 목록으로</NuxtLink>

    <header class="faculty-detail__header">
      <div>
        <p v-if="faculty">FACULTY / #{{ String(faculty.id).padStart(6, '0') }} / {{ faculty.status.toUpperCase() }}</p>
        <p v-else>FACULTY / RECOMMENDATION REVIEW</p>
        <h1 id="faculty-detail-title">{{ faculty?.name ?? '교수진 상세' }}</h1>
        <p>{{ faculty?.expertiseSummary ?? '교수 프로필과 네 가지 고정 추천 시나리오를 함께 검수합니다.' }}</p>
      </div>
      <dl v-if="faculty">
        <div><dt>상태</dt><dd>{{ faculty.status }}</dd></div>
        <div><dt>검증</dt><dd>{{ faculty.lastVerifiedAt ?? '미검증' }}</dd></div>
        <div><dt>버전</dt><dd><time :datetime="faculty.updatedAt">{{ faculty.updatedAt }}</time></dd></div>
      </dl>
    </header>

    <AppState v-if="loading" variant="loading" message="교수진 상세를 불러오고 있습니다." />
    <div v-else-if="errorMessage" class="faculty-detail__state">
      <AppState variant="error" :message="errorMessage" />
      <button type="button" data-action="retry" @click="loadFaculty">다시 시도</button>
    </div>

    <template v-else-if="faculty">
      <section v-if="facultyConflict" data-faculty-conflict class="faculty-detail__conflict" role="alert" aria-labelledby="faculty-conflict-title">
        <h2 id="faculty-conflict-title">서버 최신 교수진 정보</h2>
        <dl>
          <div><dt>이름</dt><dd>{{ facultyConflict.name }}</dd></div>
          <div><dt>직함</dt><dd>{{ facultyConflict.title }}</dd></div>
          <div><dt>버전</dt><dd>{{ facultyConflict.updatedAt }}</dd></div>
        </dl>
        <p>현재 편집본은 그대로 보존됩니다. 서버 최신본으로 바꾸려면 아래 동작을 직접 선택하세요.</p>
        <button type="button" data-action="apply-faculty-conflict" @click="applyFacultyConflict">서버 최신본 적용</button>
      </section>

      <FacultyEditor
        :faculty="faculty"
        :preview="proof"
        :preview-error="previewError"
        :previewing="previewing"
        :saving="saving"
        :publishing="publishing"
        :has-conflict="facultyConflict !== null"
        :status-message="statusMessage"
        @save="saveFaculty"
        @preview="previewFaculty"
        @publish="publishFaculty"
      />
    </template>
  </section>
</template>

<style scoped>
.faculty-detail { min-width: 0; display: grid; gap: 1.25rem; }
.faculty-detail__back { min-height: var(--touch-target); display: inline-flex; width: fit-content; align-items: center; color: var(--color-sequence); font-weight: 700; text-decoration: none; }
.faculty-detail__header { min-width: 0; display: grid; gap: 1rem; border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent); padding-bottom: 1rem; }
.faculty-detail__header > div > p:first-child { margin: 0 0 0.5rem; color: var(--color-sequence); font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.08em; }
.faculty-detail h1 { margin: 0; font-family: var(--font-display); font-size: clamp(2rem, 6vw, 3.25rem); letter-spacing: -0.05em; overflow-wrap: anywhere; }
.faculty-detail__header > div > p:last-child { max-width: 54rem; margin-bottom: 0; color: color-mix(in srgb, var(--color-ink) 70%, transparent); }
.faculty-detail__header dl { min-width: 0; display: grid; gap: 0.45rem; margin: 0; border-left: 0.25rem solid var(--color-sequence); background: var(--color-surface); padding: 0.75rem; font-family: var(--font-mono); font-size: 0.6875rem; }
.faculty-detail__header dl div, .faculty-detail__conflict dl div { min-width: 0; display: grid; grid-template-columns: 4rem minmax(0, 1fr); gap: 0.5rem; }
.faculty-detail dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.faculty-detail__state { display: grid; justify-items: start; gap: 0.75rem; }
.faculty-detail :is(button, a):focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 2px; }
.faculty-detail button { min-height: var(--touch-target); border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent); border-radius: 0; background: var(--color-surface); color: var(--color-ink); padding: 0.625rem; font-family: var(--font-display); font-weight: 700; }
.faculty-detail__conflict { display: grid; justify-items: start; gap: 0.75rem; border: 1px solid var(--color-signal); border-left-width: 0.25rem; background: color-mix(in srgb, var(--color-signal) 8%, var(--color-surface)); padding: 1rem; }
.faculty-detail__conflict :is(h2, p, dl) { margin: 0; }
.faculty-detail__conflict dl { display: grid; gap: 0.35rem; font-family: var(--font-mono); font-size: 0.75rem; }
@media (min-width: 52rem) {
  .faculty-detail__header { grid-template-columns: minmax(0, 1fr) minmax(17rem, 0.42fr); align-items: end; }
}
@media (max-width: 24rem) {
  .faculty-detail__conflict { padding: 0.65rem; }
}
</style>
