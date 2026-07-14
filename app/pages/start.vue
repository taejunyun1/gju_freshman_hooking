<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { ApiSuccess, RegistrationInput, RegistrationResult } from '../../shared/types/api'
import { useStudentSessionStore } from '../stores/student-session'

const studentSession = useStudentSessionStore()
const submitting = ref(false)
const errorMessage = ref('')
const form = reactive<RegistrationInput>({
  phone: '',
  schoolName: '',
  applicantStage: 'high3',
  region: 'gwangju',
})

const submitRegistration = async (): Promise<void> => {
  submitting.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<RegistrationResult>>('/api/student/register', {
      body: form,
      method: 'POST',
    })
    if (response.data.kind === 'existing') {
      await navigateTo('/login')
      return
    }

    studentSession.setInitialCredentials({
      initialPassword: response.data.initialPassword,
      nickname: response.data.nickname,
    })
    await navigateTo('/credentials')
  }
  catch {
    errorMessage.value = '입력 항목을 다시 확인하거나 잠시 후 다시 시도해 주세요.'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="account-page">
    <header class="account-page__masthead">
      <NuxtLink
        class="account-page__brand"
        to="/"
        aria-label="PHOTO:NEXT 홈"
      >
        PHOTO:<span>NEXT</span>
      </NuxtLink>
      <span class="account-page__timecode">IN / 01</span>
    </header>

    <section
      class="account-page__frame"
      aria-labelledby="start-title"
    >
      <aside
        class="account-page__rail"
        aria-label="계정 시작 단계"
      >
        <span class="account-page__rail-dot account-page__rail-dot--active" />
        <span class="account-page__rail-line" />
        <span class="account-page__rail-dot" />
        <span class="account-page__rail-line" />
        <span class="account-page__rail-dot" />
      </aside>

      <div class="account-page__content">
        <p class="account-page__eyebrow">ACCOUNT INTAKE / 01 OF 03</p>
        <h1 id="start-title">시작 정보를<br>입력해 주세요</h1>
        <p class="account-page__intro">처음 한 번만 입력하면, 다음 방문에도 이어서 볼 수 있어요.</p>

        <form
          class="account-form"
          @submit.prevent="submitRegistration"
        >
          <div class="account-form__field">
            <label for="phone">휴대전화 번호</label>
            <input
              id="phone"
              v-model="form.phone"
              name="phone"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              placeholder="010-0000-0000"
              required
            >
          </div>

          <div class="account-form__field">
            <label for="school-name">학교명</label>
            <input
              id="school-name"
              v-model="form.schoolName"
              name="schoolName"
              type="text"
              autocomplete="organization"
              placeholder="예: 광주고등학교"
              maxlength="40"
              required
            >
          </div>

          <div class="account-form__field">
            <label for="applicant-stage">현재 상태</label>
            <select
              id="applicant-stage"
              v-model="form.applicantStage"
              name="applicantStage"
            >
              <option value="high1">고1</option>
              <option value="high2">고2</option>
              <option value="high3">고3</option>
              <option value="graduate">고교 졸업생</option>
              <option value="ged">검정고시 준비·합격</option>
              <option value="other">기타</option>
            </select>
          </div>

          <div class="account-form__field">
            <label for="region">지역</label>
            <select
              id="region"
              v-model="form.region"
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

          <p
            v-if="errorMessage"
            class="account-form__error"
            role="alert"
          >
            {{ errorMessage }}
          </p>
          <button
            class="account-form__submit"
            type="submit"
            :disabled="submitting"
          >
            {{ submitting ? '확인 중…' : '내 연결 경로 시작하기' }}
          </button>
        </form>

        <p class="account-page__footnote">이미 계정이 있다면 로그인 화면으로 바로 안내합니다.</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.account-page {
  min-height: 100vh;
  background: var(--color-canvas);
  padding: 0 1.25rem 2.5rem;
}

.account-page__masthead {
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
}

.account-page__brand {
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

.account-page__brand span { color: var(--color-sequence); }

.account-page__timecode,
.account-page__eyebrow,
.account-page__footnote {
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
}

.account-page__timecode {
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-size: 0.625rem;
}

.account-page__frame {
  max-width: 35rem;
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  gap: 1rem;
  margin: 3.25rem auto 0;
}

.account-page__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 0.35rem;
}

.account-page__rail-dot {
  width: 0.625rem;
  height: 0.625rem;
  flex: 0 0 auto;
  border: 1px solid var(--color-sequence);
  border-radius: 50%;
  background: var(--color-canvas);
}

.account-page__rail-dot--active { background: var(--color-sequence); }

.account-page__rail-line {
  width: 1px;
  min-height: 3.4rem;
  background: color-mix(in srgb, var(--color-sequence) 50%, transparent);
}

.account-page__content { min-width: 0; }

.account-page__eyebrow {
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

.account-page__intro {
  margin: 1rem 0 2rem;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  line-height: 1.65;
  word-break: keep-all;
}

.account-form { display: grid; gap: 1.25rem; }

.account-form__field { display: grid; gap: 0.5rem; }

.account-form label {
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 700;
}

.account-form input,
.account-form select {
  min-height: 3.25rem;
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
  border-radius: 0.25rem;
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.75rem;
}

.account-form input:focus-visible,
.account-form select:focus-visible,
.account-form__submit:focus-visible,
.account-page__brand:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.account-form__error {
  margin: 0;
  color: var(--color-error);
  font-size: 0.875rem;
  line-height: 1.5;
}

.account-form__submit {
  min-height: 3.25rem;
  border: 1px solid var(--color-sequence);
  border-radius: 0.25rem;
  background: var(--color-sequence);
  color: var(--color-surface);
  font-family: var(--font-display);
  font-weight: 750;
  cursor: pointer;
}

.account-form__submit:disabled { cursor: wait; opacity: 0.66; }

.account-page__footnote {
  margin: 1.25rem 0 0;
  color: color-mix(in srgb, var(--color-ink) 58%, transparent);
  font-size: 0.625rem;
  line-height: 1.7;
}

@media (min-width: 48rem) {
  .account-page { padding-inline: 2.5rem; }
  .account-page__frame { margin-top: 5.5rem; }
}
</style>
