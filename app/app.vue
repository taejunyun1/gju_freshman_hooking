<script setup lang="ts">
import { DOCUMENT_BRAND } from '#shared/constants/department-brand'

useHead({
  title: DOCUMENT_BRAND,
  meta: [{
    name: 'description',
    content: '광주대학교 사진영상미디어학과에서 관심사를 교과과정, 프로젝트, 교수진과 진로로 연결해 보는 PHOTO:NEXT입니다.',
  }],
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
