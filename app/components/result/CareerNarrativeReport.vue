<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { z } from 'zod'

import {
  careerNarrativeReportApiSuccessSchema,
  careerNarrativeReportCategorySchema,
  type CareerNarrativeReportCategory,
} from '../../../shared/schemas/career-narrative-report'

const choices = [
  { value: 'inaccurate', label: '사실과 다른 내용' },
  { value: 'unsafe', label: '불편하거나 위험한 표현' },
  { value: 'confusing', label: '이해하기 어려운 내용' },
] as const

const studentSessionResponseSchema = z.object({
  data: z.object({
    csrfToken: z.string().min(1),
    prospectId: z.number().int().positive(),
    nickname: z.string().min(1),
    expiresAt: z.string().min(1),
  }).strict(),
  requestId: z.string().min(1),
}).strict()

const opener = ref<HTMLButtonElement | null>(null)
const formRoot = ref<HTMLFormElement | null>(null)
const open = ref(false)
const selected = ref<CareerNarrativeReportCategory | null>(null)
const pending = ref(false)
const statusMessage = ref('')
const errorMessage = ref('')

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

const focusOpener = async (): Promise<void> => {
  await nextTick()
  opener.value?.focus()
}

const show = async (): Promise<void> => {
  if (pending.value) return
  open.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  await nextTick()
  formRoot.value?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus()
}

const close = async (): Promise<void> => {
  if (pending.value) return
  open.value = false
  errorMessage.value = ''
  await focusOpener()
}

const submit = async (): Promise<void> => {
  const parsedCategory = careerNarrativeReportCategorySchema.safeParse(selected.value)
  if (pending.value || !parsedCategory.success) return

  pending.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const sessionResponse = studentSessionResponseSchema.parse(
      await $fetch<unknown>('/api/student/session'),
    )
    const response = await $fetch<unknown>('/api/career-narrative/report', {
      body: {
        assessmentPublicId: props.assessmentPublicId,
        category: parsedCategory.data,
      },
      headers: { 'x-photo-next-csrf': sessionResponse.data.csrfToken },
      method: 'POST',
    })
    careerNarrativeReportApiSuccessSchema.parse(response)
    pending.value = false
    open.value = false
    statusMessage.value = '알려주셔서 감사합니다. 담당자가 확인하겠습니다.'
    await focusOpener()
  }
  catch (error) {
    errorMessage.value = publicErrorCode(error) === 'AUTH_FAILED'
      ? '로그인 정보가 만료되었습니다. 다시 로그인한 뒤 알려주세요.'
      : '내용을 알리지 못했습니다. 선택은 유지되니 다시 시도해 주세요.'
  }
  finally {
    pending.value = false
  }
}

const props = defineProps<{
  assessmentPublicId: string
}>()
</script>

<template>
  <div class="career-narrative-report">
    <button
      ref="opener"
      data-testid="career-narrative-report-open"
      type="button"
      :aria-expanded="open"
      aria-controls="career-narrative-report-form"
      :disabled="pending"
      @click="show"
    >
      내용 알리기
    </button>

    <form
      v-if="open"
      id="career-narrative-report-form"
      ref="formRoot"
      @submit.prevent="submit"
      @keydown.esc.prevent="close"
    >
      <fieldset :disabled="pending">
        <legend>어떤 내용인지 선택해 주세요</legend>
        <label
          v-for="choice in choices"
          :key="choice.value"
        >
          <input
            v-model="selected"
            type="radio"
            name="career-narrative-report-category"
            :value="choice.value"
          >
          <span>{{ choice.label }}</span>
        </label>
      </fieldset>

      <div class="career-narrative-report__actions">
        <button
          type="submit"
          :disabled="selected === null || pending"
          :aria-busy="pending ? 'true' : undefined"
        >
          {{ pending ? '알리는 중…' : '이 내용 알리기' }}
        </button>
        <button
          data-testid="career-narrative-report-cancel"
          type="button"
          :disabled="pending"
          @click="close"
        >
          닫기
        </button>
      </div>
    </form>

    <p
      v-if="statusMessage"
      class="career-narrative-report__status"
      role="status"
      aria-live="polite"
    >{{ statusMessage }}</p>
    <p
      v-if="errorMessage"
      class="career-narrative-report__error"
      role="alert"
    >{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.career-narrative-report {
  margin-top: 1rem;
}

.career-narrative-report > button,
.career-narrative-report__actions button {
  min-height: var(--touch-target);
  border-radius: var(--radius-control);
  font-family: var(--font-display);
  font-weight: 720;
  cursor: pointer;
}

.career-narrative-report > button {
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 34%, transparent);
  background: transparent;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  padding: 0.45rem 0;
}

.career-narrative-report form {
  max-width: 42rem;
  margin-top: 0.75rem;
  border-top: 1px dashed color-mix(in srgb, var(--color-ink) 24%, transparent);
  padding-top: 1rem;
}

.career-narrative-report fieldset {
  min-width: 0;
  display: grid;
  gap: 0.5rem;
  margin: 0;
  border: 0;
  padding: 0;
}

.career-narrative-report legend {
  margin-bottom: 0.6rem;
  padding: 0;
  font-family: var(--font-display);
  font-size: 0.9rem;
  font-weight: 740;
}

.career-narrative-report label {
  position: relative;
}

.career-narrative-report label input {
  position: absolute;
  inset: 0;
  opacity: 0;
}

.career-narrative-report label span {
  min-height: var(--touch-target);
  display: flex;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--color-ink) 24%, transparent);
  background: var(--color-surface);
  padding: 0.65rem 0.75rem;
  cursor: pointer;
}

.career-narrative-report label input:checked + span {
  border-color: var(--color-sequence);
  color: var(--color-sequence);
  box-shadow: inset 0.25rem 0 0 var(--color-sequence);
}

.career-narrative-report label input:focus-visible + span,
.career-narrative-report button:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.career-narrative-report__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.career-narrative-report__actions button {
  border: 1px solid var(--color-sequence);
  background: var(--color-sequence);
  color: var(--color-surface);
  padding: 0.55rem 0.85rem;
}

.career-narrative-report__actions button:last-child {
  background: var(--color-surface);
  color: var(--color-ink);
}

.career-narrative-report button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.career-narrative-report__status,
.career-narrative-report__error {
  max-width: 42rem;
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  line-height: 1.55;
  word-break: keep-all;
}

.career-narrative-report__status {
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
}

.career-narrative-report__error {
  border-left: 0.22rem solid var(--color-error);
  color: var(--color-error);
  padding-left: 0.65rem;
}
</style>
