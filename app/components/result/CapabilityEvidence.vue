<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  EquipmentResultResource,
  FacilityResultResource,
} from '../../../shared/types/result'
import { equipmentCategoryOf } from '../../../shared/utils/equipment-category'
import ConnectionReason from './ConnectionReason.vue'

const props = withDefaults(defineProps<{
  equipment: readonly EquipmentResultResource[]
  facility: readonly FacilityResultResource[]
  resultPublicId: string
  telemetryEnabled?: boolean
}>(), { telemetryEnabled: true })

type CapabilityResource = EquipmentResultResource | FacilityResultResource

const expanded = ref(false)
const evidenceId = `capability-evidence-${props.resultPublicId}`
const rankedEvidence = computed<readonly CapabilityResource[]>(() => [
  ...props.equipment,
  ...props.facility,
].sort((left, right) => (
  right.affinity - left.affinity
  || right.sourceDate.localeCompare(left.sourceDate)
  || left.id - right.id
)))
const facilities = computed(() => rankedEvidence.value.filter(resource => resource.type === 'facility'))
const bodies = computed(() => rankedEvidence.value.filter(
  (resource): resource is EquipmentResultResource => (
    resource.type === 'equipment' && equipmentCategoryOf(resource) === 'body'
  ),
))
const lenses = computed(() => rankedEvidence.value.filter(
  (resource): resource is EquipmentResultResource => (
    resource.type === 'equipment' && equipmentCategoryOf(resource) === 'lens'
  ),
))
const featured = computed<readonly CapabilityResource[]>(() => [
  facilities.value[0],
  bodies.value[0],
  lenses.value[0],
].filter((item): item is CapabilityResource => item !== undefined))
const remaining = computed(() => {
  const featuredKeys = new Set(featured.value.map(resource => `${resource.type}-${resource.id}`))
  return rankedEvidence.value.filter(resource => !featuredKeys.has(`${resource.type}-${resource.id}`))
})
const allEvidence = computed(() => [...featured.value, ...remaining.value].slice(0, 4))
const visibleEvidence = computed(() => expanded.value ? allEvidence.value : featured.value)

const recordResourceOpen = (resource: EquipmentResultResource): void => {
  if (!props.telemetryEnabled) return
  void $fetch('/api/events', {
    method: 'POST',
    body: {
      eventName: 'resource_opened',
      resultPublicId: props.resultPublicId,
      resourceId: resource.id,
      resourceType: resource.type,
    },
  }).catch(() => undefined)
}
</script>

<template>
  <div class="capability">
    <div
      :id="evidenceId"
      class="capability__list"
    >
      <article
        v-for="resource in visibleEvidence"
        :key="`${resource.type}-${resource.id}`"
        class="capability__item"
        :class="`capability__item--${resource.type}`"
        data-capability-evidence
        :data-capability-kind="resource.type === 'facility' ? 'facility' : equipmentCategoryOf(resource)"
      >
        <div class="capability__header">
          <span>{{ resource.type === 'equipment' ? 'EQUIPMENT' : 'FACILITY' }}</span>
          <time :datetime="resource.sourceDate">기준 {{ resource.sourceDate }}</time>
        </div>
        <h3>{{ resource.title }}</h3>

        <template v-if="resource.type === 'equipment'">
          <dl class="capability__metadata">
            <div>
              <dt>위치</dt>
              <dd>{{ resource.displayMetadata.locationLabel }}</dd>
            </div>
            <div>
              <dt>확인 수량</dt>
              <dd>{{ resource.displayMetadata.confirmedQuantity }}대</dd>
            </div>
            <div>
              <dt>이용</dt>
              <dd>{{ resource.displayMetadata.accessLabel }}</dd>
            </div>
          </dl>
          <a
            v-if="resource.displayMetadata.accessMode === 'reservation'"
            class="capability__reservation"
            :href="resource.displayMetadata.reservationUrl"
            target="_blank"
            rel="noopener noreferrer"
            @click="recordResourceOpen(resource)"
          >
            기자재 예약 시스템 열기 <span>(새 창)</span>
          </a>
          <p
            v-else
            class="capability__inquiry"
          >학과 문의 후 이용</p>
        </template>

        <template v-else>
          <dl class="capability__metadata">
            <div>
              <dt>위치</dt>
              <dd>{{ resource.displayMetadata.locationLabel }}</dd>
            </div>
            <div>
              <dt>확인 내용</dt>
              <dd>{{ resource.displayMetadata.operationNote }}</dd>
            </div>
          </dl>
        </template>

        <ConnectionReason :reason="resource.connectionReason" />
      </article>

      <p
        v-if="allEvidence.length === 0"
        class="capability__empty"
      >
        확인된 학과 데이터를 준비 중입니다
      </p>
      <p
        v-else-if="facilities.length === 0"
        class="capability__empty capability__empty--facility"
        data-facility-empty
      >
        확인된 시설 정보는 준비 중이며, 기자재 근거만 먼저 보여드립니다.
      </p>
    </div>

    <button
      v-if="allEvidence.length > featured.length"
      class="capability__more"
      data-testid="capability-more"
      type="button"
      :aria-controls="evidenceId"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? '학과 기반 접기' : '학과 기반 더보기' }}
    </button>
  </div>
</template>

<style scoped>
.capability {
  min-width: 0;
  border-radius: var(--radius-card);
}

.capability__list {
  display: grid;
  gap: 0.75rem;
}

.capability__item {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--color-primary) 16%, transparent);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--color-primary-soft) 72%, var(--color-surface));
  padding: 1rem;
}

.capability__header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  color: color-mix(in srgb, var(--color-ink) 61%, transparent);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: 0.045em;
}

.capability__header span {
  color: var(--color-resource);
  font-weight: 700;
}

.capability__item h3 {
  margin: 0.65rem 0 0;
  font-family: var(--font-display);
  font-size: 1rem;
  letter-spacing: -0.025em;
  overflow-wrap: anywhere;
}

.capability__metadata {
  display: grid;
  gap: 0.4rem;
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.capability__metadata div {
  display: grid;
  grid-template-columns: 4.25rem 1fr;
  gap: 0.5rem;
}

.capability__metadata dt {
  color: color-mix(in srgb, var(--color-ink) 60%, transparent);
}

.capability__metadata dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.capability__reservation,
.capability__more {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-resource);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-resource);
  padding: 0.7rem 0.9rem;
  font-family: var(--font-display);
  font-size: 0.8125rem;
  font-weight: 720;
  text-decoration: none;
  transition: background-color 160ms ease, color 160ms ease;
}

.capability__reservation {
  width: fit-content;
  margin-top: 0.8rem;
}

.capability__reservation span {
  margin-left: 0.25rem;
  font-family: var(--font-body);
  font-size: 0.6875rem;
  font-weight: 500;
}

.capability__reservation {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.capability__reservation:hover,
.capability__more:hover {
  background: var(--color-resource);
  color: var(--color-surface);
}

.capability__reservation:focus-visible,
.capability__more:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.capability__inquiry {
  margin: 0.75rem 0 0;
  color: var(--color-resource);
  font-size: 0.8125rem;
  font-weight: 700;
}

.capability__empty {
  margin: 0;
  background: color-mix(in srgb, var(--color-resource) 5%, var(--color-surface));
  color: color-mix(in srgb, var(--color-ink) 63%, transparent);
  padding: 1rem;
  border-radius: var(--radius-card);
  line-height: 1.55;
}

.capability__empty--facility {
  grid-column: 1 / -1;
  border-left: 0.15rem solid color-mix(in srgb, var(--color-resource) 32%, transparent);
  padding: 0.65rem 0.75rem;
  font-size: 0.75rem;
}

.capability__more {
  width: 100%;
  margin-top: 0.75rem;
}

@media (min-width: 1024px) {
  .capability__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

}

@media (prefers-reduced-motion: reduce) {
  .capability__reservation,
  .capability__more {
    transition: none;
  }
}
</style>
