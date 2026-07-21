import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { studentCounselingStatusSchema } from '../../../shared/schemas/counseling'

const assessmentPublicId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const currentRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  assessmentPublicId,
  status: 'new',
  contactMethod: 'phone',
  availability: 'weekday_afternoon',
  inquiry: '포트폴리오 준비가 궁금합니다.',
  consentedAt: '2026-07-15T01:00:00.000Z',
  assignedAt: null,
  contactedAt: null,
  completedAt: null,
  closedAt: null,
  version: 0,
  createdAt: '2026-07-15T01:00:00.000Z',
  updatedAt: '2026-07-15T01:00:00.000Z',
  assignedFaculty: null,
  recommendations: [
    {
      name: '윤태준',
      title: '교수',
      expertise: '현대예술·영상촬영',
      reason: '영상과 예술사진 관심을 연결합니다.',
      role: 'primary',
      rank: 1,
    },
    {
      name: '조대연',
      title: '교수',
      expertise: '포토커뮤니케이션·다큐멘터리',
      reason: '기록 분야를 함께 살펴봅니다.',
      role: 'backup',
      rank: 1,
    },
  ],
  ...overrides,
})

describe('CounselingForm', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('requires explicit transfer consent after valid default choices', async () => {
    const { default: CounselingForm } = await import(
      '../../../app/components/counseling/CounselingForm.vue'
    )
    const wrapper = mount(CounselingForm, { props: { assessmentPublicId } })
    const submit = wrapper.get('button[type="submit"]')

    expect(wrapper.findAll('input[name="contactMethod"]')).toHaveLength(3)
    expect(wrapper.findAll('input[name="availability"]')).toHaveLength(4)
    expect(submit.attributes('disabled')).toBeDefined()

    await wrapper.get('input[name="consent"]').setValue(true)

    expect(submit.attributes('disabled')).toBeUndefined()
  })

  it('introduces counseling with the official department name before contact instructions', async () => {
    const { default: CounselingForm } = await import(
      '../../../app/components/counseling/CounselingForm.vue'
    )
    const wrapper = mount(CounselingForm, { props: { assessmentPublicId } })

    expect(wrapper.text()).toContain('광주대학교 사진영상미디어학과 상담으로 관심 경로를 이어갑니다.')
    expect(wrapper.get('.counseling-form__heading').text()).toContain('연락받기 편한 방법과 시간을 알려주세요.')
  })

  it('shows the 200-character limit and live counter', async () => {
    const { default: CounselingForm } = await import(
      '../../../app/components/counseling/CounselingForm.vue'
    )
    const wrapper = mount(CounselingForm, { props: { assessmentPublicId } })
    const inquiry = wrapper.get('textarea[name="inquiry"]')

    expect(inquiry.attributes('maxlength')).toBe('200')
    expect(wrapper.get('[data-testid="inquiry-counter"]').text()).toBe('0 / 200')

    await inquiry.setValue('사진과 영상 포트폴리오')

    expect(wrapper.get('[data-testid="inquiry-counter"]').text()).toBe('12 / 200')
  })

  it('posts once while pending and emits only a strictly valid safe response', async () => {
    const { default: CounselingForm } = await import(
      '../../../app/components/counseling/CounselingForm.vue'
    )
    let resolveRequest: ((value: unknown) => void) | undefined
    const request = vi.fn(() => new Promise(resolve => { resolveRequest = resolve }))
    vi.stubGlobal('$fetch', request)
    const wrapper = mount(CounselingForm, { props: { assessmentPublicId } })
    await wrapper.get('input[name="consent"]').setValue(true)

    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')

    expect(request).toHaveBeenCalledOnce()
    expect(wrapper.get('button[type="submit"]').attributes('aria-busy')).toBe('true')
    resolveRequest?.({ data: currentRequest(), requestId: 'request-id' })
    await vi.waitFor(() => expect(wrapper.emitted('submitted')).toHaveLength(1))
    expect(request).toHaveBeenCalledWith('/api/counseling', {
      method: 'POST',
      body: {
        assessmentPublicId,
        contactMethod: 'phone',
        availability: 'weekday_afternoon',
        inquiry: null,
        consent: true,
      },
    })
  })

  it('preserves entries on failure and allows a retry', async () => {
    const { default: CounselingForm } = await import(
      '../../../app/components/counseling/CounselingForm.vue'
    )
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: currentRequest(), requestId: 'request-id' })
    vi.stubGlobal('$fetch', request)
    const wrapper = mount(CounselingForm, { props: { assessmentPublicId } })
    await wrapper.get('input[value="visit"]').setValue(true)
    await wrapper.get('input[value="weekend"]').setValue(true)
    await wrapper.get('textarea[name="inquiry"]').setValue('주말 방문 상담을 원합니다.')
    await wrapper.get('input[name="consent"]').setValue(true)

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('다시'))

    expect((wrapper.get('input[value="visit"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.get('input[value="weekend"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.get('textarea[name="inquiry"]').element as HTMLTextAreaElement).value)
      .toBe('주말 방문 상담을 원합니다.')

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.emitted('submitted')).toHaveLength(1))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('rejects a successful-looking response with extra private fields', async () => {
    const { default: CounselingForm } = await import(
      '../../../app/components/counseling/CounselingForm.vue'
    )
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      data: { ...currentRequest(), phone: '010-0000-0000' },
      requestId: 'request-id',
    }))
    const wrapper = mount(CounselingForm, { props: { assessmentPublicId } })
    await wrapper.get('input[name="consent"]').setValue(true)

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('다시'))

    expect(wrapper.emitted('submitted')).toBeUndefined()
    expect(wrapper.text()).not.toContain('010-0000-0000')
  })

  it('keeps the draft and form mounted when authentication expires during submit', async () => {
    const { default: CounselingForm } = await import(
      '../../../app/components/counseling/CounselingForm.vue'
    )
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(Object.assign(new Error('expired'), {
      data: { error: { code: 'AUTH_FAILED', message: 'private auth detail' } },
    })))
    const wrapper = mount(CounselingForm, {
      props: { assessmentPublicId },
      global: {
        stubs: {
          NuxtLink: {
            props: ['to'],
            template: '<a data-testid="auth-link"><slot /></a>',
          },
        },
      },
    })
    await wrapper.get('input[value="visit"]').setValue(true)
    await wrapper.get('input[value="weekend"]').setValue(true)
    await wrapper.get('textarea[name="inquiry"]').setValue('로그인 뒤에도 남아야 합니다.')
    await wrapper.get('input[name="consent"]').setValue(true)

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('로그인'))

    expect(wrapper.find('form').exists()).toBe(true)
    expect((wrapper.get('input[value="visit"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.get('input[value="weekend"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.get('textarea[name="inquiry"]').element as HTMLTextAreaElement).value)
      .toBe('로그인 뒤에도 남아야 합니다.')
    expect(wrapper.get('[data-testid="auth-link"]').text())
      .toBe('새 창에서 로그인한 뒤 이 창으로 돌아와 신청하기')
    expect(wrapper.emitted('unauthenticated')).toBeUndefined()
  })
})

describe('student counseling public response schema', () => {
  it.each([
    ['assigned without an assignment', currentRequest({ status: 'assigned' })],
    ['missing primary', currentRequest({
      recommendations: [
        { ...currentRequest().recommendations[1] },
        {
          name: '박재웅', title: '겸임교수', expertise: '드론·VR', reason: '실무 연계', role: 'specialist', rank: 1,
        },
      ],
    })],
    ['duplicate role and rank', currentRequest({
      recommendations: [
        ...currentRequest().recommendations,
        { ...currentRequest().recommendations[0], name: '김사라' },
      ],
    })],
    ['a non-dense specialist rank', currentRequest({
      recommendations: [
        ...currentRequest().recommendations,
        {
          name: '박재웅', title: '겸임교수', expertise: '드론·VR', reason: '실무 연계', role: 'specialist', rank: 2,
        },
      ],
    })],
  ])('rejects %s', (_case, request) => {
    expect(studentCounselingStatusSchema.safeParse(request).success).toBe(false)
  })

  it.each([
    ['closed from new', currentRequest({
      status: 'closed',
      closedAt: '2026-07-15T02:00:00.000Z',
      version: 1,
    })],
    ['closed from assigned', currentRequest({
      status: 'closed',
      assignedAt: '2026-07-15T02:00:00.000Z',
      closedAt: '2026-07-15T03:00:00.000Z',
      version: 2,
      assignedFaculty: {
        name: '윤태준', title: '교수', expertise: '현대예술·영상촬영',
      },
    })],
    ['closed from contacted', currentRequest({
      status: 'closed',
      assignedAt: '2026-07-15T02:00:00.000Z',
      contactedAt: '2026-07-15T03:00:00.000Z',
      closedAt: '2026-07-15T04:00:00.000Z',
      version: 3,
      assignedFaculty: {
        name: '윤태준', title: '교수', expertise: '현대예술·영상촬영',
      },
    })],
    ['dense specialists', currentRequest({
      recommendations: [
        ...currentRequest().recommendations,
        {
          name: '박재웅', title: '겸임교수', expertise: '드론·VR', reason: '실무 연계', role: 'specialist', rank: 1,
        },
        {
          name: '정철호', title: '겸임교수', expertise: '전시기획', reason: '전시 연계', role: 'specialist', rank: 2,
        },
      ],
    })],
  ])('accepts %s', (_case, request) => {
    expect(studentCounselingStatusSchema.safeParse(request).success).toBe(true)
  })
})

describe('CounselingStatus', () => {
  it('shows recommendation wording before assignment and the actual professor afterward', async () => {
    const { default: CounselingStatus } = await import(
      '../../../app/components/counseling/CounselingStatus.vue'
    )
    const before = mount(CounselingStatus, { props: { request: currentRequest() } })
    const after = mount(CounselingStatus, {
      props: {
        request: currentRequest({
          status: 'assigned',
          assignedAt: '2026-07-15T02:00:00.000Z',
          version: 1,
          assignedFaculty: {
            name: '김사라',
            title: '교수',
            expertise: '다큐멘터리·지역기록·사진아카이브',
          },
        }),
      },
    })

    expect(before.text()).toContain('추천 총괄교수')
    expect(before.text()).toContain('윤태준 교수')
    expect(before.text()).not.toContain('담당 교수')
    expect(after.text()).toContain('담당 교수')
    expect(after.text()).toContain('김사라 교수')
    expect(after.text()).not.toContain('자동 배정')
    expect(`${before.html()}${after.html()}`).not.toMatch(/tel:|mailto:|전화번호|이메일/u)
  })

  it('renders the five ordered stages with completed and current semantics', async () => {
    const { default: CounselingStatus } = await import(
      '../../../app/components/counseling/CounselingStatus.vue'
    )
    const wrapper = mount(CounselingStatus, {
      props: {
        request: currentRequest({
          status: 'contacted',
          assignedAt: '2026-07-15T02:00:00.000Z',
          contactedAt: '2026-07-15T03:00:00.000Z',
          version: 2,
          assignedFaculty: {
            name: '윤태준',
            title: '교수',
            expertise: '현대예술·영상촬영',
          },
        }),
      },
    })
    const stages = wrapper.findAll('[data-counseling-stage]')

    expect(stages.map(stage => stage.text())).toEqual([
      expect.stringContaining('신청 접수'),
      expect.stringContaining('교수 배정'),
      expect.stringContaining('연락 완료'),
      expect.stringContaining('상담 완료'),
      expect.stringContaining('종료'),
    ])
    expect(stages[0]?.attributes('data-state')).toBe('completed')
    expect(stages[1]?.attributes('data-state')).toBe('completed')
    expect(stages[2]?.attributes('data-state')).toBe('current')
    expect(stages[2]?.attributes('aria-current')).toBe('step')
    expect(stages[3]?.attributes('data-state')).toBe('upcoming')
    expect(stages[4]?.attributes('data-state')).toBe('upcoming')
  })

  it.each([
    ['new', currentRequest({ status: 'closed', closedAt: '2026-07-15T02:00:00.000Z', version: 1 }), ['completed', 'upcoming', 'upcoming', 'upcoming', 'current']],
    ['assigned', currentRequest({
      status: 'closed',
      assignedAt: '2026-07-15T02:00:00.000Z',
      closedAt: '2026-07-15T03:00:00.000Z',
      version: 2,
      assignedFaculty: { name: '윤태준', title: '교수', expertise: '현대예술·영상촬영' },
    }), ['completed', 'completed', 'upcoming', 'upcoming', 'current']],
    ['contacted', currentRequest({
      status: 'closed',
      assignedAt: '2026-07-15T02:00:00.000Z',
      contactedAt: '2026-07-15T03:00:00.000Z',
      closedAt: '2026-07-15T04:00:00.000Z',
      version: 3,
      assignedFaculty: { name: '윤태준', title: '교수', expertise: '현대예술·영상촬영' },
    }), ['completed', 'completed', 'completed', 'upcoming', 'current']],
  ])('shows a terminal case closed from %s without inventing stages', async (_branch, request, states) => {
    const { default: CounselingStatus } = await import(
      '../../../app/components/counseling/CounselingStatus.vue'
    )
    const wrapper = mount(CounselingStatus, { props: { request } })

    expect(wrapper.findAll('[data-counseling-stage]').map(stage => stage.attributes('data-state')))
      .toEqual(states)
  })
})

describe('CounselingCTA', () => {
  it('uses the roadmap copy and safely carries the assessment public ID', async () => {
    const { default: CounselingCTA } = await import(
      '../../../app/components/counseling/CounselingCTA.vue'
    )
    const wrapper = mount(CounselingCTA, {
      props: { assessmentPublicId },
      global: {
        stubs: {
          NuxtLink: {
            props: ['to'],
            computed: {
              href() {
                const target = this.to as string | { path: string, query?: Record<string, string> }
                if (typeof target === 'string') return target
                const query = new URLSearchParams(target.query).toString()
                return `${target.path}${query ? `?${query}` : ''}`
              },
            },
            template: '<a :href="href"><slot /></a>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain(
      '이 로드맵의 실제 수업, 장비, 포트폴리오와 입학 준비가 궁금하다면 관심 분야 담당교수와 상담해보세요.',
    )
    expect(wrapper.get('a').attributes('href')).toBe(
      `/counseling?assessmentPublicId=${assessmentPublicId}`,
    )
    expect(wrapper.get('a').text()).toContain('상담 신청하기')
  })

  it('offers the same counseling destination in a distinct compact next-step card', async () => {
    const { default: CounselingCTA } = await import(
      '../../../app/components/counseling/CounselingCTA.vue'
    )
    const wrapper = mount(CounselingCTA, {
      props: { assessmentPublicId, variant: 'compact' },
      global: {
        stubs: {
          NuxtLink: {
            props: ['to'],
            computed: {
              href() {
                const target = this.to as string | { path: string, query?: Record<string, string> }
                if (typeof target === 'string') return target
                const query = new URLSearchParams(target.query).toString()
                return `${target.path}${query ? `?${query}` : ''}`
              },
            },
            template: '<a :href="href"><slot /></a>',
          },
        },
      },
    })

    expect(wrapper.attributes('data-counseling-cta')).toBe('compact')
    expect(wrapper.classes()).toContain('counseling-cta--compact')
    expect(wrapper.get('h2').attributes('id')).toBe('counseling-midpoint-title')
    expect(wrapper.text()).toContain('추천 경로를 상담으로 한 번 더 확인하세요')
    expect(wrapper.text()).toContain('NEXT STEP / COUNSELING')
    expect(wrapper.get('a').attributes('href')).toBe(
      `/counseling?assessmentPublicId=${assessmentPublicId}`,
    )
    expect(wrapper.get('a').text()).toContain('이 경로로 상담 이어가기')
  })

  it('keeps the compact assignment note at an AA-safe ink strength', () => {
    const source = readFileSync('app/components/counseling/CounselingCTA.vue', 'utf8')
    const compactSmallRule = source.match(
      /\.counseling-cta--compact small\s*\{([\s\S]*?)\}/u,
    )?.[1] ?? ''

    expect(compactSmallRule).toMatch(
      /color:\s*color-mix\(in srgb,\s*var\(--color-ink\)\s*(?:7\d|8\d|9\d|100)%,\s*transparent\)/u,
    )
  })
})
