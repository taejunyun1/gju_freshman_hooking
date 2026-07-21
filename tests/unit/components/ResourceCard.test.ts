import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ResourceCard from '../../../app/components/result/ResourceCard.vue'
import type { CourseResultResource } from '../../../shared/types/result'

const course = (requirementType?: 'major_required' | 'major_elective'): CourseResultResource => ({
  id: 101,
  type: 'course',
  title: '라이팅과 스튜디오',
  summary: '글쓰기와 이미지 제작의 기초를 다루는 수업입니다.',
  sourceDate: '2026-07-21',
  affinity: 90,
  primaryTag: 'commercial',
  connectionReason: '라이팅과 스튜디오는 선택한 관심을 실제 제작으로 연결합니다.',
  displayMetadata: {
    gradeYear: 1,
    term: '2학기',
    credits: 3,
    ...(requirementType ? { requirementType } : {}),
  },
})

describe('course requirement badge', () => {
  it('shows a text major-required badge beside the course type', () => {
    const wrapper = mount(ResourceCard, {
      props: { resource: course('major_required'), variant: 'course' },
    })

    expect(wrapper.get('[data-course-requirement="major_required"]').text()).toContain('전공필수')
    expect(wrapper.get('.resource-card__course-type').text()).toContain('COURSE')
  })

  it.each(['major_elective', undefined] as const)(
    'does not show a requirement badge for %s course metadata',
    (requirementType) => {
      const wrapper = mount(ResourceCard, {
        props: { resource: course(requirementType), variant: 'course' },
      })

      expect(wrapper.find('[data-course-requirement]').exists()).toBe(false)
    },
  )
})
