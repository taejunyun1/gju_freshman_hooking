import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DepartmentPhotoCard from '../../../app/components/common/DepartmentPhotoCard.vue'
import { landingDepartmentPhoto as photo } from '../../../shared/content/department-photos'

describe('DepartmentPhotoCard', () => {
  it('renders the provided photo with accessible image metadata', () => {
    const wrapper = mount(DepartmentPhotoCard, { props: { photo, loading: 'lazy' } })

    expect(wrapper.get('img').attributes()).toMatchObject({
      src: photo.src,
      alt: photo.alt,
      loading: 'lazy',
      decoding: 'async',
      width: String(photo.width),
      height: String(photo.height),
    })
  })

  it('keeps the text caption when the image fails to load', async () => {
    const wrapper = mount(DepartmentPhotoCard, { props: { photo } })

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain(photo.label)
  })
})
