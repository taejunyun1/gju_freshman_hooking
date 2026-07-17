<script setup lang="ts">
import { z } from 'zod'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  adminEquipmentInventoryItemSchema,
  adminResourceSchema,
  type AdminEquipmentInventoryItem,
  type AdminEquipmentInventoryUpdate,
  type AdminResource,
  type AdminResourceWrite,
} from '../../../../shared/schemas/admin-resources'
import type { ApiSuccess } from '../../../../shared/types/api'
import EquipmentInventoryTable from '../../../components/admin/EquipmentInventoryTable.vue'
import ResourceEditor from '../../../components/admin/ResourceEditor.vue'
import AppState from '../../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

type DetailPayload = { resource: AdminResource, inventory: AdminEquipmentInventoryItem[] }
type ResourceSavePayload = { expectedUpdatedAt: string, resource: AdminResourceWrite }
type ResourceTransitionPayload = { resourceId: number, expectedUpdatedAt: string }
type ImageUploadPayload = ResourceTransitionPayload & { file: File }
type InventoryUpdatePayload = AdminEquipmentInventoryUpdate & { resourceId: number, itemId: number }
type InventoryMutationError = { itemId: number, expectedUpdatedAt: string, message: string }

const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const detailSchema = z.object({
  resource: adminResourceSchema,
  inventory: z.array(adminEquipmentInventoryItemSchema).max(500),
}).strict()
const inventoryMutationSchema = z.object({
  item: adminEquipmentInventoryItemSchema,
  resourceUpdatedAt: timestampSchema,
}).strict()
const importValidationSchema = z.object({
  expected: z.object({
    total: z.number().int().nonnegative(),
    departmentEquipmentRoom: z.number().int().nonnegative(),
    fantasyLab: z.number().int().nonnegative(),
    reservation: z.number().int().nonnegative(),
    inquiry: z.number().int().nonnegative(),
  }).strict(),
  actual: z.object({
    total: z.number().int().nonnegative(),
    departmentEquipmentRoom: z.number().int().nonnegative(),
    fantasyLab: z.number().int().nonnegative(),
    reservation: z.number().int().nonnegative(),
    inquiry: z.number().int().nonnegative(),
  }).strict(),
  duplicateInventoryCodeGroups: z.array(z.object({
    inventoryCode: z.string().min(1).max(100),
    sourceRows: z.array(z.number().int().positive()).max(500),
  }).strict()).max(500),
  unidentifiedRows: z.array(z.number().int().positive()).max(500),
  quantityCheckRows: z.array(z.number().int().positive()).max(500),
  unmatchedSourceRows: z.array(z.number().int().positive()).max(500),
}).strict()
type ImportValidation = z.infer<typeof importValidationSchema>

const importText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim())
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }))
const importRowSchema = z.object({
  sourceRow: z.number().int().min(1).max(1_000_000),
  name: importText(200),
  inventoryCode: importText(100),
  locationKey: z.enum(['department_equipment_room', 'fantasy_lab']),
  category: importText(100),
  accessMode: z.enum(['reservation', 'inquiry']),
  availabilityState: z.enum(['available', 'unavailable', 'unknown']),
  note: importText(1000).nullable(),
  dataQualityStatus: z.enum(['verified', 'duplicate_code', 'unidentified', 'quantity_check']),
  sourceDate: z.iso.date(),
  tags: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)).min(1).max(30),
}).strict()
const importFileSchema = z.object({ rows: z.array(importRowSchema).min(1).max(500) }).strict()
const knownResourceCodesSchema = z.array(importText(100)).max(1_000)

const route = useRoute()
const adminSession = useAdminSessionStore()
const resource = ref<AdminResource | null>(null)
const inventory = ref<AdminEquipmentInventoryItem[]>([])
const importValidation = ref<ImportValidation | null>(null)
const inventoryMutationError = ref<InventoryMutationError | null>(null)
const resourceConflict = ref<AdminResource | null>(null)
const inventoryConflicts = ref<Record<number, AdminEquipmentInventoryItem>>({})
const loading = ref(true)
const errorMessage = ref('')
const mutationMessage = ref('')
let active = true
let routeEpoch = 0
let resourceMutationVersion = 0
let importVersion = 0
const inventoryMutationVersions = new Map<number, number>()
let stopResourceWatch: (() => void) | undefined

const hasControlCharacters = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
})

const resourceId = computed(() => {
  const value = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
  return /^(?:[1-9][0-9]{0,15})$/u.test(String(value))
    && Number.isSafeInteger(Number(value))
    ? Number(value)
    : 0
})

const safeLocalUrl = (value: unknown, expectedPath: string, fallback: string): string => {
  if (typeof value !== 'string' || value.length > 2_000 || hasControlCharacters(value)) return fallback
  try {
    const parsed = new URL(value, 'https://photo-next.invalid')
    return parsed.origin === 'https://photo-next.invalid' && parsed.pathname === expectedPath
      ? `${parsed.pathname}${parsed.search}`
      : fallback
  }
  catch {
    return fallback
  }
}

const listUrl = computed(() => safeLocalUrl(route.query.returnTo, '/admin/resources', '/admin/resources'))
const loginRedirect = computed(() => safeLocalUrl(
  route.fullPath,
  `/admin/resources/${resourceId.value}`,
  `/admin/resources/${resourceId.value}`,
))

const errorPayload = (error: unknown): { code: string, current?: unknown } => {
  if (typeof error !== 'object' || error === null) return { code: '' }
  const data = (error as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return { code: '' }
  const failure = (data as { error?: unknown }).error
  if (typeof failure !== 'object' || failure === null) return { code: '' }
  const record = failure as { code?: unknown, current?: unknown }
  return {
    code: typeof record.code === 'string' ? record.code : '',
    ...(record.current === undefined ? {} : { current: record.current }),
  }
}

const recoverAuthentication = async (error: unknown): Promise<boolean> => {
  if (!['ADMIN_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'].includes(errorPayload(error).code)) return false
  adminSession.clear()
  await navigateTo({
    path: '/admin/login',
    query: { redirect: loginRedirect.value },
  }, { replace: true })
  return true
}

const decodeDetailForEndpoint = (input: unknown, expectedResourceId: number): DetailPayload => {
  const parsed = detailSchema.parse(input)
  if (
    parsed.resource.id !== expectedResourceId
    || parsed.inventory.some(item => item.equipmentResourceId !== expectedResourceId)
  ) throw new Error('ADMIN_RESOURCE_ENDPOINT_MISMATCH')
  return parsed
}

const decodeInventoryMutationForEndpoint = (
  input: unknown,
  expectedResourceId: number,
  expectedItemId: number,
) => {
  const parsed = inventoryMutationSchema.parse(input)
  if (parsed.item.id !== expectedItemId || parsed.item.equipmentResourceId !== expectedResourceId) {
    throw new Error('ADMIN_RESOURCE_INVENTORY_ENDPOINT_MISMATCH')
  }
  return parsed
}

const decodeResourceConflictForEndpoint = (error: unknown, expectedResourceId: number): AdminResource | null => {
  const failure = errorPayload(error)
  if (failure.code !== 'RESOURCE_CONFLICT') return null
  const current = adminResourceSchema.safeParse(failure.current)
  return current.success && current.data.id === expectedResourceId ? current.data : null
}

const decodeInventoryConflictForEndpoint = (
  error: unknown,
  expectedResourceId: number,
  expectedItemId: number,
): AdminEquipmentInventoryItem | null => {
  const failure = errorPayload(error)
  if (failure.code !== 'RESOURCE_CONFLICT') return null
  const current = adminEquipmentInventoryItemSchema.safeParse(failure.current)
  return current.success
    && current.data.id === expectedItemId
    && current.data.equipmentResourceId === expectedResourceId
    ? current.data
    : null
}

const replaceDetail = (detail: DetailPayload): void => {
  resource.value = detail.resource
  inventory.value = detail.inventory
}

const mergeInventoryByVersion = (
  currentItems: AdminEquipmentInventoryItem[],
  responseItems: AdminEquipmentInventoryItem[],
): AdminEquipmentInventoryItem[] => {
  const remainingResponses = new Map(responseItems.map(item => [item.id, item]))
  const mergedCurrent = currentItems.map((currentItem) => {
    const responseItem = remainingResponses.get(currentItem.id)
    remainingResponses.delete(currentItem.id)
    return responseItem && compareTimestamps(currentItem.updatedAt, responseItem.updatedAt) < 0
      ? responseItem
      : currentItem
  })
  const responseOnly = responseItems.filter((item) => {
    if (!remainingResponses.has(item.id)) return false
    remainingResponses.delete(item.id)
    return true
  })
  return [...mergedCurrent, ...responseOnly]
}

const applyResourceSnapshot = (
  candidate: AdminResource,
  nextInventory: AdminEquipmentInventoryItem[],
): void => {
  const current = resource.value
  const updatedAt = current
    ? newerTimestamp(current.updatedAt, candidate.updatedAt)
    : candidate.updatedAt
  inventory.value = nextInventory
  resource.value = candidate.type === 'equipment'
    ? adminResourceSchema.parse({
        ...candidate,
        updatedAt,
        metadata: {
          ...candidate.metadata,
          confirmedQuantity: nextInventory.filter(item => item.dataQualityStatus === 'verified').length,
        },
      })
    : adminResourceSchema.parse({ ...candidate, updatedAt })
}

const applyResourceMutationDetail = (detail: DetailPayload): void => {
  applyResourceSnapshot(detail.resource, mergeInventoryByVersion(inventory.value, detail.inventory))
}

const invalidateAllRequests = (): number => {
  routeEpoch += 1
  resourceMutationVersion += 1
  importVersion += 1
  inventoryMutationVersions.clear()
  return routeEpoch
}

const isCurrentRoute = (epoch: number, id: number): boolean => (
  active && epoch === routeEpoch && id === resourceId.value
)

const loadDetail = async (): Promise<void> => {
  const thisEpoch = invalidateAllRequests()
  const requestedId = resourceId.value
  loading.value = true
  errorMessage.value = ''
  mutationMessage.value = ''
  resource.value = null
  inventory.value = []
  importValidation.value = null
  inventoryMutationError.value = null
  resourceConflict.value = null
  inventoryConflicts.value = {}
  if (requestedId === 0) {
    errorMessage.value = '자원 번호를 확인할 수 없습니다. 목록에서 다시 선택하세요.'
    loading.value = false
    return
  }
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/resources/${requestedId}`, {
      headers: adminSession.authorizationHeaders(),
    })
    if (!isCurrentRoute(thisEpoch, requestedId)) return
    replaceDetail(decodeDetailForEndpoint(response.data, requestedId))
  }
  catch (error) {
    if (!isCurrentRoute(thisEpoch, requestedId)) return
    if (!await recoverAuthentication(error)) {
      errorMessage.value = '학과 자원을 불러오지 못했습니다. 목록에서 다시 선택하거나 세션을 확인하세요.'
    }
  }
  finally {
    if (isCurrentRoute(thisEpoch, requestedId)) loading.value = false
  }
}

type MutationLane = { epoch: number, version: number, id: number }
type InventoryMutationLane = MutationLane & { itemId: number }

const beginResourceMutation = (): MutationLane => {
  mutationMessage.value = ''
  resourceConflict.value = null
  return { epoch: routeEpoch, version: ++resourceMutationVersion, id: resourceId.value }
}

const isCurrentResourceMutation = (lane: MutationLane): boolean => (
  isCurrentRoute(lane.epoch, lane.id) && lane.version === resourceMutationVersion
)

const beginImport = (): MutationLane => ({
  epoch: routeEpoch,
  version: ++importVersion,
  id: resourceId.value,
})

const isCurrentImport = (lane: MutationLane): boolean => (
  isCurrentRoute(lane.epoch, lane.id) && lane.version === importVersion
)

const beginInventoryMutation = (itemId: number): InventoryMutationLane => {
  const version = (inventoryMutationVersions.get(itemId) ?? 0) + 1
  inventoryMutationVersions.set(itemId, version)
  if (inventoryMutationError.value?.itemId === itemId) inventoryMutationError.value = null
  const { [itemId]: _discarded, ...remainingConflicts } = inventoryConflicts.value
  inventoryConflicts.value = remainingConflicts
  return { epoch: routeEpoch, version, id: resourceId.value, itemId }
}

const isCurrentInventoryMutation = (lane: InventoryMutationLane): boolean => (
  isCurrentRoute(lane.epoch, lane.id)
  && lane.version === inventoryMutationVersions.get(lane.itemId)
)

const applyResourceFailure = async (
  error: unknown,
  lane: MutationLane,
  fallback: string,
): Promise<void> => {
  if (!isCurrentResourceMutation(lane)) return
  if (await recoverAuthentication(error)) return
  const current = decodeResourceConflictForEndpoint(error, lane.id)
  if (current) {
    resourceConflict.value = current
    mutationMessage.value = '다른 관리자가 먼저 변경했습니다. 현재 초안은 유지되며 최신 서버 본을 확인한 뒤 다시 적용해야 합니다.'
    return
  }
  mutationMessage.value = fallback
}

const saveResource = async (payload: ResourceSavePayload): Promise<void> => {
  const mutation = beginResourceMutation()
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/resources/${mutation.id}`, {
      method: 'PUT',
      headers: adminSession.authorizationHeaders(),
      body: { expectedUpdatedAt: payload.expectedUpdatedAt, ...payload.resource },
    })
    if (!isCurrentResourceMutation(mutation)) return
    applyResourceMutationDetail(decodeDetailForEndpoint(response.data, mutation.id))
    mutationMessage.value = '변경 내용을 저장했습니다.'
  }
  catch (error) {
    await applyResourceFailure(error, mutation, '변경 내용을 저장하지 못했습니다. 입력과 연결 상태를 확인해 주세요.')
  }
}

const transitionResource = async (
  kind: 'publish' | 'archive',
  payload: ResourceTransitionPayload,
): Promise<void> => {
  const mutation = beginResourceMutation()
  if (payload.resourceId !== mutation.id) return
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/resources/${mutation.id}/${kind}`, {
      method: 'POST',
      headers: adminSession.authorizationHeaders(),
      body: { expectedUpdatedAt: payload.expectedUpdatedAt },
    })
    if (!isCurrentResourceMutation(mutation)) return
    applyResourceMutationDetail(decodeDetailForEndpoint(response.data, mutation.id))
    mutationMessage.value = kind === 'publish' ? '학생 결과에 게시했습니다.' : '자원을 보관했습니다.'
  }
  catch (error) {
    await applyResourceFailure(
      error,
      mutation,
      kind === 'publish' ? '게시하지 못했습니다. 게시 검증 항목을 확인해 주세요.' : '보관하지 못했습니다. 다시 시도해 주세요.',
    )
  }
}

const uploadImage = async (payload: ImageUploadPayload): Promise<void> => {
  const mutation = beginResourceMutation()
  if (payload.resourceId !== mutation.id) return
  const body = new FormData()
  body.set('image', payload.file)
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/resources/${mutation.id}/image`, {
      method: 'POST',
      headers: adminSession.authorizationHeaders(),
      body,
    })
    if (!isCurrentResourceMutation(mutation)) return
    applyResourceMutationDetail(decodeDetailForEndpoint(response.data, mutation.id))
    mutationMessage.value = '자원 이미지를 저장했습니다.'
  }
  catch (error) {
    await applyResourceFailure(error, mutation, '이미지를 저장하지 못했습니다. 형식과 8 MiB 제한을 확인해 주세요.')
  }
}

const timestampInstant = (value: string): { seconds: number, fraction: string } => {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value)
  if (!match) throw new Error('ADMIN_RESOURCE_TIMESTAMP_INVALID')
  const milliseconds = Date.parse(`${match[1]}${match[3]}`)
  if (!Number.isFinite(milliseconds)) throw new Error('ADMIN_RESOURCE_TIMESTAMP_INVALID')
  return {
    seconds: milliseconds / 1_000,
    fraction: match[2] ?? '',
  }
}

const compareTimestamps = (leftValue: string, rightValue: string): number => {
  const left = timestampInstant(leftValue)
  const right = timestampInstant(rightValue)
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1
  const fractionLength = Math.max(left.fraction.length, right.fraction.length)
  const leftFraction = left.fraction.padEnd(fractionLength, '0')
  const rightFraction = right.fraction.padEnd(fractionLength, '0')
  return leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1
}

const newerTimestamp = (current: string, candidate: string): string => {
  return compareTimestamps(current, candidate) < 0 ? candidate : current
}

const updateResourceInventoryVersion = (updatedAt: string): void => {
  const current = resource.value
  if (!current) return
  const nextUpdatedAt = newerTimestamp(current.updatedAt, updatedAt)
  if (current.type !== 'equipment') {
    resource.value = adminResourceSchema.parse({ ...current, updatedAt: nextUpdatedAt })
    return
  }
  const confirmedQuantity = inventory.value.filter(item => item.dataQualityStatus === 'verified').length
  resource.value = adminResourceSchema.parse({
    ...current,
    updatedAt: nextUpdatedAt,
    metadata: { ...current.metadata, confirmedQuantity },
  })
}

const updateInventory = async (payload: InventoryUpdatePayload): Promise<void> => {
  const mutation = beginInventoryMutation(payload.itemId)
  if (payload.resourceId !== mutation.id) return
  const { resourceId: _resourceId, itemId, ...body } = payload
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/resources/${mutation.id}/inventory/${itemId}`, {
      method: 'PUT',
      headers: adminSession.authorizationHeaders(),
      body,
    })
    if (!isCurrentInventoryMutation(mutation)) return
    const parsed = decodeInventoryMutationForEndpoint(response.data, mutation.id, itemId)
    inventory.value = mergeInventoryByVersion(inventory.value, [parsed.item])
    updateResourceInventoryVersion(parsed.resourceUpdatedAt)
  }
  catch (error) {
    if (!isCurrentInventoryMutation(mutation)) return
    if (await recoverAuthentication(error)) return
    const current = decodeInventoryConflictForEndpoint(error, mutation.id, itemId)
    if (current) {
      inventoryConflicts.value = { ...inventoryConflicts.value, [itemId]: current }
    }
    inventoryMutationError.value = {
      itemId,
      expectedUpdatedAt: payload.expectedUpdatedAt,
      message: current
        ? '다른 관리자가 먼저 이 기자재 항목을 변경했습니다.'
        : '기자재 항목을 저장하지 못했습니다.',
    }
  }
}

const validateImport = async (payload: { file: File, knownResourceCodes: string[] }): Promise<void> => {
  const mutation = beginImport()
  importValidation.value = null
  try {
    const filePayload = importFileSchema.parse(JSON.parse(await payload.file.text()) as unknown)
    const knownResourceCodes = knownResourceCodesSchema.parse(payload.knownResourceCodes)
    const response = await $fetch<ApiSuccess<unknown>>('/api/admin/resources/equipment/import/validate', {
      method: 'POST',
      headers: adminSession.authorizationHeaders(),
      body: { rows: filePayload.rows, knownResourceCodes },
    })
    if (!isCurrentImport(mutation)) return
    importValidation.value = importValidationSchema.parse(response.data)
    mutationMessage.value = '가져오기 파일을 검증했습니다. 원본에는 적용하지 않았습니다.'
  }
  catch (error) {
    if (!isCurrentImport(mutation)) return
    if (!await recoverAuthentication(error)) {
      mutationMessage.value = '가져오기 파일을 검증하지 못했습니다. canonical JSON의 rows 필드를 확인해 주세요.'
    }
  }
}

const inventoryConflictItems = computed(() => (
  Object.values(inventoryConflicts.value).sort((left, right) => left.id - right.id)
))

const applyResourceConflict = (): void => {
  const current = resourceConflict.value
  if (!current || current.id !== resourceId.value) return
  applyResourceSnapshot(current, inventory.value)
  resourceConflict.value = null
  mutationMessage.value = '최신 서버 자원을 편집 기준으로 적용했습니다.'
}

const applyInventoryConflict = (itemId: number): void => {
  const current = inventoryConflicts.value[itemId]
  if (!current || current.id !== itemId || current.equipmentResourceId !== resourceId.value) return
  const mergedInventory = mergeInventoryByVersion(inventory.value, [current])
  inventory.value = mergedInventory
  const applied = mergedInventory.find(item => item.id === itemId)
  updateResourceInventoryVersion(applied?.updatedAt ?? current.updatedAt)
  const { [itemId]: _discarded, ...remainingConflicts } = inventoryConflicts.value
  inventoryConflicts.value = remainingConflicts
  if (inventoryMutationError.value?.itemId === itemId) inventoryMutationError.value = null
}

const typeLabels: Record<AdminResource['type'], string> = {
  course: '교과', equipment: '기자재', facility: '시설', extracurricular: '비교과',
  project: '프로젝트', student_work: '학생 작품', career: '진로', support: '지원',
}

onMounted(() => {
  stopResourceWatch = watch(resourceId, () => { void loadDetail() }, { immediate: true })
})
onBeforeUnmount(() => {
  active = false
  invalidateAllRequests()
  stopResourceWatch?.()
})
</script>

<template>
  <section class="resource-detail" aria-labelledby="resource-detail-title">
    <NuxtLink data-action="back-to-resources" class="resource-detail__back" :to="listUrl">← 학과 자원 목록으로</NuxtLink>

    <header class="resource-detail__header">
      <div>
        <p v-if="resource">RESOURCE / #{{ String(resource.id).padStart(6, '0') }} / {{ typeLabels[resource.type].toUpperCase() }}</p>
        <p v-else>RESOURCE / DETAIL REVIEW</p>
        <h1 id="resource-detail-title">{{ resource?.title ?? '학과 자원 상세' }}</h1>
        <p>{{ resource?.summary ?? '학과 근거의 출처와 게시 상태를 확인합니다.' }}</p>
      </div>
      <dl v-if="resource">
        <div><dt>기준일</dt><dd>{{ resource.sourceDate ?? '미입력' }}</dd></div>
        <div><dt>버전</dt><dd><time :datetime="resource.updatedAt">{{ resource.updatedAt }}</time></dd></div>
      </dl>
    </header>

    <AppState v-if="loading" variant="loading" message="학과 자원과 기자재 원본을 불러오고 있습니다." />
    <div v-else-if="errorMessage" class="resource-detail__state">
      <AppState variant="error" :message="errorMessage" />
      <button type="button" data-action="retry" @click="loadDetail">다시 시도</button>
    </div>

    <template v-else-if="resource">
      <p v-if="mutationMessage" class="resource-detail__notice" aria-live="polite">{{ mutationMessage }}</p>

      <section v-if="resourceConflict" class="resource-detail__conflict" data-resource-conflict role="alert" aria-labelledby="resource-conflict-title">
        <h2 id="resource-conflict-title">최신 서버 자원</h2>
        <dl>
          <div><dt>제목</dt><dd>{{ resourceConflict.title }}</dd></div>
          <div><dt>버전</dt><dd>{{ resourceConflict.updatedAt }}</dd></div>
        </dl>
        <p>현재 편집 초안은 그대로 유지됩니다. 최신 서버 본을 편집 기준으로 바꾸려면 직접 적용하세요.</p>
        <button type="button" data-action="apply-resource-conflict" @click="applyResourceConflict">최신 서버 본 적용</button>
      </section>

      <section
        v-for="current in inventoryConflictItems"
        :key="current.id"
        class="resource-detail__conflict"
        data-inventory-conflict
        role="alert"
        :aria-labelledby="`inventory-conflict-${current.id}`"
      >
        <h2 :id="`inventory-conflict-${current.id}`">최신 기자재 원본 항목</h2>
        <dl>
          <div><dt>항목</dt><dd>#{{ current.id }}</dd></div>
          <div><dt>코드</dt><dd>{{ current.inventoryCode }}</dd></div>
          <div><dt>버전</dt><dd>{{ current.updatedAt }}</dd></div>
        </dl>
        <p>표의 편집 초안은 유지됩니다. 최신 원본 행을 표에 반영하려면 직접 적용하세요.</p>
        <button type="button" data-action="apply-inventory-conflict" @click="applyInventoryConflict(current.id)">최신 원본 행 적용</button>
      </section>

      <ResourceEditor
        :resource="resource"
        :inventory="inventory"
        @save="saveResource"
        @publish="transitionResource('publish', $event)"
        @archive="transitionResource('archive', $event)"
        @upload-image="uploadImage"
      />

      <EquipmentInventoryTable
        v-if="resource.type === 'equipment'"
        :resource-id="resource.id"
        :items="inventory"
        :import-validation="importValidation"
        :mutation-error="inventoryMutationError"
        @update="updateInventory"
        @validate-import="validateImport"
      />
    </template>
  </section>
</template>

<style scoped>
.resource-detail { display: grid; gap: 1.25rem; }
.resource-detail__back { min-height: var(--touch-target); display: inline-flex; width: fit-content; align-items: center; color: var(--color-resource); font-weight: 700; text-decoration: none; }
.resource-detail__header { display: grid; gap: 1rem; border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent); padding-bottom: 1rem; }
.resource-detail__header > div > p:first-child { margin: 0 0 0.5rem; color: var(--color-resource); font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.08em; }
.resource-detail h1 { margin: 0; font-family: var(--font-display); font-size: clamp(1.75rem, 4vw, 2rem); letter-spacing: -0.05em; }
.resource-detail__header > div > p:last-child { max-width: 50rem; margin-bottom: 0; color: color-mix(in srgb, var(--color-ink) 68%, transparent); }
.resource-detail__header dl { display: grid; gap: 0.45rem; margin: 0; border-left: 0.25rem solid var(--color-resource); background: var(--color-surface); padding: 0.75rem; font-family: var(--font-mono); font-size: 0.6875rem; }
.resource-detail__header dl div { display: grid; grid-template-columns: 4rem 1fr; gap: 0.5rem; }
.resource-detail__header dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.resource-detail__state { display: grid; justify-items: start; gap: 0.75rem; }
.resource-detail__conflict { display: grid; justify-items: start; gap: 0.75rem; border: 1px solid var(--color-signal); border-left-width: 0.25rem; background: color-mix(in srgb, var(--color-signal) 8%, var(--color-surface)); padding: 1rem; }
.resource-detail__conflict h2, .resource-detail__conflict p, .resource-detail__conflict dl { margin: 0; }
.resource-detail__conflict dl { display: grid; gap: 0.35rem; font-family: var(--font-mono); font-size: 0.75rem; }
.resource-detail__conflict dl div { display: grid; grid-template-columns: 4rem minmax(0, 1fr); gap: 0.5rem; }
.resource-detail__conflict dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.resource-detail :is(button):not(.resource-editor button) { min-height: var(--touch-target); border: 1px solid var(--color-resource); border-radius: 0; background: var(--color-surface); color: var(--color-resource); padding: 0.625rem 1rem; font-family: var(--font-display); font-weight: 700; cursor: pointer; }
.resource-detail :is(a, button):focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 3px; }
.resource-detail__notice { margin: 0; border-left: 0.25rem solid var(--color-signal); background: color-mix(in srgb, var(--color-signal) 9%, var(--color-surface)); padding: 0.75rem; line-height: 1.55; }
@media (min-width: 48rem) { .resource-detail__header { grid-template-columns: minmax(0, 1fr) minmax(16rem, auto); align-items: end; } }
@media (prefers-reduced-motion: reduce) { .resource-detail * { scroll-behavior: auto !important; } }
</style>
