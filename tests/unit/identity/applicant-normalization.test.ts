import { describe, expect, it } from 'vitest'

import {
  normalizeApplicantName,
  normalizeApplicantStage,
  normalizeKoreanPhone,
} from '../../../shared/utils/applicant-normalization'
import {
  applicantRosterRowSchema,
  rosterApplyRequestSchema,
  rosterChangedFieldSchema,
} from '../../../shared/schemas/admission-roster'
import { loginSchema, rosterPasswordSchema } from '../../../shared/schemas/identity'

const cycleId = '8d60bf06-4160-4ea3-a1ed-6a4976c274b4'

describe('applicant normalization and roster schemas', () => {
  it('normalizes applicant names with NFKC and collapsed Unicode whitespace', () => {
    expect(normalizeApplicantName('  윤\u00a0  태준  ')).toBe('윤 태준')
    expect(normalizeApplicantName('ＡＢ')).toBe('AB')
  })

  it('rejects empty, overlong, and control-bearing applicant names', () => {
    expect(() => normalizeApplicantName('')).toThrowError('APPLICANT_NAME_INVALID')
    expect(() => normalizeApplicantName('가'.repeat(41))).toThrowError('APPLICANT_NAME_INVALID')
    expect(() => normalizeApplicantName('윤\u0000태준')).toThrowError('APPLICANT_NAME_INVALID')
    expect(() => normalizeApplicantName('윤\u200b태준')).toThrowError('APPLICANT_NAME_INVALID')
  })

  it('normalizes Korean mobile phones and Korean applicant-stage labels', () => {
    expect(normalizeKoreanPhone('010-1234-4225')).toBe('01012344225')
    expect(normalizeApplicantStage('고3')).toBe('high3')
    expect(normalizeApplicantStage('검정고시')).toBe('ged')
    expect(normalizeApplicantStage('graduate')).toBe('graduate')
    expect(() => normalizeApplicantStage('대학생')).toThrowError('APPLICANT_STAGE_INVALID')
  })

  it('normalizes roster rows and enforces the hard 500-row request maximum', () => {
    const row = applicantRosterRowSchema.parse({
      name: '  윤\u00a0태준 ',
      phone: '010-1234-4225',
      highSchool: ' 광주고 ',
      grade: '고3',
    })

    expect(row).toEqual({
      name: '윤 태준',
      phone: '01012344225',
      highSchool: '광주고',
      grade: 'high3',
    })
    expect(Object.keys(row)).toEqual(['name', 'phone', 'highSchool', 'grade'])
    expect(rosterChangedFieldSchema.options).toEqual(['name', 'highSchool', 'grade'])
    expect(rosterChangedFieldSchema.safeParse('schoolName').success).toBe(false)
    expect(rosterChangedFieldSchema.safeParse('applicantStage').success).toBe(false)
    expect(rosterApplyRequestSchema.safeParse({
      cycleId,
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
      rows: Array.from({ length: 501 }, () => row),
    }).success).toBe(false)
  })

  it('accepts only the six-character roster password in the shared login contract', () => {
    expect(rosterPasswordSchema.parse('4225AB')).toBe('4225AB')
    expect(loginSchema.safeParse({ phone: '01012344225', password: '4225AB' }).success).toBe(true)
    expect(loginSchema.safeParse({ phone: '01012344225', password: 'AB-4225' }).success).toBe(false)
    expect(rosterPasswordSchema.safeParse('4225ab').success).toBe(false)
  })
})
