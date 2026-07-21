import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import DepartmentPhotoRotator from '../../../app/components/common/DepartmentPhotoRotator.vue'
import { landingDepartmentPhotos } from '../../../shared/content/department-photos'

function stubReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches }),
  })
}

describe('DepartmentPhotoRotator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubReducedMotion(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps exactly one eager-loading event photo in the DOM and advances every five seconds', async () => {
    const wrapper = mount(DepartmentPhotoRotator, { props: { photos: landingDepartmentPhotos } })

    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(wrapper.get('img').attributes()).toMatchObject({
      src: landingDepartmentPhotos[0].src,
      loading: 'eager',
    })

    vi.advanceTimersByTime(5_000)
    await nextTick()

    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(wrapper.get('img').attributes('src')).toBe(landingDepartmentPhotos[1].src)
  })

  it('offers labelled previous, next, position, and pause controls', async () => {
    const wrapper = mount(DepartmentPhotoRotator, { props: { photos: landingDepartmentPhotos } })

    expect(wrapper.get('[aria-label="이전 행사 사진 보기"]').element.tagName).toBe('BUTTON')
    expect(wrapper.get('[aria-label="다음 행사 사진 보기"]').element.tagName).toBe('BUTTON')
    expect(wrapper.findAll('[data-photo-position]')).toHaveLength(4)
    expect(wrapper.get('[data-photo-position="1"]').attributes('aria-current')).toBe('true')

    await wrapper.get('[aria-label="다음 행사 사진 보기"]').trigger('click')
    expect(wrapper.get('img').attributes('src')).toBe(landingDepartmentPhotos[1].src)

    await wrapper.get('[aria-label="이전 행사 사진 보기"]').trigger('click')
    expect(wrapper.get('img').attributes('src')).toBe(landingDepartmentPhotos[0].src)

    await wrapper.get('[aria-label="사진 자동 전환 일시정지"]').trigger('click')
    vi.advanceTimersByTime(10_000)
    await nextTick()

    expect(wrapper.get('img').attributes('src')).toBe(landingDepartmentPhotos[0].src)
    expect(wrapper.get('[aria-label="사진 자동 전환 재생"]').attributes('aria-pressed')).toBe('true')
  })

  it('does not start automatic rotation when reduced motion is preferred', async () => {
    stubReducedMotion(true)
    const wrapper = mount(DepartmentPhotoRotator, { props: { photos: landingDepartmentPhotos } })

    vi.advanceTimersByTime(10_000)
    await nextTick()

    expect(wrapper.get('img').attributes('src')).toBe(landingDepartmentPhotos[0].src)
    expect(wrapper.get('[aria-label="사진 자동 전환 재생"]').attributes('aria-pressed')).toBe('true')
  })
})
