<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { z } from 'zod'

import AdmissionCycleStrip from '../../../components/admin/AdmissionCycleStrip.vue'
import RosterImportPanel from '../../../components/admin/RosterImportPanel.vue'
import RosterPreviewTable from '../../../components/admin/RosterPreviewTable.vue'
import { createCredentialWorkbook, createRosterTemplate, downloadRosterWorkbook } from '../../../composables/useRosterWorkbook'
import { parseApplicantRosterFile } from '../../../utils/applicant-roster-file'
import { admissionCycleSchema, rosterApplyResultSchema, rosterCredentialSchema, rosterPreviewResultSchema, type AdmissionCycle, type ApplicantRosterRow, type RosterCredential, type RosterPreviewResult } from '../../../../shared/schemas/admission-roster'
import type { ApiSuccess } from '../../../../shared/types/api'
import { useAdminSessionStore } from '../../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })
type ImportPhase = 'idle' | 'parsing' | 'previewing' | 'ready' | 'applying' | 'completed' | 'failed'
const adminSession = useAdminSessionStore()
const phase = ref<ImportPhase>('idle')
const cycle = ref<AdmissionCycle | null>(null)
const rows = ref<ApplicantRosterRow[]>([])
const preview = ref<RosterPreviewResult | null>(null)
const errorMessage = ref('')
const fileName = ref('')
const confirmation = ref('')
const idempotencyKey = ref<string | null>(null)
const needsPreviewReload = ref(false)
const startYear = ref(new Date().getFullYear() + 1)
const isRecentAuthFailure = (error: unknown) => ['REAUTH_REQUIRED', 'MFA_REQUIRED', 'ADMIN_REQUIRED'].includes((error as { data?: { error?: { code?: string } } })?.data?.error?.code ?? '')
const redirectForRecentAuth = async (error: unknown): Promise<boolean> => {
  if (!isRecentAuthFailure(error)) return false
  adminSession.clear()
  await navigateTo('/admin/login?redirect=/admin/students/roster', { replace: true })
  return true
}
const headers = () => adminSession.authorizationHeaders()
const counts = computed(() => preview.value?.counts ?? { add: 0, update: 0, inactive: 0, unchanged: 0 })
const phrase = computed(() => `${cycle.value?.year ?? startYear.value} 명단 적용`)
const canApply = computed(() => phase.value === 'ready' && confirmation.value === phrase.value)
const errorText = (error: unknown, fallback: string) => (error as { data?: { error?: { code?: string } } })?.data?.error?.code === 'ROSTER_CONFLICT' ? '명단 버전이 변경되었습니다. 최신 비교 결과를 다시 불러오세요.' : fallback
const isRosterConflict = (error: unknown) => (error as { data?: { error?: { code?: string } } })?.data?.error?.code === 'ROSTER_CONFLICT'
function parseSuccessEnvelope<T>(response: unknown, dataSchema: z.ZodType<T>): T {
  return z.object({ data: dataSchema, requestId: z.string().min(1) }).parse(response).data
}

const loadCycles = async () => {
  try {
    const response = await $fetch<ApiSuccess<unknown>>('/api/admin/admission-cycles', { headers: headers() })
    const cycles = admissionCycleSchema.array().parse(response.data)
    cycle.value = cycles.find(item => item.status === 'current') ?? null
  } catch (error) { if (!await redirectForRecentAuth(error)) errorMessage.value = '사이클 정보를 불러오지 못했습니다.' }
}
const startCycle = async () => {
  errorMessage.value = ''
  try { await $fetch<ApiSuccess<unknown>>('/api/admin/admission-cycles/start', { method: 'POST', headers: headers(), body: { year: startYear.value } }); await loadCycles() }
  catch (error) { if (!await redirectForRecentAuth(error)) errorMessage.value = '사이클을 시작하지 못했습니다. 최근 로그인을 확인하세요.' }
}
const resetImport = () => { preview.value = null; confirmation.value = ''; idempotencyKey.value = null; needsPreviewReload.value = false }
const chooseFile = () => { errorMessage.value = '' }
const selectFile = async (file: File) => {
  if (!cycle.value) { errorMessage.value = '먼저 연간 사이클을 시작하세요.'; return }
  phase.value = 'parsing'; errorMessage.value = ''; fileName.value = file.name; resetImport()
  try { rows.value = await parseApplicantRosterFile(file); phase.value = 'previewing'; const response = await $fetch<ApiSuccess<unknown>>('/api/admin/students/roster/preview', { method: 'POST', headers: headers(), body: { cycleId: cycle.value.id, rows: rows.value } }); preview.value = rosterPreviewResultSchema.parse(response.data); idempotencyKey.value = crypto.randomUUID(); phase.value = 'ready' }
  catch (error) { if (await redirectForRecentAuth(error)) return; phase.value = 'failed'; errorMessage.value = errorText(error, '파일을 읽거나 명단 차이를 비교하지 못했습니다. 서식을 확인하세요.') }
}
const reloadPreview = async () => {
  if (!rows.value.length) return
  phase.value = 'previewing'; errorMessage.value = ''; confirmation.value = ''; idempotencyKey.value = null
  try {
    await loadCycles()
    if (!cycle.value) throw new Error('Current cycle unavailable')
    const response = await $fetch<ApiSuccess<unknown>>('/api/admin/students/roster/preview', { method: 'POST', headers: headers(), body: { cycleId: cycle.value.id, rows: rows.value } })
    preview.value = rosterPreviewResultSchema.parse(response.data)
    idempotencyKey.value = crypto.randomUUID()
    needsPreviewReload.value = false
    phase.value = 'ready'
  } catch (error) {
    if (await redirectForRecentAuth(error)) return
    phase.value = 'failed'; needsPreviewReload.value = true; errorMessage.value = '최신 비교 결과를 불러오지 못했습니다. 다시 시도하세요.'
  }
}
const downloadCredentials = async (credentials: RosterCredential[], filename: string) => {
  const module = await import('exceljs'); const Workbook = module.Workbook ?? (module.default as typeof module | undefined)?.Workbook
  if (!Workbook) throw new Error('Workbook unavailable')
  const workbook = createCredentialWorkbook(new Workbook(), credentials)
  downloadRosterWorkbook(await workbook.xlsx.writeBuffer(), filename)
}
const applyRoster = async () => {
  if (!cycle.value || !preview.value || !idempotencyKey.value || !canApply.value) return
  phase.value = 'applying'; errorMessage.value = ''
  try { const response = await $fetch<ApiSuccess<unknown>>('/api/admin/students/roster/apply', { method: 'POST', headers: headers(), body: { cycleId: cycle.value.id, expectedVersion: preview.value.rosterVersion, idempotencyKey: idempotencyKey.value, rows: rows.value } }); const result = parseSuccessEnvelope(response, rosterApplyResultSchema); await downloadCredentials(result.credentials, `${cycle.value.year}-신규-초기비밀번호.xlsx`); cycle.value = { ...cycle.value, rosterVersion: result.rosterVersion }; phase.value = 'completed' }
  catch (error) { if (await redirectForRecentAuth(error)) return; const conflict = isRosterConflict(error); phase.value = conflict ? 'failed' : 'ready'; needsPreviewReload.value = conflict; errorMessage.value = errorText(error, '적용 결과를 확인하지 못했습니다. 같은 적용 키로 다시 시도하세요.') }
}
const redownloadCurrent = async () => {
  try { const response = await $fetch<ApiSuccess<unknown>>('/api/admin/students/credentials', { headers: headers() }); const credentials = parseSuccessEnvelope(response, rosterCredentialSchema.array()); await downloadCredentials(credentials, `${cycle.value?.year ?? '현재'}-초기비밀번호.xlsx`) }
  catch (error) { if (!await redirectForRecentAuth(error)) errorMessage.value = '현재 자격증명을 내려받지 못했습니다. 최근 로그인을 확인하세요.' }
}
const downloadTemplate = async () => { const module = await import('exceljs'); const Workbook = module.Workbook ?? (module.default as typeof module | undefined)?.Workbook; if (!Workbook) return; const workbook = createRosterTemplate(new Workbook()); downloadRosterWorkbook(await workbook.xlsx.writeBuffer(), 'PHOTO-NEXT-지원자명단-양식.xlsx') }
defineExpose({ setPreviewForTest: (value: RosterPreviewResult) => { preview.value = value }, setImportForTest: (value: { rows: ApplicantRosterRow[], preview: RosterPreviewResult, confirmation: string, idempotencyKey: string }) => { rows.value = value.rows; preview.value = value.preview; confirmation.value = value.confirmation; idempotencyKey.value = value.idempotencyKey; phase.value = 'ready' } })
onMounted(loadCycles)
</script>

<template>
  <section class="roster-page" aria-labelledby="roster-title">
    <header class="roster-page__header"><div><p>ADMISSIONS / ANNUAL CONTACT SHEET</p><h1 id="roster-title">연간 지원자 명단</h1><span>사이클을 시작하고, 업로드 차이를 확인한 뒤 신규 자격증명을 보관합니다.</span></div><button data-action="download-template" type="button" @click="downloadTemplate">양식 다운로드</button></header>
    <AdmissionCycleStrip :cycle="cycle" :phase="phase" />
    <section v-if="!cycle" class="roster-page__start" aria-label="사이클 시작"><label>입시 연도 <input v-model.number="startYear" type="number" min="2020" max="2200"></label><button data-action="start-cycle" type="button" @click="startCycle">사이클 시작</button></section>
    <template v-else>
      <div class="roster-page__counts" aria-live="polite"><strong data-count="add">신규 {{ counts.add }}</strong><strong data-count="update">변경 {{ counts.update }}</strong><strong data-count="inactive">비활성 {{ counts.inactive }}</strong><strong data-count="unchanged">유지 {{ counts.unchanged }}</strong><small>현재 버전 v{{ cycle.rosterVersion }}</small></div>
      <RosterImportPanel :phase="phase" :error-message="errorMessage" :confirmation="confirmation" :confirmation-phrase="phrase" :can-apply="canApply" :file-name="fileName" @choose-file="chooseFile" @file-selected="selectFile" @update:confirmation="confirmation = $event" @apply="applyRoster" />
      <button v-if="needsPreviewReload" data-action="reload-preview" type="button" @click="reloadPreview">최신 비교 결과 다시 불러오기</button>
      <RosterPreviewTable v-if="preview" :preview="preview" />
      <div class="roster-page__credential"><button data-action="download-current-credentials" type="button" @click="redownloadCurrent">현재 자격증명 다시 다운로드</button><span>최근 로그인 후에만 내려받을 수 있습니다.</span></div>
    </template>
  </section>
</template>

<style scoped>
.roster-page{display:grid;gap:1.2rem}.roster-page__header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;align-items:end}.roster-page__header p{margin:0 0 .6rem;color:var(--color-sequence);font-family:var(--font-mono);font-size:.67rem;font-weight:700;letter-spacing:.09em}.roster-page h1{margin:0;font-family:var(--font-display);font-size:clamp(2rem,6vw,3.2rem);letter-spacing:-.05em}.roster-page__header span{display:block;margin-top:.7rem;color:color-mix(in srgb,var(--color-ink) 68%,transparent)}button{min-height:var(--touch-target);border:1px solid var(--color-resource);background:var(--color-surface);padding:.55rem .75rem;font-family:var(--font-display);font-weight:700;cursor:pointer}.roster-page__start{display:flex;flex-wrap:wrap;gap:.6rem;align-items:end;border:1px solid var(--color-resource);padding:1rem}.roster-page__start label{display:grid;gap:.3rem;font-family:var(--font-mono);font-size:.7rem}.roster-page__start input{min-height:var(--touch-target);border:1px solid var(--color-resource);padding:.35rem;background:var(--color-canvas)}.roster-page__counts{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;border-block:1px solid var(--color-resource);padding:.65rem 0;font-family:var(--font-mono);font-size:.72rem}.roster-page__counts strong{padding-right:.5rem;border-right:1px solid var(--color-resource)}.roster-page__counts small{color:color-mix(in srgb,var(--color-ink) 60%,transparent)}.roster-page__credential{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center}.roster-page__credential span{font-size:.78rem;color:color-mix(in srgb,var(--color-ink) 65%,transparent)}button:focus-visible{outline:3px solid var(--color-sequence);outline-offset:3px}@media(max-width:34rem){.roster-page__header{align-items:start}.roster-page__header>button{width:100%}.roster-page__counts{display:grid;grid-template-columns:1fr 1fr}.roster-page__counts strong{border:0}}
</style>
