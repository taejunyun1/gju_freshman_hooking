import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CampaignAttributionStrip from '../../../app/components/admin/CampaignAttributionStrip.vue'

describe('campaign attribution strip', () => {
  it('renders the real four-step sequence and keeps unavailable S6 metrics honest', () => {
    const wrapper = mount(CampaignAttributionStrip, {
      props: {
        sentCount: 120,
        metrics: {
          version: 's6-daily-metrics-v1',
          availability: 'pending',
          visits: null,
          assessmentCompletions: null,
          counselingConversions: null,
        },
      },
    })

    expect(wrapper.attributes('aria-label')).toBe('캠페인 기여 흐름')
    expect(wrapper.findAll('[data-attribution-frame]').map(frame => frame.get('[data-frame-label]').text()))
      .toEqual(['발송', '방문', '검사 완료', '상담 전환'])
    expect(wrapper.findAll('[data-frame-value]').map(value => value.text()))
      .toEqual(['120', '집계 준비 중', '집계 준비 중', '집계 준비 중'])
    expect(wrapper.text()).not.toMatch(/0%|전환율/u)
  })

  it('pins compact responsive geometry and reduced-motion behavior without decorative charts', () => {
    const source = readFileSync('app/components/admin/CampaignAttributionStrip.vue', 'utf8')

    expect(source).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
    expect(source).not.toMatch(/gradient|canvas|svg|<img/iu)
  })
})
