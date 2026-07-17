<script setup lang="ts">
import { reactive } from 'vue'

const emit = defineEmits<{
  submit: [value: { name: string, phone: string, highSchool: string, grade: string }]
  cancel: []
}>()

const form = reactive({ name: '', phone: '', highSchool: '', grade: 'high3' })
</script>

<template>
  <form class="roster-student-form" aria-label="학생 개별 등록" @submit.prevent="emit('submit', { ...form })">
    <label>이름<input v-model="form.name" name="name" autocomplete="name"></label>
    <label>휴대전화<input v-model="form.phone" name="phone" autocomplete="tel"></label>
    <label>출신고교<input v-model="form.highSchool" name="highSchool" autocomplete="organization"></label>
    <label>학년<select v-model="form.grade" name="grade"><option value="high1">고1</option><option value="high2">고2</option><option value="high3">고3</option><option value="graduate">고교 졸업</option><option value="ged">검정고시</option><option value="other">기타</option></select></label>
    <div class="roster-student-form__actions">
      <button data-action="submit-student-form" type="submit">학생 저장</button>
      <button type="button" @click="emit('cancel')">닫기</button>
    </div>
  </form>
</template>

<style scoped>
.roster-student-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;border:1px solid color-mix(in srgb,var(--color-primary) 22%,transparent);border-radius:var(--radius-card);background:var(--color-primary-soft);padding:1rem}
.roster-student-form label{display:grid;gap:.3rem;font-family:var(--font-mono);font-size:.68rem;letter-spacing:.04em}
.roster-student-form input,.roster-student-form select{min-height:var(--touch-target);border:1px solid color-mix(in srgb,var(--color-primary-strong) 25%,transparent);border-radius:var(--radius-control);background:var(--color-surface);padding:.5rem;font:inherit}
.roster-student-form__actions{grid-column:1/-1;display:flex;gap:.5rem;justify-content:flex-end}
.roster-student-form button{min-height:var(--touch-target);border:1px solid var(--color-primary);border-radius:var(--radius-control);background:var(--color-surface);padding:.55rem .8rem;font-family:var(--font-display);font-weight:700}
.roster-student-form :is(input,select,button):focus-visible{outline: 3px solid var(--color-primary);outline-offset: 2px}
@media(max-width:36rem){.roster-student-form{grid-template-columns:1fr}}
</style>
