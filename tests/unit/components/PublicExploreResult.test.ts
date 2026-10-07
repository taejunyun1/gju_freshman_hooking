import { existsSync, readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { makeEmptyResultSnapshot, makeResultSnapshot } from '../../fixtures/result'
import PublicExploreResult from '../../../app/components/result/PublicExploreResult.vue'
import { publicDepartmentStories, departmentFacultyImages } from '../../../shared/content/public-department-stories'
import type { ResultSnapshot } from '../../../shared/types/result'

describe('visual public exploration result', () => {
  it('keeps one personalized four-year route and every recommended course', () => {
    const snapshot = makeResultSnapshot()
    const wrapper = mount(PublicExploreResult, { props: { snapshot } })
    expect(wrapper.findAll('[data-public-year]')).toHaveLength(4)
    for (const year of snapshot.learningPath) {
      const card = wrapper.get(`[data-public-year="${year.year}"]`)
      for (const course of year.resources) expect(card.text()).toContain(course.title)
      expect(card.get('details').attributes('open')).toBeUndefined()
    }
    expect(wrapper.find('[data-curriculum-route-explorer]').exists()).toBe(false)
    expect(wrapper.findAll('[data-homepage-activity]')).toHaveLength(2)
    expect(wrapper.findAll('[data-homepage-alumnus]')).toHaveLength(2)
    expect(wrapper.findAll('img').every(image => image.attributes('alt'))).toBe(true)
  })

  it('retains required badges and the existing faculty recommendations, with two small support cards at most', () => {
    const source = makeResultSnapshot()
    const snapshot = {
      ...source,
      learningPath: source.learningPath.map(year => ({ ...year, resources: year.resources.map(course => ({ ...course, displayMetadata: { ...course.displayMetadata, requirementType: 'major_required' } })) })),
      faculty: { ...source.faculty, specialists: Array.from({ length: 4 }, (_, index) => ({ ...source.faculty.specialists[0]!, id: 800 + index })) },
    } as ResultSnapshot
    const wrapper = mount(PublicExploreResult, { props: { snapshot } })
    expect(wrapper.findAll('[data-required-course]')).toHaveLength(4)
    expect(wrapper.get('[data-public-faculty="primary"]').text()).toContain(source.faculty.primary.name)
    expect(wrapper.get('[data-public-faculty="backup"]').text()).toContain(source.faculty.backup.name)
    expect(wrapper.findAll('[data-public-specialist]')).toHaveLength(2)
    expect(wrapper.get('[data-recommendation-details]').attributes('open')).toBeUndefined()
  })

  it('keeps empty curriculum explicit without substituting editorial stories for recommendations', () => {
    const wrapper = mount(PublicExploreResult, { props: { snapshot: makeEmptyResultSnapshot() } })
    expect(wrapper.findAll('[data-public-year]')).toHaveLength(4)
    expect(wrapper.text()).toContain('교과 정보를 준비 중입니다')
    expect(wrapper.text()).toContain('학과 홈페이지에 공개된 활동 사례')
  })

  it.each(Object.keys(publicDepartmentStories) as Array<keyof typeof publicDepartmentStories>)('has two verified-source stories and alumni for %s, with local images and official outlinks', (track) => {
    const content = publicDepartmentStories[track]
    expect(content.activities).toHaveLength(2)
    expect(content.alumni).toHaveLength(2)
    for (const item of [content.hero, ...content.activities, ...content.alumni]) {
      expect(existsSync(`public${item.image}`)).toBe(true)
      expect(item.href).toMatch(/^https:\/\/gjuphoto\.com\//)
      expect(item.alt.length).toBeGreaterThan(3)
    }
    for (const path of Object.values(departmentFacultyImages)) expect(existsSync(`public${path}`)).toBe(true)
  })

  it('changes only the public view and makes no extra API calls for homepage content', () => {
    const page = readFileSync('app/pages/explore.vue', 'utf8')
    const component = readFileSync('app/components/result/PublicExploreResult.vue', 'utf8')
    expect(page).toContain('<PublicExploreResult')
    expect(page).not.toContain('<ResultTimeline')
    expect(component).not.toMatch(/\$fetch|fetch\(|localStorage|sessionStorage/)
    expect(component).toContain('loading="lazy"')
  })
})
