<script setup lang="ts">
import { onMounted } from 'vue'
import { DEPARTMENT_SERVICE_BRAND, HOME_ARIA_LABEL } from '../../shared/constants/department-brand'
import DepartmentPhotoCard from '../components/common/DepartmentPhotoCard.vue'
import { landingDepartmentPhoto } from '../../shared/content/department-photos'

onMounted(() => {
  void $fetch('/api/events', {
    method: 'POST',
    body: { eventName: 'landing_viewed' },
  }).catch(() => undefined)
})
</script>

<template>
  <div class="landing">
    <header class="landing__masthead">
      <NuxtLink
        class="landing__brand"
        to="/"
        :aria-label="HOME_ARIA_LABEL"
      >
        PHOTO:<span>NEXT</span>
      </NuxtLink>
      <span class="landing__timecode">SEQ / 04Y</span>
    </header>

    <main>
      <section class="landing__hero">
        <p data-department-brand class="landing__eyebrow">{{ DEPARTMENT_SERVICE_BRAND }}</p>
        <h1>하고 싶은 사진·영상, 광주대학교 사진영상미디어학과에서 어떻게 시작할 수 있는지 확인해보세요.</h1>
        <p class="landing__intro">
          선택한 관심사가 학과의 교과과정과 프로젝트·비교과, 교수진을 거쳐 어떤 작업과 진로로 이어지는지 보여드립니다.
        </p>
        <NuxtLink
          class="landing__cta"
          to="/login"
        >
          나의 연결 경로 찾기
        </NuxtLink>
        <div class="landing__photo" data-department-photo="landing">
          <DepartmentPhotoCard :photo="landingDepartmentPhoto" loading="eager" />
        </div>
      </section>

      <section
        class="sequence"
        aria-labelledby="sequence-title"
      >
        <div class="sequence__heading">
          <div>
            <p class="sequence__kicker">PREVIEW / INTEREST TO OUTPUT</p>
            <h2 id="sequence-title">선택은 한 번, 연결은 4년</h2>
          </div>
          <p>관심에서 상담까지, 같은 순서로 따라가세요.</p>
        </div>

        <div class="sequence__frame">
          <div
            class="sequence__ruler"
            aria-hidden="true"
          >
            <span>IN 00:00</span>
            <span>DURATION 04Y</span>
            <span>OUT 04:00</span>
          </div>

          <ol
            class="sequence__track"
            aria-label="PHOTO:NEXT 연결 단계"
          >
            <li class="sequence__stage">
              <article class="sequence__clip">
                <span class="sequence__clip-label">SOURCE</span>
                <strong data-stage>관심 선택</strong>
                <p>만들고 싶은 장면과 작업 방식을 고릅니다.</p>
              </article>
            </li>
            <li class="sequence__stage">
              <article class="sequence__clip">
                <span class="sequence__clip-label">Y1—Y4</span>
                <strong data-stage>4년 학습경로</strong>
                <p>기초부터 캡스톤까지 교과·프로젝트 순서를 확인합니다.</p>
              </article>
            </li>
            <li class="sequence__stage">
              <article class="sequence__clip sequence__clip--signal">
                <span class="sequence__clip-label">OUTPUT</span>
                <strong data-stage>작품·진로</strong>
                <p>배운 내용이 어떤 결과물과 진로로 이어지는지 봅니다.</p>
              </article>
            </li>
            <li class="sequence__stage">
              <article class="sequence__clip sequence__clip--signal">
                <span class="sequence__clip-label">NEXT</span>
                <strong data-stage>교수 상담</strong>
                <p>나의 연결 경로를 바탕으로 다음 선택을 상담합니다.</p>
              </article>
            </li>
          </ol>

          <aside class="sequence__evidence">
            <span class="sequence__evidence-label">제작 기반 · SUPPORTING EVIDENCE</span>
            <p>스튜디오·조명·편집 환경은 관련 교과와 프로젝트 아래에서 실제 제작을 뒷받침하는 근거로 제시됩니다.</p>
          </aside>
        </div>
      </section>
    </main>

    <footer class="landing__footer">
      <span>PHOTO:NEXT</span>
      <span>INTEREST → LEARNING → OUTPUT</span>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  overflow: hidden;
}

.landing__masthead,
.landing__hero,
.sequence,
.landing__footer {
  width: min(100% - 2.5rem, var(--timeline));
  margin-inline: auto;
}

.landing__masthead {
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid color-mix(in srgb, var(--color-primary-strong) 18%, transparent);
}

.landing__brand {
  min-inline-size: var(--touch-target);
  min-block-size: var(--touch-target);
  display: inline-flex;
  align-items: center;
  color: var(--color-primary-strong);
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

.landing__brand span {
  color: var(--color-primary);
}

.landing__brand:focus-visible,
.landing__cta:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.landing__timecode,
.landing__eyebrow,
.sequence__kicker,
.sequence__ruler,
.sequence__clip-label,
.sequence__evidence-label,
.landing__footer {
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.landing__timecode {
  color: var(--color-muted);
  font-size: 0.6875rem;
}

.landing__hero {
  max-width: var(--content);
  padding-block: clamp(3rem, 8vw, 5rem) clamp(3.5rem, 9vw, 6rem);
}

.landing__eyebrow {
  margin: 0 0 1rem;
  color: var(--color-primary);
  font-size: 0.6875rem;
  font-weight: 700;
}

.landing__hero h1 {
  max-width: 22ch;
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2rem);
  font-weight: 760;
  letter-spacing: -0.06em;
  line-height: 1.07;
  word-break: keep-all;
}

.landing__intro {
  max-width: 34rem;
  margin: 1.5rem 0 0;
  color: var(--color-muted);
  font-size: clamp(1rem, 3.7vw, 1.125rem);
  line-height: 1.75;
  word-break: keep-all;
}

.landing__cta {
  min-height: var(--touch-target);
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 1.5rem;
  margin-top: 2rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-control);
  background: var(--color-primary);
  color: var(--color-surface);
  padding: 0.875rem 1rem;
  font-family: var(--font-display);
  font-weight: 750;
  text-decoration: none;
  transition: background-color 160ms ease, color 160ms ease;
}

.landing__cta:hover {
  background: var(--color-surface);
  color: var(--color-primary);
}

.landing__cta::after {
  content: '→';
}

.landing__photo {
  margin-top: 2rem;
  --department-photo-aspect: 4 / 3;
}

.sequence {
  padding-bottom: clamp(4.5rem, 12vw, 8rem);
}

.sequence__heading {
  display: grid;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.sequence__heading h2 {
  margin: 0.35rem 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.375rem, 3vw, 1.625rem);
  letter-spacing: -0.045em;
  line-height: 1.15;
}

.sequence__heading > p {
  max-width: 26rem;
  margin: 0;
  color: var(--color-muted);
  line-height: 1.6;
}

.sequence__kicker {
  margin: 0;
  color: var(--color-primary);
  font-size: 0.6875rem;
  font-weight: 700;
}

.sequence__frame {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
}

.sequence__ruler {
  min-height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid color-mix(in srgb, var(--color-primary) 14%, transparent);
  background: var(--color-primary-soft);
  color: var(--color-muted);
  padding-inline: 0.875rem;
  font-size: 0.625rem;
}

.sequence__track {
  position: relative;
  display: grid;
  gap: 1rem;
  margin: 0;
  padding: 1.5rem 1rem;
  list-style: none;
}

.sequence__track::before {
  position: absolute;
  top: 2rem;
  bottom: 2rem;
  left: 1.75rem;
  width: 2px;
  background: var(--color-primary);
  content: '';
}

.sequence__stage {
  position: relative;
  padding-left: 2.5rem;
}

.sequence__stage::before {
  position: absolute;
  top: 1.125rem;
  left: 0.25rem;
  z-index: 1;
  width: 1rem;
  height: 1rem;
  border: 3px solid var(--color-surface);
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
  content: '';
}

.sequence__clip {
  min-height: 8.25rem;
  border: 1px solid color-mix(in srgb, var(--color-primary) 24%, transparent);
  border-top: 0.25rem solid var(--color-primary);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--color-primary) 7%, var(--color-surface));
  padding: 1rem;
}

.sequence__clip--signal {
  border-color: color-mix(in srgb, var(--color-primary) 24%, transparent);
  border-top-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 7%, var(--color-surface));
}

.sequence__clip-label {
  display: block;
  margin-bottom: 1.25rem;
  color: color-mix(in srgb, var(--color-primary-strong) 65%, transparent);
  font-size: 0.625rem;
}

.sequence__clip strong {
  display: block;
  font-family: var(--font-display);
  font-size: 1.125rem;
  letter-spacing: -0.025em;
}

.sequence__clip p {
  margin: 0.625rem 0 0;
  color: var(--color-muted);
  font-size: 0.875rem;
  line-height: 1.55;
  word-break: keep-all;
}

.sequence__evidence {
  display: grid;
  gap: 0.5rem;
  border-top: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  background: var(--color-primary-soft);
  padding: 1rem;
}

.sequence__evidence-label {
  color: var(--color-primary);
  font-size: 0.625rem;
  font-weight: 700;
}

.sequence__evidence p {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.8125rem;
  line-height: 1.55;
  word-break: keep-all;
}

.landing__footer {
  min-height: 5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid color-mix(in srgb, var(--color-primary-strong) 18%, transparent);
  color: color-mix(in srgb, var(--color-primary-strong) 64%, transparent);
  font-size: 0.5625rem;
}

@media (min-width: 720px) {
  .landing__photo {
    --department-photo-aspect: 16 / 7;
  }
}

@media (min-width: 48rem) {
  .landing__masthead,
  .landing__hero,
  .sequence,
  .landing__footer {
    width: min(100% - 5rem, var(--timeline));
  }

  .sequence__heading {
    grid-template-columns: 1fr auto;
    align-items: end;
  }

  .sequence__track {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
    padding: 2rem 1.25rem 1.5rem;
  }

  .sequence__track::before {
    top: 2.375rem;
    right: 2.25rem;
    bottom: auto;
    left: 2.25rem;
    width: auto;
    height: 2px;
  }

  .sequence__stage {
    padding: 2rem 0 0;
  }

  .sequence__stage::before {
    top: 0;
    left: 1rem;
  }

  .sequence__clip {
    min-height: 12rem;
  }

  .sequence__evidence {
    grid-template-columns: 15rem 1fr;
    align-items: center;
    padding-inline: 1.25rem;
  }
}
</style>
