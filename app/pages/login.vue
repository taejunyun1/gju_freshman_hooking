<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { ApiSuccess } from '../../shared/types/api'

const submitting = ref(false)
const errorMessage = ref('')
const form = reactive({ phone: '', password: '' })

const submitLogin = async (): Promise<void> => {
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch<ApiSuccess<{ kind: 'authenticated', expiresAt: string }>>('/api/student/login', {
      body: form,
      method: 'POST',
    })
    await navigateTo('/assessment', { replace: true })
  }
  catch {
    errorMessage.value = '입력 정보를 확인하거나 잠시 후 다시 시도해 주세요.'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <header class="login-page__masthead">
      <NuxtLink
        class="login-page__brand"
        to="/"
        aria-label="PHOTO:NEXT 홈"
      >
        PHOTO:<span>NEXT</span>
      </NuxtLink>
      <span class="login-page__timecode">RETURN / IN</span>
    </header>

    <section
      class="login-page__frame"
      aria-labelledby="login-title"
    >
      <div
        class="login-page__rail"
        aria-hidden="true"
      >
        <span />
        <i />
        <span class="login-page__rail-dot--active" />
      </div>
      <div>
        <p class="login-page__eyebrow">RETURN TO YOUR SEQUENCE</p>
        <h1 id="login-title">이어 보던 경로로<br>돌아갈게요</h1>
        <p class="login-page__intro">처음에 받은 휴대전화 번호와 임시 비밀번호를 입력해 주세요.</p>

        <form
          class="login-form"
          @submit.prevent="submitLogin"
        >
          <div class="login-form__field">
            <label for="login-phone">휴대전화 번호</label>
            <input
              id="login-phone"
              v-model="form.phone"
              name="phone"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              placeholder="010-0000-0000"
              required
            >
          </div>
          <div class="login-form__field">
            <label for="password">임시 비밀번호</label>
            <input
              id="password"
              v-model="form.password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
            >
          </div>
          <p
            v-if="errorMessage"
            class="login-form__error"
            role="alert"
          >
            {{ errorMessage }}
          </p>
          <button
            class="login-form__submit"
            type="submit"
            :disabled="submitting"
          >
            {{ submitting ? '로그인 중…' : '내 경로 이어 보기' }}
          </button>
        </form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  background: var(--color-canvas);
  padding: 0 1.25rem 2.5rem;
}

.login-page__masthead {
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
}

.login-page__brand {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  min-inline-size: 2.75rem;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

.login-page__brand span { color: var(--color-sequence); }

.login-page__timecode,
.login-page__eyebrow {
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
}

.login-page__timecode {
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-size: 0.625rem;
}

.login-page__frame {
  max-width: 35rem;
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  gap: 1rem;
  margin: 4.5rem auto 0;
}

.login-page__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 0.3rem;
}

.login-page__rail span {
  width: 0.625rem;
  height: 0.625rem;
  flex: 0 0 auto;
  border: 1px solid var(--color-sequence);
  border-radius: 50%;
  background: var(--color-canvas);
}

.login-page__rail .login-page__rail-dot--active { background: var(--color-sequence); }

.login-page__rail i {
  width: 1px;
  min-height: 4.25rem;
  background: color-mix(in srgb, var(--color-sequence) 50%, transparent);
}

.login-page__eyebrow {
  margin: 0 0 0.875rem;
  color: var(--color-sequence);
  font-size: 0.625rem;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2rem, 9vw, 3.25rem);
  font-weight: 760;
  letter-spacing: -0.06em;
  line-height: 1.08;
  word-break: keep-all;
}

.login-page__intro {
  margin: 1rem 0 2rem;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  line-height: 1.65;
  word-break: keep-all;
}

.login-form { display: grid; gap: 1.25rem; }
.login-form__field { display: grid; gap: 0.5rem; }

.login-form label {
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 700;
}

.login-form input {
  min-height: 3.25rem;
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
  border-radius: 0.25rem;
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.75rem;
}

.login-form input:focus-visible,
.login-form__submit:focus-visible,
.login-page__brand:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.login-form__error {
  margin: 0;
  color: var(--color-error);
  font-size: 0.875rem;
  line-height: 1.5;
}

.login-form__submit {
  min-height: 3.25rem;
  border: 1px solid var(--color-sequence);
  border-radius: 0.25rem;
  background: var(--color-sequence);
  color: var(--color-surface);
  font-family: var(--font-display);
  font-weight: 750;
  cursor: pointer;
}

.login-form__submit:disabled { cursor: wait; opacity: 0.66; }

@media (min-width: 48rem) {
  .login-page { padding-inline: 2.5rem; }
  .login-page__frame { margin-top: 6rem; }
}
</style>
