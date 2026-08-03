import { describe, expect, it } from 'vitest'
import {
  curriculumRoutes,
  curriculumTrackOrder,
  resolveCurriculumTrack,
} from '../../../shared/content/curriculum-routes'

describe('four-year curriculum routes', () => {
  it('keeps four tracks and their confirmed senior courses', () => {
    expect(curriculumTrackOrder).toEqual(['video', 'art_photo', 'documentary', 'commercial'])
    expect(curriculumRoutes.documentary.stages[2]!.items).toContain('포토 스토리 워크숍')
    expect(curriculumRoutes.art_photo.stages[3]!.items).toContain('예술창작 프로젝트 랩')
    expect(curriculumRoutes.commercial.stages[3]!.items).toContain('커머셜 포토그라피 랩')
  })

  it('uses a non-course video fourth-year outcome and a safe fallback', () => {
    expect(curriculumRoutes.video.stages[3]!.kind).toBe('outcome')
    expect(resolveCurriculumTrack('unknown')).toBe('video')
  })
})
