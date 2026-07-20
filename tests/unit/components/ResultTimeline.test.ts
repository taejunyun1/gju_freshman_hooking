import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  makeEmptyResultSnapshot,
  makeResultSnapshot,
  resultPublicId,
} from '../../fixtures/result'
import type { ResultSnapshot } from '../../../shared/types/result'

const mountTimeline = async (snapshot: ResultSnapshot = makeResultSnapshot()) => {
  const { default: ResultTimeline } = await import('../../../app/components/result/ResultTimeline.vue')
  return mount(ResultTimeline, {
    props: { resultPublicId, snapshot },
  })
}

const resultComponentSource = () => {
  const directory = 'app/components/result'
  const files = readdirSync(directory, { encoding: 'utf8', recursive: true })
    .filter(file => file.endsWith('.vue'))
  return files.map(file => readFileSync(join(directory, file), 'utf8')).join('\n')
}

const trackScoreSource = () => readFileSync('app/components/result/TrackScore.vue', 'utf8')

describe('result master sequence', () => {
  beforeEach(() => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ data: { accepted: true }, requestId: 'request-id' }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['matched', makeResultSnapshot()],
    ['empty', makeEmptyResultSnapshot()],
  ])('keeps the locked content hierarchy for a %s snapshot', async (_kind, snapshot) => {
    const wrapper = await mountTimeline(snapshot)

    expect(wrapper.findAll('[data-result-section]').map(section => (
      section.attributes('data-result-section')
    ))).toEqual([
      'summary',
      'interests',
      'scores',
      'learning-path',
      'faculty',
      'career-narrative',
      'outcomes',
      'capability-evidence',
      'counseling',
    ])
    expect(wrapper.get('h1').text()).toBe('선택한 관심사는 4년 동안 이렇게 이어집니다')
  })

  it('introduces the result with the official department name before the track summary', async () => {
    const wrapper = await mountTimeline()

    expect(wrapper.text()).toContain(
      '선택한 관심사가 광주대학교 사진영상미디어학과의 교과와 프로젝트를 거쳐 어떤 작업과 진로로 이어지는지 확인해 보세요.',
    )
    expect(wrapper.get('[data-result-section="summary"]').text()).toContain('광고사진 경로와 가장 높은 연결을 보입니다.')
  })

  it('renders selected interests as read-only clips labelled by group', async () => {
    const wrapper = await mountTimeline()
    const clips = wrapper.findAll('[data-interest-clip]')

    expect(clips).toHaveLength(4)
    expect(clips.map(clip => clip.attributes('data-interest-group'))).toEqual([
      'work',
      'result',
      'style',
      'career',
    ])
    for (const clip of clips) {
      expect(clip.find('[data-interest-group-label]').text()).not.toBe('')
      expect(clip.findAll('input, textarea, select, button')).toHaveLength(0)
    }
  })

  it('uses one semantic year list for mobile and desktop with four explicit stages', async () => {
    const wrapper = await mountTimeline()
    const yearLists = wrapper.findAll('ol[data-learning-years]')
    const years = wrapper.findAll('[data-learning-year]')
    const source = resultComponentSource()

    expect(yearLists).toHaveLength(1)
    expect(years).toHaveLength(4)
    expect(years.map(year => year.attributes('data-learning-year'))).toEqual(['1', '2', '3', '4'])
    expect(years.map(year => year.get('[data-year-title]').text())).toEqual([
      '1Y 기초',
      '2Y 제작·후반',
      '3Y 전공심화·프로젝트',
      '4Y 캡스톤·포트폴리오',
    ])
    expect(source).toMatch(/@media\s*\(min-width:\s*1024px\)/u)
    expect(source).toMatch(/\.learning-path__experience\s*\{\s*grid-column:\s*1\s*\/\s*-1/u)
  })

  it('keeps empty years explicit instead of inventing recommendations', async () => {
    const wrapper = await mountTimeline(makeEmptyResultSnapshot())

    expect(wrapper.findAll('[data-learning-year]')).toHaveLength(4)
    for (const year of wrapper.findAll('[data-learning-year]')) {
      expect(year.text()).toContain('확인된 학과 데이터를 준비 중입니다')
    }
    expect(wrapper.get('[data-result-section="outcomes"]').text()).toContain(
      '확인된 학과 데이터를 준비 중입니다',
    )
    expect(wrapper.get('[data-result-section="capability-evidence"]').text()).toContain(
      '확인된 학과 데이터를 준비 중입니다',
    )
    expect(wrapper.text()).not.toMatch(/추천 수업 없음|임시 추천/u)
  })

  it('keeps three portfolio examples visible when verified outcome resources are empty', async () => {
    const wrapper = await mountTimeline(makeEmptyResultSnapshot())
    const outcomes = wrapper.get('[data-result-section="outcomes"]')

    expect(outcomes.findAll('[data-result-example-kind="portfolio"] [data-result-example]')).toHaveLength(3)
    expect(outcomes.get('[data-result-example-kind="portfolio"]').text()).toContain('관심사 기반 예시')
    expect(outcomes.get('[data-result-example-kind="portfolio"]').text()).toContain('제품 광고 이미지')
    expect(outcomes.text()).toContain('확인된 학과 데이터를 준비 중입니다')
  })

  it('shows course metadata and prioritizes 2026 projects ahead of accumulated experience', async () => {
    const raw = JSON.parse(JSON.stringify(makeResultSnapshot())) as unknown as {
      resources: {
        project: Array<{
          id: number
          title: string
          connectionReason: string
          displayMetadata: Record<string, unknown>
        }>
      }
    }
    const currentProject = raw.resources.project[0]!
    raw.resources.project.push({
      ...currentProject,
      id: 303,
      title: '2025 제주 수중드론·360VR 촬영 워크숍',
      connectionReason: '선택한 ‘제품·패션·광고 이미지 만들기’ 관심이 2025 제주 수중드론·360VR 촬영 워크숍에서 실제 제작 결과물로 이어집니다.',
      displayMetadata: {
        displayTier: 'experience',
        projectYear: 2025,
        periodLabel: '2025년 여름',
        statusLabel: '운영 완료',
        programGroup: '이전 운영 경험',
      },
    })
    const wrapper = await mountTimeline(raw as unknown as ResultSnapshot)
    const firstCourse = wrapper.get('[data-course-resource="101"]')
    const project = wrapper.get('[data-project-resource="302"]')
    const learningPath = wrapper.get('[data-result-section="learning-path"]')

    expect(firstCourse.text()).toContain('기초사진실기')
    expect(firstCourse.text()).toContain('1학기')
    expect(firstCourse.text()).toContain('3학점')
    expect(firstCourse.text()).toContain('선택한 ‘제품·패션·광고 이미지 만들기’ 관심이 기초사진실기')
    expect(firstCourse.get('time').attributes('datetime')).toBe('2026-07-14')
    expect(learningPath.get('[data-project-lane]').text()).toContain('2026 진행·예정 프로그램')
    expect(learningPath.get('[data-project-experience]').text()).toContain('학과가 축적한 경험')
    expect(learningPath.get('[data-project-experience]').text()).toContain('2025 제주 수중드론·360VR 촬영 워크숍')
    expect(project.text()).toContain('지역 브랜드 캠페인 프로젝트')
    expect(project.text()).toContain('2026년 2학기')
    expect(project.text()).toContain('예정')
    expect(project.get('time').attributes('datetime')).toBe('2026-07-14')
    expect(project.element.closest('[data-learning-year]')).toBeNull()
  })

  it('leads with works and careers before quieter capability evidence', async () => {
    const wrapper = await mountTimeline()
    const outcomes = wrapper.get('[data-result-section="outcomes"]')
    const capability = wrapper.get('[data-result-section="capability-evidence"]')

    expect(outcomes.text()).toContain('이 경로에서 만들어볼 결과물')
    expect(outcomes.text()).toContain('광고사진 포트폴리오')
    expect(outcomes.text()).toContain('상업사진가·브랜드 이미지 제작자')
    expect(capability.text()).toContain('이 제작을 가능하게 하는 학과 기반')
    const orderedSections = wrapper.findAll('[data-result-section]').map(section => (
      section.attributes('data-result-section')
    ))
    expect(orderedSections.indexOf('outcomes')).toBeLessThan(orderedSections.indexOf('capability-evidence'))
    expect(wrapper.find('ol[data-learning-years] [data-capability-evidence]').exists()).toBe(false)
  })

  it('shows interest-based examples for specialty and portfolio paths', async () => {
    const wrapper = await mountTimeline()

    expect(wrapper.findAll('[data-result-example-kind="specialty"] [data-result-example]')).toHaveLength(3)
    expect(wrapper.findAll('[data-result-example-kind="portfolio"] [data-result-example]')).toHaveLength(3)
    expect(wrapper.get('[data-result-example-kind="portfolio"]').text()).toContain('관심사 기반 예시')
    expect(wrapper.get('[data-result-example-kind="portfolio"]').text()).toContain('제품 광고 이미지')
    expect(wrapper.findAll('[data-selection-graphic]')).not.toHaveLength(0)
  })

  it('shows featured capability items initially and at most four with correct disclosure ARIA', async () => {
    const wrapper = await mountTimeline()
    const button = wrapper.get('[data-testid="capability-more"]')
    const controlledId = button.attributes('aria-controls')

    expect(wrapper.findAll('[data-capability-evidence]')).toHaveLength(3)
    expect(button.text()).toBe('학과 기반 더보기')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(controlledId).toBeTruthy()
    expect(wrapper.get(`#${controlledId}`).exists()).toBe(true)

    await button.trigger('click')

    expect(button.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('[data-capability-evidence]')).toHaveLength(4)
  })

  it('features one facility, body, and lens in that order before remaining evidence', async () => {
    const raw = JSON.parse(JSON.stringify(makeResultSnapshot())) as unknown as {
      resources: {
        equipment: Array<{ affinity: number }>
        facility: Array<{ affinity: number }>
      }
    }
    raw.resources.facility[0]!.affinity = 95
    raw.resources.equipment[0]!.affinity = 90

    const wrapper = await mountTimeline(raw as unknown as ResultSnapshot)
    const collapsed = wrapper.findAll('[data-capability-evidence]')

    expect(collapsed).toHaveLength(3)
    expect(collapsed.map(item => item.attributes('data-capability-kind')))
      .toEqual(['facility', 'body', 'lens'])
    expect(collapsed[0]!.text()).toContain('스튜디오 A(호리존)')
    expect(collapsed[1]!.text()).toContain('소니 FX3 Body')
    expect(collapsed[2]!.text()).toContain('소니 FE 24-70mm F2.8 Lens')
    expect(wrapper.get('[data-testid="capability-more"]').text()).toBe('학과 기반 더보기')
  })

  it('allowlists capability display fields and sends the exact resource-open event', async () => {
    const raw = JSON.parse(JSON.stringify(makeResultSnapshot())) as ResultSnapshot & {
      resources: ResultSnapshot['resources'] & {
        equipment: Array<ResultSnapshot['resources']['equipment'][number] & {
          inventoryCode?: string
          sourceRow?: string
        }>
      }
    }
    raw.resources.equipment[0]!.inventoryCode = 'PH-SECRET-001'
    raw.resources.equipment[0]!.sourceRow = 'private spreadsheet row 72'
    const send = vi.fn().mockResolvedValue({ data: { accepted: true }, requestId: 'request-id' })
    vi.stubGlobal('$fetch', send)
    const wrapper = await mountTimeline(raw)
    const reservation = wrapper.get('a[href="https://gjureserve.co.kr"]')

    expect(wrapper.text()).toContain('사진영상미디어학과 기자재실')
    expect(wrapper.text()).toContain('2대')
    expect(wrapper.text()).toContain('예약 가능')
    expect(wrapper.text()).not.toMatch(/PH-SECRET-001|private spreadsheet row 72/u)
    expect(reservation.attributes('target')).toBe('_blank')
    expect(reservation.attributes('rel')?.split(/\s+/u).sort()).toEqual(['noopener', 'noreferrer'])
    expect(reservation.text()).toContain('새 창')

    await reservation.trigger('click')

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('/api/events', {
      method: 'POST',
      body: {
        eventName: 'resource_opened',
        resultPublicId,
        resourceId: 201,
        resourceType: 'equipment',
      },
    })
    expect(JSON.stringify(send.mock.calls[0])).not.toMatch(
      /assessmentId|connectionReason|selectedInterests|inventoryCode|faculty|tjyun/u,
    )
  })

  it('uses exact faculty roles, renders public contacts, and never claims assignment', async () => {
    const wrapper = await mountTimeline()
    const faculty = wrapper.get('[data-result-section="faculty"]')

    expect(faculty.findAll('[data-faculty-role]').map(role => role.text())).toEqual([
      '추천 총괄교수',
      '예비 상담교수',
      '함께 연결되는 실무·창작 강사',
    ])
    expect(faculty.get('a[href="tel:062-670-2338"]').exists()).toBe(true)
    expect(faculty.get('a[href="mailto:tjyun@gwangju.ac.kr"]').exists()).toBe(true)
    expect(faculty.get('a[href="https://www.taejunyun.com"]').exists()).toBe(true)
    expect(faculty.get('[data-faculty-person="701"] h4').text()).toBe('윤태준 교수')
    expect(faculty.text()).not.toMatch(/배정 완료|자동 배정/u)
    expect(wrapper.get('[data-result-section="counseling"]').text()).toContain(
      '관리자가 실제 상담교수를 최종 배정',
    )
  })

  it('describes every score with text and renders one decorative reduced-motion-safe playhead', async () => {
    const wrapper = await mountTimeline()
    const scores = wrapper.get('[data-result-section="scores"]')
    const playheads = wrapper.findAll('[data-playhead]')
    const ruler = wrapper.get('[data-sequence-ruler]')
    const source = resultComponentSource()
    const reducedMotionStart = source.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/u)
    const reducedMotionCss = reducedMotionStart < 0 ? '' : source.slice(reducedMotionStart)
    const durations = [...source.matchAll(/(\d+)ms/gu)].map(match => Number(match[1]))

    expect(scores.text()).toContain('광고사진')
    expect(scores.text()).toContain('100점')
    expect(scores.text()).toContain('교육환경 연결도')
    expect(scores.text()).toContain('92.3점')
    expect(playheads).toHaveLength(1)
    expect(playheads[0]!.attributes('aria-hidden')).toBe('true')
    expect(ruler.text()).toContain('IN')
    expect(ruler.text()).toContain('OUT')
    expect(durations.length).toBeGreaterThan(0)
    expect(Math.max(...durations)).toBeLessThanOrEqual(500)
    expect(source).toContain('160ms')
    expect(reducedMotionCss).toMatch(/animation(?:-duration)?:\s*(?:none|0m?s)/u)
    expect(reducedMotionCss).toMatch(/transition(?:-duration)?:\s*(?:none|0m?s)/u)
    expect(source).not.toContain('100vw')
    expect(source).toMatch(/left:\s*calc\(100%\s*-\s*3\.1rem\)/u)
  })

  it('stacks score labels at 320px so fixed minimum columns cannot overflow', () => {
    const source = trackScoreSource()
    const mobileRule = source.slice(source.search(/@media\s*\(max-width:\s*20rem\)/u))

    expect(mobileRule).toMatch(/\.track-score__tracks\s*>\s*div\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/u)
    expect(mobileRule).not.toContain('minmax(7.5rem, 1fr)')
  })

  it('keeps long Korean labels, titles, reasons, and public contacts inside their tracks', async () => {
    const raw = JSON.parse(JSON.stringify(makeResultSnapshot())) as unknown as {
      selectedInterests: Array<{ label: string }>
      faculty: {
        primary: {
          name: string
          publicContacts: { email: string }
        }
      }
      resources: {
        course: Array<{ title: string, connectionReason: string }>
      }
      learningPath: Array<{ resources: Array<{ title: string, connectionReason: string }> }>
    }
    const longLabel = '긴관심사문구'.repeat(20)
    const longTitle = '긴교과목이름'.repeat(20)
    const longReason = '긴연결이유'.repeat(30)
    const longEmail = `${'longaddress'.repeat(12)}@example.com`
    raw.selectedInterests[0]!.label = longLabel
    raw.resources.course[0]!.title = longTitle
    raw.resources.course[0]!.connectionReason = longReason
    raw.learningPath[0]!.resources[0]!.title = longTitle
    raw.learningPath[0]!.resources[0]!.connectionReason = longReason
    raw.faculty.primary.name = longTitle
    raw.faculty.primary.publicContacts.email = longEmail

    const wrapper = await mountTimeline(raw as unknown as ResultSnapshot)
    const source = resultComponentSource()

    expect(wrapper.text()).toContain(longLabel)
    expect(wrapper.text()).toContain(longTitle)
    expect(wrapper.text()).toContain(longReason)
    expect(wrapper.get(`a[href="mailto:${longEmail}"]`).exists()).toBe(true)
    expect(source.match(/overflow-wrap:\s*anywhere/gu)?.length ?? 0).toBeGreaterThanOrEqual(5)
  })
})
