import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { trackKeys } from '../../../shared/types/domain'
import { departmentPhotosByTrack, landingDepartmentPhotos } from '../../../shared/content/department-photos'

describe('department photo catalog', () => {
  it('provides four event-shooting landing photos and exactly two approved spaces per track', () => {
    expect(landingDepartmentPhotos.map(photo => photo.src)).toEqual([
      '/images/department/event-shooting-1.webp',
      '/images/department/event-shooting-2.webp',
      '/images/department/event-shooting-3.webp',
      '/images/department/event-shooting-4.webp',
    ])
    for (const photo of landingDepartmentPhotos) {
      expect(photo.alt.trim()).not.toBe('')
      expect(photo.label.trim()).not.toBe('')
      expect(photo.description.trim()).not.toBe('')
      expect(existsSync(join(process.cwd(), 'public', photo.src))).toBe(true)
    }
    for (const track of trackKeys) {
      expect(departmentPhotosByTrack[track]).toHaveLength(2)
      for (const photo of departmentPhotosByTrack[track]) {
        expect(photo.alt.trim()).not.toBe('')
        expect(photo.label.trim()).not.toBe('')
        expect(photo.description.trim()).not.toBe('')
        expect(existsSync(join(process.cwd(), 'public', photo.src))).toBe(true)
      }
    }
  })

  it('uses the approved A-plan mapping', () => {
    expect(departmentPhotosByTrack.documentary.map(photo => photo.label)).toEqual(['학과 암실', '프린트랩'])
    expect(departmentPhotosByTrack.art_photo.map(photo => photo.label)).toEqual(['학과 암실', '프린트랩'])
    expect(departmentPhotosByTrack.commercial.map(photo => photo.label)).toEqual(['스튜디오 A', '스튜디오 B'])
    expect(departmentPhotosByTrack.video.map(photo => photo.label)).toEqual(['컴퓨터실', '스튜디오 A'])
  })
})
