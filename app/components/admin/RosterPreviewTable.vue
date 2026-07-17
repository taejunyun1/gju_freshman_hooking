<script setup lang="ts">
import type { RosterPreviewResult } from '../../../shared/schemas/admission-roster'
defineProps<{ preview: RosterPreviewResult }>()
const labels = { add: '신규', update: '변경', unchanged: '유지' } as const
</script>
<template>
  <div class="preview-table" tabindex="0">
    <table>
      <thead><tr><th>행</th><th>상태</th><th>이름</th><th>연락처</th><th>출신고교 / 학년</th></tr></thead>
      <tbody><tr v-for="item in preview.rows" :key="item.rowNumber" :data-row="item.rowNumber"><td>{{ item.rowNumber }}</td><td>{{ labels[item.action] }}</td><td>{{ item.row.name }}</td><td>{{ item.row.phone }}</td><td>{{ item.row.highSchool }} · {{ item.row.grade }}</td></tr></tbody>
    </table>
  </div>
</template>
<style scoped>
.preview-table{overflow:auto;border:1px solid var(--color-resource);background:var(--color-surface)}table{width:100%;border-collapse:collapse;font-size:.875rem}th,td{padding:.7rem;text-align:left;border-bottom:1px solid color-mix(in srgb,var(--color-resource) 55%,transparent);white-space:nowrap}th{font-family:var(--font-mono);font-size:.625rem;letter-spacing:.07em;color:color-mix(in srgb,var(--color-ink) 65%,transparent)}td:first-child,td:nth-child(2){font-family:var(--font-mono);font-size:.72rem}
</style>
