import { expect, it } from 'vitest'
import { renderCurriculumRoutesHtml } from '../../../shared/content/curriculum-routes-html'

it('renders a standalone self-contained four-track document', () => {
  const html = renderCurriculumRoutesHtml()

  expect(html).toContain('영상 드론 콘텐츠 워크숍')
  expect(html).toContain('커머셜 포토그라피 랩')
  expect(html).not.toMatch(/<(link|script)\\s+[^>]+src=/iu)
})
