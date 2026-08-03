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

  it('uses a concise four-year strip for the compact landing variant', () => {
    const wrapper = mount(CurriculumRouteExplorer, {
      props: { defaultTrack: 'commercial', variant: 'compact' },
    })

    expect(wrapper.findAll('[data-curriculum-track]')).toHaveLength(4)
    expect(wrapper.findAll('[data-curriculum-compact-stage]')).toHaveLength(4)
    expect(wrapper.findAll('[data-curriculum-stage]')).toHaveLength(0)
    expect(wrapper.find('[data-curriculum-compact-summary]').text()).toContain('1Y')
    expect(wrapper.find('[data-curriculum-compact-summary]').text()).toContain('4Y')
    expect(wrapper.text()).not.toContain('기획부터 촬영·후반작업까지 상업 포트폴리오를 완성합니다.')
  })

  it('keeps full course and outcome detail for the detailed result variant', () => {
    const wrapper = mount(CurriculumRouteExplorer, {
      props: { defaultTrack: 'commercial', variant: 'detailed' },
    })

    expect(wrapper.findAll('[data-curriculum-stage]')).toHaveLength(4)
    expect(wrapper.findAll('[data-curriculum-compact-stage]')).toHaveLength(0)
    expect(wrapper.text()).toContain('기획부터 촬영·후반작업까지 상업 포트폴리오를 완성합니다.')
  })
})
