<script setup lang="ts">
import { onMounted } from 'vue'

onMounted(() => {
  void navigateTo('/login', { replace: true })
})
</script>

<template>
  <main aria-live="polite">
    <p>비밀번호 재발급은 관리자에게 요청해 주세요. 로그인 화면으로 이동합니다.</p>
  </main>
</template>
