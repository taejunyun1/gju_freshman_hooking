<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { ApiSuccess, StudentSession } from '../../../shared/types/api'

type PageState = 'checking' | 'change' | 'request'

const pageState = ref<PageState>('checking')
const submitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const requestForm = reactive({
  nickname: '',
  phone: '',
  region: 'gwangju',
})

const changeForm = reactive({
  currentPassword: '',
  newPassword: '',
})

onMounted(async () => {
  try {
    await $fetch<ApiSuccess<StudentSession>>('/api/student/session')
    pageState.value = 'change'
  }
  catch {
    pageState.value = 'request'
  }
})

const submitRecoveryRequest = async (): Promise<void> => {
  submitting.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    await $fetch('/api/student/password/recovery/request', { body: requestForm, method: 'POST' })
    successMessage.value = '요청을 접수했습니다. 학과 확인 절차가 필요한 경우 안내받은 연락 방식으로 복구 코드를 전달합니다.'
    requestForm.phone = ''
    requestForm.nickname = ''
  }
  catch {
    // The endpoint normally accepts every anonymous request; keep failures non-specific if the network is unavailable.
    errorMessage.value = '요청을 처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'
  }
  finally {
    submitting.value = false
  }
}

const submitPasswordChange = async (): Promise<void> => {
  submitting.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    await $fetch('/api/student/password/change', { body: changeForm, method: 'POST' })
    successMessage.value = '비밀번호를 변경했습니다. 다른 기기에서 열린 세션은 종료되었습니다.'
    changeForm.currentPassword = ''
    changeForm.newPassword = ''
  }
  catch {
    errorMessage.value = '현재 비밀번호를 확인하거나 잠시 후 다시 시도해 주세요.'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="reset-page">
    <header class="reset-page__masthead">
      <NuxtLink
        class="reset-page__brand"
        to="/"
        aria-label="PHOTO:NEXT 홈"
      >
        PHOTO:<span>NEXT</span>
      </NuxtLink>
      <span class="reset-page__timecode">ACCOUNT / ACCESS</span>
    </header>

    <section
      v-if="pageState !== 'checking'"
      class="reset-page__frame"
      aria-labelledby="reset-title"
    >
      <div
        class="reset-page__rail"
        aria-hidden="true"
      >
        <span class="reset-page__rail-dot reset-page__rail-dot--active" />
        <i />
        <span class="reset-page__rail-dot" />
        <i />
        <span class="reset-page__rail-dot" />
      </div>

      <div class="reset-page__content">
        <p class="reset-page__eyebrow">ACCOUNT ACCESS / {{ pageState === 'change' ? 'CHANGE' : 'REQUEST' }}</p>
        <h1 id="reset-title">
          <template v-if="pageState === 'change'">비밀번호를<br>새로 정하세요</template>
          <template v-else>계정 복구를<br>요청하세요</template>
        </h1>
        <p class="reset-page__intro">
          <template v-if="pageState === 'change'">현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.</template>
          <template v-else>등록 정보가 확인되면 학과의 안내 절차에 따라 복구를 진행합니다.</template>
        </p>

        <form
          v-if="pageState === 'change'"
          class="reset-form"
          @submit.prevent="submitPasswordChange"
        >
          <div class="reset-form__field">
            <label for="current-password">현재 비밀번호</label>
            <input
              id="current-password"
              v-model="changeForm.currentPassword"
              name="currentPassword"
              type="password"
              autocomplete="current-password"
              minlength="7"
              maxlength="128"
              required
            >
          </div>
          <div class="reset-form__field">
            <label for="new-password">새 비밀번호</label>
            <input
              id="new-password"
              v-model="changeForm.newPassword"
              name="newPassword"
              type="password"
              autocomplete="new-password"
              minlength="7"
              maxlength="128"
              required
            >
          </div>
          <button
            class="reset-form__submit"
            type="submit"
            :disabled="submitting"
          >
            {{ submitting ? '변경 중…' : '새 비밀번호 저장하기' }}
          </button>
        </form>

        <form
          v-else
          class="reset-form"
          @submit.prevent="submitRecoveryRequest"
        >
          <div class="reset-form__field">
            <label for="phone">휴대전화 번호</label>
            <input
              id="phone"
              v-model="requestForm.phone"
              name="phone"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              placeholder="010-0000-0000"
              required
            >
          </div>
          <div class="reset-form__field">
            <label for="nickname">닉네임</label>
            <input
              id="nickname"
              v-model="requestForm.nickname"
              name="nickname"
              type="text"
              autocomplete="username"
              maxlength="80"
              required
            >
          </div>
          <div class="reset-form__field">
            <label for="region">지역</label>
            <select
              id="region"
              v-model="requestForm.region"
              name="region"
            >
              <option value="gwangju">광주광역시</option>
              <option value="jeonbuk">전북</option>
              <option value="capital">수도권</option>
              <option value="chungcheong">충청권</option>
              <option value="gyeongsang">경상권</option>
              <option value="gangwon_jeju">강원·제주</option>
              <option value="overseas">해외</option>
              <option value="other">기타</option>
            </select>
          </div>
          <button
            class="reset-form__submit"
            type="submit"
            :disabled="submitting"
          >
            {{ submitting ? '접수 중…' : '복구 요청 접수하기' }}
          </button>
        </form>

        <p
          v-if="successMessage"
          class="reset-page__notice reset-page__notice--success"
          role="status"
          aria-live="polite"
        >
          {{ successMessage }}
        </p>
        <p
          v-if="errorMessage"
          class="reset-page__notice reset-page__notice--error"
          role="alert"
        >
          {{ errorMessage }}
        </p>
      </div>
    </section>

    <p
      v-else
      class="reset-page__loading"
      role="status"
    >
      계정 상태를 확인하고 있습니다.
    </p>
  </main>
</template>

<style scoped>
.reset-page {
  min-height: 100vh;
  background: var(--color-canvas);
  padding: 0 1.25rem 2.5rem;
}

.reset-page__masthead {
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
}

.reset-page__brand {
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

.reset-page__brand span { color: var(--color-sequence); }

.reset-page__timecode,
.reset-page__eyebrow {
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
}

.reset-page__timecode {
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-size: 0.625rem;
}

.reset-page__frame {
  max-width: 35rem;
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  gap: 1rem;
  margin: 4.5rem auto 0;
}

.reset-page__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 0.3rem;
}

.reset-page__rail-dot {
  width: 0.625rem;
  height: 0.625rem;
  flex: 0 0 auto;
  border: 1px solid var(--color-sequence);
  border-radius: 50%;
  background: var(--color-canvas);
}

.reset-page__rail-dot--active { background: var(--color-sequence); }

.reset-page__rail i {
  width: 1px;
  min-height: 3.4rem;
  background: color-mix(in srgb, var(--color-sequence) 50%, transparent);
}

.reset-page__eyebrow {
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

.reset-page__intro {
  margin: 1rem 0 2rem;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  line-height: 1.65;
  word-break: keep-all;
}

.reset-form { display: grid; gap: 1.25rem; }
.reset-form__field { display: grid; gap: 0.5rem; }

.reset-form label {
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 700;
}

.reset-form input,
.reset-form select {
  min-height: 3.25rem;
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
  border-radius: 0.25rem;
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.75rem;
}

.reset-form__submit {
  min-height: 3.25rem;
  border: 1px solid var(--color-sequence);
  border-radius: 0.25rem;
  background: var(--color-sequence);
  color: var(--color-surface);
  font-family: var(--font-display);
  font-weight: 750;
  cursor: pointer;
}

.reset-form__submit:disabled { cursor: wait; opacity: 0.66; }

.reset-page__brand:focus-visible,
.reset-form input:focus-visible,
.reset-form select:focus-visible,
.reset-form__submit:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.reset-page__notice {
  margin: 1.25rem 0 0;
  border-left: 2px solid currentColor;
  padding: 0.75rem 0 0.75rem 1rem;
  font-size: 0.875rem;
  line-height: 1.65;
  word-break: keep-all;
}

.reset-page__notice--success { color: var(--color-resource); }
.reset-page__notice--error { color: var(--color-error); }

.reset-page__loading {
  max-width: 35rem;
  margin: 4.5rem auto 0;
  color: color-mix(in srgb, var(--color-ink) 68%, transparent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

@media (min-width: 48rem) {
  .reset-page { padding-inline: 2.5rem; }
  .reset-page__frame { margin-top: 6rem; }
}
</style>
