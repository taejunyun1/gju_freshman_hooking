import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FacultyCard from '../../../app/components/result/FacultyCard.vue'

describe('FacultyCard', () => {
  it('gives the professor expertise an explicit, accessible visual hierarchy', () => {
    const wrapper = mount(FacultyCard, {
      props: {
        person: {
          role: 'primary',
          id: 2,
          name: '윤태준',
          title: '교수',
          expertise: '현대예술·예술사진·영상·AI·기술적 이미지',
          reason: '선택한 관심과 전문분야를 함께 살펴봅니다.',
          publicContacts: {},
        },
      },
    })

    expect(wrapper.get('.faculty-card__expertise-label').text()).toBe('전문분야')
    expect(wrapper.get('.faculty-card__expertise').text())
      .toBe('현대예술·예술사진·영상·AI·기술적 이미지')
    expect(wrapper.get('.faculty-card__expertise').element.tagName).toBe('P')
  })
})
