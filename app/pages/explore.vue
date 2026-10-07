<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AssessmentStep from '../components/assessment/AssessmentStep.vue'
import AssessmentProgress from '../components/assessment/AssessmentProgress.vue'
import PublicExploreResult from '../components/result/PublicExploreResult.vue'
import PublicCounselingForm from '../components/counseling/PublicCounselingForm.vue'
import { publicExploreSchema } from '../../shared/schemas/public-explore'
import { decodeResultSnapshot } from '../../shared/schemas/result'
import { questionGroups, type AssessmentSelections } from '../../shared/types/domain'
import type { PublicAssessmentCatalog } from '../../shared/types/api'
import type { ResultSnapshot } from '../../shared/types/result'
import '../assets/css/public-explore.css'

useSeoMeta({ title: '나의 사진·영상 진로 찾기 | 광주대학교 사진영상미디어학과', description: '로그인 없이 관심 분야를 골라 사진·영상·AI·예술사진·다큐멘터리·광고사진의 대학 학습경로와 진로를 살펴보세요.' })
useHead({
  bodyAttrs: { class: 'department-explore-page' },
  link: [{ rel: 'icon', type: 'image/svg+xml', href: '/brand/gjuphoto/favicon.svg' }],
  meta: [{ name: 'theme-color', content: '#070709' }],
})
const storageKey = 'photo-next:public-explore:v1'
const emptySelections = (): AssessmentSelections => ({ work: [], result: [], style: [], career: [], careerOther: null })
const catalog = ref<PublicAssessmentCatalog | null>(null)
const selections = ref(emptySelections())
const step = ref(0)
const visitorSeed = ref(1)
const snapshot = ref<ResultSnapshot | null>(null)
const sent = ref(false)
const ready = ref(false)
const loading = ref(false)
const error = ref('')
const storageNotice = ref('')
let restoreOnReload = false
let resultRequest = 0
let disposed = false
const groupLabels = ['해보고 싶은 일', '만들고 싶은 결과물', '작업 방식', '진로 방향']
const currentGroup = computed(() => catalog.value?.groups.find(group => group.key === questionGroups[step.value]))
const assessment = computed(() => ({ catalogRevision: catalog.value?.catalogRevision ?? '', visitorSeed: visitorSeed.value, selections: selections.value }))
const canAdvance = computed(() => {
  const group = currentGroup.value
  if (!group || !catalog.value) return false
  const count = selections.value[group.key].length
  return count >= catalog.value.limits[group.key].min && count <= catalog.value.limits[group.key].max
})
const newSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0]! % 2_147_483_647) + 1
const save = () => {
  if (!ready.value || !catalog.value) return
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ ...assessment.value, step: step.value, snapshot: snapshot.value, sent: sent.value }))
  }
  catch { storageNotice.value = '현재 브라우저에서는 임시 저장을 사용할 수 없습니다. 새로고침하면 선택이 사라질 수 있어요.' }
}
watch([selections, step, snapshot, sent], save, { deep: true })
const loadOptions = async () => {
  error.value = ''; loading.value = true
  try {
    const response = await $fetch<{ data: PublicAssessmentCatalog }>('/api/public-explore/options', { retry: 0 })
    if (disposed) return
    catalog.value = response.data
    if (!ready.value) {
      visitorSeed.value = newSeed()
      try {
        const stored = restoreOnReload ? JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') : null
        if (stored?.catalogRevision === response.data.catalogRevision) {
          for (const group of response.data.groups) {
            const allowed = new Set(group.options.map(option => option.key))
            const values = Array.isArray(stored.selections?.[group.key]) ? stored.selections[group.key] as unknown[] : []
            selections.value[group.key] = [...new Set(values.filter((value): value is string => typeof value === 'string' && allowed.has(value)))].slice(0, response.data.limits[group.key].max) as never
          }
          selections.value.careerOther = typeof stored.selections?.careerOther === 'string' ? stored.selections.careerOther.slice(0, 30) : null
          step.value = Number.isInteger(stored.step) ? Math.max(0, Math.min(3, stored.step)) : 0
          if (Number.isInteger(stored.visitorSeed) && stored.visitorSeed > 0 && stored.visitorSeed <= 2_147_483_647) visitorSeed.value = stored.visitorSeed
          if (stored.snapshot && publicExploreSchema.safeParse(assessment.value).success) {
            snapshot.value = decodeResultSnapshot(stored.snapshot)
            sent.value = stored.sent === true
          }
        }
      }
      catch { /* Unavailable or invalid tab storage must not prevent the survey. */ }
      ready.value = true
    }
    save()
  }
  catch { error.value = '설문 선택지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  finally { loading.value = false }
}
const clearStoredVisit = () => {
  try { sessionStorage.removeItem(storageKey) } catch { /* Survey remains usable. */ }
}
const resetVisit = () => {
  resultRequest++
  selections.value = emptySelections(); snapshot.value = null; step.value = 0; sent.value = false
  visitorSeed.value = newSeed(); error.value = ''; loading.value = false
  restoreOnReload = false
  clearStoredVisit()
  window.scrollTo({ top: 0 })
}
const handlePageShow = (event: PageTransitionEvent) => {
  // Back/forward cache restores the existing Vue instance without mounting again.
  if (event.persisted) resetVisit()
}
onMounted(() => {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  restoreOnReload = navigation?.type === 'reload'
  if (!restoreOnReload) clearStoredVisit()
  window.addEventListener('pageshow', handlePageShow)
  void loadOptions()
})
onBeforeUnmount(() => {
  disposed = true
  ready.value = false
  resultRequest++
  window.removeEventListener('pageshow', handlePageShow)
  clearStoredVisit()
})
const focusSurvey = async () => { await nextTick(); document.getElementById('explore-question')?.scrollIntoView({ block: 'start' }) }
const next = async () => {
  if (!canAdvance.value || loading.value) return
  if (step.value < 3) { step.value++; await focusSurvey(); return }
  if (!publicExploreSchema.safeParse(assessment.value).success) { error.value = '선택 항목과 기타 관심사 입력을 다시 확인해 주세요.'; return }
  error.value = ''; loading.value = true
  const request = ++resultRequest
  try {
    const response = await $fetch<{ data: ResultSnapshot }>('/api/public-explore/result', { method: 'POST', body: assessment.value, retry: 0 })
    if (request !== resultRequest) return
    snapshot.value = decodeResultSnapshot(response.data)
    await nextTick(); document.querySelector('[data-public-visual-result]')?.scrollIntoView({ block: 'start' })
  }
  catch (failure) {
    if (request !== resultRequest) return
    const response = (failure as { data?: { error?: { code?: string, message?: string } } }).data
    error.value = response?.error?.message ?? '결과를 준비하지 못했습니다. 선택은 그대로 유지됩니다. 다시 시도해 주세요.'
    if (response?.error?.code === 'ASSESSMENT_CATALOG_STALE') { ready.value = true; await loadOptions(); error.value = '선택지가 업데이트되었습니다. 선택을 확인하고 결과를 다시 만들어 주세요.' }
  }
  finally { if (request === resultRequest) loading.value = false }
}
const restart = () => {
  if (!window.confirm('이 탭의 선택과 결과를 지우고 처음부터 시작할까요? 이미 보낸 상담 메일은 삭제되지 않습니다.')) return
  resetVisit()
}
const updateSelection = (values: string[]) => {
  if (!currentGroup.value) return
  selections.value[currentGroup.value.key] = values as never
  if (!selections.value.career.includes('career.explore')) selections.value.careerOther = null
}
</script>

<template>
  <main class="public-explore">
    <header class="public-explore__header">
      <div class="public-explore__nav">
        <a href="https://gjuphoto.com/" class="public-explore__brand" aria-label="광주대학교 사진영상미디어학과 홈페이지">
          <img src="/brand/gjuphoto/dpim-logo-light.svg" alt="dpim 광주대학교 사진영상미디어학과" width="220" height="42">
        </a>
        <nav class="public-explore__nav-actions" aria-label="진로 탐색 메뉴">
          <a href="https://gjuphoto.com/" class="public-explore__home">학과 홈페이지 <span aria-hidden="true">↗</span></a>
          <button v-if="ready" class="public-explore__reset" @click="restart">처음부터</button>
        </nav>
      </div>
    </header>
    <section v-if="!snapshot" class="public-explore__survey">
      <div class="public-explore__intro">
        <p class="public-explore__eyebrow">DPIM · FIND YOUR PATH</p>
        <h1>좋아하는 장면에서,<br>나의 진로를 찾아보세요.</h1>
        <p>관심 있는 일을 고르면, 광주대학교 사진영상미디어학과에서 이어갈 수 있는 수업과 프로젝트를 보여드려요.</p>
        <div class="public-explore__badges"><span>로그인 없이</span><span>네 단계 선택</span><span>나만의 4년 경로</span></div>
        <p class="public-explore__notice">새로고침하면 진행 중인 선택을 이어 볼 수 있고, 페이지를 나갔다 다시 방문하면 처음부터 시작합니다. 선택과 결과는 학생 DB에 기록하지 않습니다.</p>
      </div>
      <p v-if="storageNotice" role="status" class="public-explore__notice">{{ storageNotice }}</p>
      <div v-if="catalog && currentGroup" id="explore-question">
        <AssessmentProgress :step="step" :group-label="groupLabels[step] ?? ''" />
        <AssessmentStep :group="currentGroup" :limit="catalog.limits[currentGroup.key]" :model-value="selections[currentGroup.key]" :career-other="selections.careerOther ?? ''" :disabled="loading" @update:model-value="updateSelection" @update:career-other="selections.careerOther = $event || null" />
        <p v-if="error" role="alert" class="public-explore__error">{{ error }}</p>
        <div class="public-explore__actions">
          <button v-if="step > 0" class="public-explore__secondary" :disabled="loading" @click="step--; focusSurvey()">이전</button>
          <button class="public-explore__primary" :disabled="!canAdvance || loading" @click="next">{{ loading ? '나의 경로를 준비하고 있어요…' : step === 3 ? '나의 학습경로 보기 →' : '다음 관심으로 →' }}</button>
        </div>
      </div>
      <div v-else role="status"><p>{{ error || '설문을 준비하고 있어요…' }}</p><button v-if="error" class="public-explore__primary" @click="loadOptions">다시 불러오기</button></div>
    </section>
    <PublicExploreResult v-else :snapshot="snapshot">
      <template #counseling><PublicCounselingForm :assessment="assessment" :sent="sent" @sent="sent = true" /></template>
    </PublicExploreResult>
    <footer class="public-explore__footer">
      <div class="public-explore__footer-inner">
        <a href="https://gjuphoto.com/" class="public-explore__brand" aria-label="광주대학교 사진영상미디어학과 홈페이지"><img src="/brand/gjuphoto/dpim-logo-light.svg" alt="dpim 광주대학교 사진영상미디어학과" width="220" height="42" loading="lazy"></a>
        <div><p>광주대학교 사진영상미디어학과</p><a href="https://gjuphoto.com/">학과 홈페이지로 돌아가기 ↗</a></div>
      </div>
    </footer>
  </main>
</template>

<style scoped>
.public-explore { min-height: 100vh; background: radial-gradient(ellipse at 15% 0%, rgba(99, 102, 241, .07), transparent 50%), var(--color-canvas); }
.public-explore__header { background: rgba(8, 8, 12, .85); border-bottom: 1px solid var(--department-border); backdrop-filter: blur(20px); }
.public-explore__nav { width: min(100% - 4rem, 1216px); margin: auto; padding: 1.25rem 0; display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.public-explore__brand { display: inline-flex; flex-shrink: 0; text-decoration: none; }
.public-explore__brand img { display: block; width: auto; height: 42px; max-width: 100%; }
.public-explore__nav-actions { display: flex; align-items: center; gap: 1.5rem; }
.public-explore__home { color: var(--color-muted); font-size: .875rem; font-weight: 600; text-decoration: none; }
.public-explore__home:hover { color: var(--color-primary); }
.public-explore__reset { min-height: 44px; border: 1px solid var(--department-border); padding: .6rem 1rem; border-radius: var(--radius-control); background: transparent; color: var(--color-primary); cursor: pointer; font: inherit; font-size: .8rem; }
.public-explore__reset:hover { background: var(--color-primary-soft); border-color: var(--color-muted); }
.public-explore__survey { width: min(100% - 4rem, 1040px); margin: 3rem auto 5rem; }
.public-explore__intro { border: 1px solid var(--department-border); border-radius: var(--radius-panel); background: rgba(18, 18, 26, .75); padding: clamp(1.5rem, 5vw, 3rem); margin-bottom: 2.5rem; }
.public-explore__eyebrow { color: var(--color-muted); font: 600 .7rem var(--font-mono); letter-spacing: .1em; }
h1 { font-size: clamp(1.75rem, 4vw, 2rem); line-height: 1.35; letter-spacing: -.035em; margin: 1.2rem 0; }
p { line-height: 1.7; color: var(--color-muted); }
.public-explore__badges { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.3rem 0; }
.public-explore__badges span { padding: .4rem .75rem; background: transparent; border: 1px solid var(--department-border); border-radius: 999px; color: var(--color-primary); font-size: .75rem; font-weight: 550; }
.public-explore__notice { font-size: .75rem; margin-bottom: 0; }
#explore-question { scroll-margin-top: 1.5rem; }
.public-explore__actions { display: flex; justify-content: flex-end; gap: .8rem; }
.public-explore__primary, .public-explore__secondary { display: inline-flex; align-items: center; justify-content: center; border-radius: 16px; padding: .95rem 1.35rem; text-decoration: none; font: inherit; font-weight: 750; border: 1px solid var(--color-primary); cursor: pointer; }
.public-explore__primary { background: var(--color-primary); color: var(--color-canvas); }
.public-explore__primary:hover:not(:disabled) { background: #e2e2ec; }
.public-explore__secondary { color: var(--color-primary); background: transparent; border-color: var(--department-border); }
button:disabled { opacity: .45; cursor: not-allowed; }
.public-explore__error { border: 1px solid var(--color-error); padding: 1rem; border-radius: 16px; color: var(--color-error); }
.public-explore__footer { padding: 2.5rem 2rem; border-top: 1px solid var(--department-border); font-size: .75rem; background: var(--color-surface); }
.public-explore__footer-inner { max-width: 1216px; margin: auto; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; }
.public-explore__footer p { margin: 0 0 .4rem; }
.public-explore__footer a { color: var(--color-primary); }
@media(max-width: 600px) {
  .public-explore__nav { width: calc(100% - 2rem); gap: .75rem; padding: 1rem 0; }
  .public-explore__brand img { height: 34px; }
  .public-explore__nav-actions { gap: .5rem; }
  .public-explore__home { display: none; }
  .public-explore__survey { width: calc(100% - 2rem); margin-top: 1.5rem; }
  .public-explore__intro { padding: 1.5rem 1.25rem; }
  .public-explore__footer { padding: 2rem 1rem; }
  .public-explore__footer-inner { align-items: flex-start; flex-direction: column; }
}
</style>
