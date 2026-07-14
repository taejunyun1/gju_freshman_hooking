<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ApiSuccess, StudentSession } from '../../shared/types/api'
import AppState from '../components/common/AppState.vue'

const session = ref<StudentSession | null>(null)
const loggingOut = ref(false)
const logoutError = ref('')

const loadSession = async (): Promise<void> => {
  try {
    const response = await $fetch<ApiSuccess<StudentSession>>('/api/student/session')
    session.value = response.data
  }
  catch {
    await navigateTo('/login', { replace: true })
  }
}

const logout = async (): Promise<void> => {
  loggingOut.value = true
  logoutError.value = ''
  try {
    await $fetch('/api/student/logout', { method: 'POST' })
    await navigateTo('/login', { replace: true })
  }
  catch {
    logoutError.value = '로그아웃하지 못했습니다. 다시 시도하세요.'
  }
  finally {
    loggingOut.value = false
  }
}

onMounted(loadSession)
</script>

<template>
  <main class="assessment-page">
    <header class="assessment-page__masthead">
      <NuxtLink
        class="assessment-page__brand"
        to="/"
        aria-label="PHOTO:NEXT 홈"
      >
        PHOTO:<span>NEXT</span>
      </NuxtLink>
      <span class="assessment-page__timecode">SEQUENCE / 01</span>
    </header>

    <section
      class="assessment-page__frame"
      aria-labelledby="assessment-title"
    >
      <div
        class="assessment-page__rail"
        aria-hidden="true"
      >
        <span class="assessment-page__rail-dot--active" />
        <i />
        <span />
        <i />
        <span />
      </div>

      <div class="assessment-page__content">
        <p class="assessment-page__eyebrow">YOUR SEQUENCE / READY</p>
        <template v-if="session">
          <div class="assessment-page__account-row">
            <p class="assessment-page__greeting">{{ session.nickname }}님</p>
            <button
              type="button"
              :disabled="loggingOut"
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
          <h1 id="assessment-title">나의 연결 경로를<br>시작할 준비가 됐어요</h1>
          <p class="assessment-page__intro">다음 단계에서 하고 싶은 작업을 고르면 수업과 진로로 연결해 드립니다.</p>
          <AppState
            variant="empty"
            message="관심 선택 기능은 다음 단계에서 제공됩니다."
          />
        </template>
        <AppState
          v-else
          variant="loading"
          message="로그인 정보를 확인하고 있어요."
        />
      </div>
    </section>
  </main>
</template>

<style scoped>
.assessment-page {
  min-height: 100vh;
  background: var(--color-canvas);
  padding: 0 1.25rem 2.5rem;
}

.assessment-page__masthead {
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
}

.assessment-page__brand {
  display: inline-flex;
  min-block-size: 2.75rem;
  min-inline-size: 2.75rem;
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
.assessment-page__eyebrow {
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
}

.assessment-page__timecode {
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-size: 0.625rem;
}

.assessment-page__frame {
  max-width: 42rem;
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  gap: 1rem;
  margin: 4.5rem auto 0;
}

.assessment-page__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 0.3rem;
}

.assessment-page__rail span {
  width: 0.625rem;
  height: 0.625rem;
  flex: 0 0 auto;
  border: 1px solid var(--color-sequence);
  border-radius: 50%;
  background: var(--color-canvas);
}

.assessment-page__rail .assessment-page__rail-dot--active { background: var(--color-sequence); }

.assessment-page__rail i {
  width: 1px;
  min-height: 3.4rem;
  background: color-mix(in srgb, var(--color-sequence) 50%, transparent);
}

.assessment-page__content { min-width: 0; }

.assessment-page__eyebrow {
  margin: 0 0 0.875rem;
  color: var(--color-sequence);
  font-size: 0.625rem;
  font-weight: 700;
}

.assessment-page__account-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
}

.assessment-page__greeting {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 750;
}

.assessment-page__account-row button {
  min-height: 2.75rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
  border-radius: 0.25rem;
  background: var(--color-surface);
  color: var(--color-ink);
  padding: 0.625rem 1rem;
  font-weight: 700;
  cursor: pointer;
}

.assessment-page__account-row button:disabled { cursor: wait; opacity: 0.66; }

.assessment-page__logout-error {
  margin: -0.75rem 0 1.5rem;
  color: var(--color-error);
  font-size: 0.875rem;
  line-height: 1.5;
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2rem, 9vw, 3.5rem);
  font-weight: 760;
  letter-spacing: -0.06em;
  line-height: 1.08;
  word-break: keep-all;
}

.assessment-page__intro {
  margin: 1rem 0 2rem;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  line-height: 1.65;
  word-break: keep-all;
}

.assessment-page__account-row button:focus-visible,
.assessment-page__brand:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

@media (min-width: 48rem) {
  .assessment-page { padding-inline: 2.5rem; }
  .assessment-page__frame { margin-top: 6rem; }
}
</style>
