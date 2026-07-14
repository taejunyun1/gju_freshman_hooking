import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AssessmentStep from '../../../app/components/assessment/AssessmentStep.vue'

const workGroup = {
  key: 'work' as const,
  options: [
    { key: 'work.photo', label: '사진 촬영하기', visualKey: 'photo_frame' as const },
    { key: 'work.video', label: '영상 촬영하기', visualKey: 'video_frame' as const },
    { key: 'work.edit', label: '영상 편집하기', visualKey: 'edit_timeline' as const },
    { key: 'work.studio', label: '광고 이미지 만들기', visualKey: 'studio_still' as const },
    { key: 'work.photobook', label: '사진집 만들기', visualKey: 'photobook_spread' as const },
  ],
}

const careerGroup = {
  key: 'career' as const,
  options: [
    { key: 'career.photo', label: '사진 진로', visualKey: 'photo_frame' as const },
    { key: 'career.explore', label: '다른 가능성 탐색', visualKey: 'contact_sheet' as const },
  ],
}

describe('AssessmentStep', () => {
  it('announces and blocks a fifth selection', async () => {
    const fourKeys = ['work.photo', 'work.video', 'work.edit', 'work.studio']
    const wrapper = mount(AssessmentStep, {
      props: {
        group: workGroup,
        limit: { min: 1, max: 4 },
        modelValue: fourKeys,
        careerOther: '',
      },
    })

    await wrapper.get('[data-key="work.photobook"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.get('[role="status"]').text()).toContain('최대 4개')
  })

  it('uses a fieldset, legend, and native checkboxes with non-color selection text', () => {
    const wrapper = mount(AssessmentStep, {
      props: {
        group: workGroup,
        limit: { min: 1, max: 4 },
        modelValue: ['work.photo'],
        careerOther: '',
      },
    })

    expect(wrapper.get('fieldset').exists()).toBe(true)
    expect(wrapper.get('legend').text()).toContain('무엇을 해보고 싶나요?')
    const selected = wrapper.get('[data-key="work.photo"]')
    expect(selected.element).toBeInstanceOf(HTMLInputElement)
    expect(selected.attributes('type')).toBe('checkbox')
    expect(selected.attributes('checked')).toBeDefined()
    expect(wrapper.text()).toContain('선택됨')
    expect(wrapper.get('[role="status"]').attributes('aria-live')).toBe('polite')
  })

  it('disables the native fieldset and emits no mutation while the flow is busy', async () => {
    const wrapper = mount(AssessmentStep, {
      props: {
        group: workGroup,
        limit: { min: 1, max: 4 },
        modelValue: ['work.photo'],
        careerOther: '',
        disabled: true,
      },
    })

    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-key="work.photo"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('reveals a labeled 30-character career input with a counter and privacy boundary', () => {
    const wrapper = mount(AssessmentStep, {
      props: {
        group: careerGroup,
        limit: { min: 1, max: 2 },
        modelValue: ['career.explore'],
        careerOther: '아카이브 연구',
      },
    })

    const input = wrapper.get('input[name="careerOther"]')
    expect(wrapper.get('label[for="career-other"]').text()).toContain('다른 가능성')
    expect(input.attributes('maxlength')).toBe('30')
    expect(wrapper.text()).toContain('7 / 30')
    expect(wrapper.text()).toContain('전화번호나 이메일은 입력하지 마세요')
  })

  it('references the career error description only while the error exists', async () => {
    const wrapper = mount(AssessmentStep, {
      props: {
        group: careerGroup,
        limit: { min: 1, max: 2 },
        modelValue: ['career.explore'],
        careerOther: '',
      },
    })
    const input = wrapper.get('input[name="careerOther"]')

    expect(input.attributes('aria-describedby')).toBe('career-other-privacy')

    await input.setValue('name@example.com')

    expect(input.attributes('aria-describedby')).toBe('career-other-privacy career-other-error')
    expect(wrapper.get('#career-other-error').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findAll('[aria-live="polite"]')).toHaveLength(1)
    expect(wrapper.get('[role="status"]').text()).toContain('전화번호나 이메일')
  })

  it('clears an invalid career error when explore is deselected before reselecting', async () => {
    const wrapper = mount(AssessmentStep, {
      props: {
        group: careerGroup,
        limit: { min: 1, max: 2 },
        modelValue: ['career.explore'],
        careerOther: '',
      },
    })
    await wrapper.get('input[name="careerOther"]').setValue('name@example.com')
    expect(wrapper.get('#career-other-error').exists()).toBe(true)

    await wrapper.get('[data-key="career.explore"]').trigger('click')
    expect(wrapper.emitted('update:careerOther')).toEqual([['']])
    await wrapper.setProps({ modelValue: [] })
    await wrapper.get('[data-key="career.explore"]').trigger('click')
    await wrapper.setProps({ modelValue: ['career.explore'] })

    const input = wrapper.get('input[name="careerOther"]')
    expect(input.attributes('aria-describedby')).toBe('career-other-privacy')
    expect(wrapper.find('#career-other-error').exists()).toBe(false)
    expect(wrapper.findAll('[aria-live="polite"]')).toHaveLength(1)
    expect(wrapper.get('[role="status"]').text()).not.toContain('전화번호나 이메일')
  })

  it.each([
    ['name@example.com', '전화번호나 이메일'],
    ['010-1234-5678', '전화번호나 이메일'],
    ['제어\u007F문자', '줄바꿈이나 제어문자'],
  ])('rejects private or control text immediately: %s', async (value, message) => {
    const wrapper = mount(AssessmentStep, {
      props: {
        group: careerGroup,
        limit: { min: 1, max: 2 },
        modelValue: ['career.explore'],
        careerOther: '',
      },
    })

    await wrapper.get('input[name="careerOther"]').setValue(value)

    expect(wrapper.emitted('update:careerOther')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toContain(message)
  })

  it('clears optional career text in the same turn when explore is deselected', async () => {
    const wrapper = mount(AssessmentStep, {
      props: {
        group: careerGroup,
        limit: { min: 1, max: 2 },
        modelValue: ['career.photo', 'career.explore'],
        careerOther: '아카이브 연구',
      },
    })

    await wrapper.get('[data-key="career.explore"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[['career.photo']]])
    expect(wrapper.emitted('update:careerOther')).toEqual([['']])
  })
})
