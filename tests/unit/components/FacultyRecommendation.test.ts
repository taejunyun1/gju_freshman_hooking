import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FacultyRecommendation from '../../../app/components/result/FacultyRecommendation.vue'

describe('FacultyRecommendation', () => {
  it('renders specialist faculty as compact supporting cards', () => {
    const wrapper = mount(FacultyRecommendation, {
      props: {
        faculty: {
          primary: {
            role: 'primary',
            id: 1,
            name: '조대연',
            title: '교수',
            expertise: '다큐멘터리 사진',
            reason: '관심사를 함께 살펴봅니다.',
            publicContacts: {},
          },
          backup: {
            role: 'backup',
            id: 2,
            name: '윤태준',
            title: '교수',
            expertise: '예술사진',
            reason: '상담을 이어갑니다.',
            publicContacts: {},
          },
          specialists: [{
            role: 'specialist',
            id: 4,
            name: '곽동욱',
            title: '겸임교수',
            expertise: '광고사진·패션사진·브랜드 이미지',
            reason: '실무 제작을 연결합니다.',
            publicContacts: { website: 'https://example.com/faculty' },
          }],
        },
        track: 'commercial_fashion',
      },
    })

    expect(wrapper.get('[data-faculty-role]').text()).toBe('추천 총괄교수')
    expect(wrapper.get('.faculty-recommendation__group--specialists [data-faculty-role]').text())
      .toBe('함께 연결되는 실무·창작 강사')
    expect(wrapper.get('[data-faculty-person="4"]').classes()).toContain('faculty-card--compact')
    expect(wrapper.get('[data-faculty-person="1"]').classes()).not.toContain('faculty-card--compact')
    expect(wrapper.get('[data-faculty-person="4"] a[href="https://example.com/faculty"]').attributes('href'))
      .toBe('https://example.com/faculty')
  })
})
