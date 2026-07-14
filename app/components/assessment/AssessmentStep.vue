<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PublicAssessmentCatalog } from '../../../shared/types/api'
import type { QuestionGroup } from '../../../shared/types/domain'
import { careerOtherDraftError } from '../../stores/assessment'
import OptionCard from './OptionCard.vue'

const props = withDefaults(defineProps<{
  group: PublicAssessmentCatalog['groups'][number]
  limit: { min: number, max: number }
  modelValue: string[]
  careerOther: string
  disabled?: boolean
}>(), { disabled: false })

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'update:careerOther': [value: string]
}>()

const groupCopy: Record<QuestionGroup, { eyebrow: string, legend: string }> = {
  work: { eyebrow: 'WORK / CONTACT SHEET', legend: '무엇을 해보고 싶나요?' },
  result: { eyebrow: 'RESULT / CONTACT SHEET', legend: '어떤 결과물을 만들고 싶나요?' },
  style: { eyebrow: 'STYLE / CONTACT SHEET', legend: '어떤 방식으로 작업하고 싶나요?' },
  career: { eyebrow: 'CAREER / CONTACT SHEET', legend: '어떤 방향을 탐색하고 싶나요?' },
}

const announcement = ref('')
const careerError = ref('')

watch(() => props.group.key, () => {
  announcement.value = ''
  careerError.value = ''
})

const toggle = (key: string): void => {
  if (props.disabled) return
  if (props.modelValue.includes(key)) {
    emit('update:modelValue', props.modelValue.filter(value => value !== key))
    if (key === 'career.explore') {
      careerError.value = ''
      emit('update:careerOther', '')
    }
    announcement.value = `선택 ${props.modelValue.length - 1} / ${props.limit.max}`
    return
  }
  if (props.modelValue.length >= props.limit.max) {
    announcement.value = `최대 ${props.limit.max}개까지 선택할 수 있어요.`
    return
  }
  emit('update:modelValue', [...props.modelValue, key])
  announcement.value = `선택 ${props.modelValue.length + 1} / ${props.limit.max}`
}

const updateCareerOther = (event: Event): void => {
  if (props.disabled) return
  const value = (event.target as HTMLInputElement).value
  const issue = careerOtherDraftError(value)
  if (issue) {
    careerError.value = issue
    announcement.value = issue
    return
  }
  careerError.value = ''
  emit('update:careerOther', value)
  announcement.value = `${value.length} / 30자 입력`
}
</script>

<template>
  <fieldset
    class="assessment-step"
    :disabled="disabled"
  >
    <legend tabindex="-1">{{ groupCopy[group.key].legend }}</legend>
    <p class="assessment-step__eyebrow">{{ groupCopy[group.key].eyebrow }}</p>
    <p class="assessment-step__instruction">
      {{ limit.min }}–{{ limit.max }}개를 골라주세요.
    </p>

    <div class="assessment-step__grid">
      <OptionCard
        v-for="option in group.options"
        :key="option.key"
        :option="option"
        :selected="modelValue.includes(option.key)"
        @toggle="toggle"
      />
    </div>

    <div
      v-if="group.key === 'career' && modelValue.includes('career.explore')"
      class="assessment-step__career-other"
    >
      <div class="assessment-step__input-heading">
        <label for="career-other">탐색하고 싶은 다른 가능성</label>
        <span aria-hidden="true">{{ careerOther.length }} / 30</span>
      </div>
      <input
        id="career-other"
        name="careerOther"
        type="text"
        :value="careerOther"
        maxlength="30"
        autocomplete="off"
        :aria-describedby="careerError
          ? 'career-other-privacy career-other-error'
          : 'career-other-privacy'"
        @input="updateCareerOther"
      >
      <p id="career-other-privacy">진로 관심사만 적어주세요. 전화번호나 이메일은 입력하지 마세요.</p>
      <p
        v-if="careerError"
        id="career-other-error"
      >
        {{ careerError }}
      </p>
    </div>

    <div class="assessment-step__selection-line">
      <span>선택 {{ modelValue.length }} / {{ limit.max }}</span>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >{{ announcement }}</span>
    </div>
  </fieldset>
</template>

<style scoped>
.assessment-step {
  min-width: 0;
  margin: 0;
  border: 0;
  padding: 2rem 0 0;
}

.assessment-step legend {
  max-width: 34rem;
  padding: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 7vw, 2.75rem);
  font-weight: 760;
  letter-spacing: -0.055em;
  line-height: 1.08;
  word-break: keep-all;
}

.assessment-step__eyebrow {
  margin: 1rem 0 0;
  color: var(--color-sequence);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.assessment-step__instruction {
  margin: 0.5rem 0 1.5rem;
  color: color-mix(in srgb, var(--color-ink) 70%, transparent);
  font-size: 0.9375rem;
}

.assessment-step__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.assessment-step__career-other {
  margin-top: 1.25rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 28%, transparent);
  background: var(--color-surface);
  padding: 1rem;
}

.assessment-step__input-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.assessment-step__input-heading label {
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 720;
}

.assessment-step__input-heading span {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.assessment-step__career-other input {
  width: 100%;
  min-height: var(--touch-target);
  margin-top: 0.625rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 38%, transparent);
  border-radius: 0;
  background: var(--color-canvas);
  color: var(--color-ink);
  padding: 0.625rem 0.75rem;
}

.assessment-step__career-other input:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 2px;
}

.assessment-step__career-other p {
  margin: 0.625rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  font-size: 0.75rem;
  line-height: 1.5;
}

.assessment-step__career-other #career-other-error {
  color: var(--color-error);
  font-weight: 700;
}

.assessment-step__selection-line {
  min-height: var(--touch-target);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.25rem;
  border-top: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent);
  padding-top: 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.assessment-step__selection-line [role='status'] {
  color: var(--color-error);
  text-align: right;
}

@media (max-width: 23rem) {
  .assessment-step__grid { grid-template-columns: 1fr; }
}

@media (min-width: 42rem) {
  .assessment-step__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
