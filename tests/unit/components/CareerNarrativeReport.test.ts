import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resultPublicId } from '../../fixtures/result'

const session = {
  csrfToken: 'csrf-memory-token',
  expiresAt: '2026-07-16T12:00:00.000Z',
  nickname: '고요한프레임27',
  prospectId: 27,
}
const success = <T>(data: T) => ({ data, requestId: 'request-id' })

const mountReport = async () => {
  const { default: CareerNarrativeReport } = await import(
    '../../../app/components/result/CareerNarrativeReport.vue'
  )
  return mount(CareerNarrativeReport, {
    attachTo: document.body,
    props: { assessmentPublicId: resultPublicId },
  })
}

describe('career narrative report', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens a category-only keyboard form and returns focus when closed', async () => {
    vi.stubGlobal('$fetch', vi.fn())
    const wrapper = await mountReport()
    const opener = wrapper.get('[data-testid="career-narrative-report-open"]')

    expect(wrapper.find('form').exists()).toBe(false)
    await opener.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(3)
    expect(wrapper.findAll('label').map(label => label.text())).toEqual([
      '사실과 다른 내용',
      '불편하거나 위험한 표현',
      '이해하기 어려운 내용',
    ])
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.find('input[type="radio"]').element)

    await wrapper.get('[data-testid="career-narrative-report-cancel"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(document.activeElement).toBe(opener.element)
  })

  it('loads memory-only CSRF and posts only the assessment ID and category', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/student/session') return success(session)
      if (url === '/api/career-narrative/report') return success({ accepted: true })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('$fetch', fetch)
    const wrapper = await mountReport()
    await wrapper.get('[data-testid="career-narrative-report-open"]').trigger('click')
    await wrapper.get('input[value="unsafe"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/student/session')
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/career-narrative/report', {
      body: {
        assessmentPublicId: resultPublicId,
        category: 'unsafe',
      },
      headers: { 'x-photo-next-csrf': 'csrf-memory-token' },
      method: 'POST',
    })
    expect(JSON.stringify(fetch.mock.calls[1])).not.toMatch(
      /generated|sentence|nickname|phone|provider|model|freeText/iu,
    )
    expect(wrapper.get('[role="status"]').text()).toBe(
      '알려주셔서 감사합니다. 담당자가 확인하겠습니다.',
    )
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="career-narrative-report-open"]').element,
    )
  })

  it('announces a sanitized session-expiry error and keeps the selected category', async () => {
    const authError = Object.assign(new Error('private session row'), {
      data: {
        error: { code: 'AUTH_FAILED', message: 'private session row' },
        requestId: 'private-id',
      },
    })
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(authError))
    const wrapper = await mountReport()
    await wrapper.get('[data-testid="career-narrative-report-open"]').trigger('click')
    await wrapper.get('input[value="confusing"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('로그인 정보가 만료되었습니다')
    expect(wrapper.get('input[value="confusing"]').element).toMatchObject({ checked: true })
    expect(wrapper.text()).not.toMatch(/private session row|private-id/u)
  })
})
