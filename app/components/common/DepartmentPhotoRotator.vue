<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DepartmentPhoto } from '../../../shared/content/department-photos'
import DepartmentPhotoCard from './DepartmentPhotoCard.vue'

const props = defineProps<{
  photos: readonly [DepartmentPhoto, ...DepartmentPhoto[]]
}>()

const rotationInterval = 5_000
const activeIndex = ref(0)
const paused = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const activePhoto = computed(() => props.photos[activeIndex.value] ?? props.photos[0])

function clearRotation() {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}

function showPhoto(index: number) {
  activeIndex.value = (index + props.photos.length) % props.photos.length
}

function startRotation() {
  clearRotation()
  paused.value = false
  if (props.photos.length > 1) {
    timer = setInterval(() => showPhoto(activeIndex.value + 1), rotationInterval)
  }
}

function pauseRotation() {
  paused.value = true
  clearRotation()
}

function toggleRotation() {
  if (paused.value) {
    startRotation()
  }
  else {
    pauseRotation()
  }
}

onMounted(() => {
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (prefersReducedMotion) {
    pauseRotation()
  }
  else {
    startRotation()
  }
})

onBeforeUnmount(clearRotation)
</script>

<template>
  <section
    class="department-photo-rotator"
    role="region"
    aria-roledescription="carousel"
    aria-label="학과 행사 촬영 사진"
    data-department-photo-rotator
  >
    <div
      :key="activePhoto.src"
      class="department-photo-rotator__photo"
    >
      <DepartmentPhotoCard :photo="activePhoto" loading="eager" />
    </div>

    <div class="department-photo-rotator__controls">
      <button
        class="department-photo-rotator__arrow"
        type="button"
        aria-label="이전 행사 사진 보기"
        @click="showPhoto(activeIndex - 1)"
      >
        ←
      </button>

      <div class="department-photo-rotator__positions" role="group" aria-label="행사 사진 선택">
        <button
          v-for="(_, index) in photos"
          :key="index"
          class="department-photo-rotator__position"
          type="button"
          :data-photo-position="index + 1"
          :aria-label="`${index + 1}번째 행사 사진 보기`"
          :aria-current="index === activeIndex ? 'true' : undefined"
          @click="showPhoto(index)"
        >
          <span aria-hidden="true" />
        </button>
      </div>

      <span class="department-photo-rotator__counter">
        {{ String(activeIndex + 1).padStart(2, '0') }} / {{ String(photos.length).padStart(2, '0') }}
      </span>

      <button
        class="department-photo-rotator__toggle"
        type="button"
        :aria-label="paused ? '사진 자동 전환 재생' : '사진 자동 전환 일시정지'"
        :aria-pressed="paused"
        @click="toggleRotation"
      >
        {{ paused ? '재생' : '정지' }}
      </button>

      <button
        class="department-photo-rotator__arrow"
        type="button"
        aria-label="다음 행사 사진 보기"
        @click="showPhoto(activeIndex + 1)"
      >
        →
      </button>
    </div>
  </section>
</template>

<style scoped>
.department-photo-rotator {
  display: grid;
  gap: 0.625rem;
}

.department-photo-rotator__photo {
  animation: photo-in 360ms ease-out both;
}

.department-photo-rotator__controls {
  min-height: var(--touch-target);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
}

.department-photo-rotator__arrow,
.department-photo-rotator__toggle,
.department-photo-rotator__position {
  min-width: var(--touch-target);
  min-height: var(--touch-target);
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
}

.department-photo-rotator__arrow,
.department-photo-rotator__toggle {
  border: 1px solid color-mix(in srgb, var(--color-primary) 24%, transparent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 700;
}

.department-photo-rotator__positions {
  display: flex;
  align-items: center;
}

.department-photo-rotator__position span {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-primary) 28%, transparent);
  transition: width 160ms ease, background-color 160ms ease;
}

.department-photo-rotator__position[aria-current='true'] span {
  width: 1.125rem;
  border-radius: 999px;
  background: var(--color-primary);
}

.department-photo-rotator__counter {
  min-width: 3.75rem;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-align: center;
}

.department-photo-rotator__arrow:hover,
.department-photo-rotator__toggle:hover,
.department-photo-rotator__position:hover {
  background: var(--color-primary-soft);
}

.department-photo-rotator button:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

@keyframes photo-in {
  from {
    opacity: 0;
    transform: translateY(0.375rem);
  }
}

@media (max-width: 32rem) {
  .department-photo-rotator__controls {
    justify-content: space-between;
  }

  .department-photo-rotator__counter {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .department-photo-rotator__photo {
    animation: none;
  }

  .department-photo-rotator__position span {
    transition: none;
  }
}
</style>
