<script setup lang="ts">
import type { AdmissionCycle } from '../../../shared/schemas/admission-roster'

defineProps<{ cycle: AdmissionCycle | null, phase: string }>()
</script>

<template>
  <ol class="cycle-strip" aria-label="연간 명단 작업 순서">
    <li class="cycle-strip__frame" :class="{ 'is-current': cycle }">
      <span>FRAME 01</span><strong>{{ cycle ? `${cycle.year} 입시` : '사이클 시작' }}</strong><small>{{ cycle ? `v${cycle.rosterVersion}` : '연도를 등록하세요' }}</small>
    </li>
    <li class="cycle-strip__frame" :class="{ 'is-current': ['ready', 'applying', 'completed'].includes(phase) }">
      <span>FRAME 02</span><strong>차이 미리보기</strong><small>파일 행 비교</small>
    </li>
    <li class="cycle-strip__frame" :class="{ 'is-current': phase === 'completed' }">
      <span>FRAME 03</span><strong>자격증명 출력</strong><small>신규 학생만</small>
    </li>
  </ol>
</template>

<style scoped>
.cycle-strip { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1px; margin:0; padding:0; overflow:hidden; list-style:none; border:1px solid color-mix(in srgb,var(--color-primary) 22%,transparent); border-radius:var(--radius-panel); background:color-mix(in srgb,var(--color-primary) 20%,var(--color-surface)); }
.cycle-strip__frame { min-height:6.5rem; display:grid; align-content:space-between; gap:.35rem; background:var(--color-surface); padding:.7rem; }
.cycle-strip__frame.is-current { background:var(--color-primary-soft); box-shadow:inset 0 -3px var(--color-primary); }
.cycle-strip span,.cycle-strip small { font-family:var(--font-mono); font-size:.625rem; letter-spacing:.07em; }
.cycle-strip span { color:var(--color-primary); font-weight:700; }.cycle-strip small{color:color-mix(in srgb,var(--color-primary-strong) 60%,transparent)}
.cycle-strip strong{font-family:var(--font-display);line-height:1.1}
@media(max-width:34rem){.cycle-strip{grid-template-columns:1fr}.cycle-strip__frame{min-height:4.5rem}}
</style>
