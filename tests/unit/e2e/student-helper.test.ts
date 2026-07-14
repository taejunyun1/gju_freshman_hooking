import { describe, expect, it } from 'vitest'
import { uniqueAssessmentPhone } from '../../e2e/support/phone'

describe('assessment E2E student helper', () => {
  it('uses a different deterministic valid phone for each Playwright retry', () => {
    const first = uniqueAssessmentPhone({ retry: 0, testId: 'commercial-primary' })
    const repeated = uniqueAssessmentPhone({ retry: 0, testId: 'commercial-primary' })
    const retry = uniqueAssessmentPhone({ retry: 1, testId: 'commercial-primary' })

    expect(first).toBe(repeated)
    expect(first).toMatch(/^0108\d{7}$/u)
    expect(retry).toMatch(/^0108\d{7}$/u)
    expect(retry).not.toBe(first)
  })
})
