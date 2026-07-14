import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAssessmentCatalog } from '../../../scripts/seed-assessment-options'
import {
  AssessmentScoringError,
  scoreAssessment,
} from '../../../server/modules/assessment/scoring'
import { selectionLimits } from '../../../shared/schemas/assessment'
import { questionGroups, trackKeys } from '../../../shared/types/domain'
import type {
  AssessmentOption,
  AssessmentSelections,
  QuestionGroup,
  TrackWeights,
} from '../../../shared/types/domain'

const zeroWeights = (): TrackWeights => ({
  documentary: 0,
  art_photo: 0,
  commercial: 0,
  video: 0,
})

const makeOption = (
  optionKey: `${QuestionGroup}.${string}`,
  trackWeights: Partial<TrackWeights>,
  interestTags: string[] = ['test_interest'],
  overrides: Partial<AssessmentOption> = {},
): AssessmentOption => {
  const group = optionKey.split('.')[0] as QuestionGroup

  return {
    group,
    optionKey,
    label: optionKey,
    visualKey: 'photo_frame',
    trackWeights: { ...zeroWeights(), ...trackWeights },
    interestTags,
    status: 'active',
    sortOrder: 1,
    ...overrides,
  }
}

const makeCatalog = (
  weights: Record<QuestionGroup, Partial<TrackWeights>>,
): AssessmentOption[] => questionGroups.map(group => makeOption(
  `${group}.choice`,
  weights[group],
  [`${group}_interest`],
))

const baseSelections = (): AssessmentSelections => ({
  work: ['work.choice'],
  result: ['result.choice'],
  style: ['style.choice'],
  career: ['career.choice'],
  careerOther: null,
})

const uniformWeights = (trackWeights: Partial<TrackWeights>) => ({
  work: trackWeights,
  result: trackWeights,
  style: trackWeights,
  career: trackWeights,
})

const canonicalCatalog = () => parseAssessmentCatalog(JSON.parse(
  readFileSync('supabase/seed/assessment-options.json', 'utf8'),
) as unknown)

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
  return value
}

const safeString = (value: unknown) => {
  try {
    return String(value)
  }
  catch {
    return '[unprintable]'
  }
}

const safeSerialize = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? '[not-serializable]'
  }
  catch {
    return '[not-serializable]'
  }
}

const collectErrorSurfaces = (value: unknown, seen = new Set<object>()): string[] => {
  const surfaces = [safeString(value), safeSerialize(value)]
  if (value instanceof Error) {
    surfaces.push(value.message, value.stack ?? '')
  }

  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    if ('cause' in value && value.cause !== undefined) {
      surfaces.push(...collectErrorSurfaces(value.cause, seen))
    }
  }

  return surfaces
}

const expectScoringError = (
  callback: () => unknown,
  code: AssessmentScoringError['code'],
  secrets: string[] = [],
) => {
  let caught: unknown
  try {
    callback()
  }
  catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(AssessmentScoringError)
  const scoringError = caught as AssessmentScoringError
  expect(scoringError.code).toBe(code)
  const surfaces = collectErrorSurfaces(scoringError)
  for (const secret of secrets) {
    const serializedSecret = safeSerialize(secret)
    const escapedSecret = serializedSecret.startsWith('"') && serializedSecret.endsWith('"')
      ? serializedSecret.slice(1, -1)
      : serializedSecret
    for (const surface of surfaces) {
      expect(surface).not.toContain(secret)
      expect(surface).not.toContain(escapedSecret)
    }
  }
}

describe('scoreAssessment', () => {
  it('normalizes selected weights by group and returns one-decimal 0..100 scores', () => {
    const scored = scoreAssessment(
      makeCatalog(uniformWeights({ art_photo: 1, commercial: 3, video: 2 })),
      baseSelections(),
    )

    expect(scored.trackScores).toEqual({
      documentary: 0,
      art_photo: 33.3,
      commercial: 100,
      video: 66.7,
    })
    expect(scored.rankedTracks).toEqual(['commercial', 'video', 'art_photo', 'documentary'])
    for (const score of Object.values(scored.trackScores)) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
      expect(Number.isInteger(score * 10)).toBe(true)
    }
  })

  it('uses work, result, and career raw scores in order while style never takes priority', () => {
    const workPriority = scoreAssessment(makeCatalog({
      work: { documentary: 3 },
      result: { art_photo: 3 },
      style: { art_photo: 3 },
      career: { commercial: 3 },
    }), baseSelections())
    expect(workPriority.trackScores.documentary).toBe(workPriority.trackScores.art_photo)
    expect(workPriority.rankedTracks.indexOf('documentary'))
      .toBeLessThan(workPriority.rankedTracks.indexOf('art_photo'))

    const resultPriority = scoreAssessment(makeCatalog({
      work: { commercial: 3 },
      result: { documentary: 3 },
      style: { art_photo: 3 },
      career: { art_photo: 3 },
    }), baseSelections())
    expect(resultPriority.trackScores.documentary).toBe(resultPriority.trackScores.art_photo)
    expect(resultPriority.rankedTracks.indexOf('documentary'))
      .toBeLessThan(resultPriority.rankedTracks.indexOf('art_photo'))

    const careerPriority = scoreAssessment(makeCatalog({
      work: { commercial: 3 },
      result: { commercial: 3 },
      style: { art_photo: 2 },
      career: { documentary: 3, art_photo: 2 },
    }), baseSelections())
    expect(careerPriority.trackScores.documentary).toBe(careerPriority.trackScores.art_photo)
    expect(careerPriority.rankedTracks.indexOf('documentary'))
      .toBeLessThan(careerPriority.rankedTracks.indexOf('art_photo'))
  })

  it('breaks rounded-total ties by raw result instead of raw total or style', () => {
    const documentaryRawTotal = (3 / (1 * 3)) * 100 * selectionLimits.style.weight
    const artPhotoRawTotal = (1 / (1 * 3)) * 100 * selectionLimits.result.weight
    const round1 = (value: number) => Math.round(value * 10) / 10

    expect(documentaryRawTotal).not.toBe(artPhotoRawTotal)
    expect(round1(documentaryRawTotal)).toBe(round1(artPhotoRawTotal))
    expect(round1(documentaryRawTotal)).toBe(10)

    const scored = scoreAssessment(makeCatalog({
      work: { commercial: 1 },
      result: { art_photo: 1 },
      style: { documentary: 3 },
      career: { commercial: 1 },
    }), baseSelections())

    expect(scored.trackScores.documentary).toBe(10)
    expect(scored.trackScores.art_photo).toBe(10)
    expect(scored.rankedTracks.indexOf('art_photo'))
      .toBeLessThan(scored.rankedTracks.indexOf('documentary'))
  })

  it('falls back to the fixed track order after all score ties', () => {
    const scored = scoreAssessment(
      makeCatalog(uniformWeights({ documentary: 1, art_photo: 1, commercial: 1, video: 1 })),
      baseSelections(),
    )

    expect(new Set(Object.values(scored.trackScores))).toEqual(new Set([33.3]))
    expect(scored.rankedTracks).toEqual([...trackKeys])
  })

  it('builds lexical interest scores from within-group tag frequency without count inflation', () => {
    const catalog = [
      makeOption('work.one', { commercial: 3 }, ['repeated', 'fraction', 'shared'], { sortOrder: 1 }),
      makeOption('work.two', { commercial: 3 }, ['shared'], { sortOrder: 2 }),
      makeOption('work.three', { commercial: 3 }, ['shared'], { sortOrder: 3 }),
      makeOption('result.one', { commercial: 3 }, ['repeated']),
      makeOption('style.one', { commercial: 3 }, ['repeated'], { sortOrder: 1 }),
      makeOption('style.two', { commercial: 3 }, ['other'], { sortOrder: 2 }),
      makeOption('career.one', { commercial: 3 }, ['fraction'], { sortOrder: 1 }),
      makeOption('career.two', { commercial: 3 }, ['other'], { sortOrder: 2 }),
    ]
    const selections: AssessmentSelections = {
      work: ['work.one', 'work.two', 'work.three'],
      result: ['result.one'],
      style: ['style.one', 'style.two'],
      career: ['career.one', 'career.two'],
      careerOther: null,
    }

    const scored = scoreAssessment(catalog, selections)

    expect(scored.interestVector).toEqual({
      fraction: 0.233333,
      other: 0.15,
      repeated: 0.483333,
      shared: 0.4,
    })
    expect(Object.keys(scored.interestVector)).toEqual(['fraction', 'other', 'repeated', 'shared'])

    const fewerWorkSelections = scoreAssessment(catalog, {
      ...selections,
      work: ['work.one'],
    })
    expect(fewerWorkSelections.interestVector.shared).toBe(0.4)
  })

  it('scores the approved 28-option catalog with the documented formula', () => {
    const scored = scoreAssessment(canonicalCatalog(), {
      work: ['work.photo_everyday', 'work.video_scene'],
      result: ['result.documentary'],
      style: ['style.field'],
      career: ['career.explore'],
      careerOther: '드론 탐색',
    })

    expect(scored.trackScores).toEqual({
      documentary: 66.7,
      art_photo: 46.7,
      commercial: 23.3,
      video: 53.3,
    })
    expect(scored.rankedTracks).toEqual(['documentary', 'video', 'art_photo', 'commercial'])
    expect(scored.interestVector.documentary).toBe(0.4)
    expect(scored.interestVector.photography).toBe(0.4)
  })
})

describe('scoreAssessment validation and determinism', () => {
  it('is independent of catalog ordering and does not mutate nested inputs', () => {
    const catalog = canonicalCatalog()
    const selections: AssessmentSelections = {
      work: ['work.photo_everyday', 'work.video_scene'],
      result: ['result.documentary'],
      style: ['style.field'],
      career: ['career.explore'],
      careerOther: '  드론 탐색  ',
    }
    const catalogSnapshot = structuredClone(catalog)
    const selectionsSnapshot = structuredClone(selections)
    deepFreeze(catalog)
    deepFreeze(selections)

    const forward = scoreAssessment(catalog, selections)
    const reversed = scoreAssessment([...catalog].reverse(), selections)

    expect(reversed).toEqual(forward)
    expect(catalog).toEqual(catalogSnapshot)
    expect(selections).toEqual(selectionsSnapshot)
  })

  it('keeps boundary selections within the documented output ranges', () => {
    const catalog = canonicalCatalog()
    const boundarySelections: AssessmentSelections[] = [
      {
        work: ['work.photo_everyday'],
        result: ['result.documentary'],
        style: ['style.field'],
        career: ['career.explore'],
        careerOther: null,
      },
      {
        work: ['work.photo_everyday', 'work.video_scene', 'work.commercial_image', 'work.interview_life'],
        result: ['result.documentary', 'result.commercial_fashion', 'result.video_showreel'],
        style: ['style.field', 'style.studio'],
        career: ['career.photo', 'career.video'],
        careerOther: null,
      },
    ]

    for (const selections of boundarySelections) {
      const scored = scoreAssessment(catalog, selections)
      expect(scored.rankedTracks).toHaveLength(4)
      expect(Object.keys(scored.interestVector)).toEqual(Object.keys(scored.interestVector).sort())
      for (const score of Object.values(scored.trackScores)) {
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(100)
        expect(Number.isInteger(score * 10)).toBe(true)
      }
      for (const score of Object.values(scored.interestVector)) {
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(1)
        expect(Number.isInteger(score * 1_000_000)).toBe(true)
      }
    }
  })

  it('rejects unknown, inactive, wrong-group, duplicate, and invalid-count selections', () => {
    const catalog = makeCatalog(uniformWeights({ documentary: 1 }))
    const archived = catalog.map(option => option.optionKey === 'work.choice'
      ? { ...option, status: 'archived' as const }
      : option)

    expectScoringError(
      () => scoreAssessment(archived, baseSelections()),
      'ASSESSMENT_OPTION_UNAVAILABLE',
    )
    expectScoringError(
      () => scoreAssessment(catalog, { ...baseSelections(), work: ['work.unknown'] }),
      'ASSESSMENT_OPTION_UNAVAILABLE',
    )
    expectScoringError(
      () => scoreAssessment(catalog, {
        ...baseSelections(),
        work: ['result.choice' as `work.${string}`],
      }),
      'ASSESSMENT_SELECTIONS_INVALID',
    )
    expectScoringError(
      () => scoreAssessment(catalog, {
        ...baseSelections(),
        work: ['work.choice', 'work.choice'],
      }),
      'ASSESSMENT_SELECTIONS_INVALID',
    )
    expectScoringError(
      () => scoreAssessment(catalog, { ...baseSelections(), work: [] }),
      'ASSESSMENT_SELECTIONS_INVALID',
    )
    expectScoringError(
      () => scoreAssessment(catalog, {
        ...baseSelections(),
        work: ['work.one', 'work.two', 'work.three', 'work.four', 'work.five'],
      }),
      'ASSESSMENT_SELECTIONS_INVALID',
    )
    expectScoringError(
      () => scoreAssessment(catalog, {
        ...baseSelections(),
        careerOther: '비공개 관심사',
      }),
      'ASSESSMENT_SELECTIONS_INVALID',
      ['비공개 관심사'],
    )
  })

  it.each([
    '+82 10-1234-5678',
    'hello@example.com',
    '드론\n탐색',
  ])('rejects unsafe careerOther without exposing it: %s', (unsafeCareerOther) => {
    const selections = {
      ...baseSelections(),
      career: ['career.explore'] as `career.${string}`[],
      careerOther: unsafeCareerOther,
    }
    const catalog = makeCatalog(uniformWeights({ documentary: 1 })).map(option => (
      option.group === 'career'
        ? { ...option, optionKey: 'career.explore' as const }
        : option
    ))

    expectScoringError(
      () => scoreAssessment(catalog, selections),
      'ASSESSMENT_SELECTIONS_INVALID',
      [unsafeCareerOther],
    )
  })

  it('rejects duplicate, ambiguous, and invalid-weight catalog entries without exposing raw data', () => {
    const catalog = makeCatalog(uniformWeights({ documentary: 1 }))
    const duplicateKey = [
      ...catalog,
      { ...catalog[0]!, sortOrder: 2, label: 'private duplicate label' },
    ]
    const wrongPrefix = catalog.map(option => option.group === 'work'
      ? { ...option, optionKey: 'result.ambiguous' as const }
      : option)
    const rawWeight = '4.000000000000001'
    const invalidWeight = catalog.map(option => option.group === 'work'
      ? {
          ...option,
          trackWeights: { ...option.trackWeights, documentary: Number(rawWeight) },
        }
      : option)
    const rawTag = 'private_tag'
    const invalidTags = catalog.map(option => option.group === 'work'
      ? { ...option, interestTags: [rawTag, rawTag] }
      : option)

    expectScoringError(
      () => scoreAssessment(duplicateKey, baseSelections()),
      'ASSESSMENT_CATALOG_INVALID',
      ['private duplicate label'],
    )
    expectScoringError(
      () => scoreAssessment(wrongPrefix, baseSelections()),
      'ASSESSMENT_CATALOG_INVALID',
      ['result.ambiguous'],
    )
    expectScoringError(
      () => scoreAssessment(invalidWeight, baseSelections()),
      'ASSESSMENT_CATALOG_INVALID',
      [rawWeight],
    )
    expectScoringError(
      () => scoreAssessment(invalidTags, baseSelections()),
      'ASSESSMENT_CATALOG_INVALID',
      [rawTag],
    )
  })
})
