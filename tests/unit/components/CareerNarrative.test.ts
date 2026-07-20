import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeResultSnapshot, resultPublicId } from '../../fixtures/result'

describe('career narrative direction cut', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders the four directions as one editorial sequence', async () => {
    vi.stubGlobal('$fetch', vi.fn())
    const { default: CareerNarrative } = await import(
      '../../../app/components/result/CareerNarrative.vue'
    )
    const narrative = makeResultSnapshot().careerNarrative
    const wrapper = mount(CareerNarrative, {
      props: {
        assessmentPublicId: resultPublicId,
        narrative,
      },
    })

    expect(wrapper.get('[data-career-narrative]').text()).toContain('DIRECTION CUT / 04')
    expect(wrapper.findAll('ol > li')).toHaveLength(4)
    expect(wrapper.findAll('[data-narrative-slot]').map(node => (
      node.attributes('data-narrative-slot')
    ))).toEqual(['direction', 'learning_path', 'career_direction', 'faculty_connection'])
    expect(wrapper.findAll('[data-cut-number]').map(node => node.text())).toEqual([
      '01',
      '02',
      '03',
      '04',
    ])
    expect(wrapper.text()).toContain('실제 교과 운영과 상담 배정은 학과 확인 후 확정됩니다')
    expect(wrapper.text()).toContain('AI는 진로를 결정하지 않습니다')
    expect(wrapper.text()).not.toContain('신고')
    expect(wrapper.html()).not.toContain('career-narrative/report')
    expect(wrapper.text()).not.toContain('evidenceIds')
    expect(wrapper.text()).not.toContain('gpt-5.6')
    expect(wrapper.text()).not.toContain(narrative.source)
  })

  it('uses identical student-facing markup for deterministic and model-assisted sources', async () => {
    vi.stubGlobal('$fetch', vi.fn())
    const { default: CareerNarrative } = await import(
      '../../../app/components/result/CareerNarrative.vue'
    )
    const deterministic = makeResultSnapshot().careerNarrative
    const openai = { ...deterministic, source: 'openai' as const }
    const deterministicWrapper = mount(CareerNarrative, {
      props: { assessmentPublicId: resultPublicId, narrative: deterministic },
    })
    const openaiWrapper = mount(CareerNarrative, {
      props: { assessmentPublicId: resultPublicId, narrative: openai },
    })

    expect(openaiWrapper.findAll('[data-narrative-slot]').map(node => node.element.tagName)).toEqual(
      deterministicWrapper.findAll('[data-narrative-slot]').map(node => node.element.tagName),
    )
    expect(openaiWrapper.get('[data-career-narrative]').attributes('class')).toBe(
      deterministicWrapper.get('[data-career-narrative]').attributes('class'),
    )
    expect(openaiWrapper.text()).not.toMatch(/openai|deterministic|model|source/iu)
  })
})
