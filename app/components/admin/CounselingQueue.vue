<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  adminCounselingCurrentSchema,
  type AdminCounselingCurrent,
  type AdminCounselingQueue,
  type AdminCounselingQueueItem,
} from '../../../shared/schemas/counseling'
import { trackLabels } from '../../../shared/types/domain'
import type { ApiSuccess } from '../../../shared/types/api'
import AppButton from '../common/AppButton.vue'
import { useAdminSessionStore } from '../../stores/admin-session'

const props = defineProps<{
  faculty: AdminCounselingQueue['faculty']
  items: AdminCounselingQueueItem[]
}>()

const emit = defineEmits<{ refresh: [] }>()

const adminSession = useAdminSessionStore()
const selectedFaculty = reactive<Record<string, string>>({})
const reopenReasons = reactive<Record<string, string>>({})
const currentSnapshots = reactive<Record<string, AdminCounselingCurrent>>({})
const revealedPhones = reactive<Record<string, string>>({})
const busyRequests = reactive<Record<string, boolean>>({})
const feedback = reactive<Record<string, string>>({})
const errorMessages = reactive<Record<string, string>>({})
const revealTimers = new Map<string, ReturnType<typeof setTimeout>>()
const reauthenticationOpen = ref(false)
const reauthenticationDialog = ref<HTMLDialogElement | null>(null)
const reauthenticationButton = ref<{ $el?: HTMLButtonElement } | null>(null)
let reauthenticationTrigger: HTMLElement | null = null
let active = true

const statusLabels = {
  new: '신규 접수',
  assigned: '배정 완료',
  contacted: '연락 완료',
  completed: '상담 완료',
  closed: '요청 종료',
} as const

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

const contactMethodLabels = { phone: '전화', text: '문자', visit: '방문' } as const
const availabilityLabels = {
  weekday_morning: '평일 오전',
  weekday_afternoon: '평일 오후',
  weekday_evening: '평일 저녁',
  weekend: '주말',
} as const

const roleLabels = { primary: '총괄', backup: '예비', specialist: '전문연계' } as const
const progressStatuses = ['new', 'assigned', 'contacted', 'completed', 'closed'] as const

const currentFor = (item: AdminCounselingQueueItem): AdminCounselingCurrent => (
  currentSnapshots[item.id] ?? item
)
const itemIsPresent = (id: string): boolean => props.items.some(item => item.id === id)
const finishBusyRequest = (id: string): void => {
  if (active && itemIsPresent(id)) busyRequests[id] = false
  else Reflect.deleteProperty(busyRequests, id)
}

const progressState = (
  item: AdminCounselingQueueItem,
  status: typeof progressStatuses[number],
): 'active' | 'done' | 'upcoming' => {
  const current = currentFor(item)
  if (current.status === status) return 'active'
  const timestamp = status === 'new'
    ? item.consentedAt
    : status === 'assigned'
      ? current.assignedAt
      : status === 'contacted'
        ? current.contactedAt
        : status === 'completed'
          ? current.completedAt
          : current.closedAt
  return timestamp === null ? 'upcoming' : 'done'
}

const formatDate = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(new Date(value))

const errorPayload = (error: unknown): { code?: unknown, current?: unknown } => {
  if (!error || typeof error !== 'object' || !('data' in error)) return {}
  const data = (error as { data?: unknown }).data
  if (!data || typeof data !== 'object' || !('error' in data)) return {}
  const apiError = (data as { error?: unknown }).error
  return apiError && typeof apiError === 'object' ? apiError : {}
}

const openReauthentication = async (): Promise<void> => {
  reauthenticationTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  reauthenticationOpen.value = true
  await nextTick()
  const dialog = reauthenticationDialog.value
  if (dialog && !dialog.open) {
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal()
      }
      catch {
        dialog.setAttribute('open', '')
      }
    }
    else {
      dialog.setAttribute('open', '')
    }
  }
  reauthenticationButton.value?.$el?.focus()
}

const closeReauthentication = async (): Promise<void> => {
  const dialog = reauthenticationDialog.value
  if (dialog?.open && typeof dialog.close === 'function') {
    try {
      dialog.close()
    }
    catch {
      dialog.removeAttribute('open')
    }
  }
  else {
    dialog?.removeAttribute('open')
  }
  reauthenticationOpen.value = false
  await nextTick()
  reauthenticationTrigger?.focus()
  reauthenticationTrigger = null
}

const trapReauthenticationFocus = (event: KeyboardEvent): void => {
  if (event.key !== 'Tab') return
  const dialog = reauthenticationDialog.value
  if (!dialog) return
  const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

const handleApiError = async (item: AdminCounselingQueueItem, error: unknown): Promise<void> => {
  const payload = errorPayload(error)
  if (payload.code === 'MFA_REQUIRED' || payload.code === 'REAUTH_REQUIRED') {
    await openReauthentication()
    return
  }

  if (payload.code === 'COUNSELING_CONFLICT') {
    const current = adminCounselingCurrentSchema.safeParse(payload.current)
    if (current.success) currentSnapshots[item.id] = current.data
    errorMessages[item.id] = '다른 관리자가 먼저 처리했습니다. 최신 상태를 불러옵니다.'
    emit('refresh')
    return
  }

  errorMessages[item.id] = '요청을 처리하지 못했습니다. 새로고침 후 다시 시도하세요.'
}

const mutate = async (
  item: AdminCounselingQueueItem,
  action: 'assign' | 'transition' | 'reopen',
  body: Record<string, unknown>,
): Promise<void> => {
  if (busyRequests[item.id]) return
  busyRequests[item.id] = true
  errorMessages[item.id] = ''
  feedback[item.id] = ''
  try {
    const response = await $fetch<ApiSuccess<AdminCounselingCurrent>>(
      `/api/admin/counseling/${item.id}/${action}`,
      {
        body,
        headers: adminSession.authorizationHeaders(),
        method: 'POST',
      },
    )
    if (!active || !itemIsPresent(item.id)) return
    currentSnapshots[item.id] = adminCounselingCurrentSchema.parse(response.data)
    feedback[item.id] = '상담 상태를 반영했습니다.'
    emit('refresh')
  }
  catch (error) {
    if (active && itemIsPresent(item.id)) await handleApiError(item, error)
  }
  finally {
    finishBusyRequest(item.id)
  }
}

const assign = async (item: AdminCounselingQueueItem): Promise<void> => {
  const facultyId = Number(selectedFaculty[item.id])
  if (!Number.isSafeInteger(facultyId) || facultyId <= 0) {
    errorMessages[item.id] = '배정할 교수를 선택하세요.'
    return
  }
  await mutate(item, 'assign', {
    assignedFacultyId: facultyId,
    expectedVersion: currentFor(item).version,
  })
}

const transition = async (
  item: AdminCounselingQueueItem,
  to: 'contacted' | 'completed' | 'closed',
): Promise<void> => {
  await mutate(item, 'transition', { expectedVersion: currentFor(item).version, to })
}

const closeRequest = async (item: AdminCounselingQueueItem): Promise<void> => {
  if (busyRequests[item.id]) return
  const currentStatus = statusLabels[currentFor(item).status]
  if (!window.confirm(`${item.nickname} 학생의 상담 상태를 ${currentStatus}에서 요청 종료로 변경할까요?`)) return
  await transition(item, 'closed')
}

const reopen = async (item: AdminCounselingQueueItem): Promise<void> => {
  if (busyRequests[item.id]) return
  const reason = reopenReasons[item.id]?.trim() ?? ''
  if (!reason) {
    errorMessages[item.id] = '재오픈 사유를 입력하세요.'
    return
  }
  if (!window.confirm(`${item.nickname} 학생의 상담 요청을 신규 접수 상태로 재오픈할까요?\n재오픈 사유: ${reason}`)) return
  await mutate(item, 'reopen', { expectedVersion: currentFor(item).version, reason })
}

const clearRevealedPhone = (id: string): void => {
  Reflect.deleteProperty(revealedPhones, id)
  const timer = revealTimers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  revealTimers.delete(id)
}

watch(() => props.items, (items) => {
  const incoming = new Map(items.map(item => [item.id, item]))
  for (const [id, snapshot] of Object.entries(currentSnapshots)) {
    const item = incoming.get(id)
    if (!item || item.version >= snapshot.version) Reflect.deleteProperty(currentSnapshots, id)
  }

  const clearRemoved = (records: Record<string, unknown>): void => {
    for (const id of Object.keys(records)) {
      if (!incoming.has(id)) Reflect.deleteProperty(records, id)
    }
  }
  clearRemoved(selectedFaculty)
  clearRemoved(reopenReasons)
  clearRemoved(busyRequests)
  clearRemoved(feedback)
  clearRemoved(errorMessages)
  for (const id of revealTimers.keys()) {
    if (!incoming.has(id)) clearRevealedPhone(id)
  }
}, { flush: 'sync' })

const revealPhone = async (item: AdminCounselingQueueItem): Promise<void> => {
  if (busyRequests[item.id]) return
  busyRequests[item.id] = true
  errorMessages[item.id] = ''
  try {
    const response = await $fetch<ApiSuccess<{ phone: string }>>(
      `/api/admin/counseling/${item.id}/reveal-phone`,
      { headers: adminSession.authorizationHeaders(), method: 'POST' },
    )
    if (!active || !itemIsPresent(item.id)) return
    const phone = response.data.phone
    if (!/^010\d{8}$/u.test(phone)) throw new Error('COUNSELING_PHONE_INVALID')
    clearRevealedPhone(item.id)
    revealedPhones[item.id] = phone.replace(/^(\d{3})(\d{4})(\d{4})$/u, '$1-$2-$3')
    revealTimers.set(item.id, setTimeout(() => clearRevealedPhone(item.id), 60_000))
  }
  catch (error) {
    if (active && itemIsPresent(item.id)) await handleApiError(item, error)
  }
  finally {
    finishBusyRequest(item.id)
  }
}

const copySummary = async (item: AdminCounselingQueueItem): Promise<void> => {
  if (busyRequests[item.id]) return
  busyRequests[item.id] = true
  errorMessages[item.id] = ''
  feedback[item.id] = ''
  try {
    const response = await $fetch<ApiSuccess<{ summary: string }>>(
      `/api/admin/counseling/${item.id}/summary`,
      { headers: adminSession.authorizationHeaders(), method: 'GET' },
    )
    if (!active || !itemIsPresent(item.id)) return
    const summary = response.data.summary
    if (typeof summary !== 'string' || summary.length === 0 || summary.length > 10_000) {
      throw new Error('COUNSELING_SUMMARY_INVALID')
    }
    await navigator.clipboard.writeText(summary)
    if (active && itemIsPresent(item.id)) feedback[item.id] = '상담 요약을 복사했습니다.'
  }
  catch (error) {
    if (active && itemIsPresent(item.id)) await handleApiError(item, error)
  }
  finally {
    finishBusyRequest(item.id)
  }
}

const reauthenticate = async (): Promise<void> => {
  adminSession.clear()
  await navigateTo(
    { path: '/admin/login', query: { redirect: '/admin/counseling' } },
    { replace: true },
  )
}

onBeforeUnmount(() => {
  active = false
  for (const id of Object.keys(revealedPhones)) clearRevealedPhone(id)
  for (const timer of revealTimers.values()) clearTimeout(timer)
  revealTimers.clear()
})
</script>

<template>
  <div class="counseling-records">
    <article
      v-for="item in props.items"
      :key="item.id"
      class="counseling-record"
      :aria-labelledby="`counseling-${item.id}`"
    >
      <header class="counseling-record__header">
        <div>
          <p>REQUEST / {{ item.id.slice(0, 8).toUpperCase() }}</p>
          <h2 :id="`counseling-${item.id}`">{{ item.nickname }}</h2>
          <span>{{ item.schoolName }} · {{ stageLabels[item.applicantStage] }} · {{ regionLabels[item.region] }}</span>
        </div>
        <div class="counseling-record__state">
          <strong>{{ statusLabels[currentFor(item).status] }}</strong>
          <span>v{{ currentFor(item).version }} · {{ formatDate(currentFor(item).updatedAt) }}</span>
        </div>
      </header>

      <div class="counseling-record__progress" aria-label="상담 진행 상태">
        <span
          v-for="status in progressStatuses"
          :key="status"
          data-counseling-progress
          :data-state="progressState(item, status)"
        >{{ statusLabels[status] }}</span>
      </div>

      <section class="counseling-record__path" aria-label="학생 관심 경로">
        <div>
          <span>관심 분야</span>
          <p><strong>{{ trackLabels[item.primaryTrack] }}</strong> → {{ trackLabels[item.secondaryTrack] }}</p>
        </div>
        <div>
          <span>선택한 활동</span>
          <ul><li v-for="label in item.selectedWorkLabels" :key="label">{{ label }}</li></ul>
        </div>
        <div>
          <span>희망 진로</span>
          <ul><li v-for="label in item.selectedCareerLabels" :key="label">{{ label }}</li></ul>
        </div>
      </section>

      <section class="counseling-record__contact" aria-label="학생 연락 정보">
        <dl>
          <div>
            <dt>휴대전화</dt>
            <dd>{{ revealedPhones[item.id] ?? item.maskedPhone }}</dd>
          </div>
          <div>
            <dt>상담 방법</dt>
            <dd>{{ contactMethodLabels[item.contactMethod] }}</dd>
          </div>
          <div>
            <dt>연락 가능 시간</dt>
            <dd>{{ availabilityLabels[item.availability] }}</dd>
          </div>
        </dl>
        <div class="counseling-record__sensitive-actions">
          <AppButton
            data-action="reveal-phone"
            variant="secondary"
            :loading="Boolean(busyRequests[item.id])"
            @click="revealPhone(item)"
          >연락처 60초 확인</AppButton>
          <AppButton
            data-action="copy-summary"
            variant="secondary"
            :loading="Boolean(busyRequests[item.id])"
            @click="copySummary(item)"
          >상담 요약 복사</AppButton>
        </div>
      </section>

      <section class="counseling-record__faculty" aria-label="교수 연결">
        <p class="counseling-record__section-label">교수 연결</p>
        <ul>
          <li v-for="recommendation in item.recommendations" :key="`${recommendation.role}-${recommendation.rank}`">
            <strong>{{ roleLabels[recommendation.role] }} {{ recommendation.name }}</strong>
            <small>{{ recommendation.title }}</small>
          </li>
        </ul>
        <p v-if="currentFor(item).assignedFaculty" class="counseling-record__assigned">
          실제 담당 · <strong>{{ currentFor(item).assignedFaculty?.name }} {{ currentFor(item).assignedFaculty?.title }}</strong>
        </p>
      </section>

      <footer class="counseling-record__operations">
        <div v-if="currentFor(item).status === 'new'" class="counseling-record__assign">
          <label :for="`faculty-${item.id}`">담당 교수 배정</label>
          <select
            :id="`faculty-${item.id}`"
            v-model="selectedFaculty[item.id]"
            :data-action="`faculty-${item.id}`"
            :disabled="Boolean(busyRequests[item.id])"
          >
            <option value="">교수 선택</option>
            <option v-for="member in props.faculty" :key="member.id" :value="String(member.id)">
              {{ member.name }} {{ member.title }}
            </option>
          </select>
          <AppButton
            data-action="assign"
            variant="primary"
            :loading="Boolean(busyRequests[item.id])"
            @click="assign(item)"
          >배정 확정</AppButton>
        </div>

        <div v-if="['completed', 'closed'].includes(currentFor(item).status)" class="counseling-record__reopen">
          <label :for="`reopen-${item.id}`">재오픈 사유</label>
          <textarea
            :id="`reopen-${item.id}`"
            v-model="reopenReasons[item.id]"
            name="reopenReason"
            maxlength="1000"
            rows="2"
            :disabled="Boolean(busyRequests[item.id])"
          />
          <AppButton
            data-action="reopen"
            variant="secondary"
            :loading="Boolean(busyRequests[item.id])"
            @click="reopen(item)"
          >재오픈</AppButton>
        </div>

        <div v-else class="counseling-record__transitions">
          <AppButton
            v-if="currentFor(item).status === 'assigned'"
            variant="primary"
            aria-label="연락 완료"
            :loading="Boolean(busyRequests[item.id])"
            @click="transition(item, 'contacted')"
          >연락 완료</AppButton>
          <AppButton
            v-if="currentFor(item).status === 'contacted'"
            variant="primary"
            aria-label="상담 완료"
            :loading="Boolean(busyRequests[item.id])"
            @click="transition(item, 'completed')"
          >상담 완료</AppButton>
          <AppButton
            variant="danger"
            aria-label="요청 종료"
            :loading="Boolean(busyRequests[item.id])"
            @click="closeRequest(item)"
          >요청 종료</AppButton>
        </div>
      </footer>

      <p v-if="feedback[item.id]" class="counseling-record__feedback" aria-live="polite">{{ feedback[item.id] }}</p>
      <p v-if="errorMessages[item.id]" class="counseling-record__error" role="alert">{{ errorMessages[item.id] }}</p>
    </article>

    <dialog
      ref="reauthenticationDialog"
      class="reauthentication-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reauthentication-title"
      @cancel.prevent="closeReauthentication"
      @keydown="trapReauthenticationFocus"
    >
      <div v-if="reauthenticationOpen" class="reauthentication-dialog__panel">
        <p>SECURITY / RECENT AUTH</p>
        <h2 id="reauthentication-title">비밀번호 재로그인이 필요합니다</h2>
        <span>민감정보를 확인하려면 이메일과 비밀번호로 다시 로그인하세요.</span>
        <div class="reauthentication-dialog__actions">
          <AppButton
            data-action="cancel-reauthentication"
            variant="secondary"
            @click="closeReauthentication"
          >취소</AppButton>
          <AppButton
            ref="reauthenticationButton"
            data-action="reauthenticate"
            variant="primary"
            @click="reauthenticate"
          >비밀번호로 다시 로그인</AppButton>
        </div>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.counseling-records { display: grid; gap: 1.25rem; }

.counseling-record {
  border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  border-top: 0.3rem solid var(--color-resource);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  overflow: hidden;
}

.counseling-record__header,
.counseling-record__path,
.counseling-record__contact,
.counseling-record__faculty,
.counseling-record__operations {
  padding: 1rem clamp(1rem, 3vw, 1.5rem);
}

.counseling-record__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
}

.counseling-record__header p,
.counseling-record__header h2,
.counseling-record__header span,
.counseling-record__state span,
.counseling-record__path p,
.counseling-record__path ul,
.counseling-record__contact dl,
.counseling-record__faculty ul,
.counseling-record__assigned,
.counseling-record__feedback,
.counseling-record__error { margin: 0; }

.counseling-record__header p,
.counseling-record__section-label,
.counseling-record__path span,
.counseling-record__contact dt {
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.counseling-record__header h2 {
  margin-top: 0.35rem;
  font-family: var(--font-display);
  font-size: clamp(1.35rem, 4vw, 1.8rem);
  letter-spacing: -0.04em;
}

.counseling-record__header > div:first-child > span {
  display: block;
  margin-top: 0.35rem;
  color: color-mix(in srgb, var(--color-ink) 70%, transparent);
  font-size: 0.875rem;
}

.counseling-record__state { text-align: right; }
.counseling-record__state strong {
  display: block;
  color: var(--color-sequence);
  font-family: var(--font-display);
}
.counseling-record__state span {
  display: block;
  margin-top: 0.25rem;
  color: color-mix(in srgb, var(--color-ink) 56%, transparent);
  font-family: var(--font-mono);
  font-size: 0.65rem;
}

.counseling-record__progress {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-block: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
}

.counseling-record__progress span {
  min-width: 0;
  padding: 0.6rem 0.5rem;
  color: color-mix(in srgb, var(--color-ink) 44%, transparent);
  font-family: var(--font-mono);
  font-size: 0.65rem;
  text-align: center;
}
.counseling-record__progress span + span { border-left: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent); }
.counseling-record__progress span[data-state="done"] { background: var(--color-primary-soft); color: var(--color-primary); }
.counseling-record__progress span[data-state="active"] { background: var(--color-primary); color: var(--color-surface); }

.counseling-record__path {
  display: grid;
  grid-template-columns: minmax(10rem, 0.75fr) repeat(2, minmax(0, 1fr));
  gap: 1rem;
  background: var(--color-primary-soft);
}
.counseling-record__path > div { min-width: 0; }
.counseling-record__path p,
.counseling-record__path ul { margin-top: 0.45rem; }
.counseling-record__path ul { padding-left: 1rem; }
.counseling-record__path li + li { margin-top: 0.25rem; }

.counseling-record__contact {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
}
.counseling-record__contact dl {
  flex: 1 1 34rem;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.counseling-record__contact dd { margin: 0.35rem 0 0; overflow-wrap: anywhere; }
.counseling-record__sensitive-actions,
.counseling-record__transitions { display: flex; flex-wrap: wrap; gap: 0.5rem; }

.counseling-record__faculty { border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent); }
.counseling-record__section-label { margin: 0 0 0.65rem; }
.counseling-record__faculty ul { display: flex; flex-wrap: wrap; gap: 0.45rem; padding: 0; list-style: none; }
.counseling-record__faculty li {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  border-left: 0.2rem solid var(--color-sequence);
  border-radius: var(--radius-card);
  background: var(--color-primary-soft);
  padding: 0.5rem 0.65rem;
}
.counseling-record__faculty li small { font-family: var(--font-mono); font-size: 0.65rem; }
.counseling-record__faculty li strong { color: var(--color-sequence); }
.counseling-record__assigned { margin-top: 0.75rem; font-size: 0.875rem; }

.counseling-record__operations {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
  background: color-mix(in srgb, var(--color-canvas) 54%, var(--color-surface));
}
.counseling-record__assign,
.counseling-record__reopen {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(10rem, 1fr) auto;
  gap: 0.5rem;
  align-items: end;
}
.counseling-record__assign label,
.counseling-record__reopen label { grid-column: 1 / -1; font-size: 0.8rem; font-weight: 700; }
.counseling-record select,
.counseling-record textarea {
  min-height: var(--touch-target);
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--color-ink) 34%, transparent);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  padding: 0.65rem 0.75rem;
  color: var(--color-ink);
}
.counseling-record select:focus-visible,
.counseling-record textarea:focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 2px; }
.counseling-record__feedback,
.counseling-record__error { padding: 0 1.5rem 1rem; font-size: 0.875rem; }
.counseling-record__feedback { color: var(--color-resource); }
.counseling-record__error { color: var(--color-error); }

.reauthentication-dialog {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  border: 0;
  background: color-mix(in srgb, var(--color-ink) 72%, transparent);
  padding: 1rem;
}
.reauthentication-dialog[open] { display: grid; place-items: center; }
.reauthentication-dialog::backdrop { background: transparent; }
.reauthentication-dialog__panel {
  width: min(100%, 28rem);
  border-top: 0.35rem solid var(--color-sequence);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  padding: 1.5rem;
  box-shadow: 0 1.5rem 4rem color-mix(in srgb, var(--color-ink) 28%, transparent);
}
.reauthentication-dialog__panel p { margin: 0; color: var(--color-sequence); font-family: var(--font-mono); font-size: 0.68rem; }
.reauthentication-dialog__panel h2 { margin: 0.5rem 0; font-family: var(--font-display); letter-spacing: -0.04em; }
.reauthentication-dialog__panel span { display: block; margin-bottom: 1.25rem; color: color-mix(in srgb, var(--color-ink) 68%, transparent); }
.reauthentication-dialog__actions { display: flex; justify-content: flex-end; gap: 0.5rem; }

@media (max-width: 48rem) {
  .counseling-record__header { display: grid; }
  .counseling-record__state { text-align: left; }
  .counseling-record__path,
  .counseling-record__contact dl { grid-template-columns: 1fr; }
  .counseling-record__progress { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .counseling-record__progress span:nth-child(3) { border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent); border-left: 0; }
  .counseling-record__progress span:nth-child(4) { border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent); }
  .counseling-record__progress span:nth-child(5) { grid-column: 1 / -1; border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent); border-left: 0; }
  .counseling-record__sensitive-actions,
  .counseling-record__transitions,
  .counseling-record__assign,
  .counseling-record__reopen { width: 100%; grid-template-columns: 1fr; }
  .counseling-record__assign :deep(button),
  .counseling-record__reopen :deep(button),
  .counseling-record__sensitive-actions :deep(button),
  .counseling-record__transitions :deep(button) { width: 100%; }
}
</style>
