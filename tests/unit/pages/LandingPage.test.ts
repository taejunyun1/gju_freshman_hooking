import { readFileSync } from 'node:fs'
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

  it('provides a labelled 44px home control in the masthead', () => {
    const wrapper = mount(LandingPage, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })
    const source = readFileSync('app/pages/index.vue', 'utf8')
    const brand = wrapper.get('a[href="/"]')

    expect(brand.attributes('aria-label')).toBe('PHOTO:NEXT 홈')
    expect(brand.classes()).toContain('landing__brand')
    expect(source).toContain('min-inline-size: var(--touch-target)')
    expect(source).toContain('min-block-size: var(--touch-target)')
  })
})
