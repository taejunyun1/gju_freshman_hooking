<script setup lang="ts">
import { computed } from 'vue'
import type { FacultyResult } from '../../../shared/types/result'

const props = defineProps<{
  person: FacultyResult
}>()

const hasContacts = computed(() => Object.keys(props.person.publicContacts).length > 0)
</script>

<template>
  <article
    class="faculty-card"
    :data-faculty-person="person.id"
  >
    <div class="faculty-card__heading">
      <h4>{{ person.name }} {{ person.title }}</h4>
      <span>{{ person.expertise }}</span>
    </div>
    <p class="faculty-card__reason">{{ person.reason }}</p>
    <address
      v-if="hasContacts"
      class="faculty-card__contacts"
    >
      <span
        v-if="person.publicContacts.office"
        class="faculty-card__office"
      >연구실 {{ person.publicContacts.office }}</span>
      <a
        v-if="person.publicContacts.phone"
        :href="`tel:${person.publicContacts.phone}`"
      >{{ person.publicContacts.phone }}</a>
      <a
        v-if="person.publicContacts.email"
        :href="`mailto:${person.publicContacts.email}`"
      >{{ person.publicContacts.email }}</a>
      <a
        v-if="person.publicContacts.website"
        :href="person.publicContacts.website"
        target="_blank"
        rel="noopener noreferrer"
      >웹사이트 (새 창)</a>
    </address>
  </article>
</template>

<style scoped>
.faculty-card { min-width: 0; }

.faculty-card__heading {
  min-width: 0;
  display: grid;
  gap: 0.35rem;
}

.faculty-card__heading h4 {
  min-width: 0;
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.25rem;
  letter-spacing: -0.035em;
  overflow-wrap: anywhere;
}

.faculty-card__heading span,
.faculty-card__reason {
  color: color-mix(in srgb, var(--color-ink) 69%, transparent);
  font-size: 0.8125rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: keep-all;
}

.faculty-card__reason { margin: 0.75rem 0 0; }

.faculty-card__contacts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.75rem;
  margin-top: 0.9rem;
  font-style: normal;
  font-size: 0.75rem;
}

.faculty-card__contacts a,
.faculty-card__office {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
}

.faculty-card__contacts a {
  min-width: 0;
  color: var(--color-sequence);
  overflow-wrap: anywhere;
  text-underline-offset: 0.2em;
}

.faculty-card__contacts a:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}
</style>
