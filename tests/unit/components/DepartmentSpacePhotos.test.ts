import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DepartmentSpacePhotos from '../../../app/components/result/DepartmentSpacePhotos.vue'

describe('DepartmentSpacePhotos', () => {
  it.each([
    ['documentary', ['학과 암실', '프린트랩']],
    ['art_photo', ['학과 암실', '프린트랩']],
    ['commercial', ['스튜디오 A', '스튜디오 B']],
    ['video', ['컴퓨터실', '스튜디오 A']],
  ] as const)('renders two spaces for %s', (track, labels) => {
    const wrapper = mount(DepartmentSpacePhotos, { props: { track } })
    const cards = wrapper.findAll('[data-department-space-photo]')

    expect(cards).toHaveLength(2)
    expect(cards.map(card => card.get('figcaption strong').text())).toEqual(labels)
    expect(cards.every(card => card.get('img').attributes('loading') === 'lazy')).toBe(true)
  })
})
