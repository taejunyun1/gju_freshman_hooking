<script setup lang="ts">
import { onMounted } from 'vue'

onMounted(() => {
  void navigateTo('/login', { replace: true })
})
</script>

<template>
  <main aria-live="polite">
    <p>로그인 화면으로 이동합니다.</p>
  </main>
</template>
