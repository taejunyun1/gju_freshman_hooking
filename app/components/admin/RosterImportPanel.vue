<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{ phase: string, errorMessage: string, confirmation: string, confirmationPhrase: string, canApply: boolean, fileName?: string }>()
const emit = defineEmits<{ 'choose-file': [], 'file-selected': [file: File], 'update:confirmation': [value: string], apply: [] }>()
const input = ref<HTMLInputElement | null>(null)
const choose = () => { emit('choose-file'); input.value?.click() }
const select = (event: Event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) emit('file-selected', file) }
</script>
<template>
  <section class="import-panel" aria-labelledby="roster-import-title">
    <div><p class="import-panel__label">SOURCE / XLSX OR CSV</p><h2 id="roster-import-title">명단 파일</h2><p>이름, 연락처, 출신고교, 학년 열을 가진 파일을 비교합니다.</p></div>
    <div class="import-panel__actions">
      <input ref="input" class="sr-only" type="file" accept=".xlsx,.csv" aria-label="명단 파일 선택" @change="select">
      <button data-action="choose-file" type="button" @click="choose" @keydown.enter.prevent="choose" @keydown.space.prevent="choose">파일 선택</button>
      <span v-if="fileName" class="import-panel__file">{{ fileName }}</span>
    </div>
    <p v-if="errorMessage" role="alert" class="import-panel__error">{{ errorMessage }}</p>
    <div v-if="phase === 'ready'" class="import-panel__confirm">
      <label for="roster-confirmation">적용 문구 <strong>{{ confirmationPhrase }}</strong>를 입력하세요.</label>
      <input id="roster-confirmation" name="confirmation" :value="props.confirmation" autocomplete="off" @input="emit('update:confirmation', ($event.target as HTMLInputElement).value)">
      <button data-action="apply" type="button" :disabled="!canApply" @click="emit('apply')">명단 적용</button>
    </div>
  </section>
</template>
<style scoped>
.import-panel { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:1rem; border:1px solid color-mix(in srgb,var(--color-primary) 22%,transparent); border-radius: var(--radius-panel); background:var(--color-surface); padding:1rem; }
.import-panel h2,.import-panel p { margin:0; }
.import-panel h2 { font-family:var(--font-display); font-size:1.2rem; }
.import-panel__label { color:var(--color-primary); font-family:var(--font-mono); font-size:.625rem; font-weight:700; letter-spacing:.08em; }
.import-panel p:not(.import-panel__label) { margin-top:.4rem; color:color-mix(in srgb,var(--color-primary-strong) 65%,transparent); font-size:.875rem; }
.import-panel__actions,.import-panel__confirm { display:flex; flex-wrap:wrap; align-items:end; gap:.5rem; }
.import-panel button { min-height:var(--touch-target); border:1px solid var(--color-primary); border-radius:var(--radius-control); background:var(--color-primary); color:var(--color-surface); padding:.55rem .75rem; font-family:var(--font-display); font-weight:700; cursor:pointer; }
.import-panel button:disabled { opacity:.48; cursor:not-allowed; }
.import-panel__file { font-family:var(--font-mono); font-size:.68rem; }
.import-panel__error { grid-column:1/-1; color:var(--color-error) !important; }
.import-panel__confirm { grid-column:1/-1; align-items:center; border-top:1px solid color-mix(in srgb,var(--color-primary) 20%,transparent); padding-top:1rem; }
.import-panel__confirm label { font-size:.8rem; }
.import-panel__confirm input { min-height:var(--touch-target); border:1px solid color-mix(in srgb,var(--color-primary-strong) 25%,transparent); border-radius:var(--radius-control); padding:.4rem; background:var(--color-canvas); }
.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
@media(max-width:34rem) { .import-panel { grid-template-columns:1fr; } .import-panel__actions { align-items:start; flex-direction:column; } }
</style>
