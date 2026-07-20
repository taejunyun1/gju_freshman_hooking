<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { ApiSuccess, StudentSession } from '../../shared/types/api'
import { DEPARTMENT_SERVICE_BRAND, HOME_ARIA_LABEL } from '../../shared/constants/department-brand'

const hydrated = ref(false)
const loadingSession = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const csrfToken = ref('')
const form = reactive({ currentPin: '', nextPin: '', nextPinConfirm: '' })

onMounted(async () => {
  hydrated.value = true
  try {
    const response = await $fetch<ApiSuccess<StudentSession>>('/api/student/session')
    csrfToken.value = response.data.csrfToken
  }
  catch {
    await navigateTo('/login', { replace: true })
  }
  finally {
    loadingSession.value = false
  }
})

const changePin = async (): Promise<void> => {
  if (!csrfToken.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch<ApiSuccess<{ kind: 'authenticated', expiresAt: string }>>('/api/student/pin', {
      body: form,
      headers: { 'x-photo-next-csrf': csrfToken.value },
      method: 'POST',
    })
    await navigateTo('/assessment', { replace: true })
  }
  catch {
    errorMessage.value = '현재 PIN과 새 PIN을 다시 확인해 주세요.'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="pin-page">
    <header class="pin-page__masthead">
      <NuxtLink class="pin-page__brand" to="/" :aria-label="HOME_ARIA_LABEL">PHOTO:<span>NEXT</span></NuxtLink>
      <span>ACCOUNT / PIN</span>
    </header>

    <section class="pin-page__frame" aria-labelledby="pin-title">
      <p data-department-brand class="pin-page__eyebrow">{{ DEPARTMENT_SERVICE_BRAND }}</p>
      <h1 id="pin-title">내 PIN 바꾸기</h1>
      <p class="pin-page__intro">다음 방문에도 이어서 볼 수 있도록, 기억하기 쉬운 여섯 자리 숫자로 바꿔 주세요.</p>

      <form class="pin-form" @submit.prevent="changePin">
        <fieldset :disabled="!hydrated || loadingSession || submitting || !csrfToken">
          <label for="current-pin">현재 PIN</label>
          <input id="current-pin" v-model="form.currentPin" name="currentPin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" required>
          <div class="pin-form__rule" aria-hidden="true"><span /><span /><span /><span /><span /><span /></div>
          <label for="next-pin">새 PIN</label>
          <input id="next-pin" v-model="form.nextPin" name="nextPin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required>
          <label for="next-pin-confirm">새 PIN 한 번 더</label>
          <input id="next-pin-confirm" v-model="form.nextPinConfirm" name="nextPinConfirm" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required>
          <p v-if="errorMessage" class="pin-form__error" role="alert">{{ errorMessage }}</p>
          <button type="submit">{{ submitting ? 'PIN 바꾸는 중…' : '새 PIN 저장하기' }}</button>
        </fieldset>
      </form>

      <NuxtLink class="pin-page__reset" to="/password/reset">PIN을 잊었다면 관심사 기록을 비우고 초기 PIN으로 다시 시작할 수 있어요.</NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.pin-page { min-height: 100vh; background: var(--color-canvas); color: var(--color-primary-strong); padding: 0 1.25rem 2.5rem; }
.pin-page__masthead { min-height: 4.5rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid color-mix(in srgb, var(--color-primary-strong) 16%, transparent); }
.pin-page__brand { color: var(--color-primary-strong); font-family: var(--font-display); font-size: 1.125rem; font-weight: 800; letter-spacing: -0.04em; text-decoration: none; }.pin-page__brand span { color: var(--color-primary); }
.pin-page__masthead > span, .pin-page__eyebrow { font-family: var(--font-mono); font-size: 0.625rem; font-weight: 700; letter-spacing: 0.07em; }.pin-page__masthead > span { color: var(--color-muted); }
.pin-page__frame { width: min(100%, 35rem); margin: 4.5rem auto 0; border: 1px solid color-mix(in srgb, var(--color-primary) 24%, transparent); border-radius: var(--radius-panel); background: var(--color-surface); padding: clamp(1.25rem, 5vw, 2.25rem); }
.pin-page__eyebrow { margin: 0 0 0.875rem; color: var(--color-primary); }.pin-page__frame h1 { margin: 0; font-family: var(--font-display); font-size: clamp(1.75rem, 5vw, 2rem); font-weight: 760; letter-spacing: -0.06em; line-height: 1.08; }.pin-page__intro { margin: 1rem 0 1.75rem; color: var(--color-muted); line-height: 1.65; word-break: keep-all; }
.pin-form fieldset { display: grid; gap: 0.65rem; margin: 0; border: 0; padding: 0; }.pin-form label { margin-top: 0.4rem; font-family: var(--font-display); font-size: 0.875rem; font-weight: 700; }.pin-form input { min-height: 3.25rem; border: 1px solid color-mix(in srgb, var(--color-primary-strong) 30%, transparent); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-primary-strong); padding: 0.75rem; }
.pin-form__rule { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.375rem; margin: 0.25rem 0; }.pin-form__rule span { height: 0.2rem; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 58%, transparent); }.pin-form__rule span:nth-child(2n) { background: color-mix(in srgb, var(--color-primary) 24%, transparent); }
.pin-form__error { margin: 0.5rem 0 0; color: var(--color-error); font-size: 0.875rem; }.pin-form button { min-height: 3.25rem; margin-top: 0.5rem; border: 1px solid var(--color-primary); border-radius: var(--radius-control); background: var(--color-primary); color: var(--color-surface); font-family: var(--font-display); font-weight: 750; cursor: pointer; }.pin-page__reset { display: inline-block; margin-top: 1.25rem; color: var(--color-muted); font-size: 0.8125rem; line-height: 1.55; text-underline-offset: 0.2em; }
.pin-form input:focus-visible, .pin-form button:focus-visible, .pin-page a:focus-visible { outline: 3px solid var(--color-primary); outline-offset: 3px; }.pin-form button:disabled { cursor: wait; opacity: 0.66; }
@media (min-width: 48rem) { .pin-page { padding-inline: 2.5rem; }.pin-page__frame { margin-top: 6rem; } }
</style>
