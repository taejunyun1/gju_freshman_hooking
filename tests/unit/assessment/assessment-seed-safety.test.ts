import { describe, expect, it } from 'vitest'
import {
  assertCanonicalSeedTestBaseline,
  destructiveSeedTestOptIn,
  isDestructiveSeedTestEnabled,
} from '../../../scripts/assessment-seed-test-safety'

describe('destructive assessment seed test safety', () => {
  const expectedManifest = [{ optionKey: 'work.photo_everyday' }]

  it('requires one exact, explicit opt-in value', () => {
    expect(destructiveSeedTestOptIn).toBe('PHOTO_NEXT_ALLOW_DESTRUCTIVE_ASSESSMENT_SEED_TESTS')
    expect(isDestructiveSeedTestEnabled({ [destructiveSeedTestOptIn]: '1' })).toBe(true)
    expect(isDestructiveSeedTestEnabled({})).toBe(false)
    expect(isDestructiveSeedTestEnabled({ [destructiveSeedTestOptIn]: 'true' })).toBe(false)
    expect(isDestructiveSeedTestEnabled({ [destructiveSeedTestOptIn]: '0' })).toBe(false)
  })

  it('accepts only an exact 28-row all-active canonical baseline', () => {
    expect(() => assertCanonicalSeedTestBaseline({
      activeRows: 28,
      actualManifest: expectedManifest,
      expectedManifest,
      totalRows: 28,
    })).not.toThrow()

    for (const baseline of [
      { activeRows: 28, actualManifest: expectedManifest, totalRows: 29 },
      { activeRows: 27, actualManifest: expectedManifest, totalRows: 28 },
      { activeRows: 28, actualManifest: [{ optionKey: 'work.changed' }], totalRows: 28 },
    ]) {
      expect(() => assertCanonicalSeedTestBaseline({
        ...baseline,
        expectedManifest,
      })).toThrowError('assessment seed test baseline is not the exact canonical catalog')
    }
  })
})
