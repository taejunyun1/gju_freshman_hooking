import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import EquipmentInventoryTable from '../../../app/components/admin/EquipmentInventoryTable.vue'
import ResourceEditor from '../../../app/components/admin/ResourceEditor.vue'
import type {
  AdminEquipmentInventoryItem,
  AdminResource,
  AdminResourceWrite,
} from '../../../shared/schemas/admin-resources'

const updatedAt = '2026-07-15T01:00:00.000Z'
const course: AdminResource = {
  id: 42,
  type: 'course',
  title: '기초사진실기',
  summary: '촬영 기초와 표현 방법을 연결하는 전공 교과입니다.',
  connectionTemplate: '선택한 관심이 교과의 실습과 연결됩니다.',
  status: 'draft',
  visibility: 'public',
  priority: 10,
  sourceDate: '2025-07-14',
  metadata: { academic_year: 2026, grade_year: 1, term: '1학기', credits: 3, goal: '촬영 기초를 익힌다.' },
  imagePath: null,
  tags: [{ key: 'photography', weight: 3, isPrimary: true }],
  createdAt: '2026-07-01T01:00:00.000Z',
  updatedAt,
}

const studentWork: AdminResource = {
  ...course,
  id: 43,
  type: 'student_work',
  title: '빛의 기록',
  imagePath: 'images/student-work/light.webp',
  metadata: {
    consent_at: '2026-07-15T01:30:00+09:00',
    image_alt: '창가의 빛을 기록한 학생 사진',
    related_course: '기초사진실기',
    related_year: 1,
    related_track: 'art_photo',
  },
}

const facility: AdminResource = {
  ...course,
  id: 44,
  type: 'facility',
  title: '판타지랩',
  metadata: {
    location_label: '호심관 2층',
    operation_note: '수업과 프로젝트 시간에 이용합니다.',
    activities: ['촬영', '편집'],
    last_verified_at: '2026-07-15T01:30:00+09:00',
  },
}

const equipmentResource: AdminResource = {
  ...course,
  id: 45,
  type: 'equipment',
  title: '중형 카메라',
  metadata: {
    category: 'body',
    confirmedQuantity: 0,
    locationKey: 'department_equipment_room',
    locationLabel: '사진영상미디어학과 기자재실',
    accessMode: 'inquiry',
    accessLabel: '문의 전용',
  },
}

const archiveCareer: AdminResource = {
  ...course,
  id: 46,
  type: 'career',
  title: '졸업생 진로 사례 · 박진우',
  sourceDate: '2025-11-06',
  tags: [
    { key: 'video', weight: 3, isPrimary: true },
    { key: 'news', weight: 2, isPrimary: false },
  ],
  metadata: {
    seedKey: 'archive:career:park_jinwoo',
    archive: {
      sourceUrl: 'https://gjphoto94.notion.site/2a163cb8bb55800c9057c4973527db76?source=copy_link',
      sourcePageTitle: '졸업생 인터뷰',
      sourceLastEditedDate: '2025-11-06',
      evidenceStatus: 'snapshot',
      trackEvidence: ['video', 'documentary'],
      interestEvidence: ['news', 'field', 'drone'],
      verificationNote: '인터뷰 본문에만 직무가 있어 body_only 상태로 보존합니다.',
    },
    publicName: '박진우',
    graduationYear: 2022,
    graduationYearStatus: 'confirmed',
    graduationYearCandidates: [],
    roleAtSource: '영상 촬영 기자',
    roleCandidates: [],
    roleStatus: 'body_only',
  },
}

const toLocalDateTimeValue = (iso: string): string => {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const inventory = (overrides: Partial<AdminEquipmentInventoryItem> = {}): AdminEquipmentInventoryItem => ({
  id: 1,
  equipmentResourceId: 42,
  inventoryCode: 'CAM-001',
  sourceRow: 1,
  locationKey: 'department_equipment_room',
  accessMode: 'reservation',
  availabilityState: 'available',
  note: null,
  dataQualityStatus: 'verified',
  sourceDate: '2026-07-14',
  updatedAt,
  ...overrides,
})

const ResourceCardStub = {
  name: 'ResourceCard',
  props: ['resource', 'variant'],
  template: '<article data-testid="resource-preview">{{ resource.title }} / {{ resource.primaryTag }} / {{ resource.connectionReason }}</article>',
}

describe('administrator resource editor', () => {
  it('separates the four editing areas and exposes type metadata with one source-verification timecode', () => {
    vi.setSystemTime('2026-07-15T03:00:00.000Z')
    const wrapper = mount(ResourceEditor, {
      props: { resource: course, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    expect(wrapper.findAll('[data-source-timecode]')).toHaveLength(1)
    expect(wrapper.get('[data-source-timecode]').text()).toContain('2025-07-14')
    expect(wrapper.get('[data-source-timecode]').text()).toContain('2026-07-15')
    expect(wrapper.findAll('form section > h2').map(heading => heading.text())).toEqual([
      '콘텐츠', '태그', '미디어', '게시',
    ])
    expect(wrapper.get('input[name="academic_year"]').attributes('aria-describedby')).toContain('academic-year-help')
    expect(wrapper.get('[data-stale-source]').text()).toContain('현재 학사 주기')
  })

  it('renders a safe ResourceCard-compatible preview DTO', () => {
    const templated = { ...course, connectionTemplate: '{{interest}}이 {{unknown}}과 연결됩니다.' }
    const wrapper = mount(ResourceEditor, {
      props: { resource: templated, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    const preview = wrapper.get('[data-testid="resource-preview"]')
    expect(preview.text()).toContain('기초사진실기')
    expect(preview.text()).toContain('photography')
    expect(preview.text()).not.toMatch(/[{}]/u)
  })

  it('keeps exactly one primary tag and reports labeled validation issues', async () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: course, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    await wrapper.get('input[name="newTagKey"]').setValue('studio')
    await wrapper.get('button[data-action="add-tag"]').trigger('click')
    expect(wrapper.findAll('input[name="primaryTag"]')).toHaveLength(2)
    await wrapper.findAll('input[name="primaryTag"]')[1]!.setValue()
    await wrapper.get('button[data-action="save"]').trigger('click')

    const save = wrapper.emitted('save')?.at(-1)?.[0] as { resource: AdminResource }
    expect(save.resource.tags.filter(tag => tag.isPrimary)).toEqual([
      { key: 'studio', weight: 1, isPrimary: true },
    ])

    await wrapper.findAll('button[data-action="remove-tag"]')[1]!.trigger('click')
    expect(wrapper.get('[data-publish-issues]').text()).toContain('기본 태그는 하나여야 합니다')
    expect(wrapper.get('button[data-action="publish"]').attributes('disabled')).toBeDefined()
  })

  it('emits optimistic save and explicit confirmed publish/archive intents without fetching', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mount(ResourceEditor, {
      props: { resource: course, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    expect(wrapper.get('[data-publish-issues]').text()).toContain('게시 이슈 0개')
    await wrapper.get('button[data-action="save"]').trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      expectedUpdatedAt: updatedAt,
      resource: {
        type: 'course', title: '기초사진실기',
        tags: [{ key: 'photography', weight: 3, isPrimary: true }],
      },
    })

    await wrapper.get('button[data-action="publish"]').trigger('click')
    expect(wrapper.emitted('publish')).toBeUndefined()
    expect(wrapper.get('[data-confirm="publish"]').text()).toContain('게시할까요')
    await wrapper.get('button[data-action="confirm-publish"]').trigger('click')
    expect(wrapper.emitted('publish')?.[0]?.[0]).toEqual({ resourceId: 42, expectedUpdatedAt: updatedAt })

    await wrapper.get('button[data-action="archive"]').trigger('click')
    expect(wrapper.emitted('archive')).toBeUndefined()
    await wrapper.get('button[data-action="confirm-archive"]').trigger('click')
    expect(wrapper.emitted('archive')?.[0]?.[0]).toEqual({ resourceId: 42, expectedUpdatedAt: updatedAt })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('validates image type and size before emitting an upload intent', async () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: course, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })
    const input = wrapper.get('input[name="resourceImage"]')
    const invalid = new File(['plain'], 'evidence.txt', { type: 'text/plain' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [invalid] })
    await input.trigger('change')
    expect(wrapper.get('[data-image-error]').text()).toContain('jpg, png, webp')
    expect(wrapper.emitted('upload-image')).toBeUndefined()
  })

  it('blocks publish while edits are dirty and clears dirty state only when the saved resource baseline arrives', async () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: course, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    await wrapper.get('input[name="title"]').setValue('수정한 기초사진실기')
    expect(wrapper.get('[data-publish-issues]').text()).toContain('변경 내용을 먼저 저장')
    expect(wrapper.get('button[data-action="publish"]').attributes('disabled')).toBeDefined()

    await wrapper.get('button[data-action="save"]').trigger('click')
    expect(wrapper.get('button[data-action="publish"]').attributes('disabled')).toBeDefined()

    await wrapper.setProps({
      resource: { ...course, title: '수정한 기초사진실기', updatedAt: '2026-07-15T02:00:00.000Z' },
    })
    expect(wrapper.get('button[data-action="publish"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('button[data-action="publish"]').trigger('click')
    expect(wrapper.get('[data-confirm="publish"]').exists()).toBe(true)
  })

  it('preserves a dirty draft across unrelated resource replacements and only accepts its matching save response', async () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: course, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    await wrapper.get('input[name="title"]').setValue('내가 편집 중인 교과')
    await wrapper.get('button[data-action="save"]').trigger('click')
    await wrapper.setProps({
      resource: {
        ...course,
        imagePath: 'images/course/external.webp',
        updatedAt: '2026-07-15T02:00:00.000Z',
      },
    })

    expect(wrapper.get('input[name="title"]').element).toHaveProperty('value', '내가 편집 중인 교과')
    expect(wrapper.get('[data-resource-sync-conflict]').text()).toContain('다른 변경')
    expect(wrapper.get('button[data-action="publish"]').attributes('disabled')).toBeDefined()

    await wrapper.get('button[data-action="reapply-resource"]').trigger('click')
    expect(wrapper.find('[data-resource-sync-conflict]').exists()).toBe(false)
    expect(wrapper.get('input[name="title"]').element).toHaveProperty('value', '내가 편집 중인 교과')
    await wrapper.get('button[data-action="save"]').trigger('click')

    const submitted = wrapper.emitted('save')?.at(-1)?.[0] as {
      expectedUpdatedAt: string
      resource: AdminResourceWrite
    }
    expect(submitted.expectedUpdatedAt).toBe('2026-07-15T02:00:00.000Z')
    expect(submitted.resource.imagePath).toBe('images/course/external.webp')
    await wrapper.setProps({
      resource: {
        ...course,
        ...submitted.resource,
        updatedAt: '2026-07-15T03:00:00.000Z',
      } as AdminResource,
    })

    expect(wrapper.find('[data-resource-sync-conflict]').exists()).toBe(false)
    expect(wrapper.get('button[data-action="publish"]').attributes('disabled')).toBeUndefined()
  })

  it('keeps a locally edited student-work image when the incoming resource still has the accepted baseline path', async () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: studentWork, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    await wrapper.get('input[name="imagePath"]').setValue('images/student-work/local-edit.webp')
    await wrapper.setProps({
      resource: {
        ...studentWork,
        summary: '서버에서 갱신된 설명',
        updatedAt: '2026-07-15T02:00:00.000Z',
      },
    })
    await wrapper.get('button[data-action="reapply-resource"]').trigger('click')
    await wrapper.get('button[data-action="save"]').trigger('click')

    const submitted = wrapper.emitted('save')?.at(-1)?.[0] as { resource: AdminResourceWrite }
    expect(submitted.resource.imagePath).toBe('images/student-work/local-edit.webp')
  })

  it('requires an explicit image choice when both the local draft and incoming resource changed from baseline', async () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: studentWork, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    await wrapper.get('input[name="imagePath"]').setValue('images/student-work/local-edit.webp')
    await wrapper.setProps({
      resource: {
        ...studentWork,
        imagePath: 'images/student-work/server-upload.webp',
        updatedAt: '2026-07-15T02:00:00.000Z',
      },
    })
    await wrapper.get('button[data-action="reapply-resource"]').trigger('click')

    expect(wrapper.get('[data-resource-sync-conflict]').text()).toContain('이미지 경로')
    expect(wrapper.get('button[data-action="keep-local-image"]').text()).toContain('내 편집 유지')
    expect(wrapper.get('button[data-action="use-server-image"]').text()).toContain('서버 경로 사용')
    expect(wrapper.get('input[name="imagePath"]').element).toHaveProperty(
      'value',
      'images/student-work/local-edit.webp',
    )

    await wrapper.get('button[data-action="use-server-image"]').trigger('click')
    expect(wrapper.find('[data-resource-sync-conflict]').exists()).toBe(false)
    await wrapper.get('button[data-action="save"]').trigger('click')
    const submitted = wrapper.emitted('save')?.at(-1)?.[0] as { resource: AdminResourceWrite }
    expect(submitted.resource.imagePath).toBe('images/student-work/server-upload.webp')
  })

  it('keeps the local image choice dirty against the new server baseline and saves with its effective version', async () => {
    const localImagePath = 'images/student-work/local-choice.webp'
    const incomingUpdatedAt = '2026-07-15T02:00:00.000Z'
    const wrapper = mount(ResourceEditor, {
      props: { resource: studentWork, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    await wrapper.get('input[name="imagePath"]').setValue(localImagePath)
    await wrapper.setProps({
      resource: {
        ...studentWork,
        imagePath: 'images/student-work/server-choice.webp',
        updatedAt: incomingUpdatedAt,
      },
    })
    await wrapper.get('button[data-action="reapply-resource"]').trigger('click')
    await wrapper.get('button[data-action="keep-local-image"]').trigger('click')

    expect(wrapper.find('[data-resource-sync-conflict]').exists()).toBe(false)
    expect(wrapper.get('input[name="imagePath"]').element).toHaveProperty('value', localImagePath)
    expect(wrapper.get('.resource-editor__publication-status').text()).toContain('저장하지 않은 변경 있음')
    expect(wrapper.get('button[data-action="publish"]').attributes('disabled')).toBeDefined()

    await wrapper.get('button[data-action="save"]').trigger('click')
    const submitted = wrapper.emitted('save')?.at(-1)?.[0] as {
      expectedUpdatedAt: string
      resource: AdminResourceWrite
    }
    expect(submitted.expectedUpdatedAt).toBe(incomingUpdatedAt)
    expect(submitted.resource.imagePath).toBe(localImagePath)
  })

  it('matches publish-time metadata rules for missing, empty, and unverified values', () => {
    vi.setSystemTime('2026-07-15T03:00:00.000Z')
    const cases: Array<{ resource: AdminResource, inventory: AdminEquipmentInventoryItem[], issue: string }> = [
      {
        resource: {
          ...course,
          metadata: { ...course.metadata, goal: '' },
        } as AdminResource,
        inventory: [],
        issue: '학년도·학년·학기·학점·목표',
      },
      {
        resource: {
          ...studentWork,
          metadata: { ...studentWork.metadata, related_course: '', related_year: null, related_track: '' },
        },
        inventory: [],
        issue: '연계 교과·학년·전공',
      },
      {
        resource: equipmentResource,
        inventory: [],
        issue: '검증된 기자재 원본 행',
      },
      {
        resource: {
          ...facility,
          metadata: {
            ...facility.metadata,
            location_label: '',
            activities: [],
          },
        },
        inventory: [],
        issue: '위치·운영 안내·활동·검증 일시',
      },
    ]

    for (const testCase of cases) {
      const wrapper = mount(ResourceEditor, {
        props: testCase,
        global: { stubs: { ResourceCard: ResourceCardStub, CapabilityEvidence: true } },
      })
      expect(wrapper.get('[data-publish-issues]').text()).toContain(testCase.issue)
      expect(wrapper.get('button[data-action="publish"]').attributes('disabled')).toBeDefined()
      wrapper.unmount()
    }
  })

  it('directly reports future-only consent and facility verification timestamps', () => {
    vi.setSystemTime('2026-07-15T03:00:00.000Z')
    const cases: Array<{ resource: AdminResource, issue: string }> = [
      {
        resource: {
          ...studentWork,
          metadata: { ...studentWork.metadata, consent_at: '2026-07-16T03:00:00+09:00' },
        },
        issue: '학생 작품 동의 일시는 미래일 수 없습니다',
      },
      {
        resource: {
          ...facility,
          metadata: { ...facility.metadata, last_verified_at: '2026-07-16T03:00:00+09:00' },
        },
        issue: '시설 검증 일시는 미래일 수 없습니다',
      },
    ]

    for (const testCase of cases) {
      const wrapper = mount(ResourceEditor, {
        props: { resource: testCase.resource, inventory: [] },
        global: { stubs: { ResourceCard: ResourceCardStub, CapabilityEvidence: true } },
      })
      expect(wrapper.get('[data-publish-issues]').text()).toContain(testCase.issue)
      expect(wrapper.get('button[data-action="publish"]').attributes('disabled')).toBeDefined()
      wrapper.unmount()
    }
  })

  it('round-trips student-work related fields and local consent time as an offset ISO datetime', async () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: studentWork, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    expect(wrapper.get('input[name="consent_at"]').element).toHaveProperty(
      'value',
      toLocalDateTimeValue(studentWork.metadata.consent_at!),
    )
    await wrapper.get('input[name="consent_at"]').setValue('2026-08-02T14:45')
    await wrapper.get('input[name="related_course"]').setValue('디지털이미지')
    await wrapper.get('input[name="related_year"]').setValue(2)
    await wrapper.get('input[name="related_track"]').setValue('visual_story')
    await wrapper.get('button[data-action="save"]').trigger('click')

    const payload = wrapper.emitted('save')?.at(-1)?.[0] as {
      resource: Extract<AdminResourceWrite, { type: 'student_work' }>
    }
    expect(payload.resource.metadata).toMatchObject({
      related_course: '디지털이미지',
      related_year: 2,
      related_track: 'visual_story',
    })
    expect(payload.resource.metadata.consent_at).toMatch(/[+-]\d{2}:\d{2}$/u)
    expect(new Date(payload.resource.metadata.consent_at!).getTime())
      .toBe(new Date(2026, 7, 2, 14, 45).getTime())
  })

  it('round-trips strict archive evidence metadata without silently dropping it', async () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: archiveCareer, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    await wrapper.get('textarea[name="summary"]').setValue('진로 근거 요약을 교정했습니다.')
    await wrapper.get('button[data-action="save"]').trigger('click')

    const payload = wrapper.emitted('save')?.at(-1)?.[0] as {
      resource: Extract<AdminResourceWrite, { type: 'career' }>
    }
    expect(payload.resource.metadata).toEqual(archiveCareer.metadata)
  })

  it('keeps unchanged consent and verification timestamps byte-for-byte', async () => {
    const exactConsent = '2026-07-14T01:02:03.456+09:00'
    const exactVerified = '2026-07-14T02:03:04.567+09:00'
    const workWrapper = mount(ResourceEditor, {
      props: {
        resource: { ...studentWork, metadata: { ...studentWork.metadata, consent_at: exactConsent } },
        inventory: [],
      },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })
    const facilityWrapper = mount(ResourceEditor, {
      props: {
        resource: { ...facility, metadata: { ...facility.metadata, last_verified_at: exactVerified } },
        inventory: [],
      },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    await workWrapper.get('button[data-action="save"]').trigger('click')
    await facilityWrapper.get('button[data-action="save"]').trigger('click')

    const workSave = workWrapper.emitted('save')?.[0]?.[0] as {
      resource: Extract<AdminResourceWrite, { type: 'student_work' }>
    }
    const facilitySave = facilityWrapper.emitted('save')?.[0]?.[0] as {
      resource: Extract<AdminResourceWrite, { type: 'facility' }>
    }
    expect(workSave.resource.metadata.consent_at).toBe(exactConsent)
    expect(facilitySave.resource.metadata.last_verified_at).toBe(exactVerified)
  })

  it('edits facility location, activities, and verified local datetime with schema-shaped output', async () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: facility, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    expect(wrapper.findAll('input[name="activity"]')).toHaveLength(2)
    expect(wrapper.get('input[name="last_verified_at"]').element).toHaveProperty(
      'value',
      toLocalDateTimeValue(facility.metadata.last_verified_at!),
    )
    await wrapper.get('input[name="location_label"]').setValue('호심관 3층')
    await wrapper.get('input[name="newActivity"]').setValue('인화')
    await wrapper.get('input[name="newActivity"]').trigger('keydown.enter')
    expect(wrapper.findAll('input[name="activity"]')).toHaveLength(3)
    await wrapper.findAll('button[data-action="remove-activity"]')[0]!.trigger('click')
    await wrapper.get('input[name="last_verified_at"]').setValue('2026-08-03T09:10')
    await wrapper.get('button[data-action="save"]').trigger('click')

    const payload = wrapper.emitted('save')?.at(-1)?.[0] as {
      resource: Extract<AdminResourceWrite, { type: 'facility' }>
    }
    expect(payload.resource.metadata.location_label).toBe('호심관 3층')
    expect(payload.resource.metadata.activities).toEqual(['편집', '인화'])
    expect(payload.resource.metadata.last_verified_at).toMatch(/[+-]\d{2}:\d{2}$/u)
  })

  it('uses verified inventory truth in the preview without writing its server-derived quantity', async () => {
    const fetch = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mount(ResourceEditor, {
      props: { resource: equipmentResource, inventory: [inventory()] },
    })

    expect(wrapper.get('[data-capability-evidence]').text()).toContain('중형 카메라')
    expect(wrapper.get('[data-capability-evidence]').text()).toContain('1대')
    expect(wrapper.get('.resource-editor__derived').text()).toContain('1대')
    await wrapper.setProps({ inventory: [] })
    expect(wrapper.get('[data-capability-evidence]').text()).toContain('0대')
    await wrapper.setProps({ inventory: [inventory({ dataQualityStatus: 'quantity_check' })] })
    expect(wrapper.get('[data-capability-evidence]').text()).toContain('0대')
    await wrapper.get('.capability__reservation').trigger('click')
    expect(fetch).not.toHaveBeenCalled()
    await wrapper.get('button[data-action="save"]').trigger('click')
    const payload = wrapper.emitted('save')?.at(-1)?.[0] as {
      resource: Extract<AdminResourceWrite, { type: 'equipment' }>
    }
    expect(payload.resource.metadata).not.toHaveProperty('confirmedQuantity')
  })

  it('offers only canonical labeled equipment categories in the editor', () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: equipmentResource, inventory: [] },
      global: { stubs: { CapabilityEvidence: true } },
    })

    const category = wrapper.get('select[name="category"]')
    expect(category.findAll('option').map(option => ({
      label: option.text(),
      value: option.attributes('value'),
    }))).toEqual([
      { value: '', label: '미분류 (레거시)' },
      { value: 'body', label: '카메라 바디' },
      { value: 'lens', label: '렌즈' },
      { value: 'lighting', label: '조명' },
      { value: 'audio', label: '오디오' },
      { value: 'drone', label: '드론' },
      { value: 'other', label: '기타' },
    ])
    expect(wrapper.find('input[name="category"]').exists()).toBe(false)
  })

  it('lets an administrator replace a legacy stored equipment category with a canonical option', async () => {
    const legacyEquipment = {
      ...equipmentResource,
      metadata: { ...equipmentResource.metadata, category: 'Body' },
    } as AdminResource
    const wrapper = mount(ResourceEditor, {
      props: { resource: legacyEquipment, inventory: [] },
      global: { stubs: { CapabilityEvidence: true } },
    })

    const category = wrapper.get('select[name="category"]')
    expect(category.element).toHaveProperty('value', '')
    await category.setValue('body')
    await wrapper.get('button[data-action="save"]').trigger('click')

    const payload = wrapper.emitted('save')?.at(-1)?.[0] as {
      resource: Extract<AdminResourceWrite, { type: 'equipment' }>
    }
    expect(payload.resource.metadata.category).toBe('body')
  })

  it('reads camel-only migrated facility operation and verification metadata in form and preview', () => {
    const camelFacility = {
      ...facility,
      metadata: {
        location_label: '호심관 2층',
        activities: ['촬영'],
        operationNote: '예약 뒤 관리자 확인을 받고 이용합니다.',
        lastVerifiedAt: '2026-07-14T02:03:04.567+09:00',
      },
    } as AdminResource
    const wrapper = mount(ResourceEditor, {
      props: { resource: camelFacility, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    expect(wrapper.get('textarea[name="operation_note"]').element).toHaveProperty(
      'value',
      '예약 뒤 관리자 확인을 받고 이용합니다.',
    )
    expect(wrapper.get('input[name="last_verified_at"]').element).toHaveProperty(
      'value',
      toLocalDateTimeValue('2026-07-14T02:03:04.567+09:00'),
    )
    expect(wrapper.get('[data-capability-evidence]').text())
      .toContain('예약 뒤 관리자 확인을 받고 이용합니다.')
  })

  it('renders an anchored three-column editor structure and image constraints before upload', () => {
    const wrapper = mount(ResourceEditor, {
      props: { resource: course, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    const columns = wrapper.get('[data-editor-layout]')
    expect(columns.element.children).toHaveLength(3)
    expect(columns.element.children[0]?.tagName).toBe('NAV')
    expect(columns.element.children[1]?.tagName).toBe('FORM')
    expect(columns.element.children[2]?.tagName).toBe('ASIDE')
    expect(columns.get('nav[aria-label="편집 섹션"]')
      .findAll('a').map(link => link.attributes('href'))).toEqual([
      '#resource-content', '#resource-tags', '#resource-media', '#resource-publication',
    ])
    expect(wrapper.get('input[name="resourceImage"]').attributes('aria-describedby')).toContain('resource-image-help')
    expect(wrapper.get('#resource-image-help').text()).toContain('8 MiB')
    expect(wrapper.get('#resource-image-help').text()).toContain('서버 검증')
  })

  it('moves focus into inline confirmations and restores it to each action trigger', async () => {
    const wrapper = mount(ResourceEditor, {
      attachTo: document.body,
      props: { resource: course, inventory: [] },
      global: { stubs: { ResourceCard: ResourceCardStub } },
    })

    const publishTrigger = wrapper.get('button[data-action="publish"]')
    await publishTrigger.trigger('click')
    expect(wrapper.get('[data-confirm="publish"]').attributes('role')).toBe('group')
    expect(wrapper.get('[data-confirm="publish"]').attributes('aria-labelledby')).toBe('publish-confirm-title')
    expect(document.activeElement).toBe(wrapper.get('button[data-action="confirm-publish"]').element)
    await wrapper.get('button[data-action="cancel-publish"]').trigger('click')
    expect(document.activeElement).toBe(publishTrigger.element)

    await publishTrigger.trigger('click')
    await wrapper.get('button[data-action="confirm-publish"]').trigger('click')
    expect(document.activeElement).toBe(publishTrigger.element)

    const archiveTrigger = wrapper.get('button[data-action="archive"]')
    await archiveTrigger.trigger('click')
    expect(document.activeElement).toBe(wrapper.get('button[data-action="confirm-archive"]').element)
    await wrapper.get('button[data-action="cancel-archive"]').trigger('click')
    expect(document.activeElement).toBe(archiveTrigger.element)

    await archiveTrigger.trigger('click')
    await wrapper.get('button[data-action="confirm-archive"]').trigger('click')
    expect(document.activeElement).toBe(archiveTrigger.element)
    wrapper.unmount()
  })
})

describe('administrator equipment inventory', () => {
  const items = [
    inventory(),
    inventory({ id: 2, sourceRow: 2, inventoryCode: 'CAM-002', locationKey: 'fantasy_lab', dataQualityStatus: 'duplicate_code' }),
    inventory({ id: 3, sourceRow: 3, inventoryCode: 'CAM-003', dataQualityStatus: 'unidentified' }),
    inventory({ id: 4, sourceRow: 4, inventoryCode: 'CAM-004', dataQualityStatus: 'quantity_check' }),
  ]

  it('renders all rows as a semantic table and equivalent labeled mobile cards', () => {
    const wrapper = mount(EquipmentInventoryTable, { props: { resourceId: 42, items } })

    expect(wrapper.get('table').attributes('aria-label')).toBe('기자재 재고 4개')
    expect(wrapper.findAll('tbody tr')).toHaveLength(4)
    expect(wrapper.findAll('[data-inventory-card]')).toHaveLength(4)
    expect(wrapper.get('[data-inventory-card]').findAll('dt').map(label => label.text())).toEqual([
      '원본 행', '위치', '접근', '상태', '품질 검증', '기준일',
    ])
    expect(wrapper.text()).toContain('중복 코드')
  })

  it('filters rows independently by location and quality', async () => {
    const wrapper = mount(EquipmentInventoryTable, { props: { resourceId: 42, items } })

    await wrapper.get('select[name="locationFilter"]').setValue('fantasy_lab')
    await wrapper.get('select[name="qualityFilter"]').setValue('duplicate_code')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.get('tbody tr').text()).toContain('CAM-002')
    expect(wrapper.findAll('[data-inventory-card]')).toHaveLength(1)
  })

  it('shows the audited original code and emits an optimistic inventory update', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    const wrapper = mount(EquipmentInventoryTable, { props: { resourceId: 42, items: [inventory()] } })

    await wrapper.get('button[data-action="edit-inventory"]').trigger('click')
    expect(wrapper.get('[data-original-code]').text()).toContain('CAM-001')
    expect(wrapper.get('[data-original-code]').text()).toContain('감사')
    await wrapper.get('input[name="inventoryCode"]').setValue('CAM-001-R')
    await wrapper.get('form[data-inventory-editor]').trigger('submit')

    expect(wrapper.emitted('update')?.[0]?.[0]).toEqual({
      resourceId: 42,
      itemId: 1,
      expectedUpdatedAt: updatedAt,
      inventoryCode: 'CAM-001-R',
      locationKey: 'department_equipment_room',
      accessMode: 'reservation',
      availabilityState: 'available',
      note: null,
      dataQualityStatus: 'verified',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('closes the inventory editor only when the matching submitted snapshot returns', async () => {
    const original = inventory()
    const wrapper = mount(EquipmentInventoryTable, { props: { resourceId: 42, items: [original] } })

    await wrapper.get('button[data-action="edit-inventory"]').trigger('click')
    await wrapper.get('input[name="inventoryCode"]').setValue('CAM-001-R')
    await wrapper.get('textarea[name="note"]').setValue('점검 완료')
    await wrapper.get('form[data-inventory-editor]').trigger('submit')
    expect(wrapper.find('form[data-inventory-editor]').exists()).toBe(true)

    await wrapper.setProps({
      items: [{
        ...original,
        inventoryCode: 'CAM-001-R',
        note: '점검 완료',
        updatedAt: '2026-07-15T02:00:00.000Z',
      }],
    })

    expect(wrapper.find('form[data-inventory-editor]').exists()).toBe(false)
    expect(wrapper.get('[data-inventory-success]').text()).toContain('저장')
  })

  it('keeps the submitted inventory draft open when a different replacement returns', async () => {
    const original = inventory()
    const wrapper = mount(EquipmentInventoryTable, { props: { resourceId: 42, items: [original] } })

    await wrapper.get('button[data-action="edit-inventory"]').trigger('click')
    await wrapper.get('textarea[name="note"]').setValue('내 점검 메모')
    await wrapper.get('form[data-inventory-editor]').trigger('submit')
    await wrapper.setProps({
      items: [{ ...original, note: '다른 관리자 메모', updatedAt: '2026-07-15T02:00:00.000Z' }],
    })

    expect(wrapper.get('textarea[name="note"]').element).toHaveProperty('value', '내 점검 메모')
    expect(wrapper.get('[data-inventory-conflict]').text()).toContain('다른 변경')
    expect(wrapper.get('button[data-action="save-inventory"]').attributes('disabled')).toBeDefined()
  })

  it('releases a matching failed inventory request for retry without losing its draft', async () => {
    const original = inventory()
    const wrapper = mount(EquipmentInventoryTable, {
      props: { resourceId: 42, items: [original], mutationError: null },
    })

    await wrapper.get('button[data-action="edit-inventory"]').trigger('click')
    await wrapper.get('textarea[name="note"]').setValue('재시도할 점검 메모')
    await wrapper.get('form[data-inventory-editor]').trigger('submit')
    expect(wrapper.get('button[data-action="save-inventory"]').attributes('disabled')).toBeDefined()

    await wrapper.setProps({
      mutationError: {
        itemId: original.id,
        expectedUpdatedAt: original.updatedAt,
        message: '네트워크 연결을 확인해 주세요.',
      },
    })

    expect(wrapper.get('textarea[name="note"]').element).toHaveProperty('value', '재시도할 점검 메모')
    expect(wrapper.get('[data-inventory-error]').text()).toContain('네트워크 연결')
    expect(wrapper.get('[data-inventory-error]').text()).toContain('다시 저장')
    expect(wrapper.get('button[data-action="save-inventory"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form[data-inventory-editor]').trigger('submit')
    expect(wrapper.emitted('update')).toHaveLength(2)
  })

  it('ignores stale inventory mutation errors for a different item or expected version', async () => {
    const original = inventory()
    const draftNote = 'pending 상태를 유지할 점검 메모'
    const wrapper = mount(EquipmentInventoryTable, {
      props: { resourceId: 42, items: [original], mutationError: null },
    })

    await wrapper.get('button[data-action="edit-inventory"]').trigger('click')
    await wrapper.get('textarea[name="note"]').setValue(draftNote)
    await wrapper.get('form[data-inventory-editor]').trigger('submit')

    await wrapper.setProps({
      mutationError: {
        itemId: 999,
        expectedUpdatedAt: original.updatedAt,
        message: '다른 항목의 이전 오류',
      },
    })
    expect(wrapper.get('[data-inventory-pending]').text()).toContain('확인')
    expect(wrapper.find('[data-inventory-error]').exists()).toBe(false)
    expect(wrapper.get('textarea[name="note"]').element).toHaveProperty('value', draftNote)
    expect(wrapper.get('button[data-action="save-inventory"]').attributes('disabled')).toBeDefined()

    await wrapper.setProps({ mutationError: null })
    await wrapper.setProps({
      mutationError: {
        itemId: original.id,
        expectedUpdatedAt: '2026-07-14T23:59:59.000Z',
        message: '이전 버전 요청의 오류',
      },
    })
    expect(wrapper.get('[data-inventory-pending]').text()).toContain('확인')
    expect(wrapper.find('[data-inventory-error]').exists()).toBe(false)
    expect(wrapper.get('textarea[name="note"]').element).toHaveProperty('value', draftNote)
    expect(wrapper.get('button[data-action="save-inventory"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('update')).toHaveLength(1)
  })

  it('emits import validation input and only renders parent-provided results', async () => {
    const validation = {
      expected: { total: 144, departmentEquipmentRoom: 83, fantasyLab: 61, reservation: 81, inquiry: 63 },
      actual: { total: 144, departmentEquipmentRoom: 83, fantasyLab: 61, reservation: 81, inquiry: 63 },
      duplicateInventoryCodeGroups: [{ inventoryCode: 'CAM-001', sourceRows: [1, 2] }],
      unidentifiedRows: [91], quantityCheckRows: [92], unmatchedSourceRows: [93],
    }
    const wrapper = mount(EquipmentInventoryTable, {
      props: { resourceId: 42, items: [inventory()], importValidation: validation },
    })
    const input = wrapper.get('input[name="inventoryImport"]')
    const file = new File([JSON.stringify({ rows: [{ sourceRow: 1 }] })], 'inventory.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')

    expect(wrapper.emitted('validate-import')?.[0]?.[0]).toEqual({ file, knownResourceCodes: ['CAM-001'] })
    expect(wrapper.get('[data-import-validation]').text()).toContain('총 기자재 144 / 144')
    expect(wrapper.get('[data-import-validation]').text()).toContain('기자재실 83 / 83')
    expect(wrapper.get('[data-import-validation]').text()).toContain('미연결 원본 행 93')
    expect(wrapper.get('[data-import-validation]').text()).toContain('CAM-001 · 원본 행 1, 2')
    expect(wrapper.find('[data-action="apply-import"]').exists()).toBe(false)
  })

  it('keeps the edit-start timestamp and reports a conflict when that source row changes', async () => {
    const original = inventory()
    const wrapper = mount(EquipmentInventoryTable, { props: { resourceId: 42, items: [original] } })

    await wrapper.get('button[data-action="edit-inventory"]').trigger('click')
    expect(wrapper.get('form[data-inventory-editor]').attributes('data-expected-updated-at')).toBe(updatedAt)
    await wrapper.setProps({
      items: [{ ...original, updatedAt: '2026-07-15T02:00:00.000Z', note: '다른 관리자가 수정함' }],
    })

    expect(wrapper.get('[data-inventory-conflict]').text()).toContain('다른 변경')
    expect(wrapper.get('button[data-action="save-inventory"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form[data-inventory-editor]').trigger('submit')
    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('shows a directional empty state when filters have no matching source rows', async () => {
    const wrapper = mount(EquipmentInventoryTable, { props: { resourceId: 42, items: [inventory()] } })

    await wrapper.get('select[name="qualityFilter"]').setValue('unidentified')
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    expect(wrapper.get('[data-inventory-empty]').text()).toContain('필터')
    expect(wrapper.get('[data-inventory-empty]').text()).toContain('다시')
  })
})
