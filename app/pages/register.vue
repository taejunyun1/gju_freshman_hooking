<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { DEPARTMENT_SERVICE_BRAND, HOME_ARIA_LABEL } from '../../shared/constants/department-brand'
import { applicantRosterRowSchema, type ApplicantRosterRow } from '../../shared/schemas/admission-roster'
import type { ApiSuccess } from '../../shared/types/api'
import { MAX_APPLICANT_NAME_LENGTH } from '../../shared/utils/applicant-normalization'
import {
  formatStudentPhoneInput,
  studentPhoneInputDigits,
} from '../utils/student-phone-input'

type RegistrationResult =
  | { kind: 'created', expiresAt: string }
  | { kind: 'existing' }
  | { kind: 'rate_limited' }

const hydrated = ref(false)
const submitting = ref(false)
const registrationState = ref<'idle' | 'existing'>('idle')
const errorMessage = ref('')
const form = reactive({ name: '', phone: '', highSchool: '', grade: '' })
const fieldErrors = reactive({ name: '', phone: '', highSchool: '', grade: '' })

onMounted(() => {
  hydrated.value = true
})

const formatRegistrationPhoneInput = (value: string): string => {
  const digits = studentPhoneInputDigits(value)
  const formatted = formatStudentPhoneInput(digits)
  return digits.length <= 11 ? formatted : `${formatted}${digits.slice(11)}`
}

const updatePhone = (event: Event): void => {
  const input = event.target as HTMLInputElement
  const formatted = formatRegistrationPhoneInput(input.value)
  fieldErrors.phone = ''
  form.phone = formatted
  input.value = formatted
}

const pastePhone = (event: ClipboardEvent): void => {
  if (!event.cancelable || !event.clipboardData) return
  event.preventDefault()

  const input = event.target as HTMLInputElement
  const selectionStart = input.selectionStart ?? input.value.length
  const selectionEnd = input.selectionEnd ?? selectionStart
  const beforeSelection = input.value.slice(0, selectionStart)
  const pastedText = event.clipboardData.getData('text')
  const formatted = formatRegistrationPhoneInput(
    `${beforeSelection}${pastedText}${input.value.slice(selectionEnd)}`,
  )
  const caret = Math.min(
    formatRegistrationPhoneInput(`${beforeSelection}${pastedText}`).length,
    formatted.length,
  )

  form.phone = formatted
  fieldErrors.phone = ''
  input.value = formatted
  input.setSelectionRange(caret, caret)
}

const validateRegistrationInput = (): ApplicantRosterRow | null => {
  fieldErrors.name = ''
  fieldErrors.phone = ''
  fieldErrors.highSchool = ''
  fieldErrors.grade = ''

  let name: ApplicantRosterRow['name'] | undefined
  let phone: ApplicantRosterRow['phone'] | undefined
  let highSchool: ApplicantRosterRow['highSchool'] | undefined
  let grade: ApplicantRosterRow['grade'] | undefined
  try {
    name = applicantRosterRowSchema.shape.name.parse(form.name)
  }
  catch {
    fieldErrors.name = '이름은 1자 이상 40자 이하로 입력해 주세요.'
  }
  try {
    phone = applicantRosterRowSchema.shape.phone.parse(studentPhoneInputDigits(form.phone))
  }
  catch {
    fieldErrors.phone = '휴대전화 번호는 010으로 시작하는 숫자 11자리여야 합니다.'
  }
  try {
    highSchool = applicantRosterRowSchema.shape.highSchool.parse(form.highSchool)
  }
  catch {
    fieldErrors.highSchool = '고등학교는 1자 이상 40자 이하로 입력해 주세요.'
  }
  try {
    grade = applicantRosterRowSchema.shape.grade.parse(form.grade)
  }
  catch {
    fieldErrors.grade = '학년을 선택해 주세요.'
  }

  if (name === undefined || phone === undefined || highSchool === undefined || grade === undefined) return null
  return { name, phone, highSchool, grade }
}

const submitRegistration = async (): Promise<void> => {
  if (registrationState.value === 'existing') return

  const input = validateRegistrationInput()
  if (!input) {
    errorMessage.value = ''
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<RegistrationResult>>('/api/student/register', {
      body: {
        name: input.name,
        phone: input.phone,
        highSchool: input.highSchool,
        grade: input.grade,
      },
      method: 'POST',
    })

    if (response.data.kind === 'created') {
      await navigateTo('/assessment', { replace: true })
      return
    }
    if (response.data.kind === 'existing') {
      registrationState.value = 'existing'
      return
    }
    errorMessage.value = '등록 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
  }
  catch {
    errorMessage.value = '등록을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="register-page">
    <header class="register-page__masthead">
      <NuxtLink
        class="register-page__brand"
        to="/"
        :aria-label="HOME_ARIA_LABEL"
      >
        PHOTO:<span>NEXT</span>
      </NuxtLink>
      <span class="register-page__timecode">START / IN</span>
    </header>

    <section
      class="register-page__frame"
      aria-labelledby="register-title"
    >
      <div
        class="register-page__rail"
        aria-hidden="true"
      >
        <span class="register-page__rail-dot--active" />
        <i />
        <span />
      </div>
      <div>
        <p data-department-brand class="register-page__eyebrow">{{ DEPARTMENT_SERVICE_BRAND }}</p>
        <h1 id="register-title">처음이라면,<br>간단히 시작해요</h1>
        <p class="register-page__intro">이름과 학교 정보를 남기면 관심사 진단을 바로 시작할 수 있어요.</p>

        <form
          class="register-form"
          novalidate
          @submit.prevent="submitRegistration"
        >
          <fieldset
            class="register-form__fieldset"
            :disabled="!hydrated || submitting || registrationState === 'existing'"
          >
            <div class="register-form__field">
              <label for="register-name">이름</label>
              <input
                id="register-name"
                v-model="form.name"
                name="name"
                autocomplete="name"
                :maxlength="MAX_APPLICANT_NAME_LENGTH"
                :aria-invalid="fieldErrors.name ? 'true' : undefined"
                :aria-describedby="fieldErrors.name ? 'register-name-error' : undefined"
                required
                @input="fieldErrors.name = ''"
              >
              <p
                v-if="fieldErrors.name"
                id="register-name-error"
                class="register-form__field-error"
                role="alert"
              >
                {{ fieldErrors.name }}
              </p>
            </div>
            <div class="register-form__field">
              <label for="register-phone">휴대전화 번호</label>
              <input
                id="register-phone"
                :value="form.phone"
                name="phone"
                type="tel"
                inputmode="numeric"
                maxlength="13"
                autocomplete="tel"
                placeholder="010-0000-0000"
                :aria-invalid="fieldErrors.phone ? 'true' : undefined"
                :aria-describedby="fieldErrors.phone ? 'register-phone-error' : undefined"
                required
                @input="updatePhone"
                @paste="pastePhone"
              >
              <p
                v-if="fieldErrors.phone"
                id="register-phone-error"
                class="register-form__field-error"
                role="alert"
              >
                {{ fieldErrors.phone }}
              </p>
            </div>
            <div class="register-form__field">
              <label for="register-high-school">고등학교</label>
              <input
                id="register-high-school"
                v-model="form.highSchool"
                name="highSchool"
                autocomplete="organization"
                maxlength="40"
                :aria-invalid="fieldErrors.highSchool ? 'true' : undefined"
                :aria-describedby="fieldErrors.highSchool ? 'register-high-school-error' : undefined"
                required
                @input="fieldErrors.highSchool = ''"
              >
              <p
                v-if="fieldErrors.highSchool"
                id="register-high-school-error"
                class="register-form__field-error"
                role="alert"
              >
                {{ fieldErrors.highSchool }}
              </p>
            </div>
            <div class="register-form__field">
              <label for="register-grade">학년</label>
              <select
                id="register-grade"
                v-model="form.grade"
                name="grade"
                :aria-invalid="fieldErrors.grade ? 'true' : undefined"
                :aria-describedby="fieldErrors.grade ? 'register-grade-error' : undefined"
                required
                @change="fieldErrors.grade = ''"
              >
                <option disabled value="">학년 선택</option>
                <option value="high1">고1</option>
                <option value="high2">고2</option>
                <option value="high3">고3</option>
                <option value="graduate">고교 졸업</option>
                <option value="ged">검정고시</option>
                <option value="other">기타</option>
              </select>
              <p
                v-if="fieldErrors.grade"
                id="register-grade-error"
                class="register-form__field-error"
                role="alert"
              >
                {{ fieldErrors.grade }}
              </p>
            </div>
            <p class="register-form__notice">PIN은 자동 생성되며, 다음 로그인부터 사용합니다.</p>
            <p
              v-if="errorMessage"
              class="register-form__error"
              role="alert"
            >
              {{ errorMessage }}
            </p>
            <p
              v-if="registrationState === 'existing'"
              class="register-form__existing"
              role="status"
            >
              이미 등록된 번호입니다. 로그인으로 이동해 주세요.
              <NuxtLink to="/login">로그인하기</NuxtLink>
            </p>
            <button
              v-else
              class="register-form__submit"
              type="submit"
            >
              {{ submitting ? '등록 중…' : '관심사 진단 시작하기' }}
            </button>
          </fieldset>
        </form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.register-page {
  min-height: 100vh;
  background: var(--color-canvas);
  padding: 0 1.25rem 2.5rem;
}

.register-page__masthead {
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid color-mix(in srgb, var(--color-primary-strong) 16%, transparent);
}

.register-page__brand {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  min-inline-size: 2.75rem;
  color: var(--color-primary-strong);
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

.register-page__brand span { color: var(--color-primary); }

.register-page__timecode,
.register-page__eyebrow {
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
}

.register-page__timecode {
  color: var(--color-muted);
  font-size: 0.625rem;
}

.register-page__frame {
  max-width: 35rem;
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  gap: 1rem;
  margin: 3rem auto 0;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  padding: clamp(1.25rem, 5vw, 2.25rem);
}

.register-page__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 0.3rem;
}

.register-page__rail span {
  width: 0.625rem;
  height: 0.625rem;
  flex: 0 0 auto;
  border: 1px solid var(--color-primary);
  border-radius: 50%;
  background: var(--color-surface);
}

.register-page__rail .register-page__rail-dot--active { background: var(--color-primary); }

.register-page__rail i {
  width: 1px;
  min-height: 4.25rem;
  background: color-mix(in srgb, var(--color-primary) 50%, transparent);
}

.register-page__eyebrow {
  margin: 0 0 0.875rem;
  color: var(--color-primary);
  font-size: 0.625rem;
  font-weight: 700;
}

.register-page__frame h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  font-weight: 760;
  letter-spacing: -0.06em;
  line-height: 1.12;
  word-break: keep-all;
}

.register-page__intro {
  margin: 1rem 0 2rem;
  color: var(--color-muted);
  line-height: 1.65;
  word-break: keep-all;
}

.register-form__fieldset {
  min-inline-size: 0;
  display: grid;
  gap: 1.25rem;
  margin: 0;
  border: 0;
  padding: 0;
}

.register-form__field { display: grid; gap: 0.5rem; }

.register-form label {
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 700;
}

.register-form input,
.register-form select {
  min-height: 3.25rem;
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--color-primary-strong) 30%, transparent);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-primary-strong);
  padding: 0.75rem;
}

.register-form input:focus-visible,
.register-form select:focus-visible,
.register-form__submit:focus-visible,
.register-page__brand:focus-visible,
.register-form__existing a:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.register-form__notice,
.register-form__field-error,
.register-form__error,
.register-form__existing {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.55;
}

.register-form__notice { color: var(--color-muted); }
.register-form__field-error { margin: 0; color: var(--color-error); font-size: 0.8125rem; line-height: 1.5; }
.register-form__error { color: var(--color-error); }
.register-form__existing { color: var(--color-primary-strong); }
.register-form__existing a { color: var(--color-primary); text-underline-offset: 0.2em; }

.register-form__submit {
  min-height: 3.25rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-control);
  background: var(--color-primary);
  color: var(--color-surface);
  font-family: var(--font-display);
  font-weight: 750;
  cursor: pointer;
}

.register-form__submit:disabled { cursor: wait; opacity: 0.66; }

@media (min-width: 48rem) {
  .register-page { padding-inline: 2.5rem; }
  .register-page__frame { margin-top: 4.5rem; }
}
</style>
