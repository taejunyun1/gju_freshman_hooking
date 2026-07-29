<script setup lang="ts">
import { PUBLIC_SEO } from '#shared/content/public-seo'

useHead({
  title: PUBLIC_SEO.title,
  meta: [{
    name: 'description',
    content: PUBLIC_SEO.description,
  }],
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
