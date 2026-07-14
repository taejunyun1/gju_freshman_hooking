import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppState from '../../../app/components/common/AppState.vue'

describe('AppState', () => {
  it.each(['loading', 'empty', 'error'] as const)('announces the %s state politely', (variant) => {
    const wrapper = mount(AppState, {
      props: { variant, message: `${variant} message` },
    })

    expect(wrapper.attributes('aria-live')).toBe('polite')
    expect(wrapper.classes()).toContain(`app-state--${variant}`)
    expect(wrapper.text()).toContain(`${variant} message`)
  })
})
