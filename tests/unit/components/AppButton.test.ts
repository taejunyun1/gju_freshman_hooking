import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppButton from '../../../app/components/common/AppButton.vue'

describe('AppButton', () => {
  it('uses a safe button type by default', () => {
    const wrapper = mount(AppButton, {
      props: { variant: 'primary' },
      slots: { default: '경로 찾기' },
    })

    expect(wrapper.get('button').attributes('type')).toBe('button')
  })

  it('uses native disabled and busy states while loading', () => {
    const wrapper = mount(AppButton, {
      props: { variant: 'primary', loading: true },
      slots: { default: '경로 찾기' },
    })
    const button = wrapper.get('button')

    expect(button.attributes()).toHaveProperty('disabled')
    expect(button.attributes('aria-busy')).toBe('true')
  })

  it('provides a 44px touch target on both axes', () => {
    const wrapper = mount(AppButton, {
      props: { variant: 'secondary' },
      slots: { default: '이전' },
    })
    const source = readFileSync('app/components/common/AppButton.vue', 'utf8')

    expect(wrapper.get('button').classes()).toContain('app-button')
    expect(source).toContain('min-inline-size: var(--touch-target)')
    expect(source).toContain('min-block-size: var(--touch-target)')
  })
})
