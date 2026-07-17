<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { ApiSuccess, StudentSession } from '../../shared/types/api'
import type { QuestionGroup } from '../../shared/types/domain'
import AssessmentProgress from '../components/assessment/AssessmentProgress.vue'
import AssessmentStep from '../components/assessment/AssessmentStep.vue'
import AppState from '../components/common/AppState.vue'
import { useAssessmentStore } from '../stores/assessment'

const assessment = useAssessmentStore()
const session = ref<StudentSession | null>(null)
const checkingSession = ref(true)
const loggingOut = ref(false)
const logoutError = ref('')
const sequenceRoot = ref<HTMLElement | null>(null)

const groupLabels: Record<QuestionGroup, string> = {
  work: '작업 선택',
  result: '결과물 선택',
  style: '작업 방식',
  career: '진로 방향',
}

const currentGroupLabel = computed(() => assessment.currentGroup
  ? groupLabels[assessment.currentGroup.key]
  : '')
const isLastStep = computed(() => assessment.step === assessment.groups.length - 1)
const flowBusy = computed(() => assessment.status === 'loading'
  || assessment.status === 'submitting'
  || assessment.status === 'validating')

const loadSession = async (): Promise<void> => {
  checkingSession.value = true
  try {
    const response = await $fetch<ApiSuccess<StudentSession>>('/api/student/session')
    session.value = response.data
    checkingSession.value = false
    await assessment.loadOptions()
  }
  catch {
    session.value = null
    assessment.markUnauthenticated()
    await navigateTo('/login', { replace: true })
  }
  finally {
    checkingSession.value = false
  }
}

const logout = async (): Promise<void> => {
  if (loggingOut.value || flowBusy.value) return
  loggingOut.value = true
  logoutError.value = ''
  try {
    if (!session.value) throw new Error('STUDENT_SESSION_REQUIRED')
    await $fetch('/api/student/logout', {
      headers: { 'x-photo-next-csrf': session.value.csrfToken },
      method: 'POST',
    })
    assessment.clear()
    await navigateTo('/login', { replace: true })
  }
  catch {
    logoutError.value = '로그아웃하지 못했습니다. 다시 시도하세요.'
  }
  finally {
    loggingOut.value = false
  }
}

const updateSelections = (values: string[]): void => {
  const current = assessment.currentSelected
  const changed = [...new Set([...current, ...values])]
    .find(key => current.includes(key) !== values.includes(key))
  if (changed) assessment.toggleOption(changed)
}

const focusCurrentStep = async (): Promise<void> => {
  await nextTick()
  const heading = sequenceRoot.value?.querySelector<HTMLElement>('legend')
  if (!heading) return
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  heading.focus({ preventScroll: true })
  heading.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
}

const nextStep = async (): Promise<void> => {
  if (assessment.next()) await focusCurrentStep()
}

const previousStep = async (): Promise<void> => {
  if (assessment.previous()) await focusCurrentStep()
}

const goToResult = async (publicId: string | null): Promise<void> => {
  if (publicId) await navigateTo(`/result/${publicId}`)
}

const submit = async (): Promise<void> => {
  if (!session.value) return
  const publicId = await assessment.submit(session.value.csrfToken)
  if (assessment.status === 'unauthenticated') {
    await navigateTo('/login', { replace: true })
    return
  }
  await goToResult(publicId)
}

const retry = async (): Promise<void> => {
  const result = await assessment.retry(session.value?.csrfToken)
  if (assessment.status === 'unauthenticated') {
    await navigateTo('/login', { replace: true })
    return
  }
  await goToResult(typeof result === 'string' ? result : null)
}

onMounted(loadSession)
</script>

<template>
  <main class="assessment-page">
    <header class="assessment-page__masthead">
      <div class="assessment-page__masthead-inner">
        <NuxtLink
          class="assessment-page__brand"
          to="/"
          aria-label="PHOTO:NEXT 홈"
        >
          PHOTO:<span>NEXT</span>
        </NuxtLink>
        <span class="assessment-page__timecode">ASSESSMENT / CONTACT 04</span>
      </div>
    </header>

    <div class="assessment-page__workspace">
      <AppState
        v-if="checkingSession"
        variant="loading"
        message="로그인 정보를 확인하고 있어요."
      />

      <template v-else-if="session">
        <div class="assessment-page__account-row">
          <p>{{ session.nickname }}님</p>
          <button
            data-testid="logout"
            type="button"
            :disabled="loggingOut || flowBusy"
            @click="logout"
          >
            {{ loggingOut ? '로그아웃 중…' : '로그아웃' }}
          </button>
        </div>
        <p
          v-if="logoutError"
          class="assessment-page__logout-error"
          role="alert"
        >
          {{ logoutError }}
        </p>

        <AppState
          v-if="assessment.status === 'loading' && !assessment.currentGroup"
          variant="loading"
          message="관심 선택지를 불러오고 있어요."
        />

        <section
          v-else-if="assessment.status === 'empty'"
          class="assessment-page__state-panel"
          aria-labelledby="assessment-empty-title"
        >
          <p class="assessment-page__state-code">EMPTY / CONTACT SHEET</p>
          <h1 id="assessment-empty-title">지금 고를 수 있는 선택지가 없습니다.</h1>
          <p>선택지가 준비된 뒤 다시 불러와 주세요.</p>
          <button
            data-testid="assessment-retry"
            type="button"
            @click="assessment.loadOptions()"
          >
            다시 불러오기
          </button>
        </section>

        <section
          v-else-if="assessment.status === 'error' && !assessment.currentGroup"
          class="assessment-page__state-panel assessment-page__state-panel--error"
          aria-labelledby="assessment-error-title"
        >
          <p class="assessment-page__state-code">LOAD / INTERRUPTED</p>
          <h1 id="assessment-error-title">진단을 이어갈 수 없습니다.</h1>
          <p role="alert">{{ assessment.errorMessage }}</p>
          <button
            v-if="assessment.retryAction"
            data-testid="assessment-retry"
            type="button"
            @click="retry"
          >
            다시 불러오기
          </button>
        </section>

        <AppState
          v-else-if="assessment.status === 'unauthenticated'"
          variant="error"
          message="로그인 정보가 만료되었습니다. 다시 로그인해 주세요."
        />

        <section
          v-else-if="assessment.currentGroup && assessment.currentLimit"
          ref="sequenceRoot"
          class="assessment-page__sequence"
          aria-labelledby="assessment-title"
        >
          <h1
            id="assessment-title"
            class="assessment-page__sr-only"
          >관심사 진단</h1>
          <AssessmentProgress
            :step="assessment.step"
            :group-label="currentGroupLabel"
          />

          <AppState
            v-if="assessment.status === 'loading'"
            variant="loading"
            message="선택지를 다시 불러오고 있어요. 현재 선택은 유지됩니다."
          />

          <div
            v-else-if="assessment.status === 'error'"
            class="assessment-page__inline-error"
          >
            <p role="alert">{{ assessment.errorMessage }}</p>
            <button
              v-if="assessment.retryAction"
              data-testid="assessment-retry"
              type="button"
              @click="retry"
            >
              {{ assessment.retryAction === 'load' ? '다시 불러오기' : '결과 다시 만들기' }}
            </button>
          </div>

          <div
            v-else-if="assessment.status === 'stale'"
            class="assessment-page__inline-stale"
            data-testid="assessment-stale"
          >
            <p class="assessment-page__state-code">CATALOG / UPDATED</p>
            <p role="status">{{ assessment.errorMessage }}</p>
          </div>

          <AssessmentStep
            :group="assessment.currentGroup"
            :limit="assessment.currentLimit"
            :model-value="assessment.currentSelected"
            :career-other="assessment.careerOther"
            :disabled="flowBusy"
            @update:model-value="updateSelections"
            @update:career-other="assessment.setCareerOther"
          />

          <p
            class="assessment-page__global-status assessment-page__sr-only"
            role="status"
            aria-live="polite"
          >
            {{ assessment.announcement }}
          </p>

          <nav
            class="assessment-page__actions"
            aria-label="진단 단계 이동"
          >
            <button
              data-testid="assessment-previous"
              type="button"
              :disabled="assessment.step === 0 || flowBusy"
              @click="previousStep"
            >
              ← 이전
            </button>
            <button
              v-if="!isLastStep"
              data-testid="assessment-next"
              class="assessment-page__primary-action"
              type="button"
              :disabled="!assessment.canAdvance || flowBusy"
              @click="nextStep"
            >
              다음 →
            </button>
            <button
              v-else
              data-testid="assessment-submit"
              class="assessment-page__primary-action"
              type="button"
              :disabled="!assessment.isComplete || flowBusy"
              :aria-busy="assessment.status === 'submitting' ? 'true' : undefined"
              @click="submit"
            >
              {{ assessment.status === 'submitting' ? '결과와 진로 제안 정리 중…' : '나의 연결 경로 보기' }}
            </button>
          </nav>
        </section>
      </template>

      <AppState
        v-else-if="assessment.status === 'unauthenticated'"
        variant="error"
        message="로그인 정보를 확인할 수 없습니다. 로그인 화면으로 이동합니다."
      />
    </div>
  </main>
</template>

<style scoped>
.assessment-page {
  min-height: 100vh;
  background: var(--color-canvas);
  padding-bottom: 3rem;
}

.assessment-page__masthead {
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
  background: var(--color-surface);
}

.assessment-page__masthead-inner {
  min-height: 4.5rem;
  max-width: var(--content);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0 auto;
  padding-inline: 1.25rem;
}

.assessment-page__brand {
  min-block-size: var(--touch-target);
  min-inline-size: var(--touch-target);
  display: inline-flex;
  align-items: center;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

.assessment-page__brand span { color: var(--color-sequence); }

.assessment-page__timecode,
.assessment-page__state-code {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.07em;
}

.assessment-page__timecode {
  color: color-mix(in srgb, var(--color-ink) 60%, transparent);
  text-align: right;
}

.assessment-page__workspace {
  max-width: var(--content);
  margin: 0 auto;
  padding: 1.25rem;
}

.assessment-page__account-row {
  min-height: var(--touch-target);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.assessment-page__account-row p {
  margin: 0;
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 720;
}

.assessment-page button {
  min-height: var(--touch-target);
  border: 1px solid color-mix(in srgb, var(--color-ink) 38%, transparent);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.625rem 1rem;
  font-family: var(--font-display);
  font-weight: 720;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
}

.assessment-page button:focus-visible,
.assessment-page__brand:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.assessment-page button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.assessment-page__logout-error {
  margin: -0.75rem 0 1.25rem;
  color: var(--color-error);
  font-size: 0.875rem;
}

.assessment-page__sequence {
  min-width: 0;
}

.assessment-page__inline-error,
.assessment-page__inline-stale,
.assessment-page__validated,
.assessment-page__state-panel {
  margin-block: 1.25rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 24%, transparent);
  background: var(--color-surface);
  padding: 1rem;
}

.assessment-page__inline-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-color: var(--color-error);
  color: var(--color-error);
}

.assessment-page__inline-stale {
  border-left: 0.35rem solid var(--color-sequence);
}

.assessment-page__inline-error p,
.assessment-page__inline-stale p,
.assessment-page__validated p,
.assessment-page__state-panel p {
  margin: 0;
  line-height: 1.55;
}

.assessment-page__validated {
  border-left: 0.35rem solid var(--color-sequence);
}

.assessment-page__validated .assessment-page__state-code,
.assessment-page__state-code {
  margin-bottom: 0.75rem;
  color: var(--color-sequence);
}

.assessment-page__validated strong {
  display: block;
  margin-block: 0.35rem;
  font-family: var(--font-display);
  font-size: 1.5rem;
}

.assessment-page__validated small {
  color: color-mix(in srgb, var(--color-ink) 66%, transparent);
  line-height: 1.5;
}

.assessment-page__state-panel {
  margin-top: 4rem;
  border-top: 0.25rem solid var(--color-sequence);
}

.assessment-page__state-panel--error { border-top-color: var(--color-error); }

.assessment-page__state-panel h1 {
  margin: 0 0 0.75rem;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  letter-spacing: -0.05em;
  line-height: 1.1;
}

.assessment-page__state-panel button { margin-top: 1.25rem; }

.assessment-page__actions {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 1rem;
  border-top: 1px solid color-mix(in srgb, var(--color-ink) 24%, transparent);
  padding-top: 1rem;
}

.assessment-page .assessment-page__primary-action {
  border-color: var(--color-sequence);
  background: var(--color-sequence);
  color: var(--color-surface);
}

.assessment-page__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@media (min-width: 48rem) {
  .assessment-page__masthead-inner,
  .assessment-page__workspace { padding-inline: 0; }
  .assessment-page__workspace { padding-top: 2rem; }
}
</style>
