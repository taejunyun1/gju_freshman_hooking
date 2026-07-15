<script setup lang="ts">
import { computed, ref } from 'vue'
import { z } from 'zod'
import {
  studentCounselingStatusSchema,
  type StudentCounselingStatus,
} from '../../../shared/schemas/counseling'

const props = defineProps<{
  assessmentPublicId: string
}>()

const emit = defineEmits<{
  submitted: [request: StudentCounselingStatus]
}>()

const contactMethods = [
  { value: 'phone', label: '전화' },
  { value: 'text', label: '문자' },
  { value: 'visit', label: '방문' },
] as const

const availabilities = [
  { value: 'weekday_morning', label: '평일 오전' },
  { value: 'weekday_afternoon', label: '평일 오후' },
  { value: 'weekday_evening', label: '평일 저녁' },
  { value: 'weekend', label: '주말' },
] as const

const canonicalUuidSchema = z.string().uuid()
const responseSchema = z.object({
  data: studentCounselingStatusSchema,
  requestId: z.string().min(1),
}).strict()

const contactMethod = ref<(typeof contactMethods)[number]['value']>('phone')
const availability = ref<(typeof availabilities)[number]['value']>('weekday_afternoon')
const inquiry = ref('')
const consent = ref(false)
const pending = ref(false)
const errorMessage = ref('')
const authExpired = ref(false)
const loginTarget = computed(() => ({
  path: '/login',
  query: {
    redirect: `/counseling?assessmentPublicId=${encodeURIComponent(props.assessmentPublicId)}`,
  },
}))

const isValid = computed(() => (
  canonicalUuidSchema.safeParse(props.assessmentPublicId).success
  && inquiry.value.length <= 200
  && consent.value
))

const publicErrorCode = (error: unknown): string | null => {
  if (error === null || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const responseData = record.response !== null && typeof record.response === 'object'
    ? (record.response as Record<string, unknown>)._data
    : undefined
  const payload = record.data !== null && typeof record.data === 'object'
    ? record.data
    : responseData !== null && typeof responseData === 'object'
      ? responseData
      : null
  if (payload === null || typeof payload !== 'object') return null
  const publicError = (payload as Record<string, unknown>).error
  if (publicError === null || typeof publicError !== 'object') return null
  const code = (publicError as Record<string, unknown>).code
  return typeof code === 'string' ? code : null
}

const submit = async (): Promise<void> => {
  if (pending.value || !isValid.value) return
  pending.value = true
  errorMessage.value = ''
  authExpired.value = false
  try {
    const response = await $fetch<unknown>('/api/counseling', {
      method: 'POST',
      body: {
        assessmentPublicId: props.assessmentPublicId,
        contactMethod: contactMethod.value,
        availability: availability.value,
        inquiry: inquiry.value.trim() || null,
        consent: true,
      },
    })
    const parsed = responseSchema.safeParse(response)
    if (!parsed.success) throw new Error('COUNSELING_RESPONSE_INVALID')
    emit('submitted', parsed.data.data)
  }
  catch (error) {
    if (publicErrorCode(error) === 'AUTH_FAILED') {
      errorMessage.value = '로그인 정보가 만료되었습니다. 로그인한 뒤 다시 신청해 주세요.'
      authExpired.value = true
    }
    else {
      errorMessage.value = '상담을 신청하지 못했습니다. 입력 내용은 그대로 두었으니 다시 시도해 주세요.'
    }
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <form
    class="counseling-form"
    novalidate
    @submit.prevent="submit"
  >
    <header class="counseling-form__heading">
      <p>REQUEST CARD / 01</p>
      <h1>상담을 신청합니다</h1>
      <span>연락받기 편한 방법과 시간을 알려주세요. 신청 후 관리자가 담당 교수를 확정합니다.</span>
    </header>

    <fieldset>
      <legend>상담 방법</legend>
      <div class="counseling-form__choices counseling-form__choices--three">
        <label
          v-for="method in contactMethods"
          :key="method.value"
        >
          <input
            v-model="contactMethod"
            type="radio"
            name="contactMethod"
            :value="method.value"
          >
          <span>{{ method.label }}</span>
        </label>
      </div>
    </fieldset>

    <fieldset>
      <legend>연락 가능 시간</legend>
      <div class="counseling-form__choices counseling-form__choices--four">
        <label
          v-for="item in availabilities"
          :key="item.value"
        >
          <input
            v-model="availability"
            type="radio"
            name="availability"
            :value="item.value"
          >
          <span>{{ item.label }}</span>
        </label>
      </div>
    </fieldset>

    <div class="counseling-form__inquiry">
      <div class="counseling-form__label-line">
        <label for="counseling-inquiry">문의 내용 <small>선택</small></label>
        <output
          data-testid="inquiry-counter"
          for="counseling-inquiry"
          aria-live="polite"
        >{{ inquiry.length }} / 200</output>
      </div>
      <textarea
        id="counseling-inquiry"
        v-model="inquiry"
        name="inquiry"
        maxlength="200"
        rows="5"
        placeholder="궁금한 수업, 장비, 포트폴리오 또는 입학 준비를 적어주세요."
      />
    </div>

    <label class="counseling-form__consent">
      <input
        v-model="consent"
        type="checkbox"
        name="consent"
        required
      >
      <span>
        상담을 위해 학생 정보와 진단 결과를 담당 교수에게 전달하는 데 동의합니다.
        <small>상담 연결에 필요한 정보만 전달됩니다.</small>
      </span>
    </label>

    <p
      v-if="errorMessage"
      class="counseling-form__error"
      role="alert"
    >{{ errorMessage }}</p>

    <NuxtLink
      v-if="authExpired"
      class="counseling-form__auth-link"
      :to="loginTarget"
      target="_blank"
      rel="noopener"
    >새 창에서 로그인한 뒤 이 창으로 돌아와 신청하기</NuxtLink>

    <button
      type="submit"
      :disabled="!isValid || pending"
      :aria-busy="pending ? 'true' : undefined"
    >
      {{ pending ? '상담 신청 중…' : '상담 신청하기' }}
    </button>
  </form>
</template>

<style scoped>
.counseling-form {
  display: grid;
  gap: 2rem;
  border-top: 0.4rem solid var(--color-sequence);
  background: var(--color-surface);
  padding: clamp(1.25rem, 5vw, 2rem);
}

.counseling-form__heading > p {
  margin: 0;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.counseling-form__heading h1 {
  margin: 0.45rem 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.85rem, 7vw, 2.75rem);
  letter-spacing: -0.05em;
  line-height: 1.12;
  word-break: keep-all;
}

.counseling-form__heading > span {
  display: block;
  margin-top: 0.75rem;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  line-height: 1.65;
  word-break: keep-all;
}

.counseling-form fieldset {
  min-width: 0;
  margin: 0;
  border: 0;
  padding: 0;
}

.counseling-form legend,
.counseling-form__label-line label {
  margin-bottom: 0.75rem;
  padding: 0;
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 750;
}

.counseling-form__choices {
  display: grid;
  gap: 0.5rem;
}

.counseling-form__choices label {
  position: relative;
  min-width: 0;
}

.counseling-form__choices input {
  position: absolute;
  inset: 0;
  opacity: 0;
}

.counseling-form__choices span {
  min-height: var(--touch-target);
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
  border-radius: 0.125rem;
  background: var(--color-surface);
  padding: 0.625rem;
  font-weight: 650;
  cursor: pointer;
}

.counseling-form__choices input:checked + span {
  border-color: var(--color-sequence);
  background: color-mix(in srgb, var(--color-sequence) 9%, var(--color-surface));
  color: var(--color-sequence);
}

.counseling-form__choices input:focus-visible + span {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.counseling-form__label-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.counseling-form__label-line label { margin: 0; }
.counseling-form__label-line small { color: color-mix(in srgb, var(--color-ink) 56%, transparent); }

.counseling-form__label-line output {
  color: var(--color-resource);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 700;
}

.counseling-form textarea {
  width: 100%;
  min-height: 8.5rem;
  display: block;
  margin-top: 0.75rem;
  resize: vertical;
  border: 1px solid color-mix(in srgb, var(--color-ink) 32%, transparent);
  border-radius: 0.125rem;
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.85rem;
  line-height: 1.6;
}

.counseling-form textarea:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 2px;
}

.counseling-form__consent {
  min-height: var(--touch-target);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--color-resource) 38%, transparent);
  background: color-mix(in srgb, var(--color-resource) 5%, var(--color-surface));
  padding: 1rem;
  line-height: 1.55;
  cursor: pointer;
}

.counseling-form__consent input {
  width: 1.25rem;
  height: 1.25rem;
  margin: 0.15rem 0 0;
  accent-color: var(--color-sequence);
}

.counseling-form__consent input:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.counseling-form__consent small {
  display: block;
  margin-top: 0.25rem;
  color: color-mix(in srgb, var(--color-ink) 60%, transparent);
}

.counseling-form__error {
  margin: -0.5rem 0 0;
  border-left: 0.25rem solid var(--color-error);
  color: var(--color-error);
  padding-left: 0.75rem;
  line-height: 1.55;
}

.counseling-form__auth-link {
  min-height: var(--touch-target);
  width: fit-content;
  display: inline-flex;
  align-items: center;
  margin-top: -1rem;
  color: var(--color-sequence);
  font-family: var(--font-display);
  font-weight: 750;
  text-underline-offset: 0.25rem;
}

.counseling-form__auth-link:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.counseling-form > button {
  min-height: var(--touch-target);
  width: 100%;
  border: 1px solid var(--color-sequence);
  border-radius: 0.125rem;
  background: var(--color-sequence);
  color: var(--color-surface);
  padding: 0.75rem 1rem;
  font-family: var(--font-display);
  font-weight: 750;
  cursor: pointer;
}

.counseling-form > button:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.counseling-form > button:disabled {
  border-color: color-mix(in srgb, var(--color-ink) 22%, transparent);
  background: color-mix(in srgb, var(--color-ink) 12%, var(--color-surface));
  color: color-mix(in srgb, var(--color-ink) 52%, transparent);
  cursor: not-allowed;
}

@media (min-width: 42rem) {
  .counseling-form__choices--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .counseling-form__choices--four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .counseling-form > button { width: fit-content; min-width: 12rem; justify-self: end; }
}
</style>
