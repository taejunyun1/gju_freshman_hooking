import { describe, expect, it } from 'vitest'

import {
  counselingApplicationSchema,
  counselingReopenSchema,
  counselingTransitionSchema,
} from '../../../shared/schemas/counseling'
import { assertTransition } from '../../../server/modules/counseling/state-machine'

describe('assertTransition', () => {
  it.each([
    ['new', 'assigned'],
    ['assigned', 'contacted'],
    ['contacted', 'completed'],
    ['new', 'closed'],
    ['assigned', 'closed'],
    ['contacted', 'closed'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow()
  })

  it.each([
    ['new', 'contacted'],
    ['assigned', 'completed'],
    ['contacted', 'assigned'],
    ['completed', 'closed'],
    ['closed', 'completed'],
  ] as const)('rejects invalid normal transition %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrowError('COUNSELING_TRANSITION_INVALID')
  })

  it.each(['completed', 'closed'] as const)('requires a nonblank reason to reopen %s', (from) => {
    expect(() => assertTransition(from, 'new')).toThrowError('COUNSELING_REOPEN_REASON_REQUIRED')
    expect(() => assertTransition(from, 'new', '   ')).toThrowError('COUNSELING_REOPEN_REASON_REQUIRED')
    expect(() => assertTransition(from, 'new', '학생 재요청')).not.toThrow()
  })
})

describe('counseling schemas', () => {
  it('accepts the constrained application contract and trims inquiry text', () => {
    expect(counselingApplicationSchema.parse({
      assessmentPublicId: '11111111-1111-4111-8111-111111111111',
      contactMethod: 'phone',
      availability: 'weekday_morning',
      inquiry: '  전공 상담을 받고 싶어요.  ',
      consent: true,
    })).toEqual({
      assessmentPublicId: '11111111-1111-4111-8111-111111111111',
      contactMethod: 'phone',
      availability: 'weekday_morning',
      inquiry: '전공 상담을 받고 싶어요.',
      consent: true,
    })
  })

  it('rejects missing consent, unknown choices, and inquiry over 200 characters', () => {
    const base = {
      assessmentPublicId: '11111111-1111-4111-8111-111111111111',
      contactMethod: 'phone',
      availability: 'weekday_morning',
      inquiry: null,
      consent: true,
    }

    expect(counselingApplicationSchema.safeParse({ ...base, consent: false }).success).toBe(false)
    expect(counselingApplicationSchema.safeParse({ ...base, contactMethod: 'email' }).success).toBe(false)
    expect(counselingApplicationSchema.safeParse({ ...base, availability: 'anytime' }).success).toBe(false)
    expect(counselingApplicationSchema.safeParse({ ...base, inquiry: '가'.repeat(201) }).success).toBe(false)
    expect(counselingApplicationSchema.safeParse({ ...base, inquiry: '상담\n요청' }).success).toBe(false)
    expect(counselingApplicationSchema.safeParse({ ...base, inquiry: '상담\u0085요청' }).success).toBe(false)
  })

  it('requires optimistic versions and a bounded nonblank reopen reason', () => {
    expect(counselingTransitionSchema.safeParse({ to: 'contacted', expectedVersion: 1 }).success).toBe(true)
    expect(counselingTransitionSchema.safeParse({ to: 'contacted', expectedVersion: 2_147_483_647 }).success).toBe(true)
    expect(counselingTransitionSchema.safeParse({ to: 'contacted', expectedVersion: -1 }).success).toBe(false)
    expect(counselingTransitionSchema.safeParse({ to: 'contacted', expectedVersion: 2_147_483_648 }).success).toBe(false)
    expect(counselingTransitionSchema.safeParse({ to: 'new', expectedVersion: 1 }).success).toBe(false)
    expect(counselingReopenSchema.safeParse({ expectedVersion: 2, reason: '  학생 재요청  ' }).data).toEqual({
      expectedVersion: 2,
      reason: '학생 재요청',
    })
    expect(counselingReopenSchema.safeParse({ expectedVersion: 2, reason: '   ' }).success).toBe(false)
    expect(counselingReopenSchema.safeParse({ expectedVersion: 2, reason: '학생\n재요청' }).success).toBe(false)
    expect(counselingReopenSchema.safeParse({ expectedVersion: 2, reason: '학생\u0085재요청' }).success).toBe(false)
    expect(counselingReopenSchema.safeParse({ expectedVersion: 2_147_483_648, reason: '학생 재요청' }).success).toBe(false)
  })
})
