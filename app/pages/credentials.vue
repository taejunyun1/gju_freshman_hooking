<script setup lang="ts">
import { useStudentSessionStore } from '../stores/student-session'

const studentSession = useStudentSessionStore()
const credentials = studentSession.consumeInitialCredentials()

if (!credentials) void navigateTo('/start', { replace: true })

const continueToAssessment = async (): Promise<void> => {
  await navigateTo('/assessment', { replace: true })
}
</script>

<template>
  <main class="credentials-page">
    <header class="credentials-page__masthead">
      <NuxtLink
        class="credentials-page__brand"
        to="/"
        aria-label="PHOTO:NEXT 홈"
      >
        PHOTO:<span>NEXT</span>
      </NuxtLink>
      <span class="credentials-page__timecode">IN / 02</span>
    </header>

    <section
      v-if="credentials"
      class="credentials-page__frame"
      aria-labelledby="credentials-title"
    >
      <div
        class="credentials-page__rail"
        aria-hidden="true"
      >
        <span />
        <i />
        <span class="credentials-page__rail-dot--active" />
        <i />
        <span />
      </div>
      <div>
        <p class="credentials-page__eyebrow">ACCOUNT INTAKE / 02 OF 03</p>
        <h1 id="credentials-title">로그인 정보를<br>지금 확인해 주세요</h1>
        <p class="credentials-page__intro">이 화면을 나가면 임시 비밀번호는 다시 표시되지 않습니다.</p>

        <dl class="credentials-page__sheet">
          <div>
            <dt>NICKNAME</dt>
            <dd>{{ credentials.nickname }}</dd>
          </div>
          <div>
            <dt>INITIAL PASSWORD</dt>
            <dd class="credentials-page__password">{{ credentials.initialPassword }}</dd>
          </div>
        </dl>

        <button
          class="credentials-page__continue"
          type="button"
          @click="continueToAssessment"
        >
          확인했고, 다음으로 가기
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.credentials-page {
  min-height: 100vh;
  background: var(--color-canvas);
  padding: 0 1.25rem 2.5rem;
}

.credentials-page__masthead {
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
}

.credentials-page__brand {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

.credentials-page__brand span { color: var(--color-sequence); }

.credentials-page__timecode,
.credentials-page__eyebrow,
.credentials-page__sheet dt {
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
}

.credentials-page__timecode {
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-size: 0.625rem;
}

.credentials-page__frame {
  max-width: 35rem;
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  gap: 1rem;
  margin: 4.5rem auto 0;
}

.credentials-page__rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 0.3rem;
}

.credentials-page__rail span {
  width: 0.625rem;
  height: 0.625rem;
  flex: 0 0 auto;
  border: 1px solid var(--color-sequence);
  border-radius: 50%;
  background: var(--color-canvas);
}

.credentials-page__rail .credentials-page__rail-dot--active { background: var(--color-sequence); }

.credentials-page__rail i {
  width: 1px;
  min-height: 3.4rem;
  background: color-mix(in srgb, var(--color-sequence) 50%, transparent);
}

.credentials-page__eyebrow {
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

.credentials-page__intro {
  margin: 1rem 0 2rem;
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  line-height: 1.65;
  word-break: keep-all;
}

.credentials-page__sheet {
  display: grid;
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--color-sequence) 45%, transparent);
  background: var(--color-surface);
}

.credentials-page__sheet > div { padding: 1rem; }
.credentials-page__sheet > div + div { border-top: 1px solid color-mix(in srgb, var(--color-ink) 15%, transparent); }

.credentials-page__sheet dt {
  color: color-mix(in srgb, var(--color-ink) 58%, transparent);
  font-size: 0.625rem;
}

.credentials-page__sheet dd {
  margin: 0.5rem 0 0;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 750;
  letter-spacing: -0.035em;
}

.credentials-page__sheet .credentials-page__password {
  color: var(--color-sequence);
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
}

.credentials-page__continue {
  min-height: 3.25rem;
  width: 100%;
  margin-top: 1.25rem;
  border: 1px solid var(--color-sequence);
  border-radius: 0.25rem;
  background: var(--color-sequence);
  color: var(--color-surface);
  font-family: var(--font-display);
  font-weight: 750;
  cursor: pointer;
}

.credentials-page__continue:focus-visible,
.credentials-page__brand:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

@media (min-width: 48rem) {
  .credentials-page { padding-inline: 2.5rem; }
  .credentials-page__frame { margin-top: 6rem; }
}
</style>
