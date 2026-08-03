import { expect, it } from 'vitest'
import {
  hasStandaloneExternalResource,
  renderCurriculumRoutesHtml,
} from '../../../shared/content/curriculum-routes-html'

it('renders a standalone self-contained four-track document', () => {
  const html = renderCurriculumRoutesHtml()

  expect(html).toContain('영상 드론 콘텐츠 워크숍')
  expect(html).toContain('커머셜 포토그라피 랩')
  expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive">')
  expect(html).not.toMatch(/<(?:link|script|img)\b[^>]*\b(?:href|src)\s*=/iu)
  expect(hasStandaloneExternalResource(html)).toBe(false)
})

it.each([
  '<link rel="stylesheet" href="https://cdn.example.com/routes.css">',
  '<script src="/routes.js"></script>',
  '<img src="https://cdn.example.com/poster.webp" alt="">',
])('recognizes external standalone resource markup: %s', (markup) => {
  expect(hasStandaloneExternalResource(markup)).toBe(true)
})
