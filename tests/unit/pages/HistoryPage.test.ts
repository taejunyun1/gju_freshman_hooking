import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

const historyItem = (
  publicId: string,
  completedAt: string,
  topTrack: 'documentary' | 'art_photo' | 'commercial' | 'video',
  environmentScore: number,
) => ({
  publicId,
  completedAt,
  topTrack,
  environmentScore,
  selectedInterests: [
    { group: 'work', key: 'work.commercial_image', label: `관심 요약 ${publicId.slice(0, 4)}` },
  ],
  facultyPhone: 'private-062-000-0000',
  rawWeights: { commercial: 3 },
})

describe('assessment history page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads, sorts newest first, and renders at most three redacted result links', async () => {
    const items = [
      historyItem('11111111-1111-4111-8111-111111111111', '2026-07-12T10:00:00+09:00', 'documentary', 70.1),
      historyItem('22222222-2222-4222-8222-222222222222', '2026-07-15T11:59:00+09:00', 'art_photo', 80.2),
      historyItem('44444444-4444-4444-8444-444444444444', '2026-07-15T12:00:00+09:00', 'commercial', 92.3),
      historyItem('33333333-3333-4333-8333-333333333333', '2026-07-14T11:00:00+09:00', 'video', 84.4),
    ]
    const fetch = vi.fn().mockResolvedValue({ data: { items }, requestId: 'request-id' })
    vi.stubGlobal('$fetch', fetch)
    const { default: HistoryPage } = await import('../../../app/pages/history.vue')
    const wrapper = mount(HistoryPage, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/assessment/history')
    const cards = wrapper.findAll('[data-testid="history-card"]')
    expect(cards).toHaveLength(3)
    expect(cards.map(card => card.get('a').attributes('href'))).toEqual([
      '/result/44444444-4444-4444-8444-444444444444',
      '/result/22222222-2222-4222-8222-222222222222',
      '/result/33333333-3333-4333-8333-333333333333',
    ])
    for (const card of cards) {
      expect(card.get('time').attributes('datetime')).toMatch(/^2026-07-(?:14|15)T/u)
      expect(card.text()).toMatch(/다큐멘터리|예술사진|광고사진|영상/u)
      expect(card.text()).toMatch(/\d+(?:\.\d)?점/u)
      expect(card.text()).toContain('관심 요약')
    }
    expect(wrapper.text()).toContain('최근 편집본')
    expect(wrapper.text()).not.toMatch(/private-062-000-0000|rawWeights|commercial.*3/u)
  })

  it('accepts PostgreSQL offset timestamps with six fractional digits', async () => {
    const completedAt = '2026-07-15T12:00:00.123456+09:00'
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      data: {
        items: [historyItem(
          '11111111-1111-4111-8111-111111111111',
          completedAt,
          'commercial',
          92.3,
        )],
      },
      requestId: 'request-id',
    }))
    const { default: HistoryPage } = await import('../../../app/pages/history.vue')
    const wrapper = mount(HistoryPage, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="history-card"] time').attributes('datetime')).toBe(completedAt)
  })

  it('preserves server order when different microseconds parse to the same millisecond', async () => {
    const serverFirstId = '99999999-9999-4999-8999-999999999999'
    const serverSecondId = '11111111-1111-4111-8111-111111111111'
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      data: {
        items: [
          historyItem(serverFirstId, '2026-07-15T12:00:00.123456+09:00', 'commercial', 92.3),
          historyItem(serverSecondId, '2026-07-15T12:00:00.123001+09:00', 'art_photo', 84.4),
        ],
      },
      requestId: 'request-id',
    }))
    const { default: HistoryPage } = await import('../../../app/pages/history.vue')
    const wrapper = mount(HistoryPage, {
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="history-card"] a').map(link => link.attributes('href'))).toEqual([
      `/result/${serverFirstId}`,
      `/result/${serverSecondId}`,
    ])
  })
})
