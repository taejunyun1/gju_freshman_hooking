<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'

import {
  adminFacultyTagCategories,
  adminFacultyTrackPairs,
  adminFacultyWriteSchema,
  type AdminFaculty,
  type AdminFacultyPreview,
  type AdminFacultyWrite,
} from '../../../shared/schemas/admin-faculty'

const props = withDefaults(defineProps<{
  faculty: AdminFaculty
  preview?: AdminFacultyPreview | null
  previewError?: string
  previewing?: boolean
  saving?: boolean
  publishing?: boolean
  hasConflict?: boolean
  statusMessage?: string
}>(), {
  preview: null,
  previewError: '',
  previewing: false,
  saving: false,
  publishing: false,
  hasConflict: false,
  statusMessage: '',
})

const emit = defineEmits<{
  save: [payload: { expectedUpdatedAt: string, faculty: AdminFacultyWrite }]
  preview: [payload: { faculty: AdminFacultyWrite }]
  publish: [payload: { facultyId: number, expectedUpdatedAt: string }]
}>()

const profileSections = [
  { key: 'education', label: '학력' },
  { key: 'careers', label: '경력' },
  { key: 'teachingFields', label: '교육·지도 분야' },
  { key: 'studentProjects', label: '학생 연계 프로젝트' },
  { key: 'careerPaths', label: '진로 방향' },
  { key: 'institutionProjects', label: '기관 프로젝트' },
  { key: 'majorWorks', label: '주요 작품' },
] as const
type ProfileListKey = typeof profileSections[number]['key']

const categoryLabels: Record<typeof adminFacultyTagCategories[number], string> = {
  track: '전공 트랙',
  activity: '활동',
  result: '결과물',
  career: '진로',
  specialist: '전문 연계',
}

const contactFields = [
  { key: 'office', label: '연구실', type: 'text', visibilityName: 'officeVisibility' },
  { key: 'phone', label: '전화', type: 'tel', visibilityName: 'phoneVisibility' },
  { key: 'email', label: '이메일', type: 'email', visibilityName: 'emailVisibility' },
  { key: 'website', label: '웹사이트', type: 'url', visibilityName: 'websiteVisibility' },
] as const
type ContactKey = typeof contactFields[number]['key']

const canonicalTracks = Object.entries(adminFacultyTrackPairs).map(([key, label]) => ({ key, label }))
const newTags = reactive(Object.fromEntries(adminFacultyTagCategories.map(category => [category, {
  key: category === 'track' ? 'documentary' : '',
  label: category === 'track' ? adminFacultyTrackPairs.documentary : '',
}])) as Record<typeof adminFacultyTagCategories[number], { key: string, label: string }>)

const editable = reactive<AdminFacultyWrite>({} as AdminFacultyWrite)
const baseline = ref('')
const expectedUpdatedAt = ref('')
const lastVerifiedShadow = reactive({ local: '', original: null as string | null })
const confirmationOpen = ref(false)
const publishTrigger = ref<HTMLButtonElement | null>(null)
const publishConfirm = ref<HTMLButtonElement | null>(null)
const selectedScenario = ref(0)
const linkTargetModes = ref<Array<'common' | 'specific'>>([])

const deepClone = <Value,>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value
const facultyWrite = (value: AdminFaculty): AdminFacultyWrite => ({
  name: value.name,
  title: value.title,
  employmentType: value.employmentType,
  consultationRole: value.consultationRole,
  office: value.office,
  phone: value.phone,
  email: value.email,
  website: value.website,
  contactVisibility: { ...value.contactVisibility },
  expertiseSummary: value.expertiseSummary,
  bio: value.bio,
  profileSections: deepClone(value.profileSections),
  weeklyCapacity: value.weeklyCapacity,
  priority: value.priority,
  sourceDate: value.sourceDate,
  lastVerifiedAt: value.lastVerifiedAt,
  imagePath: value.imagePath,
  tags: value.tags.map(tag => ({ ...tag })),
  specialistLinks: value.specialistLinks.map(link => ({ ...link })),
})

const pad = (value: number): string => String(value).padStart(2, '0')
const toLocalDateTime = (value: string | null): string => {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
const toOffsetIsoDateTime = (value: string): string | null => {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value)
  if (!match) return value
  const [, year, month, day, hour, minute, second = '00'] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
}

const timestampForWrite = (): string | null => (
  editable.lastVerifiedAt === lastVerifiedShadow.local
    ? lastVerifiedShadow.original
    : toOffsetIsoDateTime(editable.lastVerifiedAt ?? '')
)

const payload = (): AdminFacultyWrite => ({
  ...deepClone(editable),
  office: editable.office === '' ? null : editable.office,
  phone: editable.phone === '' ? null : editable.phone,
  email: editable.email === '' ? null : editable.email,
  website: editable.website === '' ? null : editable.website,
  imagePath: typeof editable.imagePath === 'string' ? editable.imagePath.trim() || null : null,
  lastVerifiedAt: timestampForWrite(),
})
const fingerprint = (value: unknown): string => JSON.stringify(value)
const isDirty = computed(() => fingerprint(payload()) !== baseline.value)

const cloneFaculty = (value: AdminFaculty): void => {
  const write = facultyWrite(value)
  lastVerifiedShadow.original = value.lastVerifiedAt
  lastVerifiedShadow.local = toLocalDateTime(value.lastVerifiedAt)
  Object.assign(editable, write, {
    contactVisibility: { ...write.contactVisibility },
    profileSections: deepClone(write.profileSections),
    tags: write.tags.map(tag => ({ ...tag })),
    specialistLinks: write.specialistLinks.map(link => ({ ...link })),
    lastVerifiedAt: lastVerifiedShadow.local,
  })
  linkTargetModes.value = write.specialistLinks.map(link => link.primaryFacultyId === null ? 'common' : 'specific')
  baseline.value = fingerprint(write)
  expectedUpdatedAt.value = value.updatedAt
  confirmationOpen.value = false
}

watch(() => props.faculty, cloneFaculty, { immediate: true, deep: true })
watch(() => props.preview, () => { selectedScenario.value = 0 })

const verificationContacts = computed(() => {
  const original = facultyWrite(props.faculty)
  return contactFields.filter(({ key }) => editable.contactVisibility[key] === 'public' && (
    original.contactVisibility[key] !== 'public' || editable[key] !== original[key]
  ))
})

const issueMessage = (path: PropertyKey[]): string => {
  const field = String(path[0] ?? '')
  const messages: Record<string, string> = {
    name: '이름을 확인해 주세요.',
    title: '직함을 확인해 주세요.',
    consultationRole: '전임교원은 총괄, 겸임·실무교원은 전문 연계 역할이어야 합니다.',
    tags: '태그 키·표시명·분류·기본 선택을 확인해 주세요.',
    specialistLinks: '전문 연계는 specialist 태그와 중복되지 않는 총괄교수를 사용해야 합니다.',
    expertiseSummary: '전문분야와 윤태준 교수의 예술사진·영상·AI·기술적 이미지 범위를 확인해 주세요.',
  }
  return messages[field] ?? `입력값(${path.join('.')})을 확인해 주세요.`
}

const validation = computed(() => adminFacultyWriteSchema.safeParse(payload()))
const localIssues = computed(() => {
  const issues = validation.value.success
    ? []
    : validation.value.error.issues.map(issue => issueMessage(issue.path))
  if (editable.consultationRole === 'specialist' && editable.specialistLinks.some((link, index) => (
    linkTargetModes.value[index] === 'specific'
    && (link.primaryFacultyId === null || !Number.isSafeInteger(link.primaryFacultyId) || link.primaryFacultyId <= 0)
  ))) issues.push('전임 총괄교수 ID를 명시적으로 입력해 주세요.')
  return [...new Set(issues)]
})
const mutationBusy = computed(() => props.saving || props.publishing)
const canPublish = computed(() => !isDirty.value && !props.hasConflict && localIssues.value.length === 0 && !mutationBusy.value)
const liveStatus = computed(() => {
  if (props.saving) return '변경 내용 저장 중'
  if (props.previewing) return '추천 미리보기 중'
  if (props.publishing) return '교수진 정보 게시 중'
  return props.statusMessage
})

const save = (): void => {
  if (mutationBusy.value || !validation.value.success || localIssues.value.length > 0 || props.hasConflict) return
  emit('save', { expectedUpdatedAt: expectedUpdatedAt.value, faculty: validation.value.data })
}
const requestPreview = (): void => {
  if (mutationBusy.value || !validation.value.success || localIssues.value.length > 0 || props.previewing) return
  emit('preview', { faculty: validation.value.data })
}
const openPublishConfirmation = (): void => {
  if (!canPublish.value) return
  confirmationOpen.value = true
  void nextTick(() => publishConfirm.value?.focus())
}
const closePublishConfirmation = (): void => {
  confirmationOpen.value = false
  void nextTick(() => publishTrigger.value?.focus())
}
const confirmPublication = (): void => {
  if (!canPublish.value) return
  emit('publish', { facultyId: props.faculty.id, expectedUpdatedAt: expectedUpdatedAt.value })
  closePublishConfirmation()
}

const updateContact = (key: ContactKey, event: Event): void => {
  editable[key] = (event.target as HTMLInputElement).value || null
}
const updateVisibility = (key: ContactKey, event: Event): void => {
  editable.contactVisibility[key] = (event.target as HTMLSelectElement).value as AdminFacultyWrite['contactVisibility'][ContactKey]
}
const addProfileItem = (key: ProfileListKey): void => { editable.profileSections[key].push('') }
const updateProfileItem = (key: ProfileListKey, index: number, event: Event): void => {
  editable.profileSections[key][index] = (event.target as HTMLInputElement).value
}
const removeProfileItem = (key: ProfileListKey, index: number): void => {
  editable.profileSections[key].splice(index, 1)
}

const tagsFor = (category: typeof adminFacultyTagCategories[number]) => (
  editable.tags.filter(tag => tag.category === category)
)
const setPrimaryTag = (category: typeof adminFacultyTagCategories[number], key: string): void => {
  editable.tags.forEach((tag) => {
    if (tag.category === category) tag.isPrimary = tag.key === key
  })
}
const addTag = (category: typeof adminFacultyTagCategories[number]): void => {
  const draft = newTags[category]
  const key = draft.key.trim().toLowerCase()
  const label = category === 'track'
    ? adminFacultyTrackPairs[key as keyof typeof adminFacultyTrackPairs]
    : draft.label.trim()
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(key) || !label
    || editable.tags.some(tag => tag.category === category && tag.key === key)) return
  editable.tags.push({ key, label, category, weight: 1, isPrimary: !tagsFor(category).some(tag => tag.isPrimary) })
  if (category !== 'track') draft.key = ''
  draft.label = category === 'track'
    ? adminFacultyTrackPairs[draft.key as keyof typeof adminFacultyTrackPairs]
    : ''
}
const removeTag = (tag: AdminFacultyWrite['tags'][number]): void => {
  const index = editable.tags.indexOf(tag)
  if (index >= 0) editable.tags.splice(index, 1)
}
const updateTrackDraft = (): void => {
  newTags.track.label = adminFacultyTrackPairs[newTags.track.key as keyof typeof adminFacultyTrackPairs] ?? ''
}

const specialistTags = computed(() => editable.tags.filter(tag => tag.category === 'specialist'))
const addSpecialistLink = (): void => {
  if (editable.consultationRole !== 'specialist' || !specialistTags.value[0]) return
  editable.specialistLinks.push({
    primaryFacultyId: null,
    tagKey: specialistTags.value[0].key,
    priority: 0,
    explanationTemplate: '',
  })
  linkTargetModes.value.push('common')
}
const toggleCommonConnection = (index: number, event: Event): void => {
  const link = editable.specialistLinks[index]
  if (!link) return
  const common = (event.target as HTMLInputElement).checked
  linkTargetModes.value[index] = common ? 'common' : 'specific'
  link.primaryFacultyId = null
}
const updatePrimaryFacultyId = (index: number, event: Event): void => {
  const link = editable.specialistLinks[index]
  if (!link) return
  const value = Number((event.target as HTMLInputElement).value)
  link.primaryFacultyId = Number.isSafeInteger(value) && value > 0 ? value : null
}
const removeSpecialistLink = (index: number): void => {
  editable.specialistLinks.splice(index, 1)
  linkTargetModes.value.splice(index, 1)
}

const activeScenario = computed(() => props.preview?.scenarios[selectedScenario.value] ?? null)
const selectScenario = (index: number): void => {
  if (mutationBusy.value) return
  selectedScenario.value = index
}
const onScenarioKeydown = (event: KeyboardEvent, index: number): void => {
  if (mutationBusy.value) return
  const count = props.preview?.scenarios.length ?? 0
  if (!count) return
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % count
  else if (event.key === 'ArrowLeft') next = (index - 1 + count) % count
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = count - 1
  else return
  event.preventDefault()
  selectedScenario.value = next
  const tabs = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  void nextTick(() => tabs?.[next]?.focus())
}

type PublicPerson = AdminFacultyPreview['scenarios'][number]['recommendation']['primary']
const publicContactEntries = (person: Pick<PublicPerson, 'publicContacts'>) => {
  const labels: Record<string, string> = { office: '연구실', phone: '전화', email: '이메일', website: '웹사이트' }
  return Object.entries(person.publicContacts).map(([key, value]) => ({ key, label: labels[key] ?? key, value }))
}
</script>

<template>
  <div class="faculty-editor" data-faculty-editor>
    <div class="faculty-editor__layout">
      <form class="faculty-editor__form" @submit.prevent="save">
        <fieldset :disabled="mutationBusy">
          <legend>역할과 용량</legend>
          <div class="faculty-editor__grid faculty-editor__grid--three">
            <label>이름 <input v-model="editable.name" name="name" maxlength="100"></label>
            <label>직함 <input v-model="editable.title" name="title" maxlength="100"></label>
            <label>교원 유형
              <select v-model="editable.employmentType" name="employmentType">
                <option value="full_time">전임교원</option>
                <option value="adjunct">겸임교원</option>
                <option value="practitioner">실무전문가</option>
              </select>
            </label>
            <label>상담 역할
              <select v-model="editable.consultationRole" name="consultationRole">
                <option value="primary">총괄 상담</option>
                <option value="specialist">전문 연계</option>
              </select>
            </label>
            <label>주간 상담 용량 <input v-model.number="editable.weeklyCapacity" name="weeklyCapacity" type="number" min="0" max="32767"></label>
            <label>우선순위 <input v-model.number="editable.priority" name="priority" type="number" min="0" max="32767"></label>
            <label>출처 기준일 <input v-model="editable.sourceDate" name="sourceDate" type="date"></label>
            <label>마지막 검증 시각 <input v-model="editable.lastVerifiedAt" name="lastVerifiedAt" type="datetime-local" step="1"></label>
          </div>
        </fieldset>

        <fieldset :disabled="mutationBusy">
          <legend>공개 연락처</legend>
          <p class="faculty-editor__help">public은 추천 결과에 표시되고, admin_only와 hidden은 운영 화면에만 머물러요.</p>
          <div class="faculty-editor__contacts">
            <div v-for="field in contactFields" :key="field.key" data-contact-row class="faculty-editor__contact-row">
              <label>{{ field.label }}
                <input :name="field.key" :type="field.type" :value="editable[field.key] ?? ''" @input="updateContact(field.key, $event)">
              </label>
              <label>{{ field.label }} 표시 범위
                <select :name="field.visibilityName" :value="editable.contactVisibility[field.key]" @change="updateVisibility(field.key, $event)">
                  <option value="public">public</option>
                  <option value="admin_only">admin_only</option>
                  <option value="hidden">hidden</option>
                </select>
              </label>
            </div>
          </div>
          <p v-if="verificationContacts.length" data-contact-verification role="alert" class="faculty-editor__signal">
            {{ verificationContacts.map(field => field.label).join('·') }} 공개값이 바뀌었습니다. 새 공개값보다 더 최신의 검증 시각을 기록하세요.
          </p>
        </fieldset>

        <fieldset :disabled="mutationBusy">
          <legend>전문분야와 소개</legend>
          <div class="faculty-editor__grid">
            <label>전문분야 요약 <textarea v-model="editable.expertiseSummary" name="expertiseSummary" maxlength="1000" /></label>
            <label>소개(LF 줄바꿈 유지) <textarea v-model="editable.bio" name="bio" maxlength="8000" /></label>
            <label>추천 역할 <textarea v-model="editable.profileSections.recommendationRole" name="recommendationRole" maxlength="1000" /></label>
          </div>
          <p v-if="editable.name === '윤태준'" data-yoon-scope class="faculty-editor__note">
            윤태준 교수 검증 범위: <strong>예술사진·영상·AI·기술적 이미지</strong> / 필수 키 <code>art_photo | video | ai</code>
          </p>
          <section
            v-for="section in profileSections"
            :key="section.key"
            :data-profile-section="section.key"
            class="faculty-editor__array"
            :aria-labelledby="`profile-${section.key}`"
          >
            <h3 :id="`profile-${section.key}`">{{ section.label }}</h3>
            <div v-for="(_item, index) in editable.profileSections[section.key]" :key="index" class="faculty-editor__array-row">
              <label :for="`profile-${section.key}-${index}`">{{ section.label }} {{ index + 1 }}</label>
              <input
                :id="`profile-${section.key}-${index}`"
                data-profile-item
                :value="editable.profileSections[section.key][index]"
                maxlength="1000"
                @input="updateProfileItem(section.key, index, $event)"
              >
              <button type="button" data-action="remove-profile-item" @click="removeProfileItem(section.key, index)">삭제</button>
            </div>
            <button type="button" data-action="add-profile-item" @click="addProfileItem(section.key)">{{ section.label }} 추가</button>
          </section>
        </fieldset>

        <fieldset :disabled="mutationBusy">
          <legend>추천 태그</legend>
          <p data-canonical-tracks class="faculty-editor__help">
            고정 트랙: <span v-for="track in canonicalTracks" :key="track.key"><code>{{ track.key }}</code> {{ track.label }} </span>
          </p>
          <section v-for="category in adminFacultyTagCategories" :key="category" data-tag-category class="faculty-editor__tags">
            <h3>{{ categoryLabels[category] }}</h3>
            <div v-for="tag in tagsFor(category)" :key="`${category}-${tag.key}`" class="faculty-editor__tag-row">
              <label>분류 기본
                <input
                  type="radio"
                  :name="`primary-${category}`"
                  :checked="tag.isPrimary"
                  @change="setPrimaryTag(category, tag.key)"
                >
              </label>
              <label>키 <input v-model="tag.key" :readonly="category === 'track'" pattern="[a-z][a-z0-9_]*"></label>
              <label>표시명 <input v-model="tag.label" :readonly="category === 'track'" maxlength="100"></label>
              <label>가중치 <input v-model.number="tag.weight" type="number" min="0" max="3"></label>
              <button type="button" data-action="remove-tag" @click="removeTag(tag)">삭제</button>
            </div>
            <div class="faculty-editor__tag-add">
              <label>새 키
                <select v-if="category === 'track'" v-model="newTags.track.key" @change="updateTrackDraft">
                  <option v-for="track in canonicalTracks" :key="track.key" :value="track.key">{{ track.key }} · {{ track.label }}</option>
                </select>
                <input v-else v-model="newTags[category].key" pattern="[a-z][a-z0-9_]*">
              </label>
              <label v-if="category !== 'track'">새 표시명 <input v-model="newTags[category].label" maxlength="100"></label>
              <button type="button" data-action="add-tag" @click="addTag(category)">{{ categoryLabels[category] }} 태그 추가</button>
            </div>
          </section>
        </fieldset>

        <fieldset data-specialist-matrix :disabled="mutationBusy">
          <legend>전문 연계 matrix</legend>
          <p class="faculty-editor__help">전문 연계는 specialist 교수진이 작성하며, 초안은 작성 상태이고 active 교수진만 추천에 쓰입니다.</p>
          <template v-if="editable.consultationRole === 'specialist'">
            <div v-for="(link, index) in editable.specialistLinks" :key="index" class="faculty-editor__link-row">
              <label>학과 공통 연결(null)
                <input :name="`commonConnection-${index}`" type="checkbox" :checked="linkTargetModes[index] === 'common'" @change="toggleCommonConnection(index, $event)">
              </label>
              <label>전임 총괄교수 ID
                <input
                  :name="`primaryFacultyId-${index}`"
                  type="number"
                  min="1"
                  :disabled="linkTargetModes[index] === 'common'"
                  :value="link.primaryFacultyId ?? ''"
                  @input="updatePrimaryFacultyId(index, $event)"
                >
              </label>
              <label>전문 태그
                <select v-model="link.tagKey" :name="`specialistTagKey-${index}`">
                  <option v-for="tag in specialistTags" :key="tag.key" :value="tag.key">{{ tag.label }} · {{ tag.key }}</option>
                </select>
              </label>
              <label>우선순위 <input v-model.number="link.priority" type="number" min="0" max="32767"></label>
              <label class="faculty-editor__wide">연결 설명 <textarea v-model="link.explanationTemplate" maxlength="1000" /></label>
              <button type="button" data-action="remove-specialist-link" @click="removeSpecialistLink(index)">연결 삭제</button>
            </div>
            <button type="button" data-action="add-specialist-link" :disabled="specialistTags.length === 0" @click="addSpecialistLink">전문 연결 추가</button>
          </template>
        </fieldset>

        <fieldset data-media-readiness :disabled="mutationBusy">
          <legend>미디어 readiness</legend>
          <label>안전한 imagePath <input v-model="editable.imagePath" name="imagePath" placeholder="images/faculty-placeholder.webp"></label>
          <p class="faculty-editor__help">
            현재 계약은 안전한 imagePath만 저장합니다. 이미지 권한과 대체 텍스트 메타데이터가 계약에 추가되기 전까지 교수진 이미지는 승인된 플레이스홀더를 사용하며 공개 이미지를 표시하지 않습니다.
          </p>
        </fieldset>

        <div v-if="localIssues.length" class="faculty-editor__errors" role="alert" data-editor-errors>
          <strong>입력을 확인해 주세요.</strong>
          <ul><li v-for="issue in localIssues" :key="issue">{{ issue }}</li></ul>
        </div>
        <p v-if="hasConflict" class="faculty-editor__signal" role="alert">현재 편집은 보존되었습니다. 서버 최신본을 적용하거나 충돌을 해결한 뒤 저장·게시하세요.</p>
        <p class="faculty-editor__live" aria-live="polite">{{ liveStatus }}</p>
        <div class="faculty-editor__actions">
          <button type="button" data-action="save-faculty" :disabled="mutationBusy || hasConflict || localIssues.length > 0" @click="save">{{ saving ? '저장 중' : '변경 저장' }}</button>
          <button type="button" data-action="preview-faculty" :disabled="mutationBusy || previewing || localIssues.length > 0" @click="requestPreview">{{ previewing ? '미리보기 중' : '추천 미리보기' }}</button>
          <button ref="publishTrigger" type="button" data-action="publish-faculty" :aria-disabled="!canPublish" @click="openPublishConfirmation">게시</button>
        </div>
        <div v-if="confirmationOpen" class="faculty-editor__confirm" role="group" aria-labelledby="faculty-publish-confirm-title">
          <p id="faculty-publish-confirm-title">저장된 교수진 정보를 학생 추천에 게시할까요?</p>
          <button ref="publishConfirm" type="button" data-action="confirm-publish" :disabled="mutationBusy" @click="confirmPublication">게시 확인</button>
          <button type="button" data-action="cancel-publish" :disabled="mutationBusy" @click="closePublishConfirmation">취소</button>
        </div>
      </form>

      <aside class="faculty-editor__proof" aria-labelledby="faculty-proof-title">
        <header>
          <p>RECOMMENDATION CONTACT SHEET</p>
          <h2 id="faculty-proof-title">고정 시나리오 제작 검수</h2>
        </header>
        <div v-if="previewError" data-preview-error role="alert" class="faculty-editor__preview-error">{{ previewError }}</div>
        <div v-if="preview" class="faculty-editor__contact-sheet">
          <div role="tablist" aria-label="추천 검수 시나리오" class="faculty-editor__frames">
            <button
              v-for="(scenario, index) in preview.scenarios"
              :id="`faculty-scenario-tab-${index}`"
              :key="scenario.key"
              type="button"
              role="tab"
              :aria-label="scenario.label"
              :aria-selected="selectedScenario === index"
              :aria-controls="`faculty-scenario-panel-${index}`"
              :tabindex="selectedScenario === index ? 0 : -1"
              :disabled="mutationBusy"
              @click="selectScenario(index)"
              @keydown="onScenarioKeydown($event, index)"
            >
              <span>FRAME {{ String(index + 1).padStart(2, '0') }}</span>
              {{ scenario.label }}
            </button>
          </div>

          <section
            v-if="activeScenario"
            :id="`faculty-scenario-panel-${selectedScenario}`"
            role="tabpanel"
            :aria-labelledby="`faculty-scenario-tab-${selectedScenario}`"
            tabindex="0"
            class="faculty-editor__proof-panel"
          >
            <p class="faculty-editor__evidence">TRACK EVIDENCE · {{ adminFacultyTrackPairs[activeScenario.trackEvidence] }} · 적합도 {{ activeScenario.recommendation.facultyFit }}</p>
            <article>
              <h3>추천 총괄교수</h3>
              <strong>{{ activeScenario.recommendation.primary.name }} {{ activeScenario.recommendation.primary.title }}</strong>
              <p>{{ activeScenario.recommendation.primary.expertise }}</p>
              <p>{{ activeScenario.recommendation.primary.reason }}</p>
              <dl v-if="publicContactEntries(activeScenario.recommendation.primary).length">
                <div v-for="contact in publicContactEntries(activeScenario.recommendation.primary)" :key="contact.key"><dt>{{ contact.label }}</dt><dd>{{ contact.value }}</dd></div>
              </dl>
            </article>
            <article>
              <h3>예비 상담교수</h3>
              <strong>{{ activeScenario.recommendation.backup.name }} {{ activeScenario.recommendation.backup.title }}</strong>
              <p>{{ activeScenario.recommendation.backup.expertise }}</p>
              <p>{{ activeScenario.recommendation.backup.reason }}</p>
              <dl v-if="publicContactEntries(activeScenario.recommendation.backup).length">
                <div v-for="contact in publicContactEntries(activeScenario.recommendation.backup)" :key="contact.key"><dt>{{ contact.label }}</dt><dd>{{ contact.value }}</dd></div>
              </dl>
            </article>
            <section class="faculty-editor__specialists" aria-labelledby="faculty-specialists-title">
              <h3 id="faculty-specialists-title">함께 연결되는 전문분야</h3>
              <p v-if="activeScenario.recommendation.specialists.length === 0">이 시나리오에는 추가 전문 연계가 없습니다.</p>
              <article v-for="person in activeScenario.recommendation.specialists" :key="person.id">
                <strong>{{ person.name }} {{ person.title }}</strong>
                <p>{{ person.expertise }}</p>
                <p>{{ person.reason }}</p>
                <dl v-if="publicContactEntries(person).length">
                  <div v-for="contact in publicContactEntries(person)" :key="contact.key"><dt>{{ contact.label }}</dt><dd>{{ contact.value }}</dd></div>
                </dl>
              </article>
            </section>
          </section>
        </div>
        <p v-else class="faculty-editor__proof-empty">현재 편집본으로 ‘추천 미리보기’를 실행하면 네 프레임이 여기에 표시됩니다.</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.faculty-editor { min-width: 0; }
.faculty-editor__layout { min-width: 0; display: grid; gap: 1rem; align-items: start; }
.faculty-editor__form { min-width: 0; display: grid; gap: 1rem; }
.faculty-editor fieldset { min-width: 0; margin: 0; border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent); background: var(--color-surface); padding: 1rem; }
.faculty-editor legend { padding: 0 0.35rem; font-family: var(--font-display); font-size: 1.18rem; font-weight: 750; }
.faculty-editor__grid, .faculty-editor__contacts { display: grid; gap: 0.75rem; }
.faculty-editor label { min-width: 0; display: grid; gap: 0.35rem; font-weight: 650; }
.faculty-editor :is(input, textarea, select, button) { min-width: 0; min-height: var(--touch-target); border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-ink); padding: 0.625rem; }
.faculty-editor textarea { min-height: 6rem; resize: vertical; }
.faculty-editor button { cursor: pointer; font-family: var(--font-display); font-weight: 720; }
.faculty-editor button:is(:disabled, [aria-disabled='true']) { cursor: not-allowed; opacity: 0.45; }
.faculty-editor :is(input, textarea, select, button, [tabindex]):focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 2px; }
.faculty-editor__contact-row, .faculty-editor__array-row, .faculty-editor__tag-row, .faculty-editor__tag-add, .faculty-editor__link-row { min-width: 0; display: grid; gap: 0.55rem; border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent); padding-top: 0.65rem; }
.faculty-editor__array, .faculty-editor__tags { min-width: 0; display: grid; gap: 0.55rem; margin-top: 1rem; }
.faculty-editor h3 { margin: 0.35rem 0; font-size: 0.92rem; }
.faculty-editor__help, .faculty-editor__note, .faculty-editor__proof-empty { color: color-mix(in srgb, var(--color-ink) 70%, transparent); font-size: 0.82rem; line-height: 1.6; }
.faculty-editor__note { border-left: 0.25rem solid var(--color-sequence); background: color-mix(in srgb, var(--color-sequence) 7%, var(--color-surface)); padding: 0.75rem; }
.faculty-editor__signal, .faculty-editor__errors, .faculty-editor__preview-error { border-left: 0.25rem solid var(--color-signal); background: color-mix(in srgb, var(--color-signal) 8%, var(--color-surface)); padding: 0.75rem; }
.faculty-editor__errors { border-left-color: var(--color-error); }
.faculty-editor__actions, .faculty-editor__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; }
.faculty-editor__actions button:first-child { background: var(--color-ink); color: var(--color-surface); }
.faculty-editor__confirm { border: 1px solid var(--color-signal); padding: 0.75rem; }
.faculty-editor__confirm p { flex-basis: 100%; margin: 0; }
.faculty-editor__live { min-height: 1.5rem; margin: 0; }
.faculty-editor__proof { min-width: 0; display: grid; gap: 0.85rem; border: 1px solid color-mix(in srgb, var(--color-ink) 25%, transparent); background: var(--color-surface); padding: 0.8rem; }
.faculty-editor__proof header > p, .faculty-editor__evidence, .faculty-editor__frames button span { font-family: var(--font-mono); font-size: 0.65rem; font-weight: 700; letter-spacing: 0.06em; }
.faculty-editor__proof header > p { margin: 0; color: var(--color-sequence); }
.faculty-editor__proof h2 { margin: 0.25rem 0 0; font-family: var(--font-display); font-size: 1.25rem; }
.faculty-editor__frames { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.35rem; background: var(--color-ink); padding: 0.35rem; }
.faculty-editor__frames button { min-width: 0; display: grid; align-content: end; gap: 0.35rem; min-height: 5.5rem; border-color: color-mix(in srgb, var(--color-surface) 28%, transparent); background: color-mix(in srgb, var(--color-ink) 92%, var(--color-sequence)); color: var(--color-surface); text-align: left; overflow-wrap: anywhere; }
.faculty-editor__frames button[aria-selected='true'] { border-color: var(--color-signal); box-shadow: inset 0 -0.25rem 0 var(--color-signal); }
.faculty-editor__frames button span { color: color-mix(in srgb, var(--color-surface) 65%, transparent); }
.faculty-editor__proof-panel { min-width: 0; display: grid; gap: 0.75rem; }
.faculty-editor__evidence { margin: 0; border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 25%, transparent); padding-bottom: 0.65rem; overflow-wrap: anywhere; }
.faculty-editor__proof-panel article, .faculty-editor__specialists { min-width: 0; border-left: 0.22rem solid var(--color-sequence); background: var(--color-canvas); padding: 0.75rem; }
.faculty-editor__proof-panel article:nth-of-type(2) { border-left-color: var(--color-resource); }
.faculty-editor__proof-panel :is(h3, p, dl) { margin-top: 0; }
.faculty-editor__proof-panel dl { display: grid; gap: 0.25rem; font-size: 0.78rem; }
.faculty-editor__proof-panel dl div { min-width: 0; display: grid; grid-template-columns: 4rem minmax(0, 1fr); gap: 0.4rem; }
.faculty-editor__proof-panel dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.faculty-editor__specialists { border-left-color: var(--color-signal); }
@media (min-width: 44rem) {
  .faculty-editor__grid--three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .faculty-editor__contact-row { grid-template-columns: minmax(0, 2fr) minmax(9rem, 1fr); }
  .faculty-editor__array-row { grid-template-columns: minmax(7rem, 0.65fr) minmax(0, 2fr) auto; align-items: end; }
  .faculty-editor__tag-row { grid-template-columns: auto minmax(7rem, 1fr) minmax(8rem, 1.25fr) 6rem auto; align-items: end; }
  .faculty-editor__tag-add { grid-template-columns: minmax(8rem, 1fr) minmax(8rem, 1fr) auto; align-items: end; }
  .faculty-editor__link-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .faculty-editor__wide { grid-column: 1 / -1; }
}
@media (min-width: 70rem) {
  .faculty-editor__layout { grid-template-columns: minmax(0, 3fr) minmax(19rem, 2fr); }
  .faculty-editor__proof { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow-y: auto; }
  .faculty-editor__grid--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 24rem) {
  .faculty-editor fieldset, .faculty-editor__proof { padding: 0.65rem; }
  .faculty-editor__frames { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .faculty-editor *, .faculty-editor *::before, .faculty-editor *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
</style>
