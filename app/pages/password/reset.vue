<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { ApiSuccess } from '../../../shared/types/api'
import { DEPARTMENT_SERVICE_BRAND, HOME_ARIA_LABEL } from '../../../shared/constants/department-brand'

const hydrated = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const form = reactive({ phone: '', deleteInterestHistory: false })

onMounted(() => {
  hydrated.value = true
})

const resetAndRestart = async (): Promise<void> => {
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch<ApiSuccess<{ kind: 'authenticated', expiresAt: string }>>('/api/student/pin/reset', {
      body: form,
      method: 'POST',
    })
    await navigateTo('/assessment', { replace: true })
  }
  catch {
    errorMessage.value = '휴대전화 번호와 확인 항목을 다시 확인해 주세요.'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="pin-reset-page">
    <header class="pin-reset-page__masthead">
      <NuxtLink class="pin-reset-page__brand" to="/" :aria-label="HOME_ARIA_LABEL">
        PHOTO:<span>NEXT</span>
      </NuxtLink>
      <span>RESET / RESTART</span>
    </header>

    <section class="pin-reset-page__frame" aria-labelledby="pin-reset-title">
      <p data-department-brand class="pin-reset-page__eyebrow">{{ DEPARTMENT_SERVICE_BRAND }}</p>
      <h1 id="pin-reset-title">초기 PIN으로<br>다시 시작하기</h1>
      <p class="pin-reset-page__intro">PIN을 잊었다면 학과 명단에 등록된 휴대전화 번호로 초기 PIN을 복구할 수 있어요.</p>

      <aside class="pin-reset-page__warning" aria-label="초기화 범위 안내">
        <strong>관심사와 결과 기록은 삭제됩니다</strong>
        <p>선택한 관심사, 결과 화면, 생성된 진로 기록을 비운 뒤 처음부터 다시 진행합니다.</p>
        <p>상담신청 내용과 처리 상태는 유지됩니다.</p>
      </aside>

      <form class="pin-reset-form" @submit.prevent="resetAndRestart">
        <fieldset :disabled="!hydrated || submitting">
          <label for="reset-phone">휴대전화 번호</label>
          <input
            id="reset-phone"
            v-model="form.phone"
            name="phone"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            placeholder="010-0000-0000"
            required
          >
          <label class="pin-reset-form__confirm" for="delete-interest-history">
            <input
              id="delete-interest-history"
              v-model="form.deleteInterestHistory"
              name="deleteInterestHistory"
              type="checkbox"
              required
            >
            <span>위 삭제 범위를 확인했고, 새로 시작할게요.</span>
          </label>
          <p v-if="errorMessage" class="pin-reset-form__error" role="alert">{{ errorMessage }}</p>
          <button type="submit">{{ submitting ? '초기화 중…' : '기록 비우고 다시 시작하기' }}</button>
        </fieldset>
      </form>

      <NuxtLink class="pin-reset-page__back" to="/login">로그인으로 돌아가기</NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.pin-reset-page { min-height: 100vh; background: var(--color-canvas); color: var(--color-primary-strong); padding: 0 1.25rem 2.5rem; }
.pin-reset-page__masthead { min-height: 4.5rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid color-mix(in srgb, var(--color-primary-strong) 16%, transparent); }
.pin-reset-page__brand { color: var(--color-primary-strong); font-family: var(--font-display); font-size: 1.125rem; font-weight: 800; letter-spacing: -0.04em; text-decoration: none; }
.pin-reset-page__brand span { color: var(--color-primary); }
.pin-reset-page__masthead > span, .pin-reset-page__eyebrow { font-family: var(--font-mono); font-size: 0.625rem; font-weight: 700; letter-spacing: 0.07em; }
.pin-reset-page__masthead > span { color: var(--color-muted); }
.pin-reset-page__frame { width: min(100%, 35rem); margin: 4.5rem auto 0; border: 1px solid color-mix(in srgb, var(--color-primary) 24%, transparent); border-radius: var(--radius-panel); background: var(--color-surface); padding: clamp(1.25rem, 5vw, 2.25rem); }
.pin-reset-page__eyebrow { margin: 0 0 0.875rem; color: var(--color-primary); }
.pin-reset-page__frame h1 { margin: 0; font-family: var(--font-display); font-size: clamp(1.75rem, 4vw, 2rem); font-weight: 760; letter-spacing: -0.06em; line-height: 1.08; word-break: keep-all; }
.pin-reset-page__intro { margin: 1rem 0 1.5rem; color: var(--color-muted); line-height: 1.65; word-break: keep-all; }
.pin-reset-page__warning { border: 1px solid color-mix(in srgb, var(--color-error) 75%, transparent); border-radius: var(--radius-control); background: color-mix(in srgb, var(--color-error) 4%, var(--color-surface)); padding: 1rem; }
.pin-reset-page__warning strong { color: var(--color-error); font-family: var(--font-display); }
.pin-reset-page__warning p { margin: 0.5rem 0 0; color: var(--color-muted); font-size: 0.875rem; line-height: 1.55; }
.pin-reset-form { margin-top: 1.5rem; }
.pin-reset-form fieldset { display: grid; gap: 0.75rem; margin: 0; border: 0; padding: 0; }
.pin-reset-form label { font-family: var(--font-display); font-size: 0.875rem; font-weight: 700; }
.pin-reset-form > fieldset > input { min-height: 3.25rem; border: 1px solid color-mix(in srgb, var(--color-primary-strong) 30%, transparent); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-primary-strong); padding: 0.75rem; }
.pin-reset-form__confirm { display: flex; align-items: flex-start; gap: 0.625rem; color: var(--color-muted); font-family: var(--font-body) !important; font-weight: 500 !important; line-height: 1.5; }
.pin-reset-form__confirm input { width: 1.125rem; height: 1.125rem; margin-top: 0.12rem; accent-color: var(--color-primary); }
.pin-reset-form__error { margin: 0; color: var(--color-error); font-size: 0.875rem; }
.pin-reset-form button { min-height: 3.25rem; border: 1px solid var(--color-primary); border-radius: var(--radius-control); background: var(--color-primary); color: var(--color-surface); font-family: var(--font-display); font-weight: 750; cursor: pointer; }
.pin-reset-page__back { display: inline-block; margin-top: 1.25rem; color: var(--color-primary-strong); font-size: 0.8125rem; text-underline-offset: 0.2em; }
.pin-reset-form input:focus-visible, .pin-reset-form button:focus-visible, .pin-reset-page a:focus-visible { outline: 3px solid var(--color-primary); outline-offset: 3px; }
.pin-reset-form button:disabled { cursor: wait; opacity: 0.66; }
@media (min-width: 48rem) { .pin-reset-page { padding-inline: 2.5rem; } .pin-reset-page__frame { margin-top: 6rem; } }
</style>
