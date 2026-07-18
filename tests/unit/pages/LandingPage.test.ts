import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LandingPage from '../../../app/pages/index.vue'

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

describe('landing page', () => {
  beforeEach(() => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined))
  })

  it('explains the four-stage connection in order', () => {
    const wrapper = mount(LandingPage, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })

    expect(wrapper.get('[data-department-brand]').text()).toBe('광주대학교 사진영상미디어학과 · PHOTO:NEXT')
    expect(wrapper.get('h1').text()).toBe(
      '하고 싶은 사진·영상, 광주대학교 사진영상미디어학과에서 어떻게 시작할 수 있는지 확인해보세요.',
    )
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
    const startLinks = wrapper.findAll('a[href="/login"]')

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

    expect(brand.attributes('aria-label')).toBe('광주대학교 사진영상미디어학과 PHOTO:NEXT 홈')
    expect(brand.classes()).toContain('landing__brand')
    expect(source).toContain('min-inline-size: var(--touch-target)')
    expect(source).toContain('min-block-size: var(--touch-target)')
  })

  it('does not reintroduce the retired department name in the current landing entry', () => {
    const source = readFileSync('app/pages/index.vue', 'utf8')

    expect(source).not.toContain('광주대학교 사진영상학과')
  })

  it('sends one non-blocking landing event with no client-derived metadata', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('$fetch', send)

    mount(LandingPage, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })
    await flushPromises()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('/api/events', {
      method: 'POST',
      body: { eventName: 'landing_viewed' },
    })
  })

  it('swallows landing telemetry failure without removing primary navigation', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('private upstream detail')))
    const wrapper = mount(LandingPage, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })

    await flushPromises()

    expect(wrapper.get('a[href="/login"]').text()).toBe('나의 연결 경로 찾기')
  })
})
