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

  it('keeps the video route editing courses in year two', () => {
    expect(curriculumRoutes.video.stages[1]!.items).toEqual([
      '내러티브 영상촬영',
      '비주얼 스토리 메이킹',
      '영상 컬러와 포스트 프로덕션',
      '영상드론기초',
    ])
  })

  it('uses the art photography workshop and lab in video year four and keeps a safe fallback', () => {
    expect(curriculumRoutes.video.stages[3]!.kind).toBe('course')
    expect(curriculumRoutes.video.stages[3]!.items).toEqual([
      '예술사진 워크숍',
      '예술사진 랩',
    ])
    expect(resolveCurriculumTrack('unknown')).toBe('video')
  })
})
