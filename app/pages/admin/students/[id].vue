<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import { adminStudentDetailSchema, type AdminStudentDetail } from '../../../../shared/schemas/admin-students'
import { trackLabels } from '../../../../shared/types/domain'
import type { ApiSuccess } from '../../../../shared/types/api'
import PhoneRevealDialog from '../../../components/admin/PhoneRevealDialog.vue'
import PasswordReissueDialog from '../../../components/admin/PasswordReissueDialog.vue'
import type { RosterCredential } from '../../../../shared/schemas/admission-roster'
import AppButton from '../../../components/common/AppButton.vue'
import AppState from '../../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const adminSession = useAdminSessionStore()
const detail = ref<AdminStudentDetail | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const phoneDialogOpen = ref(false)
const profileEditorOpen = ref(false)
const phoneEditorOpen = ref(false)
const statusConfirmationOpen = ref(false)
const actionMessage = ref('')
const actionError = ref('')
const oneTimeCredential = ref<RosterCredential | null>(null)
const profileForm = reactive({ name: '', highSchool: '', grade: 'high3' })
const phoneForm = reactive({ phone: '' })
const statusConfirmation = ref('')
let active = true
let requestVersion = 0
let stopStudentWatch: (() => void) | undefined

const hasControlCharacters = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
})

const studentId = computed(() => {
  const routeParam = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
  return /^(?:[1-9][0-9]{0,15})$/u.test(String(routeParam))
    && Number.isSafeInteger(Number(routeParam))
    ? Number(routeParam)
    : 0
})

const safeLocalUrl = (
  value: unknown,
  expectedPath: string,
  fallback: string,
): string => {
  if (typeof value !== 'string'
    || value.length > 2_000
    || hasControlCharacters(value)) return fallback
  try {
    const parsed = new URL(value, 'https://photo-next.invalid')
    return parsed.origin === 'https://photo-next.invalid' && parsed.pathname === expectedPath
      ? `${parsed.pathname}${parsed.search}`
      : fallback
  }
  catch {
    return fallback
  }
}

const listUrl = computed(() => safeLocalUrl(
  route.query.returnTo,
  '/admin/students',
  '/admin/students',
))

const loginRedirect = computed(() => safeLocalUrl(
  route.fullPath,
  `/admin/students/${studentId.value}`,
  `/admin/students/${studentId.value}`,
))

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

const contactMethodLabels = { phone: '전화', text: '문자', visit: '방문' } as const
const availabilityLabels = {
  weekday_morning: '평일 오전',
  weekday_afternoon: '평일 오후',
  weekday_evening: '평일 저녁',
  weekend: '주말',
} as const

const formatDate = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hour12: false,
}).format(new Date(value))

const pendingStatus = computed(() => detail.value?.student.status === 'active' ? 'inactive' as const : 'active' as const)
const confirmationPhrase = computed(() => `${studentId.value} ${pendingStatus.value === 'inactive' ? '비활성화' : '활성화'}`)
const requestOptions = () => ({ headers: adminSession.authorizationHeaders() })

const openProfileEditor = (): void => {
  if (!detail.value) return
  profileForm.name = detail.value.student.nickname
  profileForm.highSchool = detail.value.student.schoolName
  profileForm.grade = detail.value.student.applicantStage
  actionError.value = ''
  profileEditorOpen.value = true
}

const saveProfile = async (): Promise<void> => {
  if (!detail.value) return
  actionError.value = ''; actionMessage.value = ''
  try {
    await $fetch(`/api/admin/students/${detail.value.student.id}`, { method: 'PATCH', ...requestOptions(), body: { ...profileForm } })
    detail.value = { ...detail.value, student: { ...detail.value.student, nickname: profileForm.name, schoolName: profileForm.highSchool, applicantStage: profileForm.grade as AdminStudentDetail['student']['applicantStage'] } }
    profileEditorOpen.value = false
    actionMessage.value = '학생 기본 정보를 저장했습니다.'
  }
  catch { actionError.value = '학생 기본 정보를 저장하지 못했습니다. 입력값을 확인하세요.' }
}

const changePhone = async (): Promise<void> => {
  if (!detail.value) return
  actionError.value = ''; actionMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<{ passwordGeneration: number, credential: RosterCredential }>>(`/api/admin/students/${detail.value.student.id}/phone`, {
      method: 'POST', ...requestOptions(), body: { phone: phoneForm.phone },
    })
    oneTimeCredential.value = response.data.credential
    phoneEditorOpen.value = false
  }
  catch { actionError.value = '전화번호를 변경하지 못했습니다. 최신 학생 정보를 다시 확인하세요.' }
}

const changeStatus = async (): Promise<void> => {
  if (!detail.value || statusConfirmation.value !== confirmationPhrase.value) return
  actionError.value = ''; actionMessage.value = ''
  try {
    await $fetch(`/api/admin/students/${detail.value.student.id}/status`, { method: 'POST', ...requestOptions(), body: { status: pendingStatus.value, confirmation: statusConfirmation.value } })
    detail.value = { ...detail.value, student: { ...detail.value.student, status: pendingStatus.value } }
    statusConfirmationOpen.value = false
    statusConfirmation.value = ''
    actionMessage.value = pendingStatus.value === 'inactive' ? '학생 계정을 비활성화했습니다.' : '학생 계정을 활성화했습니다.'
  }
  catch { actionError.value = '학생 상태를 변경하지 못했습니다. 확인 문구와 세션을 다시 확인하세요.' }
}

const reissuePassword = async (): Promise<void> => {
  if (!detail.value) return
  actionError.value = ''; actionMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<{ passwordGeneration: number, credential: RosterCredential }>>(`/api/admin/students/${detail.value.student.id}/password/reissue`, {
      method: 'POST', ...requestOptions(), body: {},
    })
    oneTimeCredential.value = response.data.credential
  }
  catch { actionError.value = '임시 비밀번호를 발급하지 못했습니다. 최근 관리자 로그인을 확인하세요.' }
}

const closeCredentialDialog = (): void => { oneTimeCredential.value = null }

const loadDetail = async (): Promise<void> => {
  const thisRequest = ++requestVersion
  const requestedStudentId = studentId.value
  loading.value = true
  errorMessage.value = ''
  phoneDialogOpen.value = false
  profileEditorOpen.value = false
  phoneEditorOpen.value = false
  statusConfirmationOpen.value = false
  oneTimeCredential.value = null
  detail.value = null
  if (requestedStudentId === 0) {
    errorMessage.value = '학생 정보를 확인할 수 없습니다. 목록에서 다시 선택하세요.'
    loading.value = false
    return
  }
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/students/${requestedStudentId}`, {
      headers: adminSession.authorizationHeaders(),
    })
    if (!active || thisRequest !== requestVersion) return
    detail.value = adminStudentDetailSchema.parse(response.data)
  }
  catch {
    if (!active || thisRequest !== requestVersion) return
    detail.value = null
    errorMessage.value = '학생 정보를 불러오지 못했습니다. 목록에서 다시 선택하거나 세션을 확인하세요.'
  }
  finally {
    if (active && thisRequest === requestVersion) loading.value = false
  }
}

onMounted(() => {
  stopStudentWatch = watch(studentId, loadDetail, { immediate: true })
})
onBeforeUnmount(() => {
  active = false
  requestVersion += 1
  stopStudentWatch?.()
  phoneDialogOpen.value = false
  oneTimeCredential.value = null
})
</script>

<template>
  <section class="student-detail" aria-labelledby="student-detail-title">
    <NuxtLink data-action="back-to-list" class="student-detail__back" :to="listUrl">← 학생 목록으로</NuxtLink>

    <AppState v-if="loading" variant="loading" message="학생 참여 기록을 불러오고 있습니다." />
    <div v-else-if="errorMessage" class="student-detail__state">
      <AppState variant="error" :message="errorMessage" />
      <AppButton data-action="retry" variant="secondary" @click="loadDetail">다시 시도</AppButton>
    </div>

    <template v-else-if="detail">
      <header class="student-detail__header">
        <div>
          <p class="student-detail__eyebrow">STUDENT / #{{ String(detail.student.id).padStart(6, '0') }}</p>
          <h1 id="student-detail-title">{{ detail.student.nickname }}</h1>
          <p>{{ detail.student.schoolName }} · {{ stageLabels[detail.student.applicantStage] }} · {{ regionLabels[detail.student.region] }}</p>
        </div>
        <div class="student-detail__contact">
          <span>연락처</span>
          <strong>{{ detail.student.phone }}</strong>
          <AppButton data-action="open-phone" variant="secondary" @click="phoneDialogOpen = true">전화번호 확인</AppButton>
        </div>
      </header>

      <dl class="student-detail__identity" data-testid="roster-identity">
        <div><dt>이름</dt><dd>{{ detail.student.nickname }}</dd></div>
        <div><dt>연락처</dt><dd>{{ detail.student.phone }}</dd></div>
        <div><dt>학교</dt><dd>{{ detail.student.schoolName }}</dd></div>
        <div><dt>학년</dt><dd>{{ stageLabels[detail.student.applicantStage] }}</dd></div>
        <div><dt>사이클</dt><dd>{{ detail.student.cycleId ? '현재 사이클' : '현재 연도' }}</dd></div>
        <div><dt>상태</dt><dd>{{ detail.student.status === 'active' ? '활성' : '비활성' }}</dd></div>
        <div v-if="detail.student.isTest"><dt>구분</dt><dd>테스트 계정</dd></div>
      </dl>

      <section class="student-detail__operations" aria-label="학생 계정 관리">
        <header><p>ROSTER / ACCOUNT CONTROL</p><h2>학생 계정 관리</h2></header>
        <div class="student-detail__operation-actions">
          <button data-action="open-profile-edit" type="button" @click="openProfileEditor">기본 정보 수정</button>
          <button data-action="open-phone-change" type="button" @click="phoneEditorOpen = !phoneEditorOpen">전화번호 변경</button>
          <button data-action="open-status-toggle" type="button" @click="statusConfirmationOpen = !statusConfirmationOpen">{{ pendingStatus === 'inactive' ? '비활성화' : '활성화' }}</button>
          <button data-action="reissue-password" type="button" @click="reissuePassword">임시 비밀번호 재발급</button>
        </div>
        <p v-if="actionMessage" class="student-detail__action-message" role="status">{{ actionMessage }}</p>
        <p v-if="actionError" class="student-detail__action-error" role="alert">{{ actionError }}</p>
        <form v-if="profileEditorOpen" class="student-detail__operation-form" aria-label="학생 기본 정보 수정" @submit.prevent="saveProfile">
          <label>이름<input v-model="profileForm.name" name="name" autocomplete="name" required></label>
          <label>출신고교<input v-model="profileForm.highSchool" name="highSchool" autocomplete="organization" required></label>
          <label>학년<select v-model="profileForm.grade" name="grade"><option value="high1">고1</option><option value="high2">고2</option><option value="high3">고3</option><option value="graduate">고교 졸업</option><option value="ged">검정고시</option><option value="other">기타</option></select></label>
          <div><button type="submit">저장</button><button type="button" @click="profileEditorOpen = false">취소</button></div>
        </form>
        <form v-if="phoneEditorOpen" class="student-detail__operation-form" aria-label="학생 전화번호 변경" @submit.prevent="changePhone">
          <label>새 휴대전화<input v-model="phoneForm.phone" name="phone" autocomplete="tel" required></label>
          <p>전화번호를 변경하면 새 임시 비밀번호가 한 번만 표시됩니다.</p>
          <div><button type="submit">변경하고 발급</button><button type="button" @click="phoneEditorOpen = false">취소</button></div>
        </form>
        <form v-if="statusConfirmationOpen" class="student-detail__operation-form" aria-label="학생 상태 변경 확인" @submit.prevent="changeStatus">
          <p><strong>{{ confirmationPhrase }}</strong>를 입력하면 {{ pendingStatus === 'inactive' ? '비활성화와 세션 해제' : '활성화' }}를 진행합니다.</p>
          <label>확인 문구<input v-model="statusConfirmation" name="statusConfirmation" :placeholder="confirmationPhrase" required></label>
          <div><button type="submit" :disabled="statusConfirmation !== confirmationPhrase">상태 변경</button><button type="button" @click="statusConfirmationOpen = false">취소</button></div>
        </form>
      </section>

      <dl class="student-detail__facts">
        <div>
          <dt>최근 활동</dt>
          <dd><time :datetime="detail.student.lastActiveAt">{{ formatDate(detail.student.lastActiveAt) }}</time></dd>
        </div>
        <div>
          <dt>처음 참여</dt>
          <dd><time :datetime="detail.student.createdAt">{{ formatDate(detail.student.createdAt) }}</time></dd>
        </div>
      </dl>

      <section class="student-detail__section" aria-labelledby="student-results-title">
        <header>
          <p>ASSESSMENT / LATEST 3</p>
          <h2 id="student-results-title">최근 진로 결과</h2>
        </header>
        <AppState v-if="detail.recentResults.length === 0" variant="empty" message="아직 완료한 진로 결과가 없습니다." />
        <div v-else class="student-detail__table-wrap">
          <table aria-label="최근 진로 결과">
            <thead>
              <tr>
                <th scope="col">완료일</th>
                <th scope="col">주 관심</th>
                <th scope="col">다음 관심</th>
                <th scope="col">캠페인</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="result in detail.recentResults" :key="result.id" data-result-row>
                <td><time :datetime="result.completedAt">{{ formatDate(result.completedAt) }}</time></td>
                <td><strong>{{ trackLabels[result.primaryTrack] }}</strong></td>
                <td>{{ trackLabels[result.secondaryTrack] }}</td>
                <td>{{ result.campaignId === null ? '직접 참여' : `#${result.campaignId}` }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="student-detail__section" aria-labelledby="student-counseling-title">
        <header>
          <p>COUNSELING / HISTORY</p>
          <h2 id="student-counseling-title">상담 기록</h2>
        </header>
        <AppState v-if="detail.counseling.length === 0" variant="empty" message="아직 접수된 상담이 없습니다." />
        <ol v-else class="student-detail__counseling">
          <li v-for="item in detail.counseling" :key="item.id" data-counseling-row>
            <div>
              <span :data-status="item.status">{{ statusLabels[item.status] }}</span>
              <time :datetime="item.createdAt">{{ formatDate(item.createdAt) }}</time>
            </div>
            <dl>
              <div>
                <dt>연락 방식</dt>
                <dd>{{ contactMethodLabels[item.contactMethod] }} · {{ availabilityLabels[item.availability] }}</dd>
              </div>
              <div>
                <dt>담당 교수</dt>
                <dd>{{ item.assignedFaculty ? `${item.assignedFaculty.name} ${item.assignedFaculty.title}` : '미배정' }}</dd>
              </div>
              <div v-if="item.inquiry">
                <dt>문의 내용</dt>
                <dd>{{ item.inquiry }}</dd>
              </div>
            </dl>
          </li>
        </ol>
      </section>

      <PhoneRevealDialog
        v-if="phoneDialogOpen"
        :student-id="detail.student.id"
        :nickname="detail.student.nickname"
        :masked-phone="detail.student.phone"
        :login-redirect="loginRedirect"
        @close="phoneDialogOpen = false"
      />
      <PasswordReissueDialog v-if="oneTimeCredential" :credential="oneTimeCredential" @close="closeCredentialDialog" />
    </template>
  </section>
</template>

<style scoped>
.student-detail {
  display: grid;
  gap: 1.5rem;
  max-width: 70rem;
}

.student-detail__back {
  width: fit-content;
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  color: var(--color-resource);
  font-family: var(--font-display);
  font-weight: 700;
  text-underline-offset: 0.2em;
}

.student-detail__back:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.student-detail__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1.5rem;
  border-top: 3px solid var(--color-ink);
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  padding: 1.5rem;
}

.student-detail__eyebrow,
.student-detail__section > header p {
  margin: 0 0 0.5rem;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.07em;
}

.student-detail h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  letter-spacing: -0.05em;
}

.student-detail__header > div > p:last-child {
  margin: 0.75rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
}

.student-detail__contact {
  min-width: 14rem;
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 0.4rem;
  border-left: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  padding-left: 1.5rem;
}

.student-detail__contact > span,
.student-detail__facts dt {
  color: color-mix(in srgb, var(--color-ink) 60%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.student-detail__contact strong {
  margin-bottom: 0.35rem;
  font-family: var(--font-mono);
}

.student-detail__identity {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  border: 1px solid var(--color-resource);
  border-radius: var(--radius-panel);
  background: var(--color-resource);
  overflow: hidden;
}

.student-detail__identity > div {
  display: grid;
  gap: 0.35rem;
  background: var(--color-canvas);
  padding: 0.75rem;
}

.student-detail__identity dt {
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.07em;
}

.student-detail__identity dd {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
}

.student-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  background: color-mix(in srgb, var(--color-ink) 14%, transparent);
  border-radius: var(--radius-panel);
  overflow: hidden;
}

.student-detail__facts > div {
  background: var(--color-surface);
  padding: 1rem;
}

.student-detail__facts dd {
  margin: 0.35rem 0 0;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.student-detail__operations {
  display: grid;
  gap: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  padding: 1rem;
}

.student-detail__operations header p,
.student-detail__operations h2 {
  margin: 0;
}

.student-detail__operations header p {
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.675rem;
  letter-spacing: 0.08em;
}

.student-detail__operations h2 { font-family: var(--font-display); font-size: 1.35rem; }
.student-detail__operation-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.student-detail__operation-actions button,
.student-detail__operation-form button {
  min-height: var(--touch-target);
  border: 1px solid var(--color-resource);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.55rem 0.8rem;
  font-family: var(--font-display);
  font-weight: 700;
}
.student-detail__operation-actions button:last-child { border-color: var(--color-primary); background: var(--color-primary); color: var(--color-surface); }
.student-detail__operation-actions [data-action="open-status-toggle"] { border-color: var(--color-error); background: var(--color-surface); color: var(--color-error); }
.student-detail__operation-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent); border-radius: var(--radius-card); background: var(--color-primary-soft); padding: 0.875rem; }
.student-detail__operation-form label { display: grid; gap: 0.3rem; font-family: var(--font-mono); font-size: 0.7rem; }
.student-detail__operation-form input,
.student-detail__operation-form select { min-height: var(--touch-target); border: 1px solid var(--color-resource); border-radius: var(--radius-control); background: var(--color-surface); padding: 0.5rem; color: var(--color-ink); font: inherit; }
.student-detail__operation-form > p,
.student-detail__operation-form > div { grid-column: 1 / -1; margin: 0; }
.student-detail__operation-form > div { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
.student-detail__action-message { margin: 0; color: var(--color-sequence); font-family: var(--font-mono); font-size: 0.8rem; }
.student-detail__action-error { margin: 0; color: var(--color-error); font-family: var(--font-mono); font-size: 0.8rem; }

.student-detail__section {
  display: grid;
  gap: 0.875rem;
}

.student-detail__section h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.5rem;
  letter-spacing: -0.035em;
}

.student-detail__table-wrap {
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
}

table {
  width: 100%;
  min-width: 42rem;
  border-collapse: collapse;
  text-align: left;
}

th,
td {
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
  padding: 0.875rem 1rem;
}

thead th {
  background: color-mix(in srgb, var(--color-canvas) 70%, var(--color-surface));
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.student-detail__counseling {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.student-detail__counseling > li {
  border: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  padding: 1rem;
}

.student-detail__counseling > li > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.student-detail__counseling > li > div span {
  border-left: 3px solid var(--color-sequence);
  padding-left: 0.5rem;
  font-family: var(--font-display);
  font-weight: 700;
}

.student-detail__counseling time {
  color: color-mix(in srgb, var(--color-ink) 60%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.student-detail__counseling dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
  margin: 1rem 0 0;
}

.student-detail__counseling dl div:last-child:nth-child(3) {
  grid-column: 1 / -1;
}

.student-detail__counseling dt {
  color: color-mix(in srgb, var(--color-ink) 60%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.student-detail__counseling dd {
  margin: 0.3rem 0 0;
  overflow-wrap: anywhere;
}

.student-detail__state {
  display: grid;
  justify-items: start;
  gap: 0.75rem;
}

@media (max-width: 44.99rem) {
  .student-detail__header {
    grid-template-columns: 1fr;
    padding: 1rem;
  }

  .student-detail__contact {
    border-top: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
    border-left: 0;
    padding-top: 1rem;
    padding-left: 0;
  }

  .student-detail__facts,
  .student-detail__counseling dl,
  .student-detail__identity,
  .student-detail__operation-form {
    grid-template-columns: 1fr;
  }

  .student-detail__counseling dl div:last-child:nth-child(3) {
    grid-column: auto;
  }
}
</style>
