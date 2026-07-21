import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ResourceCard from '../../../app/components/result/ResourceCard.vue'
import { trackLabels } from '../../../shared/types/domain'
import type { CourseResultResource, ProjectResultResource } from '../../../shared/types/result'

const course = (requirementType?: 'major_required' | 'major_elective'): CourseResultResource => ({
  id: 101,
  type: 'course',
  title: '라이팅과 스튜디오',
  summary: '글쓰기와 이미지 제작의 기초를 다루는 수업입니다.',
  sourceDate: '2026-07-21',
  affinity: 90,
  primaryTag: 'commercial',
  connectionReason: '라이팅과 스튜디오는 선택한 관심을 실제 제작으로 연결합니다.',
  displayMetadata: {
    gradeYear: 1,
    term: '2학기',
    credits: 3,
    ...(requirementType ? { requirementType } : {}),
  },
})

const project = (
  primaryTag = 'documentary',
  displayMetadata: ProjectResultResource['displayMetadata'] = {
    displayTier: 'current',
    projectYear: 2026,
    periodLabel: '2026нян 2хагас',
    statusLabel: 'явагдах товтой',
    programGroup: 'RISE төсөл',
    category: 'контент хөгжүүлэлт',
    activities: 'орон нутгийн судалгаа, ярилцлага, гэрэл зураг, видео зураг авалт',
    outcomes: 'орон нутгийн бичлэгийн үзэсгэлэн, богино хэмжээний баримтат кино',
    locations: '5·18 Ардчилсан хөдөлгөөний архив·Жеонил барилга 245',
  },
): ProjectResultResource => ({
  id: 302,
  type: 'project',
  title: 'Гванжүгийн орон нутгийн бичлэгийн төсөл',
  summary: 'Гэрэл зураг, видеогоор хүмүүс, газар судалж, баримтжуулах төсөл.',
  sourceDate: '2026-07-21',
  affinity: 92,
  primaryTag,
  connectionReason: 'Баримтат гэрэл зургийн сонгосон сонирхлыг тухайн газар дээр бичих замаар холбож болно.',
  displayMetadata,
})

describe('course requirement badge', () => {
  it('shows a text major-required badge beside the course type', () => {
    const wrapper = mount(ResourceCard, {
      props: { resource: course('major_required'), variant: 'course' },
    })

    expect(wrapper.get('[data-course-requirement="major_required"]').text()).toContain('전공필수')
    expect(wrapper.get('.resource-card__course-type').text()).toContain('COURSE')
  })

  it.each(['major_elective', undefined] as const)(
    'does not show a requirement badge for %s course metadata',
    (requirementType) => {
      const wrapper = mount(ResourceCard, {
        props: { resource: course(requirementType), variant: 'course' },
      })

      expect(wrapper.find('[data-course-requirement]').exists()).toBe(false)
    },
  )
})

describe('project disclosure card', () => {
  it('keeps the project collapsed while showing its category, title, summary, status, and period', () => {
    const wrapper = mount(ResourceCard, {
      props: { resource: project(), variant: 'project' },
    })

    const disclosure = wrapper.get('details[data-project-resource="302"]')
    const summary = disclosure.get('summary')
    expect(disclosure.attributes('open')).toBeUndefined()
    expect(summary.attributes('aria-label')).toBe('Гванжүгийн орон нутгийн бичлэгийн төсөл 상세 보기')
    expect(summary.text()).toContain(trackLabels.documentary)
    expect(summary.text()).toContain('Гванжүгийн орон нутгийн бичлэгийн төсөл')
    expect(summary.text()).toContain('хүмүүс, газар судалж')
    expect(summary.text()).toContain('явагдах товтой')
    expect(summary.text()).toContain('2026нян 2хагас')
  })

  it('shows original project facts and the connection reason only in the disclosure body', () => {
    const wrapper = mount(ResourceCard, {
      props: { resource: project(), variant: 'project-experience' },
    })

    const body = wrapper.get('[data-project-details]')
    expect(body.text()).toContain('\uD504\uB85C\uADF8\uB7A8 \uD615\uD0DC')
    expect(body.text()).toContain('контент хөгжүүлэлт')
    expect(body.text()).toContain('\uD559\uC0DD \uD65C\uB3D9')
    expect(body.text()).toContain('орон нутгийн судалгаа, ярилцлага')
    expect(body.text()).toContain('\uACB0\uACFC\uBB3C')
    expect(body.text()).toContain('орон нутгийн бичлэгийн үзэсгэлэн')
    expect(body.text()).toContain('\uCC38\uC5EC \uAE30\uAD00\u00B7\uC7A5\uC18C')
    expect(body.text()).toContain('5·18 Ардчилсан хөдөлгөөний архив')
    expect(body.text()).toContain('Баримтат гэрэл зургийн сонгосон сонирхлыг')
  })

  it('hides absent detail rows and labels an unknown primary tag as a convergence project', () => {
    const wrapper = mount(ResourceCard, {
      props: {
        resource: project('location_signal', {
          displayTier: 'experience',
          projectYear: 2025,
        }),
        variant: 'project-experience',
      },
    })

    expect(wrapper.get('[data-project-track-badge]').text()).toBe('\uC735\uD569 \uD504\uB85C\uC81D\uD2B8')
    expect(wrapper.find('[data-project-facts]').exists()).toBe(false)
  })

  it('keeps non-project resources on the existing article rendering path', () => {
    const wrapper = mount(ResourceCard, {
      props: { resource: course('major_required'), variant: 'course' },
    })

    expect(wrapper.get('article[data-course-resource="101"]').exists()).toBe(true)
    expect(wrapper.find('details').exists()).toBe(false)
  })

  it('provides a 44px summary target, visible keyboard focus, and overflow-safe text', () => {
    const source = readFileSync('app/components/result/ResourceCard.vue', 'utf8')
    expect(source).toMatch(/resource-card__project-summary[\s\S]*min-height:\s*(?:44px|2\.75rem)/u)
    expect(source).toMatch(/resource-card__project-summary:focus-visible[\s\S]*outline:/u)
    expect(source).toMatch(/resource-card__project-summary[\s\S]*min-width:\s*0/u)
    expect(source).toMatch(/resource-card__project-title[\s\S]*overflow-wrap:\s*anywhere/u)
    expect(source).toMatch(/resource-card__project-topline[\s\S]*color:\s*color-mix\(in srgb, var\(--color-ink\) 72%, transparent\)/u)
  })
})
