import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CurriculumRouteExplorer from '../../../app/components/curriculum/CurriculumRouteExplorer.vue'

describe('CurriculumRouteExplorer', () => {
  it('switches to documentary and exposes its four-year route', async () => {
    const wrapper = mount(CurriculumRouteExplorer, {
      props: { defaultTrack: 'video', variant: 'detailed' },
    })

    await wrapper.get('[data-curriculum-track="documentary"]').trigger('click')

    expect(wrapper.get('[data-curriculum-route-explorer]').attributes('data-active-track')).toBe('documentary')
    expect(wrapper.text()).toContain('포스트 다큐멘터리 랩')
  })

  it('uses video when the requested track is invalid', () => {
    const wrapper = mount(CurriculumRouteExplorer, {
      props: { defaultTrack: 'invalid' as never },
    })

    expect(wrapper.get('[data-curriculum-route-explorer]').attributes('data-active-track')).toBe('video')
  })
})
