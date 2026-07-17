import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RosterImportPanel from '../../../app/components/admin/RosterImportPanel.vue'

describe('RosterImportPanel', () => {
  it('supports keyboard file selection and announces a file error', async () => {
    const wrapper = mount(RosterImportPanel, { props: { phase: 'idle', errorMessage: '열 형식을 확인하세요.' } })

    expect(wrapper.get('input[type="file"]').attributes('accept')).toContain('.xlsx')
    expect(wrapper.get('[role="alert"]').text()).toContain('열 형식을 확인하세요.')
    await wrapper.get('[data-action="choose-file"]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('choose-file')).toHaveLength(1)
  })

  it('keeps the apply action disabled until the explicit confirmation phrase is entered', async () => {
    const wrapper = mount(RosterImportPanel, {
      props: { phase: 'ready', errorMessage: '', confirmation: '2027 명단 적용', confirmationPhrase: '2027 명단 적용', canApply: false },
    })

    expect(wrapper.get('button[data-action="apply"]').attributes('disabled')).toBeDefined()
    expect((wrapper.get('input[name="confirmation"]').element as HTMLInputElement).value).toBe('2027 명단 적용')
    await wrapper.get('input[name="confirmation"]').setValue('2027 명단 적용')
    expect(wrapper.emitted('update:confirmation')).toEqual([['2027 명단 적용']])
  })

  it('gives the hidden file input an accessible name', () => {
    const wrapper = mount(RosterImportPanel, { props: { phase: 'idle', errorMessage: '', confirmationPhrase: '', canApply: false } })

    expect(wrapper.get('input[type="file"]').attributes('aria-label')).toBe('명단 파일 선택')
  })
})
