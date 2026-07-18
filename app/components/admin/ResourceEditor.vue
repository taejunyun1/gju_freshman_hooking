<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'

import {
  adminResourceWriteSchema,
  type AdminEquipmentInventoryItem,
  type AdminResource,
  type AdminResourceWrite,
} from '../../../shared/schemas/admin-resources'
import { getAdminResourcePublishIssues } from '../../../shared/schemas/admin-resource-publish-validator'
import {
  equipmentCategories,
  equipmentCategoryLabels,
  type EquipmentCategory,
  type EquipmentResultResource,
  type FacilityResultResource,
  type ResultResource,
} from '../../../shared/types/result'
import CapabilityEvidence from '../result/CapabilityEvidence.vue'
import ResourceCard from '../result/ResourceCard.vue'

const props = withDefaults(defineProps<{
  resource: AdminResource
  inventory?: AdminEquipmentInventoryItem[]
  validatorIssues?: string[]
}>(), {
  inventory: () => [],
  validatorIssues: () => [],
})

const emit = defineEmits<{
  save: [payload: { expectedUpdatedAt: string, resource: AdminResourceWrite }]
  publish: [payload: { resourceId: number, expectedUpdatedAt: string }]
  archive: [payload: { resourceId: number, expectedUpdatedAt: string }]
  preview: [payload: ResultResource]
  'upload-image': [payload: { resourceId: number, expectedUpdatedAt: string, file: File }]
}>()

type Editable = {
  title: string
  summary: string
  connectionTemplate: string
  sourceDate: string
  visibility: AdminResource['visibility']
  priority: number
  imagePath: string | null
  metadata: Record<string, unknown>
  tags: Array<AdminResource['tags'][number]>
}

const editable = reactive<Editable>({
  title: '',
  summary: '',
  connectionTemplate: '',
  sourceDate: '',
  visibility: 'hidden',
  priority: 0,
  imagePath: null,
  metadata: {},
  tags: [],
})
const primaryTagKey = ref('')
const newTagKey = ref('')
const newActivity = ref('')
const imageError = ref('')
const confirmation = ref<'publish' | 'archive' | null>(null)
const publishConfirmButton = ref<HTMLButtonElement | null>(null)
const archiveConfirmButton = ref<HTMLButtonElement | null>(null)
const publishTriggerButton = ref<HTMLButtonElement | null>(null)
const archiveTriggerButton = ref<HTMLButtonElement | null>(null)
const baselineFingerprint = ref('')
const acceptedImagePath = ref<string | null>(null)
const effectiveExpectedUpdatedAt = ref('')
const acceptedResourceId = ref<number | null>(null)
const pendingSave = ref<{ fingerprint: string, expectedUpdatedAt: string } | null>(null)
const syncConflict = ref<AdminResource | null>(null)
const imagePathChoiceRequired = ref(false)
const saveStatus = ref('')
const timestampShadows = reactive({
  consentAt: { local: '', original: null as string | null },
  lastVerifiedAt: { local: '', original: null as string | null },
})
const equipmentCategory = computed({
  get: () => equipmentCategories.find(category => category === editable.metadata.category) ?? '',
  set: (category: string) => {
    if (category === '') delete editable.metadata.category
    else editable.metadata.category = category
  },
})
const cloneMetadata = (value: object): Record<string, unknown> => (
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>
)

const pad = (value: number): string => String(value).padStart(2, '0')

const toLocalDateTime = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const toOffsetIsoDateTime = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value)
  if (!match) return value
  const [, year, month, day, hour, minute] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  return `${value}:00.000${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
}

const timestampForWrite = (
  value: unknown,
  shadow: { local: string, original: string | null },
): string | null => (
  typeof value === 'string' && value === shadow.local
    ? shadow.original
    : toOffsetIsoDateTime(value)
)

const metadataForWrite = (): Record<string, unknown> => {
  const metadata = cloneMetadata(editable.metadata)
  if (props.resource.type === 'equipment') delete metadata.confirmedQuantity
  if (props.resource.type === 'student_work') {
    metadata.consent_at = timestampForWrite(metadata.consent_at, timestampShadows.consentAt)
  }
  if (props.resource.type === 'facility') {
    const timestampKey = 'last_verified_at' in metadata ? 'last_verified_at' : 'lastVerifiedAt'
    metadata[timestampKey] = timestampForWrite(metadata[timestampKey], timestampShadows.lastVerifiedAt)
    if (Array.isArray(metadata.activities)) {
      metadata.activities = metadata.activities.map(activity => String(activity))
    }
  }
  return metadata
}

const normalizedTags = computed<Array<AdminResource['tags'][number]>>(() => editable.tags.map(tag => ({
  ...tag,
  isPrimary: tag.key === primaryTagKey.value,
})))

const writePayload = (): AdminResourceWrite => ({
  type: props.resource.type,
  title: editable.title.trim(),
  summary: editable.summary.trim(),
  connectionTemplate: editable.connectionTemplate.trim(),
  sourceDate: editable.sourceDate || null,
  visibility: editable.visibility,
  priority: Number(editable.priority),
  tags: normalizedTags.value,
  metadata: metadataForWrite(),
  imagePath: editable.imagePath,
} as AdminResourceWrite)

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

const fingerprint = (value: unknown): string => JSON.stringify(canonicalize(value))
const payloadFingerprint = (): string => fingerprint(writePayload())

const resourceWrite = (resource: AdminResource): AdminResourceWrite => {
  const metadata = cloneMetadata(resource.metadata)
  if (resource.type === 'equipment') {
    delete metadata.confirmedQuantity
    delete metadata.confirmed_quantity
  }
  return {
    type: resource.type,
    title: resource.title,
    summary: resource.summary,
    connectionTemplate: resource.connectionTemplate,
    sourceDate: resource.sourceDate,
    visibility: resource.visibility,
    priority: resource.priority,
    tags: resource.tags.map(tag => ({ ...tag })),
    metadata,
    imagePath: resource.imagePath,
  } as AdminResourceWrite
}

const resourceFingerprint = (resource: AdminResource): string => fingerprint(resourceWrite(resource))

const cloneResource = (resource: AdminResource) => {
  editable.title = resource.title
  editable.summary = resource.summary
  editable.connectionTemplate = resource.connectionTemplate
  editable.sourceDate = resource.sourceDate ?? ''
  editable.visibility = resource.visibility
  editable.priority = resource.priority
  editable.imagePath = resource.imagePath
  editable.metadata = cloneMetadata(resource.metadata)
  if (resource.type === 'student_work') {
    const original = typeof resource.metadata.consent_at === 'string' ? resource.metadata.consent_at : null
    timestampShadows.consentAt.original = original
    timestampShadows.consentAt.local = toLocalDateTime(original)
    editable.metadata.consent_at = timestampShadows.consentAt.local
  } else {
    timestampShadows.consentAt.original = null
    timestampShadows.consentAt.local = ''
  }
  if (resource.type === 'facility') {
    const usesSnakeTimestamp = 'last_verified_at' in resource.metadata
    const original = usesSnakeTimestamp
      ? typeof resource.metadata.last_verified_at === 'string' ? resource.metadata.last_verified_at : null
      : typeof resource.metadata.lastVerifiedAt === 'string' ? resource.metadata.lastVerifiedAt : null
    timestampShadows.lastVerifiedAt.original = original
    timestampShadows.lastVerifiedAt.local = toLocalDateTime(original)
    editable.metadata[usesSnakeTimestamp ? 'last_verified_at' : 'lastVerifiedAt']
      = timestampShadows.lastVerifiedAt.local
  } else {
    timestampShadows.lastVerifiedAt.original = null
    timestampShadows.lastVerifiedAt.local = ''
  }
  editable.tags = resource.tags.map(tag => ({ ...tag }))
  primaryTagKey.value = resource.tags.find(tag => tag.isPrimary)?.key ?? ''
  newTagKey.value = ''
  newActivity.value = ''
  imageError.value = ''
  confirmation.value = null
  baselineFingerprint.value = payloadFingerprint()
  acceptedImagePath.value = resource.imagePath
  effectiveExpectedUpdatedAt.value = resource.updatedAt
  acceptedResourceId.value = resource.id
  pendingSave.value = null
  syncConflict.value = null
  imagePathChoiceRequired.value = false
  saveStatus.value = ''
}

const today = computed(() => new Date().toISOString().slice(0, 10))
const staleSource = computed(() => {
  if (!editable.sourceDate) return false
  const source = new Date(`${editable.sourceDate}T00:00:00Z`)
  const now = new Date()
  return Number.isFinite(source.getTime()) && source.getUTCFullYear() < now.getUTCFullYear()
})

const isDirty = computed(() => baselineFingerprint.value !== payloadFingerprint())

watch(() => props.resource, (resource) => {
  if (acceptedResourceId.value === null || resource.id !== acceptedResourceId.value) {
    cloneResource(resource)
    return
  }
  const incomingFingerprint = resourceFingerprint(resource)
  if (
    pendingSave.value
    && resource.updatedAt !== pendingSave.value.expectedUpdatedAt
    && incomingFingerprint === pendingSave.value.fingerprint
  ) {
    cloneResource(resource)
    saveStatus.value = '변경 내용이 서버에 저장되었습니다.'
    return
  }
  if (
    resource.updatedAt === effectiveExpectedUpdatedAt.value
    && incomingFingerprint === baselineFingerprint.value
  ) return
  if (isDirty.value || pendingSave.value) {
    syncConflict.value = resource
    imagePathChoiceRequired.value = false
    saveStatus.value = ''
    return
  }
  cloneResource(resource)
}, { immediate: true, deep: true })

const facilityActivities = computed(() => (
  Array.isArray(editable.metadata.activities)
    ? editable.metadata.activities.map(activity => String(activity))
    : []
))
const facilityOperationNote = computed(() => {
  const value = editable.metadata.operation_note ?? editable.metadata.operationNote
  return typeof value === 'string' ? value : ''
})
const facilityLastVerifiedAt = computed(() => {
  const value = editable.metadata.last_verified_at ?? editable.metadata.lastVerifiedAt
  return typeof value === 'string' ? value : ''
})

const localIssues = computed(() => {
  const resource = writePayload()
  const issues = getAdminResourcePublishIssues(resource, props.inventory)
  const parsed = adminResourceWriteSchema.safeParse(resource)
  if (!parsed.success) issues.push(...parsed.error.issues.map(issue => issue.message))
  if (isDirty.value) issues.push('변경 내용을 먼저 저장한 뒤 게시해 주세요.')
  if (syncConflict.value) issues.push('서버의 다른 변경을 확인한 뒤 편집 내용을 다시 적용해 주세요.')
  return [...new Set([...issues, ...props.validatorIssues])]
})

const primaryTag = computed(() => normalizedTags.value.find(tag => tag.isPrimary)?.key ?? 'resource')
const verifiedInventoryQuantity = computed(() => (
  props.inventory.filter(item => item.dataQualityStatus === 'verified').length
))
const previewResource = computed<ResultResource>(() => {
  const common = {
    id: props.resource.id,
    title: editable.title || '제목 미입력',
    summary: editable.summary || '요약을 입력하면 학생 결과에서 보이는 설명을 확인할 수 있습니다.',
    sourceDate: editable.sourceDate || today.value,
    affinity: 100,
    primaryTag: primaryTag.value,
    connectionReason: `${editable.title || '이 자원'}은(는) 선택한 관심과 학과의 학습 경로를 연결하는 근거입니다.`,
  } as const
  if (props.resource.type === 'course') {
    return {
      ...common,
      type: 'course',
      displayMetadata: {
        gradeYear: Number(editable.metadata.grade_year || 1) as 1 | 2 | 3 | 4,
        term: String(editable.metadata.term || '학기 미정'),
        credits: Number(editable.metadata.credits || 0),
      },
    }
  }
  if (props.resource.type === 'equipment') {
    const verified = props.inventory.filter(item => item.dataQualityStatus === 'verified')
    const first = verified[0] ?? props.inventory[0]
    const metadataAccessMode = editable.metadata.accessMode === 'reservation' ? 'reservation' : 'inquiry'
    const accessMode = first?.accessMode ?? metadataAccessMode
    const metadataLocation = String(editable.metadata.locationLabel || '사진영상미디어학과 기자재실')
    const category = equipmentCategories.find(item => item === editable.metadata.category)
    return {
      ...common,
      type: 'equipment',
      displayMetadata: {
        locationLabel: first
          ? (first.locationKey === 'fantasy_lab' ? '판타지랩' : '사진영상미디어학과 기자재실')
          : metadataLocation,
        confirmedQuantity: verifiedInventoryQuantity.value,
        reservationUrl: 'https://gjureserve.co.kr',
        accessMode,
        accessLabel: accessMode === 'reservation' ? '예약 가능' : '문의 전용',
        ...(category === undefined ? {} : { category: category as EquipmentCategory }),
      },
    } as ResultResource
  }
  if (props.resource.type === 'facility') {
    return {
      ...common,
      type: 'facility',
      displayMetadata: {
        locationLabel: String(editable.metadata.location_label || '학과 시설'),
        operationNote: facilityOperationNote.value || '운영 정보를 확인해 주세요.',
      },
    }
  }
  if (props.resource.type === 'student_work') {
    return {
      ...common,
      type: 'student_work',
      displayMetadata: {
        imagePath: editable.imagePath || 'images/resource-placeholder.webp',
        imageAlt: String(editable.metadata.image_alt || '학생 작품 미리보기'),
      },
    }
  }
  return {
    ...common,
    type: props.resource.type,
    displayMetadata: {},
  } as ResultResource
})

const equipmentPreview = computed<readonly EquipmentResultResource[]>(() => (
  previewResource.value.type === 'equipment' ? [previewResource.value] : []
))
const facilityPreview = computed<readonly FacilityResultResource[]>(() => (
  previewResource.value.type === 'facility' ? [previewResource.value] : []
))

watch(previewResource, value => emit('preview', value), { immediate: true, deep: true })

const addTag = () => {
  const key = newTagKey.value.trim().toLowerCase()
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(key) || editable.tags.some(tag => tag.key === key)) return
  editable.tags.push({ key, weight: 1, isPrimary: false })
  newTagKey.value = ''
}

const setMetadataText = (key: string, event: Event) => {
  editable.metadata[key] = (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

const setFacilityOperationNote = (event: Event) => {
  const key = 'operation_note' in editable.metadata ? 'operation_note' : 'operationNote'
  setMetadataText(key, event)
}

const setFacilityLastVerifiedAt = (event: Event) => {
  const key = 'last_verified_at' in editable.metadata ? 'last_verified_at' : 'lastVerifiedAt'
  setMetadataText(key, event)
}

const removeTag = (index: number) => {
  const removed = editable.tags[index]
  editable.tags.splice(index, 1)
  if (removed?.key === primaryTagKey.value) primaryTagKey.value = ''
}

const addActivity = () => {
  const activity = newActivity.value.trim()
  if (!activity || activity.length > 200 || facilityActivities.value.length >= 30) return
  editable.metadata.activities = [...facilityActivities.value, activity]
  newActivity.value = ''
}

const updateActivity = (index: number, event: Event) => {
  const activities = [...facilityActivities.value]
  activities[index] = (event.target as HTMLInputElement).value
  editable.metadata.activities = activities
}

const removeActivity = (index: number) => {
  editable.metadata.activities = facilityActivities.value.filter((_, activityIndex) => activityIndex !== index)
}

const save = () => {
  const resource = writePayload()
  pendingSave.value = {
    fingerprint: fingerprint(resource),
    expectedUpdatedAt: effectiveExpectedUpdatedAt.value,
  }
  saveStatus.value = ''
  emit('save', { expectedUpdatedAt: effectiveExpectedUpdatedAt.value, resource })
}

const finishReapply = (imagePath: string | null) => {
  const incoming = syncConflict.value
  if (!incoming) return
  editable.imagePath = imagePath
  effectiveExpectedUpdatedAt.value = incoming.updatedAt
  baselineFingerprint.value = resourceFingerprint(incoming)
  acceptedImagePath.value = incoming.imagePath
  pendingSave.value = null
  syncConflict.value = null
  imagePathChoiceRequired.value = false
  saveStatus.value = '최신 서버 본을 기준으로 현재 편집을 다시 적용했습니다. 변경 내용을 저장해 주세요.'
}

const reapplyDraft = () => {
  const incoming = syncConflict.value
  if (!incoming) return
  const localImagePath = editable.imagePath
  const incomingImagePath = incoming.imagePath
  const bothChanged = localImagePath !== acceptedImagePath.value
    && incomingImagePath !== acceptedImagePath.value
    && localImagePath !== incomingImagePath
  if (bothChanged) {
    imagePathChoiceRequired.value = true
    return
  }
  finishReapply(localImagePath === acceptedImagePath.value ? incomingImagePath : localImagePath)
}

const keepLocalImage = () => finishReapply(editable.imagePath)
const useServerImage = () => finishReapply(syncConflict.value?.imagePath ?? null)
const closeConfirmation = (kind: 'publish' | 'archive') => {
  confirmation.value = null
  void nextTick(() => {
    if (kind === 'publish') publishTriggerButton.value?.focus()
    else archiveTriggerButton.value?.focus()
  })
}
const confirmPublish = () => {
  if (isDirty.value || localIssues.value.length > 0) return
  emit('publish', { resourceId: props.resource.id, expectedUpdatedAt: effectiveExpectedUpdatedAt.value })
  closeConfirmation('publish')
}
const confirmArchive = () => {
  emit('archive', { resourceId: props.resource.id, expectedUpdatedAt: effectiveExpectedUpdatedAt.value })
  closeConfirmation('archive')
}

const openConfirmation = (kind: 'publish' | 'archive') => {
  if (kind === 'publish' && (isDirty.value || localIssues.value.length > 0)) return
  confirmation.value = kind
  void nextTick(() => {
    if (kind === 'publish') publishConfirmButton.value?.focus()
    else archiveConfirmButton.value?.focus()
  })
}

const onImageChange = (event: Event) => {
  imageError.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    imageError.value = '이미지는 jpg, png, webp 형식만 사용할 수 있습니다.'
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    imageError.value = '이미지는 8MiB 이하여야 합니다.'
    return
  }
  emit('upload-image', { resourceId: props.resource.id, expectedUpdatedAt: effectiveExpectedUpdatedAt.value, file })
}
</script>

<template>
  <div class="resource-editor">
    <p class="resource-editor__timecode" data-source-timecode>
      SOURCE {{ editable.sourceDate || '미입력' }} / VERIFIED {{ today }}
    </p>
    <p v-if="staleSource" class="resource-editor__stale" data-stale-source>
      현재 학사 주기보다 오래된 기준일입니다. 게시 전에 운영 정보를 다시 확인하세요.
    </p>

    <div class="resource-editor__layout" data-editor-layout>
      <nav class="resource-editor__index" aria-label="편집 섹션">
        <p>EDIT SECTIONS</p>
        <a href="#resource-content">콘텐츠</a>
        <a href="#resource-tags">태그</a>
        <a href="#resource-media">미디어</a>
        <a href="#resource-publication">게시</a>
      </nav>

      <form class="resource-editor__form" @submit.prevent="save">
        <section id="resource-content" aria-labelledby="resource-content-title">
          <h2 id="resource-content-title">콘텐츠</h2>
          <div class="resource-editor__fields">
            <label>제목 <input v-model="editable.title" name="title" maxlength="200"></label>
            <label class="resource-editor__wide">요약 <textarea v-model="editable.summary" name="summary" maxlength="1000" /></label>
            <label class="resource-editor__wide">관심 연결 설명 <textarea v-model="editable.connectionTemplate" name="connectionTemplate" maxlength="1000" /></label>
            <label>출처 기준일 <input v-model="editable.sourceDate" name="sourceDate" type="date"></label>
            <label>공개 범위
              <select v-model="editable.visibility" name="visibility">
                <option value="hidden">숨김</option>
                <option value="admin_only">관리자만</option>
                <option value="public">학생 공개</option>
              </select>
            </label>
            <label>우선순위 <input v-model.number="editable.priority" name="priority" type="number" min="0" max="32767"></label>
          </div>

          <fieldset v-if="resource.type === 'course'" class="resource-editor__type-fields">
            <legend>교과 운영 정보</legend>
            <label>학년도
              <input v-model.number="editable.metadata.academic_year" name="academic_year" type="number" min="2000" max="2100" aria-describedby="academic-year-help">
            </label>
            <small id="academic-year-help">현재 교육과정에 적용되는 학년도를 입력하세요.</small>
            <label>학년 <input v-model.number="editable.metadata.grade_year" name="grade_year" type="number" min="1" max="4"></label>
            <label>학기 <input v-model="editable.metadata.term" name="term" maxlength="40"></label>
            <label>학점 <input v-model.number="editable.metadata.credits" name="credits" type="number" min="0" max="30"></label>
            <label>교과 목표 <textarea :value="String(editable.metadata.goal ?? '')" name="goal" maxlength="1000" @input="setMetadataText('goal', $event)" /></label>
          </fieldset>

          <fieldset v-else-if="resource.type === 'equipment'" class="resource-editor__type-fields">
            <legend>기자재 이용 정보</legend>
            <p class="resource-editor__derived">확인 수량 {{ verifiedInventoryQuantity }}대 · 검증 완료 재고 원본에서 계산되며 여기서 수정하지 않습니다.</p>
            <label>분류
              <select v-model="equipmentCategory" name="category">
                <option value="">미분류 (레거시)</option>
                <option v-for="category in equipmentCategories" :key="category" :value="category">{{ equipmentCategoryLabels[category] }}</option>
              </select>
            </label>
            <label>위치
              <select v-model="editable.metadata.locationKey" name="locationKey">
                <option value="department_equipment_room">기자재실</option>
                <option value="fantasy_lab">판타지랩</option>
              </select>
            </label>
            <label>표시 위치 <input v-model="editable.metadata.locationLabel" name="locationLabel" maxlength="120"></label>
            <label>이용 방식
              <select v-model="editable.metadata.accessMode" name="accessMode">
                <option value="reservation">예약</option>
                <option value="inquiry">문의</option>
              </select>
            </label>
            <label>이용 표시 <input v-model="editable.metadata.accessLabel" name="accessLabel" maxlength="100"></label>
            <label>예약 URL <input v-model="editable.metadata.reservationUrl" name="reservationUrl" type="url" maxlength="500"></label>
            <label class="resource-editor__wide">수량 안내 <textarea :value="String(editable.metadata.snapshotNotice ?? '')" name="snapshotNotice" maxlength="1000" @input="setMetadataText('snapshotNotice', $event)" /></label>
          </fieldset>

          <fieldset v-else-if="resource.type === 'facility'" class="resource-editor__type-fields">
            <legend>시설 운영 정보</legend>
            <label>위치 <input v-model="editable.metadata.location_label" name="location_label" maxlength="120"></label>
            <label class="resource-editor__wide">운영·예약 안내 <textarea :value="facilityOperationNote" name="operation_note" maxlength="1000" @input="setFacilityOperationNote" /></label>
            <label>마지막 검증 <input :value="facilityLastVerifiedAt" name="last_verified_at" type="datetime-local" @input="setFacilityLastVerifiedAt"></label>
            <div class="resource-editor__activities resource-editor__wide">
              <span>가능한 활동</span>
              <ul>
                <li v-for="(activity, index) in facilityActivities" :key="index">
                  <label :for="`facility-activity-${index}`">활동 {{ index + 1 }}</label>
                  <input :id="`facility-activity-${index}`" name="activity" :value="activity" maxlength="200" @input="updateActivity(index, $event)">
                  <button type="button" data-action="remove-activity" @click="removeActivity(index)">활동 삭제</button>
                </li>
              </ul>
              <div class="resource-editor__tag-add">
                <label>새 활동 <input v-model="newActivity" name="newActivity" maxlength="200" @keydown.enter.prevent="addActivity"></label>
                <button type="button" data-action="add-activity" @click="addActivity">활동 추가</button>
              </div>
            </div>
          </fieldset>

          <fieldset v-else-if="resource.type === 'student_work'" class="resource-editor__type-fields">
            <legend>학생 작품 공개 정보</legend>
            <label>동의 일시 <input v-model="editable.metadata.consent_at" name="consent_at" type="datetime-local"></label>
            <label>대체 텍스트 <input v-model="editable.metadata.image_alt" name="image_alt" maxlength="200"></label>
            <label>연계 교과 <input v-model="editable.metadata.related_course" name="related_course" maxlength="200"></label>
            <label>연계 학년 <input v-model.number="editable.metadata.related_year" name="related_year" type="number" min="1" max="4"></label>
            <label>연계 전공 <input v-model="editable.metadata.related_track" name="related_track" maxlength="64"></label>
          </fieldset>
        </section>

        <section id="resource-tags" aria-labelledby="resource-tags-title">
          <h2 id="resource-tags-title">태그</h2>
          <div class="resource-editor__tag-add">
            <label>새 태그 <input v-model="newTagKey" name="newTagKey" pattern="[a-z][a-z0-9_]*" @keydown.enter.prevent="addTag"></label>
            <button type="button" data-action="add-tag" @click="addTag">태그 추가</button>
          </div>
          <ul class="resource-editor__tags">
            <li v-for="(tag, index) in editable.tags" :key="tag.key">
              <label><input v-model="primaryTagKey" name="primaryTag" type="radio" :value="tag.key"> 기본</label>
              <code>{{ tag.key }}</code>
              <label>가중치 <input v-model.number="tag.weight" type="number" min="0" max="3"></label>
              <button type="button" data-action="remove-tag" @click="removeTag(index)">삭제</button>
            </li>
          </ul>
        </section>

        <section id="resource-media" aria-labelledby="resource-media-title">
          <h2 id="resource-media-title">미디어</h2>
          <label>자원 이미지
            <input name="resourceImage" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="resource-image-help" @change="onImageChange">
          </label>
          <p id="resource-image-help" class="resource-editor__help">jpg, png, webp · 최대 8 MiB. 서버 검증 결과가 최종 기준입니다.</p>
          <p v-if="imageError" class="resource-editor__error" data-image-error role="alert">{{ imageError }}</p>
          <label v-if="resource.type === 'student_work'">이미지 경로 <input v-model="editable.imagePath" name="imagePath"></label>
        </section>

        <section id="resource-publication" aria-labelledby="resource-publication-title">
          <h2 id="resource-publication-title">게시</h2>
          <p class="resource-editor__publication-status">현재 상태: {{ resource.status }} · {{ isDirty ? '저장하지 않은 변경 있음' : '서버 저장본과 일치' }}</p>
          <div v-if="syncConflict" class="resource-editor__sync" data-resource-sync-conflict role="alert">
            <p>편집 중 서버에서 다른 변경을 받았습니다. 현재 초안은 보존했습니다. 최신 서버 본에 이 편집을 다시 적용한 뒤 저장하세요.</p>
            <div v-if="imagePathChoiceRequired" class="resource-editor__image-choice" data-image-path-choice>
              <p>이미지 경로가 내 편집과 서버에서 각각 변경되었습니다. 사용할 경로를 선택해 주세요.</p>
              <button type="button" data-action="keep-local-image" @click="keepLocalImage">내 편집 유지</button>
              <button type="button" data-action="use-server-image" @click="useServerImage">서버 경로 사용</button>
            </div>
            <button v-else type="button" data-action="reapply-resource" @click="reapplyDraft">현재 편집 다시 적용</button>
          </div>
          <p v-if="saveStatus" class="resource-editor__save-status" data-resource-save-status aria-live="polite">{{ saveStatus }}</p>
          <div class="resource-editor__actions">
            <button type="button" data-action="save" :disabled="syncConflict !== null" @click="save">변경 저장</button>
            <button ref="publishTriggerButton" type="button" data-action="publish" :disabled="localIssues.length > 0" @click="openConfirmation('publish')">게시</button>
            <button ref="archiveTriggerButton" type="button" data-action="archive" @click="openConfirmation('archive')">보관</button>
          </div>
          <div v-if="confirmation === 'publish'" class="resource-editor__confirm" data-confirm="publish" role="group" aria-labelledby="publish-confirm-title">
            <p id="publish-confirm-title">검증한 내용으로 학생에게 게시할까요?</p>
            <button ref="publishConfirmButton" type="button" data-action="confirm-publish" @click="confirmPublish">게시 확인</button>
            <button type="button" data-action="cancel-publish" @click="closeConfirmation('publish')">취소</button>
          </div>
          <div v-if="confirmation === 'archive'" class="resource-editor__confirm" data-confirm="archive" role="group" aria-labelledby="archive-confirm-title">
            <p id="archive-confirm-title">이 자원을 보관 상태로 전환할까요?</p>
            <button ref="archiveConfirmButton" type="button" data-action="confirm-archive" @click="confirmArchive">보관 확인</button>
            <button type="button" data-action="cancel-archive" @click="closeConfirmation('archive')">취소</button>
          </div>
        </section>
      </form>

      <aside class="resource-editor__review" aria-label="학생 결과 미리보기와 게시 검증">
        <div class="resource-editor__preview">
          <p>STUDENT RESULT PREVIEW</p>
          <CapabilityEvidence
            v-if="resource.type === 'equipment' || resource.type === 'facility'"
            :equipment="equipmentPreview"
            :facility="facilityPreview"
            result-public-id="admin-preview"
            :telemetry-enabled="false"
          />
          <ResourceCard
            v-else
            :resource="previewResource"
            :variant="resource.type === 'course' ? 'course' : 'outcome'"
          />
        </div>
        <div class="resource-editor__issues" data-publish-issues aria-live="polite">
          <strong>게시 이슈 {{ localIssues.length }}개</strong>
          <ul v-if="localIssues.length"><li v-for="issue in localIssues" :key="issue">{{ issue }}</li></ul>
          <p v-else>게시 전 검증을 통과했습니다.</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.resource-editor { display: grid; gap: 0.75rem; }
.resource-editor__timecode { margin: 0; color: var(--color-resource); font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.06em; }
.resource-editor__stale { margin: 0; border-left: 0.25rem solid var(--color-primary); border-radius: var(--radius-card); background: var(--color-primary-soft); padding: 0.75rem; }
.resource-editor__layout { display: grid; gap: 1rem; align-items: start; }
.resource-editor__index { display: grid; gap: 0.25rem; border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent); border-radius: var(--radius-panel); background: var(--color-surface); padding: 0.75rem; }
.resource-editor__index p { margin: 0 0 0.35rem; color: var(--color-resource); font-family: var(--font-mono); font-size: 0.625rem; font-weight: 700; letter-spacing: 0.06em; }
.resource-editor__index a { min-height: var(--touch-target); display: flex; align-items: center; border-left: 0.2rem solid transparent; color: var(--color-ink); padding: 0.45rem 0.6rem; font-weight: 700; text-decoration: none; }
.resource-editor__index a:hover { border-left-color: var(--color-resource); background: color-mix(in srgb, var(--color-resource) 7%, var(--color-surface)); }
.resource-editor__index a:focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 2px; }
.resource-editor__form { display: grid; gap: 1rem; }
.resource-editor__form > section { scroll-margin-top: 1rem; border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent); border-radius: var(--radius-panel); background: var(--color-surface); padding: 1rem; }
.resource-editor h2 { margin: 0 0 1rem; font-family: var(--font-display); font-size: 1.2rem; }
.resource-editor__fields, .resource-editor__type-fields { display: grid; gap: 0.75rem; }
.resource-editor label { display: grid; gap: 0.35rem; font-weight: 650; }
.resource-editor input, .resource-editor textarea, .resource-editor select, .resource-editor button { min-height: var(--touch-target); border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-ink); padding: 0.625rem; }
.resource-editor textarea { min-height: 6rem; resize: vertical; }
.resource-editor button { cursor: pointer; font-family: var(--font-display); font-weight: 700; }
.resource-editor button:disabled { cursor: not-allowed; opacity: 0.45; }
.resource-editor :is(input, textarea, select, button):focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 2px; }
.resource-editor__type-fields { margin: 1rem 0 0; border: 1px dashed color-mix(in srgb, var(--color-resource) 45%, transparent); padding: 0.75rem; }
.resource-editor__type-fields legend { color: var(--color-resource); font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; }
.resource-editor__derived { margin: 0; border-left: 0.2rem solid var(--color-primary); border-radius: var(--radius-card); background: var(--color-primary-soft); padding: 0.65rem; font-size: 0.8125rem; line-height: 1.5; }
.resource-editor__tag-add { display: flex; flex-wrap: wrap; align-items: end; gap: 0.75rem; }
.resource-editor__tags { display: grid; gap: 0.5rem; padding: 0; list-style: none; }
.resource-editor__tags li { display: grid; grid-template-columns: auto minmax(7rem, 1fr) minmax(7rem, auto) auto; align-items: center; gap: 0.625rem; border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent); padding-top: 0.5rem; }
.resource-editor__tags label { display: flex; align-items: center; gap: 0.35rem; }
.resource-editor__tags input[type='radio'] { min-height: 1rem; }
.resource-editor__activities { display: grid; gap: 0.55rem; }
.resource-editor__activities > span { font-weight: 650; }
.resource-editor__activities ul { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.resource-editor__activities li { display: grid; grid-template-columns: auto minmax(8rem, 1fr) auto; align-items: center; gap: 0.5rem; }
.resource-editor__review { min-width: 0; display: grid; gap: 1rem; border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent); border-radius: var(--radius-panel); background: var(--color-primary-soft); padding: 0.75rem; }
.resource-editor__preview { max-width: 34rem; }
.resource-editor__preview > p { color: var(--color-resource); font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; }
.resource-editor__issues { margin-top: 1rem; border-left: 0.25rem solid var(--color-primary); border-radius: var(--radius-card); background: var(--color-primary-soft); color: var(--color-primary-strong); padding: 0.75rem; }
.resource-editor__issues:has(ul) { border-left-color: var(--color-error); background: color-mix(in srgb, var(--color-error) 7%, var(--color-surface)); color: var(--color-error); }
.resource-editor__issues :is(ul, p) { margin-bottom: 0; }
.resource-editor__publication-status, .resource-editor__help { color: color-mix(in srgb, var(--color-ink) 68%, transparent); font-size: 0.8125rem; line-height: 1.55; }
.resource-editor__sync { display: grid; justify-items: start; gap: 0.625rem; border-left: 0.25rem solid var(--color-primary); border-radius: var(--radius-card); background: var(--color-primary-soft); padding: 0.75rem; }
.resource-editor__image-choice { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; }
.resource-editor__image-choice p { flex-basis: 100%; }
.resource-editor__sync p, .resource-editor__save-status { margin: 0; line-height: 1.55; }
.resource-editor__save-status { border-left: 0.25rem solid var(--color-primary); border-radius: var(--radius-card); background: var(--color-primary-soft); padding: 0.75rem; }
.resource-editor__actions { display: flex; flex-wrap: wrap; gap: 0.625rem; margin-top: 1rem; }
.resource-editor__actions button:first-child { border-color: var(--color-primary); background: var(--color-primary); color: var(--color-surface); }
.resource-editor :is([data-action='remove-activity'], [data-action='remove-tag'], [data-action='archive']) { border-color: var(--color-error); color: var(--color-error); }
.resource-editor__confirm { margin-top: 0.75rem; border-radius: var(--radius-card); padding: 0.75rem; }
.resource-editor__confirm[data-confirm='publish'] { border: 1px solid color-mix(in srgb, var(--color-primary) 28%, transparent); background: var(--color-primary-soft); }
.resource-editor__confirm[data-confirm='publish'] [data-action='confirm-publish'] { border-color: var(--color-primary); background: var(--color-primary); color: var(--color-surface); }
.resource-editor__confirm[data-confirm='archive'] { border: 1px solid color-mix(in srgb, var(--color-error) 28%, transparent); background: color-mix(in srgb, var(--color-error) 6%, var(--color-surface)); }
.resource-editor__confirm[data-confirm='archive'] [data-action='confirm-archive'] { border-color: var(--color-error); background: var(--color-error); color: var(--color-surface); }
.resource-editor__error { color: var(--color-error); }
@media (min-width: 48rem) {
  .resource-editor__fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .resource-editor__wide { grid-column: 1 / -1; }
  .resource-editor__type-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 70rem) {
  .resource-editor__layout { grid-template-columns: 10rem minmax(0, 1fr) minmax(16rem, 21rem); }
  .resource-editor__index, .resource-editor__review { position: sticky; top: 1rem; }
}
@media (max-width: 40rem) {
  .resource-editor__tags li, .resource-editor__activities li { grid-template-columns: 1fr; }
}
</style>
