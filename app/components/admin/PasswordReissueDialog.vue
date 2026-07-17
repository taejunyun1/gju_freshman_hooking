<script setup lang="ts">
import type { RosterCredential } from '../../../shared/schemas/admission-roster'

defineProps<{ credential: RosterCredential | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title">
    <h2 id="password-dialog-title">임시 비밀번호</h2>
    <p v-if="credential">비밀번호는 이 창을 닫으면 다시 표시하지 않습니다.</p>
    <dl v-if="credential">
      <div><dt>학생</dt><dd>{{ credential.name }}</dd></div>
      <div><dt>전화</dt><dd>{{ credential.phone }}</dd></div>
      <div><dt>비밀번호</dt><dd><strong>{{ credential.password }}</strong></dd></div>
    </dl>
    <p v-else>표시할 비밀번호가 없습니다.</p>
    <button data-action="close-password-dialog" type="button" @click="emit('close')">닫기</button>
  </div>
</template>

<style scoped>
.password-dialog{position:fixed;inset:auto 1rem 1rem;max-width:28rem;border:1px solid color-mix(in srgb,var(--color-primary) 28%,transparent);border-radius:var(--radius-card);background:var(--color-surface);box-shadow:var(--shadow-raised);padding:1rem;z-index:20}
.password-dialog h2{margin:0 0 .5rem;font-family:var(--font-display)}
.password-dialog dl{display:grid;gap:.4rem}.password-dialog div{display:flex;justify-content:space-between;gap:1rem}.password-dialog dt{font-family:var(--font-mono);font-size:.7rem}.password-dialog strong{font-size:1.4rem;letter-spacing:.08em}
.password-dialog button{min-height:var(--touch-target);border:1px solid var(--color-primary);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-primary-strong);padding:.5rem .8rem;font-family:var(--font-display);font-weight:700}
.password-dialog button:focus-visible{outline: 3px solid var(--color-primary);outline-offset: 2px}
</style>
