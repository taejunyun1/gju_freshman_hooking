<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AssessmentStep from '../components/assessment/AssessmentStep.vue'
import AssessmentProgress from '../components/assessment/AssessmentProgress.vue'
import ResultTimeline from '../components/result/ResultTimeline.vue'
import CapabilityEvidence from '../components/result/CapabilityEvidence.vue'
import PublicCounselingForm from '../components/counseling/PublicCounselingForm.vue'
import { publicExploreSchema } from '../../shared/schemas/public-explore'
import { decodeResultSnapshot } from '../../shared/schemas/result'
import { questionGroups, type AssessmentSelections } from '../../shared/types/domain'
import type { PublicAssessmentCatalog } from '../../shared/types/api'
import type { ResultSnapshot } from '../../shared/types/result'

useSeoMeta({ title: '나의 사진·영상 진로 찾기 | 광주대학교 사진영상미디어학과', description: '로그인 없이 관심 분야를 골라 사진·영상·AI·예술사진·다큐멘터리·광고사진의 대학 학습경로와 진로를 살펴보세요.' })
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
    catalog.value = response.data
    if (!ready.value) {
      visitorSeed.value = newSeed()
      try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
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
onMounted(loadOptions)
const focusSurvey = async () => { await nextTick(); document.getElementById('explore-question')?.scrollIntoView({ block: 'start' }) }
const next = async () => {
  if (!canAdvance.value || loading.value) return
  if (step.value < 3) { step.value++; await focusSurvey(); return }
  if (!publicExploreSchema.safeParse(assessment.value).success) { error.value = '선택 항목과 기타 관심사 입력을 다시 확인해 주세요.'; return }
  error.value = ''; loading.value = true
  try {
    const response = await $fetch<{ data: ResultSnapshot }>('/api/public-explore/result', { method: 'POST', body: assessment.value, retry: 0 })
    snapshot.value = decodeResultSnapshot(response.data)
    await nextTick(); document.getElementById('result-title')?.scrollIntoView({ block: 'start' })
  }
  catch (failure) {
    const response = (failure as { data?: { error?: { code?: string, message?: string } } }).data
    error.value = response?.error?.message ?? '결과를 준비하지 못했습니다. 선택은 그대로 유지됩니다. 다시 시도해 주세요.'
    if (response?.error?.code === 'ASSESSMENT_CATALOG_STALE') { ready.value = true; await loadOptions(); error.value = '선택지가 업데이트되었습니다. 선택을 확인하고 결과를 다시 만들어 주세요.' }
  }
  finally { loading.value = false }
}
const restart = () => {
  if (!window.confirm('이 탭의 선택과 결과를 지우고 처음부터 시작할까요? 이미 보낸 상담 메일은 삭제되지 않습니다.')) return
  selections.value = emptySelections(); snapshot.value = null; step.value = 0; sent.value = false; visitorSeed.value = newSeed(); error.value = ''
  try { sessionStorage.removeItem(storageKey) } catch { /* Survey remains usable. */ }
  window.scrollTo({ top: 0 })
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
      <a href="https://gjuphoto.com/" class="public-explore__brand">PHOTO:<span>NEXT</span><small>광주대학교 사진영상미디어학과</small></a>
      <button v-if="ready" class="public-explore__reset" @click="restart">처음부터</button>
    </header>
    <section v-if="!snapshot" class="public-explore__survey">
      <div class="public-explore__intro">
        <p class="public-explore__eyebrow">YOUR INTEREST → YOUR NEXT</p>
        <h1>좋아하는 장면에서,<br>나의 진로를 찾아보세요.</h1>
        <p>관심 있는 일을 고르면, 광주대학교 사진영상미디어학과에서 이어갈 수 있는 수업과 프로젝트를 보여드려요.</p>
        <div class="public-explore__badges"><span>로그인 없이</span><span>네 단계 선택</span><span>나만의 4년 경로</span></div>
        <p class="public-explore__notice">선택과 결과는 이 브라우저 탭에 임시 보관됩니다. 추천 계산을 위해 서버로 전송되지만 학생 DB에 기록하지 않습니다. 공용 기기에서는 이용 후 ‘처음부터’를 눌러 주세요.</p>
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
    <ResultTimeline v-else :snapshot="snapshot" result-public-id="public-explore">
      <template #counseling-mid>
        <div class="public-explore__mid"><div><p class="public-explore__eyebrow">NEXT STEP</p><h2 id="counseling-midpoint-title">이 관심을 입학 준비로 이어볼까요?</h2><p>궁금한 점이 생겼다면, 이름과 연락처만 남겨 상담을 신청할 수 있어요.</p></div><a href="#public-counseling" class="public-explore__primary">내 관심 분야로 상담받기 →</a></div>
      </template>
      <template #capability-evidence><CapabilityEvidence :equipment="snapshot.resources.equipment" :facility="snapshot.resources.facility" result-public-id="public-explore" :telemetry-enabled="false" /></template>
      <template #counseling><PublicCounselingForm :assessment="assessment" :sent="sent" @sent="sent = true" /></template>
    </ResultTimeline>
    <footer class="public-explore__footer"><a href="https://gjuphoto.com/">학과 홈페이지로 돌아가기 ↗</a><p>광주대학교 사진영상미디어학과 · PHOTO:NEXT</p></footer>
  </main>
</template>

<style scoped>
.public-explore { min-height: 100vh; background: var(--color-canvas); }
.public-explore__header { width: min(100% - 2.5rem, 1120px); margin: auto; padding: 1.6rem 0; display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.public-explore__brand { color: var(--color-ink); text-decoration: none; font-size: 1.35rem; font-weight: 900; letter-spacing: -.05em; }
.public-explore__brand span { color: var(--color-primary); }
.public-explore__brand small { display: block; font-size: .65rem; font-weight: 600; letter-spacing: 0; margin-top: .3rem; color: var(--color-muted); }
.public-explore__reset { border: 1px solid #cad5ec; padding: .6rem .9rem; border-radius: 999px; background: white; color: var(--color-muted); cursor: pointer; font: inherit; font-size: .8rem; }
.public-explore__survey { width: min(100% - 2.5rem, 960px); margin: 1rem auto 4rem; }
.public-explore__intro { border: 1px solid #d5dffd; border-radius: var(--radius-panel); background: white; padding: clamp(1.5rem, 5vw, 3rem); margin-bottom: 2rem; }
.public-explore__eyebrow { color: var(--color-primary); font: 700 .7rem var(--font-mono); letter-spacing: .06em; }
h1 { font-size: clamp(1.75rem, 4vw, 2rem); line-height: 1.3; margin: 1rem 0; }
p { line-height: 1.7; color: var(--color-muted); }
.public-explore__badges { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.3rem 0; }
.public-explore__badges span { padding: .4rem .75rem; background: var(--color-primary-soft); border-radius: 999px; color: var(--color-primary); font-size: .75rem; font-weight: 650; }
.public-explore__notice { font-size: .75rem; margin-bottom: 0; }
#explore-question { scroll-margin-top: 1.5rem; }
.public-explore__actions { display: flex; justify-content: flex-end; gap: .8rem; }
.public-explore__primary, .public-explore__secondary { display: inline-flex; align-items: center; justify-content: center; border-radius: 16px; padding: .95rem 1.35rem; text-decoration: none; font: inherit; font-weight: 750; border: 1px solid var(--color-primary); cursor: pointer; }
.public-explore__primary { background: var(--color-primary); color: white; }
.public-explore__secondary { color: var(--color-primary); background: white; }
button:disabled { opacity: .45; cursor: not-allowed; }
.public-explore__error { border: 1px solid #ba263b; padding: 1rem; border-radius: 16px; color: #a3212d; }
.public-explore__mid { display: flex; align-items: center; justify-content: space-between; gap: 2rem; background: var(--color-primary-soft); border: 1px solid #c3d3ff; border-radius: var(--radius-panel); padding: clamp(1.5rem, 4vw, 2.5rem); }
.public-explore__mid h2 { font-size: 1.4rem; margin: .5rem 0; }
.public-explore__mid p { margin: .5rem 0; }
.public-explore__mid a { flex-shrink: 0; }
.public-explore__footer { text-align: center; padding: 2rem 1rem; border-top: 1px solid #d5dffd; font-size: .75rem; }
.public-explore__footer a { color: var(--color-primary); }
@media(max-width: 720px) { .public-explore__mid { display: grid; gap: 1rem; } }
</style>
