<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { AdminEquipmentInventoryItem } from '../../../shared/schemas/admin-resources'

type ImportValidation = {
  expected: { total: number, departmentEquipmentRoom: number, fantasyLab: number, reservation: number, inquiry: number }
  actual: { total: number, departmentEquipmentRoom: number, fantasyLab: number, reservation: number, inquiry: number }
  duplicateInventoryCodeGroups: Array<{ inventoryCode: string, sourceRows: number[] }>
  unidentifiedRows: number[]
  quantityCheckRows: number[]
  unmatchedSourceRows: number[]
}

type InventoryUpdatePayload = {
  resourceId: number
  itemId: number
  expectedUpdatedAt: string
  inventoryCode: string
  locationKey: AdminEquipmentInventoryItem['locationKey']
  accessMode: AdminEquipmentInventoryItem['accessMode']
  availabilityState: AdminEquipmentInventoryItem['availabilityState']
  note: string | null
  dataQualityStatus: AdminEquipmentInventoryItem['dataQualityStatus']
}

type InventoryMutationError = {
  itemId: number
  expectedUpdatedAt: string
  message: string
}

const props = withDefaults(defineProps<{
  resourceId: number
  items: AdminEquipmentInventoryItem[]
  importValidation?: ImportValidation | null
  mutationError?: InventoryMutationError | null
}>(), { importValidation: null, mutationError: null })

const emit = defineEmits<{
  update: [payload: InventoryUpdatePayload]
  'validate-import': [payload: { file: File, knownResourceCodes: string[] }]
}>()

const locationFilter = ref('')
const qualityFilter = ref('')
const editingId = ref<number | null>(null)
const editExpectedUpdatedAt = ref('')
const originalCode = ref('')
const pendingUpdate = ref<InventoryUpdatePayload | null>(null)
const inventoryConflict = ref<AdminEquipmentInventoryItem | null>(null)
const inventorySuccess = ref('')
const inventoryError = ref('')
const edit = ref({
  inventoryCode: '',
  locationKey: 'department_equipment_room' as AdminEquipmentInventoryItem['locationKey'],
  accessMode: 'reservation' as AdminEquipmentInventoryItem['accessMode'],
  availabilityState: 'unknown' as AdminEquipmentInventoryItem['availabilityState'],
  note: '' as string,
  dataQualityStatus: 'verified' as AdminEquipmentInventoryItem['dataQualityStatus'],
})

const filteredItems = computed(() => props.items.filter(item => (
  (!locationFilter.value || item.locationKey === locationFilter.value)
  && (!qualityFilter.value || item.dataQualityStatus === qualityFilter.value)
)))
const editingConflict = computed(() => inventoryConflict.value !== null)

const locationLabels = {
  department_equipment_room: '사진영상미디어학과 기자재실',
  fantasy_lab: '판타지랩',
} as const
const accessLabels = { reservation: '예약', inquiry: '문의' } as const
const availabilityLabels = { available: '사용 가능', unavailable: '사용 불가', unknown: '확인 필요' } as const
const qualityLabels = {
  verified: '검증 완료',
  duplicate_code: '중복 코드',
  unidentified: '모델 미확인',
  quantity_check: '수량 확인',
} as const

const startEdit = (item: AdminEquipmentInventoryItem) => {
  editingId.value = item.id
  editExpectedUpdatedAt.value = item.updatedAt
  originalCode.value = item.inventoryCode
  pendingUpdate.value = null
  inventoryConflict.value = null
  inventorySuccess.value = ''
  inventoryError.value = ''
  edit.value = {
    inventoryCode: item.inventoryCode,
    locationKey: item.locationKey,
    accessMode: item.accessMode,
    availabilityState: item.availabilityState,
    note: item.note ?? '',
    dataQualityStatus: item.dataQualityStatus,
  }
}

const itemMatchesPendingUpdate = (
  item: AdminEquipmentInventoryItem,
  pending: InventoryUpdatePayload,
): boolean => (
  item.inventoryCode === pending.inventoryCode
  && item.locationKey === pending.locationKey
  && item.accessMode === pending.accessMode
  && item.availabilityState === pending.availabilityState
  && item.note === pending.note
  && item.dataQualityStatus === pending.dataQualityStatus
)

watch(() => props.items, (items) => {
  if (editingId.value === null) return
  const current = items.find(item => item.id === editingId.value)
  if (!current) {
    editingId.value = null
    editExpectedUpdatedAt.value = ''
    pendingUpdate.value = null
    inventoryConflict.value = null
    inventoryError.value = ''
    return
  }
  if (pendingUpdate.value) {
    if (current.updatedAt === pendingUpdate.value.expectedUpdatedAt) return
    if (itemMatchesPendingUpdate(current, pendingUpdate.value)) {
      editingId.value = null
      editExpectedUpdatedAt.value = ''
      pendingUpdate.value = null
      inventoryConflict.value = null
      inventorySuccess.value = '기자재 원본 항목을 저장했습니다.'
      inventoryError.value = ''
      return
    }
    inventoryConflict.value = current
    pendingUpdate.value = null
    inventorySuccess.value = ''
    inventoryError.value = ''
    return
  }
  if (current.updatedAt !== editExpectedUpdatedAt.value) inventoryConflict.value = current
}, { deep: true })

watch(() => props.mutationError, (error) => {
  const pending = pendingUpdate.value
  if (
    !error
    || !pending
    || error.itemId !== pending.itemId
    || error.expectedUpdatedAt !== pending.expectedUpdatedAt
  ) return
  pendingUpdate.value = null
  inventorySuccess.value = ''
  inventoryError.value = error.message
})

const submitEdit = () => {
  const current = props.items.find(item => item.id === editingId.value)
  if (!current || editingConflict.value || pendingUpdate.value || !edit.value.inventoryCode.trim()) return
  const payload: InventoryUpdatePayload = {
    resourceId: props.resourceId,
    itemId: current.id,
    expectedUpdatedAt: editExpectedUpdatedAt.value,
    inventoryCode: edit.value.inventoryCode.trim(),
    locationKey: edit.value.locationKey,
    accessMode: edit.value.accessMode,
    availabilityState: edit.value.availabilityState,
    note: edit.value.note.trim() || null,
    dataQualityStatus: edit.value.dataQualityStatus,
  }
  pendingUpdate.value = payload
  inventorySuccess.value = ''
  inventoryError.value = ''
  emit('update', payload)
}

const cancelEdit = () => {
  editingId.value = null
  editExpectedUpdatedAt.value = ''
  pendingUpdate.value = null
  inventoryConflict.value = null
  inventoryError.value = ''
}

const onImport = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  emit('validate-import', {
    file,
    knownResourceCodes: [...new Set(props.items.map(item => item.inventoryCode))],
  })
}
</script>

<template>
  <section class="inventory" aria-labelledby="inventory-title">
    <header class="inventory__header">
      <div>
        <p>INVENTORY / SOURCE ROWS</p>
        <h2 id="inventory-title">기자재 원본 {{ items.length }}개</h2>
      </div>
      <div class="inventory__filters">
        <label>위치
          <select v-model="locationFilter" name="locationFilter">
            <option value="">전체</option>
            <option value="department_equipment_room">기자재실</option>
            <option value="fantasy_lab">판타지랩</option>
          </select>
        </label>
        <label>품질 검증
          <select v-model="qualityFilter" name="qualityFilter">
            <option value="">전체</option>
            <option value="verified">검증 완료</option>
            <option value="duplicate_code">중복 코드</option>
            <option value="unidentified">모델 미확인</option>
            <option value="quantity_check">수량 확인</option>
          </select>
        </label>
      </div>
    </header>

    <div class="inventory__table-wrap">
      <table :aria-label="`기자재 재고 ${filteredItems.length}개`">
        <thead><tr><th scope="col">원본 행</th><th scope="col">코드</th><th scope="col">위치</th><th scope="col">접근</th><th scope="col">상태</th><th scope="col">품질 검증</th><th scope="col">기준일</th><th scope="col">작업</th></tr></thead>
        <tbody>
          <tr v-for="item in filteredItems" :key="item.id">
            <td>{{ item.sourceRow }}</td><td><code>{{ item.inventoryCode }}</code></td>
            <td>{{ locationLabels[item.locationKey] }}</td><td>{{ accessLabels[item.accessMode] }}</td>
            <td>{{ availabilityLabels[item.availabilityState] }}</td>
            <td><span :data-quality="item.dataQualityStatus">{{ qualityLabels[item.dataQualityStatus] }}</span></td>
            <td><time :datetime="item.sourceDate">{{ item.sourceDate }}</time></td>
            <td><button type="button" data-action="edit-inventory" @click="startEdit(item)">수정</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="inventory__cards" aria-label="모바일 기자재 재고">
      <article v-for="item in filteredItems" :key="item.id" data-inventory-card>
        <h3>{{ item.inventoryCode }}</h3>
        <dl>
          <div><dt>원본 행</dt><dd>{{ item.sourceRow }}</dd></div>
          <div><dt>위치</dt><dd>{{ locationLabels[item.locationKey] }}</dd></div>
          <div><dt>접근</dt><dd>{{ accessLabels[item.accessMode] }}</dd></div>
          <div><dt>상태</dt><dd>{{ availabilityLabels[item.availabilityState] }}</dd></div>
          <div><dt>품질 검증</dt><dd>{{ qualityLabels[item.dataQualityStatus] }}</dd></div>
          <div><dt>기준일</dt><dd>{{ item.sourceDate }}</dd></div>
        </dl>
        <button type="button" data-action="edit-inventory" @click="startEdit(item)">수정</button>
      </article>
    </div>

    <p v-if="filteredItems.length === 0" class="inventory__empty" data-inventory-empty role="status">
      이 필터와 일치하는 원본 행이 없습니다. 위치나 품질 검증 필터를 다시 선택하세요.
    </p>
    <p v-if="inventorySuccess" class="inventory__success" data-inventory-success aria-live="polite">
      {{ inventorySuccess }}
    </p>

    <form
      v-if="editingId !== null"
      class="inventory__editor"
      data-inventory-editor
      :data-expected-updated-at="editExpectedUpdatedAt"
      @submit.prevent="submitEdit"
    >
      <h3>원본 항목 수정</h3>
      <p data-original-code>원래 코드 {{ originalCode }}는 변경 시 감사 기록에 남습니다.</p>
      <p v-if="editingConflict" class="inventory__conflict" data-inventory-conflict role="alert">
        편집을 시작하거나 저장을 요청한 뒤 다른 변경이 도착했습니다. 현재 초안은 보존했습니다. 취소한 뒤 최신 원본 행에서 다시 시작하세요.
      </p>
      <p v-else-if="inventoryError" class="inventory__error" data-inventory-error role="alert">
        {{ inventoryError }} 초안을 유지했습니다. 연결 상태를 확인하고 다시 저장해 주세요.
      </p>
      <p v-else-if="pendingUpdate" class="inventory__pending" data-inventory-pending aria-live="polite">
        저장 결과를 확인하고 있습니다.
      </p>
      <div class="inventory__editor-fields">
        <label>기자재 코드 <input v-model="edit.inventoryCode" name="inventoryCode" maxlength="100"></label>
        <label>위치 <select v-model="edit.locationKey" name="locationKey"><option value="department_equipment_room">기자재실</option><option value="fantasy_lab">판타지랩</option></select></label>
        <label>접근 <select v-model="edit.accessMode" name="accessMode"><option value="reservation">예약</option><option value="inquiry">문의</option></select></label>
        <label>상태 <select v-model="edit.availabilityState" name="availabilityState"><option value="available">사용 가능</option><option value="unavailable">사용 불가</option><option value="unknown">확인 필요</option></select></label>
        <label>품질 검증 <select v-model="edit.dataQualityStatus" name="dataQualityStatus"><option value="verified">검증 완료</option><option value="duplicate_code">중복 코드</option><option value="unidentified">모델 미확인</option><option value="quantity_check">수량 확인</option></select></label>
        <label>메모 <textarea v-model="edit.note" name="note" maxlength="1000" /></label>
      </div>
      <div class="inventory__actions">
        <button type="submit" data-action="save-inventory" :disabled="editingConflict || pendingUpdate !== null">변경 저장</button>
        <button type="button" @click="cancelEdit">취소</button>
      </div>
    </form>

    <section class="inventory__import" aria-labelledby="inventory-import-title">
      <h3 id="inventory-import-title">가져오기 사전 검증</h3>
      <p>파일은 검증만 하며 이 화면에서 자동 적용하지 않습니다.</p>
      <label>JSON 원본 <input name="inventoryImport" type="file" accept="application/json" @change="onImport"></label>
      <div v-if="importValidation" data-import-validation aria-live="polite">
        <p>총 기자재 {{ importValidation.actual.total }} / {{ importValidation.expected.total }}</p>
        <p>기자재실 {{ importValidation.actual.departmentEquipmentRoom }} / {{ importValidation.expected.departmentEquipmentRoom }}</p>
        <p>판타지랩 {{ importValidation.actual.fantasyLab }} / {{ importValidation.expected.fantasyLab }}</p>
        <p>예약 {{ importValidation.actual.reservation }} / {{ importValidation.expected.reservation }} · 문의 {{ importValidation.actual.inquiry }} / {{ importValidation.expected.inquiry }}</p>
        <div v-if="importValidation.duplicateInventoryCodeGroups.length">
          <p>중복 코드</p>
          <ul>
            <li v-for="group in importValidation.duplicateInventoryCodeGroups" :key="group.inventoryCode">
              {{ group.inventoryCode }} · 원본 행 {{ group.sourceRows.join(', ') }}
            </li>
          </ul>
        </div>
        <p v-if="importValidation.unidentifiedRows.length">모델 미확인 원본 행 {{ importValidation.unidentifiedRows.join(', ') }}</p>
        <p v-if="importValidation.quantityCheckRows.length">수량 확인 원본 행 {{ importValidation.quantityCheckRows.join(', ') }}</p>
        <p v-if="importValidation.unmatchedSourceRows.length">미연결 원본 행 {{ importValidation.unmatchedSourceRows.join(', ') }}</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.inventory { display: grid; gap: 1rem; border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent); background: var(--color-surface); padding: 1rem; }
.inventory__header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 1rem; }
.inventory__header p { margin: 0 0 0.3rem; color: var(--color-resource); font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.06em; }
.inventory h2, .inventory h3 { margin: 0; font-family: var(--font-display); }
.inventory__filters { display: flex; flex-wrap: wrap; gap: 0.625rem; }
.inventory label { display: grid; gap: 0.3rem; font-size: 0.8125rem; font-weight: 650; }
.inventory :is(input, select, textarea, button) { min-height: var(--touch-target); border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-ink); padding: 0.5rem; }
.inventory button { cursor: pointer; font-family: var(--font-display); font-weight: 700; }
.inventory button:disabled { cursor: not-allowed; opacity: 0.45; }
.inventory :is(input, select, textarea, button):focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 2px; }
.inventory__table-wrap { overflow-x: auto; }
.inventory table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.inventory th, .inventory td { border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 13%, transparent); padding: 0.65rem; text-align: left; white-space: nowrap; }
.inventory th { font-family: var(--font-mono); font-size: 0.625rem; letter-spacing: 0.04em; }
.inventory [data-quality]:not([data-quality='verified']) { color: var(--color-signal); font-weight: 700; }
.inventory__cards { display: none; }
.inventory__editor, .inventory__import { display: grid; gap: 0.75rem; border-top: 0.25rem solid var(--color-resource); background: var(--color-canvas); padding: 1rem; }
.inventory__editor-fields { display: grid; gap: 0.625rem; }
.inventory__actions { display: flex; gap: 0.625rem; }
.inventory__import p { margin: 0; }
.inventory__empty, .inventory__conflict, .inventory__error { margin: 0; border-left: 0.25rem solid var(--color-signal); background: color-mix(in srgb, var(--color-signal) 9%, var(--color-surface)); padding: 0.75rem; line-height: 1.55; }
.inventory__pending, .inventory__success { margin: 0; border-left: 0.25rem solid var(--color-resource); padding: 0.75rem; line-height: 1.55; }
.inventory__import ul { margin-bottom: 0; }
@media (min-width: 48rem) { .inventory__editor-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 44.99rem) {
  .inventory__table-wrap { display: none; }
  .inventory__cards { display: grid; gap: 0.75rem; }
  .inventory__cards article { border: 1px solid color-mix(in srgb, var(--color-ink) 15%, transparent); padding: 0.75rem; }
  .inventory__cards dl { display: grid; gap: 0.35rem; }
  .inventory__cards dl div { display: grid; grid-template-columns: 7rem 1fr; gap: 0.5rem; }
  .inventory__cards dt { color: color-mix(in srgb, var(--color-ink) 60%, transparent); }
  .inventory__cards dd { margin: 0; }
}
</style>
