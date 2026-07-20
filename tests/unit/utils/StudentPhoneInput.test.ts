import { describe, expect, it } from 'vitest'
import {
  formatStudentPhoneInput,
  studentPhoneDigits,
} from '../../../app/utils/student-phone-input'

describe('student phone input', () => {
  it.each([
    ['', ''],
    ['010', '010'],
    ['0101', '010-1'],
    ['0101234', '010-1234'],
    ['01012345', '010-1234-5'],
    ['01012345678', '010-1234-5678'],
  ])('formats %s progressively', (input, expected) => {
    expect(formatStudentPhoneInput(input)).toBe(expected)
  })

  it('removes non-digits and truncates after eleven digits', () => {
    expect(formatStudentPhoneInput('010-12가34 5678xyz9')).toBe('010-1234-5678')
    expect(studentPhoneDigits('010-1234-5678')).toBe('01012345678')
  })
})
