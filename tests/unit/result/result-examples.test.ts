import { describe, expect, it } from 'vitest'
import { trackKeys } from '../../../shared/types/domain'
import { resultExamplesFor } from '../../../shared/content/result-examples'

describe('result example catalog', () => {
  it.each(trackKeys)('%s 전문분야와 포트폴리오 예시를 각각 3개 제공한다', (track) => {
    for (const kind of ['specialty', 'portfolio'] as const) {
      const examples = resultExamplesFor(track, kind)
      expect(examples).toHaveLength(3)
      expect(new Set(examples.map(item => item.key)).size).toBe(3)
      expect(examples.every(item => item.title && item.description && item.visualKey)).toBe(true)
    }
  })

  it('영상 트랙에 AI·편집·드론 예시를 제공한다', () => {
    expect(resultExamplesFor('video', 'specialty').map(item => item.title))
      .toEqual(['영상편집·색보정', 'AI 이미지·영상', '드론·360 콘텐츠'])
  })
})
