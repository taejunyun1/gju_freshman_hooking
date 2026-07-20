import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdminStudentListItem } from '../../../shared/schemas/admin-students'
import DataTable from '../../../app/components/admin/DataTable.vue'
import StudentFilters from '../../../app/components/admin/StudentFilters.vue'

const students: AdminStudentListItem[] = [{
  id: 42,
  nickname: '선명한프레임42',
  phone: '010-****-5678',
  schoolName: '광주고등학교',
  applicantStage: 'high3',
  region: 'gwangju',
  status: 'active',
  lastActiveAt: '2026-07-15T01:00:00.000Z',
  createdAt: '2026-07-01T01:00:00.000Z',
}]

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
}

describe('administrator student list components', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders one semantic desktop table and labeled mobile cards with a photography-specific row marker', () => {
    const wrapper = mount(DataTable, {
      props: {
        items: students,
        listUrl: '/admin/students?stage=high3&query=%EC%84%A0%EB%AA%85',
      },
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    })

    expect(wrapper.get('table').attributes('aria-label')).toBe('학생 목록')
    expect(wrapper.findAll('thead th').map(cell => cell.text())).toEqual([
      '학생', '학교·학년', '연락처', '최근 활동', '상세',
    ])
    expect(wrapper.get('[data-film-edge]').text()).toContain('#000042')
    expect(wrapper.get('[data-film-edge]').text()).toContain('2026. 7. 15.')
    expect(wrapper.get('[data-mobile-card]').findAll('dt').map(label => label.text())).toEqual([
      '학교·학년', '연락처', '지역', '최근 활동',
    ])
    expect(wrapper.text()).toContain('010-****-5678')
    expect(wrapper.text()).not.toContain('01012345678')

    const detailTargets = wrapper.findAll('a').map(link => JSON.parse(link.attributes('data-to')))
    expect(detailTargets).toEqual([
      {
        path: '/admin/students/42',
        query: { returnTo: '/admin/students?stage=high3&query=%EC%84%A0%EB%AA%85' },
      },
      {
        path: '/admin/students/42',
        query: { returnTo: '/admin/students?stage=high3&query=%EC%84%A0%EB%AA%85' },
      },
    ])
  })

  it('debounces nickname and school searches but applies select filters immediately', async () => {
    vi.useFakeTimers()
    const wrapper = mount(StudentFilters, {
      props: {
        modelValue: {
          query: '',
          stage: '',
          region: '',
          school: '',
          track: '',
          counselingStatus: '',
          dateFrom: '',
          dateTo: '',
        },
      },
    })

    await wrapper.get('input[name="query"]').setValue('선명')
    await vi.advanceTimersByTimeAsync(349)
    expect(wrapper.emitted('apply')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.emitted('apply')?.at(-1)).toEqual([expect.objectContaining({ query: '선명' })])

    await wrapper.get('input[name="school"]').setValue('광주고')
    await vi.advanceTimersByTimeAsync(350)
    expect(wrapper.emitted('apply')?.at(-1)).toEqual([
      expect.objectContaining({ query: '선명', school: '광주고' }),
    ])

    await wrapper.get('select[name="track"]').setValue('art_photo')
    await flushPromises()
    expect(wrapper.emitted('apply')?.at(-1)).toEqual([
      expect.objectContaining({ track: 'art_photo' }),
    ])
    expect(wrapper.find('[name="campaign"]').exists()).toBe(false)
  })

  it('cancels a pending search before emitting one clean reset', async () => {
    vi.useFakeTimers()
    const wrapper = mount(StudentFilters, {
      props: {
        modelValue: {
          query: '선명',
          stage: 'high3',
          region: '',
          school: '',
          track: '',
          counselingStatus: '',
          dateFrom: '',
          dateTo: '',
        },
      },
    })

    await wrapper.get('input[name="query"]').setValue('프레임')
    await wrapper.get('button[data-action="reset"]').trigger('click')
    await vi.advanceTimersByTimeAsync(400)

    expect(wrapper.emitted('reset')).toHaveLength(1)
    expect(wrapper.emitted('apply')).toBeUndefined()
  })
})
