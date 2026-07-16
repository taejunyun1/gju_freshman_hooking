import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import FacultyEditor from '../../../app/components/admin/FacultyEditor.vue'
import type {
  AdminFaculty,
  AdminFacultyPreview,
  AdminFacultyWrite,
} from '../../../shared/schemas/admin-faculty'

const updatedAt = '2026-07-15T01:02:03.123456+09:00'
const faculty: AdminFaculty = {
  id: 2,
  name: '윤태준',
  title: '교수',
  employmentType: 'full_time',
  consultationRole: 'primary',
  office: '극기관 3층',
  phone: '062-670-2338',
  email: 'tjyun@gwangju.ac.kr',
  website: null,
  contactVisibility: {
    office: 'admin_only', phone: 'hidden', email: 'public', website: 'hidden',
  },
  expertiseSummary: '예술사진·영상·AI·기술적 이미지',
  bio: '첫 문단입니다.\n\n둘째 문단입니다.\n셋째 줄입니다.',
  profileSections: {
    recommendationRole: '예술사진·영상·AI 학습경로 총괄',
    education: ['중앙대학교 일반대학원 사진학과'],
    careers: ['광주대학교 교수'],
    teachingFields: ['예술사진', '영상', 'AI 이미지'],
    studentProjects: ['사진과 영상을 결합한 전시 프로젝트'],
    careerPaths: ['미디어아티스트'],
    institutionProjects: ['학과 전시 프로젝트'],
    majorWorks: ['기술적 이미지 연작'],
  },
  weeklyCapacity: 4,
  priority: 10,
  sourceDate: '2026-07-14',
  lastVerifiedAt: '2026-07-14T08:09:10.654321+09:00',
  imagePath: null,
  tags: [
    { key: 'art_photo', label: '예술사진', category: 'track', weight: 3, isPrimary: true },
    { key: 'video', label: '영상과 기술(AI·편집·드론)', category: 'track', weight: 3, isPrimary: false },
    { key: 'ai', label: 'AI', category: 'activity', weight: 3, isPrimary: true },
    { key: 'installation', label: '설치', category: 'result', weight: 2, isPrimary: true },
    { key: 'media_artist', label: '미디어아티스트', category: 'career', weight: 2, isPrimary: true },
  ],
  specialistLinks: [],
  status: 'draft',
  openAssignedCount: 1,
  createdAt: '2026-07-01T01:02:03.123456+09:00',
  updatedAt,
}

const specialist: AdminFaculty = {
  ...faculty,
  id: 4,
  name: '박재웅',
  title: '겸임교수',
  employmentType: 'adjunct',
  consultationRole: 'specialist',
  expertiseSummary: '영상촬영·드론·VR·360 영상',
  weeklyCapacity: 0,
  tags: [
    { key: 'drone', label: '드론촬영', category: 'specialist', weight: 3, isPrimary: true },
    { key: 'video', label: '영상과 기술(AI·편집·드론)', category: 'track', weight: 2, isPrimary: true },
  ],
  specialistLinks: [{
    primaryFacultyId: 2,
    tagKey: 'drone',
    priority: 20,
    explanationTemplate: '드론 촬영 실무를 전문 연계합니다.',
  }],
  updatedAt: '2026-07-15T02:02:03.123456+09:00',
}

const publicPerson = (
  id: number,
  name: string,
  role: 'primary' | 'backup' | 'specialist',
  publicContacts: Record<string, string> = {},
) => ({
  id, name, title: role === 'specialist' ? '겸임교수' : '교수', role,
  expertise: `${name} 전문분야`, reason: `${name}은(는) 이 관심과 연결됩니다.`, publicContacts,
})

const preview: AdminFacultyPreview = {
  scenarios: [
    {
      key: 'social_photo_story', label: '사회 포토스토리', trackEvidence: 'documentary',
      recommendation: {
        primary: publicPerson(1, '조대연', 'primary', { email: 'public-primary@example.com' }),
        backup: publicPerson(3, '김사라', 'backup'), specialists: [], facultyFit: 91.2,
      },
    },
    {
      key: 'local_archive', label: '지역 아카이브', trackEvidence: 'documentary',
      recommendation: {
        primary: publicPerson(3, '김사라', 'primary'), backup: publicPerson(1, '조대연', 'backup'),
        specialists: [], facultyFit: 88.4,
      },
    },
    {
      key: 'video_drone', label: '영상·드론', trackEvidence: 'video',
      recommendation: {
        primary: publicPerson(2, '윤태준', 'primary'), backup: publicPerson(1, '조대연', 'backup'),
        specialists: [publicPerson(4, '박재웅', 'specialist', { website: 'https://faculty.example.com' })], facultyFit: 96,
      },
    },
    {
      key: 'commercial_fashion', label: '광고·패션', trackEvidence: 'commercial',
      recommendation: {
        primary: publicPerson(1, '조대연', 'primary'), backup: publicPerson(2, '윤태준', 'backup'),
        specialists: [publicPerson(6, '곽동욱', 'specialist')], facultyFit: 82.5,
      },
    },
  ],
}

const writeOf = (value: AdminFaculty): AdminFacultyWrite => ({
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
  profileSections: Object.fromEntries(Object.entries(value.profileSections).map(([key, item]) => (
    [key, Array.isArray(item) ? [...item] : item]
  ))) as AdminFacultyWrite['profileSections'],
  weeklyCapacity: value.weeklyCapacity,
  priority: value.priority,
  sourceDate: value.sourceDate,
  lastVerifiedAt: value.lastVerifiedAt,
  imagePath: value.imagePath,
  tags: value.tags.map(tag => ({ ...tag })),
  specialistLinks: value.specialistLinks.map(link => ({ ...link })),
})

const wrappers: VueWrapper[] = []
const mountEditor = (props: Record<string, unknown> = {}) => {
  const wrapper = mount(FacultyEditor, {
    attachTo: document.body,
    props: { faculty, ...props },
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

describe('administrator faculty editor', () => {
  it('renders the six semantic editor sections, canonical track labels, Yoon scope note, and media readiness rule', () => {
    const wrapper = mountEditor()

    expect(wrapper.findAll('fieldset > legend').map(legend => legend.text())).toEqual(expect.arrayContaining([
      '역할과 용량', '공개 연락처', '전문분야와 소개', '추천 태그', '전문 연계 matrix', '미디어 readiness',
    ]))
    expect(wrapper.text()).toContain('예술사진·영상·AI·기술적 이미지')
    expect(wrapper.text()).toContain('art_photo | video | ai')
    expect(wrapper.text()).toContain('다큐멘터리 사진')
    expect(wrapper.text()).toContain('영상과 기술(AI·편집·드론)')
    expect(wrapper.get('[data-media-readiness]').text()).toContain('권한과 대체 텍스트')
    expect(wrapper.get('[data-media-readiness]').text()).toContain('플레이스홀더')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('emits exact save and preview payloads while preserving LF bio and untouched microsecond timestamp', async () => {
    const wrapper = mountEditor()
    const bio = '첫 문단.\n\n둘째 문단.\n셋째 줄.'
    await wrapper.get('textarea[name="bio"]').setValue(bio)
    await wrapper.get('button[data-action="save-faculty"]').trigger('click')
    await wrapper.get('button[data-action="preview-faculty"]').trigger('click')

    const expected = { ...writeOf(faculty), bio }
    expect(wrapper.emitted('save')).toEqual([[{ expectedUpdatedAt: updatedAt, faculty: expected }]])
    expect(wrapper.emitted('preview')).toEqual([[{ faculty: expected }]])
    expect((wrapper.emitted('save')![0]![0] as { faculty: AdminFacultyWrite }).faculty.lastVerifiedAt)
      .toBe('2026-07-14T08:09:10.654321+09:00')
  })

  it('gates publish on dirty/conflict state and requires confirmation with focus restoration', async () => {
    const wrapper = mountEditor()
    const trigger = wrapper.get<HTMLButtonElement>('button[data-action="publish-faculty"]')
    expect(trigger.attributes('disabled')).toBeUndefined()
    expect(trigger.attributes('aria-disabled')).toBe('false')

    await trigger.trigger('click')
    const confirm = wrapper.get<HTMLButtonElement>('button[data-action="confirm-publish"]')
    expect(document.activeElement).toBe(confirm.element)
    await wrapper.get('button[data-action="cancel-publish"]').trigger('click')
    expect(document.activeElement).toBe(trigger.element)

    await wrapper.get('input[name="name"]').setValue('윤태준 교수')
    expect(trigger.attributes('disabled')).toBeUndefined()
    expect(trigger.attributes('aria-disabled')).toBe('true')
    await wrapper.setProps({ hasConflict: true })
    expect(wrapper.text()).toContain('서버 최신본을 적용')
    expect(trigger.attributes('disabled')).toBeUndefined()
    expect(trigger.attributes('aria-disabled')).toBe('true')

    await wrapper.setProps({ faculty: { ...faculty, updatedAt: '2026-07-15T03:02:03.123457+09:00' }, hasConflict: false })
    expect(wrapper.get('input[name="name"]').element).toHaveProperty('value', '윤태준')
    expect(trigger.attributes('aria-disabled')).toBe('false')
    await trigger.trigger('click')
    await wrapper.get('button[data-action="confirm-publish"]').trigger('click')
    expect(wrapper.emitted('publish')).toEqual([[{ facultyId: 2, expectedUpdatedAt: '2026-07-15T03:02:03.123457+09:00' }]])
  })

  it('pairs every contact with visibility and identifies newly public contact verification work', async () => {
    const wrapper = mountEditor()
    expect(wrapper.findAll('[data-contact-row]')).toHaveLength(4)
    await wrapper.get('select[name="phoneVisibility"]').setValue('public')

    const notice = wrapper.get('[data-contact-verification]')
    expect(notice.attributes('role')).toBe('alert')
    expect(notice.text()).toContain('전화')
    expect(notice.text()).toContain('더 최신의 검증 시각')
  })

  it('supports profile array add/remove controls without flattening section ownership', async () => {
    const wrapper = mountEditor()
    const education = wrapper.get('[data-profile-section="education"]')
    expect(education.findAll('input[data-profile-item]')).toHaveLength(1)
    await education.get('button[data-action="add-profile-item"]').trigger('click')
    expect(education.findAll('input[data-profile-item]')).toHaveLength(2)
    await education.findAll('button[data-action="remove-profile-item"]')[1]!.trigger('click')
    expect(education.findAll('input[data-profile-item]')).toHaveLength(1)
  })

  it('groups tags by category and edits only specialist-owned links including a null-primary common connection', async () => {
    const primaryWrapper = mountEditor()
    expect(primaryWrapper.findAll('[data-tag-category]')).toHaveLength(5)
    expect(primaryWrapper.get('[data-specialist-matrix]').text()).toContain('전문 연계는 specialist 교수진이 작성')
    expect(primaryWrapper.find('button[data-action="add-specialist-link"]').exists()).toBe(false)

    const wrapper = mountEditor({ faculty: specialist })
    const matrix = wrapper.get('[data-specialist-matrix]')
    expect(matrix.text()).toContain('전임 총괄교수 ID')
    expect(matrix.get('select[name="specialistTagKey-0"]').text()).toContain('드론촬영')
    await matrix.get('input[name="commonConnection-0"]').setValue(true)
    await wrapper.get('button[data-action="save-faculty"]').trigger('click')

    const payload = wrapper.emitted('save')![0]![0] as { faculty: AdminFacultyWrite }
    expect(payload.faculty.specialistLinks[0]).toEqual({
      primaryFacultyId: null,
      tagKey: 'drone',
      priority: 20,
      explanationTemplate: '드론 촬영 실무를 전문 연계합니다.',
    })
  })

  it('renders the canonical four-frame accessible proof strip and only public recommendation contacts', async () => {
    const wrapper = mountEditor({ preview })
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map(tab => tab.attributes('aria-label'))).toEqual([
      '사회 포토스토리', '지역 아카이브', '영상·드론', '광고·패션',
    ])
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    const panel = wrapper.get('[role="tabpanel"]')
    expect(panel.text()).toContain('추천 총괄교수')
    expect(panel.text()).toContain('예비 상담교수')
    expect(panel.text()).toContain('적합도 91.2')
    expect(panel.text()).toContain('public-primary@example.com')
    expect(panel.text()).not.toContain('062-670-2338')
    expect(panel.text()).not.toMatch(/contactVisibility|lastVerifiedAt|설명 템플릿|편집 payload/u)

    ;(tabs[0]!.element as HTMLButtonElement).focus()
    await tabs[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.findAll('[role="tab"]')[1]!.attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(wrapper.findAll('[role="tab"]')[1]!.element)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('김사라')
  })

  it('keeps the editor mounted on a preview error and exposes a direct retry action', async () => {
    const wrapper = mountEditor({ previewError: '게시 준비 중인 교수진 내용을 확인한 뒤 다시 미리보기하세요.' })

    expect(wrapper.get('[data-preview-error]').attributes('role')).toBe('alert')
    expect(wrapper.get('input[name="name"]').exists()).toBe(true)
    await wrapper.get('button[data-action="preview-faculty"]').trigger('click')
    expect(wrapper.emitted('preview')).toHaveLength(1)
  })

  it('announces save, preview, and publish progress through the polite live region', async () => {
    const wrapper = mountEditor({ saving: true })
    const live = wrapper.get('[aria-live="polite"]')
    expect(live.text()).toContain('저장 중')

    await wrapper.setProps({ saving: false, previewing: true })
    expect(live.text()).toContain('미리보기 중')
    await wrapper.setProps({ previewing: false, publishing: true })
    expect(live.text()).toContain('게시 중')
  })

  it('normalizes a cleared image path to null for exact save and preview payloads', async () => {
    const withImage = { ...faculty, imagePath: 'images/faculty/yoon.webp' }
    const wrapper = mountEditor({ faculty: withImage })
    await wrapper.get('input[name="imagePath"]').setValue('   ')

    expect(wrapper.find('[data-editor-errors]').exists()).toBe(false)
    await wrapper.get('button[data-action="save-faculty"]').trigger('click')
    await wrapper.get('button[data-action="preview-faculty"]').trigger('click')

    expect((wrapper.emitted('save')![0]![0] as { faculty: AdminFacultyWrite }).faculty.imagePath).toBeNull()
    expect((wrapper.emitted('preview')![0]![0] as { faculty: AdminFacultyWrite }).faculty.imagePath).toBeNull()
  })

  it('requires an explicit specialist target after leaving common mode and never invents a faculty ID', async () => {
    const commonSpecialist = {
      ...specialist,
      specialistLinks: [{ ...specialist.specialistLinks[0]!, primaryFacultyId: null }],
    }
    const wrapper = mountEditor({ faculty: commonSpecialist })
    const common = wrapper.get<HTMLInputElement>('input[name="commonConnection-0"]')
    await common.setValue(false)

    const target = wrapper.get<HTMLInputElement>('input[name="primaryFacultyId-0"]')
    expect(target.attributes('disabled')).toBeUndefined()
    expect(target.element.value).toBe('')
    expect(wrapper.get('button[data-action="save-faculty"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[data-action="preview-faculty"]').attributes('disabled')).toBeDefined()
    await wrapper.get('button[data-action="save-faculty"]').trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()

    await target.setValue('7')
    expect(wrapper.find('[data-editor-errors]').exists()).toBe(false)
    await wrapper.get('button[data-action="save-faculty"]').trigger('click')
    await wrapper.get('button[data-action="preview-faculty"]').trigger('click')
    expect((wrapper.emitted('save')![0]![0] as { faculty: AdminFacultyWrite }).faculty.specialistLinks[0]?.primaryFacultyId).toBe(7)
    expect((wrapper.emitted('preview')![0]![0] as { faculty: AdminFacultyWrite }).faculty.specialistLinks[0]?.primaryFacultyId).toBe(7)
  })

  it.each(['saving', 'publishing'] as const)(
    'locks editor controls while %s but keeps the guarded publish trigger focusable', async (busyProp) => {
      const wrapper = mountEditor({ [busyProp]: true })
      const trigger = wrapper.get<HTMLButtonElement>('button[data-action="publish-faculty"]')

      expect(wrapper.findAll('fieldset')).toHaveLength(6)
      expect(wrapper.findAll('fieldset').every(fieldset => fieldset.attributes('disabled') !== undefined)).toBe(true)
      expect(wrapper.get('button[data-action="save-faculty"]').attributes('disabled')).toBeDefined()
      expect(wrapper.get('button[data-action="preview-faculty"]').attributes('disabled')).toBeDefined()
      expect(trigger.attributes('disabled')).toBeUndefined()
      expect(trigger.attributes('aria-disabled')).toBe('true')
      ;(trigger.element as HTMLButtonElement).focus()
      expect(document.activeElement).toBe(trigger.element)
      await trigger.trigger('click')
      expect(wrapper.find('button[data-action="confirm-publish"]').exists()).toBe(false)
      expect(wrapper.emitted('publish')).toBeUndefined()
    },
  )
})
