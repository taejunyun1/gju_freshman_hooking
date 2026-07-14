import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LandingPage from '../../../app/pages/index.vue'

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

describe('landing page', () => {
  it('explains the four-stage connection in order', () => {
    const wrapper = mount(LandingPage, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })

    expect(wrapper.get('h1').text()).toBe('하고 싶은 사진·영상 작업이 학과의 수업과 어떻게 이어지는지 확인해보세요')
    expect(wrapper.findAll('[data-stage]').map(stage => stage.text())).toEqual([
      '관심 선택',
      '4년 학습경로',
      '작품·진로',
      '교수 상담',
    ])
  })

  it('offers one primary start link', () => {
    const wrapper = mount(LandingPage, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })
    const startLinks = wrapper.findAll('a[href="/start"]')

    expect(startLinks).toHaveLength(1)
    expect(startLinks[0].text()).toBe('나의 연결 경로 찾기')
    expect(startLinks[0].classes()).toContain('landing__cta')
  })
})
