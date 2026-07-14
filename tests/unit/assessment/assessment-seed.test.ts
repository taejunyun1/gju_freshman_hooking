import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  catalogGroupCounts,
  createCatalogRevision,
  generateAssessmentSeedSql,
  parseAssessmentCatalog,
} from '../../../scripts/seed-assessment-options'
import { assessmentSubmissionSchema, selectionLimits } from '../../../shared/schemas/assessment'

const canonicalInput = () => JSON.parse(
  readFileSync('supabase/seed/assessment-options.json', 'utf8'),
) as unknown

describe('assessment catalog seed', () => {
  it('accepts the canonical 28-option manifest in fixed group order', () => {
    const catalog = parseAssessmentCatalog(canonicalInput())

    expect(catalog).toHaveLength(28)
    expect(catalogGroupCounts(catalog)).toEqual({ work: 10, result: 8, style: 6, career: 4 })
    expect(catalog.map(option => option.optionKey)).toEqual([
      'work.photo_everyday',
      'work.video_scene',
      'work.video_post',
      'work.commercial_image',
      'work.interview_life',
      'work.brand_region',
      'work.exhibition_install',
      'work.music_shortform',
      'work.photobook',
      'work.project_plan',
      'result.photo_portfolio',
      'result.exhibit_photobook',
      'result.commercial_fashion',
      'result.documentary',
      'result.brand_video',
      'result.shortform_mv',
      'result.video_showreel',
      'result.project_proposal',
      'style.solo',
      'style.team',
      'style.field',
      'style.studio',
      'style.interview',
      'style.post',
      'career.photo',
      'career.video',
      'career.planning',
      'career.explore',
    ])
  })

  it('rejects unknown fields, duplicate keys, and duplicate group sort positions', () => {
    const catalog = canonicalInput() as Array<Record<string, unknown>>

    expect(() => parseAssessmentCatalog([
      { ...catalog[0], unexpected: true },
      ...catalog.slice(1),
    ])).toThrowError(/unknown/i)
    expect(() => parseAssessmentCatalog([
      ...catalog.slice(0, -1),
      { ...catalog.at(-1), optionKey: catalog[0]?.optionKey, group: 'work', sortOrder: 11 },
    ])).toThrowError(/duplicate option key/i)
    expect(() => parseAssessmentCatalog([
      { ...catalog[0], sortOrder: 2 },
      ...catalog.slice(1),
    ])).toThrowError(/duplicate group sort/i)
  })

  it('rejects incomplete weights, invalid tags, unapproved visuals, and catalog drift', () => {
    const catalog = canonicalInput() as Array<Record<string, unknown>>
    const replaceFirst = (changes: Record<string, unknown>) => [
      { ...catalog[0], ...changes },
      ...catalog.slice(1),
    ]

    expect(() => parseAssessmentCatalog(replaceFirst({ trackWeights: { documentary: 1 } })))
      .toThrowError(/track weights/i)
    expect(() => parseAssessmentCatalog(replaceFirst({ interestTags: ['bad tag'] })))
      .toThrowError(/interest tags/i)
    expect(() => parseAssessmentCatalog(replaceFirst({ visualKey: 'https://example.com/image.jpg' })))
      .toThrowError(/visual key/i)
    expect(() => parseAssessmentCatalog(catalog.slice(1)))
      .toThrowError(/catalog manifest/i)
    expect(() => parseAssessmentCatalog(replaceFirst({ label: 'changed live content' })))
      .toThrowError(/catalog manifest/i)
  })

  it('produces a deterministic revision and owner-only drift-safe SQL', () => {
    const catalog = parseAssessmentCatalog(canonicalInput())
    const firstRevision = createCatalogRevision(catalog)
    const firstSql = generateAssessmentSeedSql(catalog)
    const secondSql = generateAssessmentSeedSql(parseAssessmentCatalog(canonicalInput()))

    expect(firstRevision).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(createCatalogRevision(catalog)).toBe(firstRevision)
    expect(secondSql).toBe(firstSql)
    expect(firstSql).toContain('begin;')
    expect(firstSql).toContain('pg_advisory_xact_lock')
    expect(firstSql).toContain('catalog manifest drift')
    expect(firstSql).toContain('commit;')
    expect(firstSql).not.toMatch(/delete\s+from\s+public\.assessment_options/iu)
    expect(firstSql).not.toMatch(/update\s+public\.assessment_options/iu)
  })

  it('feeds the generated SQL directly to reset while retaining the operator include', () => {
    const config = readFileSync('supabase/config.toml', 'utf8')
    const rootSeed = readFileSync('supabase/seed.sql', 'utf8')

    expect(config).toContain('sql_paths = ["./seed/assessment-options.sql"]')
    expect(rootSeed).toBe('\\ir seed/assessment-options.sql\n')
  })
})

describe('assessment submission contract', () => {
  const validSubmission = {
    catalogRevision: `sha256:${'a'.repeat(64)}`,
    selections: {
      work: ['work.photo_everyday'],
      result: ['result.photo_portfolio'],
      style: ['style.solo'],
      career: ['career.photo'],
      careerOther: null,
    },
  }

  it('publishes the fixed selection limits and trims safe exploration text', () => {
    expect(selectionLimits).toEqual({
      work: { min: 1, max: 4, weight: 0.4 },
      result: { min: 1, max: 3, weight: 0.3 },
      style: { min: 1, max: 2, weight: 0.1 },
      career: { min: 1, max: 2, weight: 0.2 },
    })

    const parsed = assessmentSubmissionSchema.parse({
      ...validSubmission,
      selections: {
        ...validSubmission.selections,
        career: ['career.explore'],
        careerOther: '  드론과 지역 기록  ',
      },
    })

    expect(parsed.selections.careerOther).toBe('드론과 지역 기록')
  })

  it('requires fully prefixed keys and enforces every group limit', () => {
    expect(() => assessmentSubmissionSchema.parse({
      ...validSubmission,
      selections: { ...validSubmission.selections, work: ['photo_everyday'] },
    })).toThrow()
    expect(() => assessmentSubmissionSchema.parse({
      ...validSubmission,
      selections: { ...validSubmission.selections, work: [] },
    })).toThrow()
    expect(() => assessmentSubmissionSchema.parse({
      ...validSubmission,
      selections: {
        ...validSubmission.selections,
        result: [
          'result.photo_portfolio',
          'result.exhibit_photobook',
          'result.commercial_fashion',
          'result.documentary',
        ],
      },
    })).toThrow()
  })

  it('allows careerOther only for explore and rejects contact or control characters', () => {
    for (const careerOther of [
      '010-1234-5678',
      'hello@example.com',
      'line\nbreak',
      'a'.repeat(31),
    ]) {
      expect(() => assessmentSubmissionSchema.parse({
        ...validSubmission,
        selections: {
          ...validSubmission.selections,
          career: ['career.explore'],
          careerOther,
        },
      })).toThrow()
    }

    expect(() => assessmentSubmissionSchema.parse({
      ...validSubmission,
      selections: { ...validSubmission.selections, careerOther: '포토북 제작' },
    })).toThrow()
  })
})
