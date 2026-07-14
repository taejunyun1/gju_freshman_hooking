import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

type CanonicalOption = {
  group: string
  optionKey: string
  label: string
  description?: string
  visualKey: string
  trackWeights: Record<string, number>
  interestTags: string[]
  status: string
  sortOrder: number
}

const config = readFileSync('supabase/config.toml', 'utf8')
const projectId = config.match(/^project_id = "([a-z0-9-]+)"$/mu)?.[1]
if (projectId === undefined) {
  throw new Error('local Supabase project_id is missing or unsafe')
}

const databaseContainer = `supabase_db_${projectId}`
const seedSql = readFileSync('supabase/seed/assessment-options.sql', 'utf8')
const canonicalCatalog = JSON.parse(
  readFileSync('supabase/seed/assessment-options.json', 'utf8'),
) as CanonicalOption[]

const dockerPsqlArgs = [
  'exec',
  '-i',
  databaseContainer,
  'psql',
  '-X',
  '-v',
  'ON_ERROR_STOP=1',
  '-v',
  'VERBOSITY=verbose',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-Atq',
]

const runSql = (sql: string) => execFileSync(
  'docker',
  [...dockerPsqlArgs, '-c', sql],
  { encoding: 'utf8' },
).trim()

const runSeed = () => {
  const result = spawnSync('docker', dockerPsqlArgs, {
    encoding: 'utf8',
    input: seedSql,
  })
  if (result.status !== 0) {
    throw new Error('generated assessment seed failed against the local database', {
      cause: new Error(result.stderr.trim()),
    })
  }
}

const expectSeedDrift = () => {
  const result = spawnSync('docker', dockerPsqlArgs, {
    encoding: 'utf8',
    input: seedSql,
  })

  expect(result.status).not.toBe(0)
  const output = `${result.stdout}\n${result.stderr}`
  expect(output).toMatch(/ERROR:\s+P0001:/u)
  expect(output).toContain('assessment catalog manifest drift')
}

const restoreCanonicalCatalog = () => {
  runSql('truncate table public.assessment_options restart identity')
  runSeed()
}

const databaseSnapshot = () => runSql(`
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(catalog) order by catalog.id),
    '[]'::jsonb
  )::text
  from public.assessment_options as catalog
`)

const activeManifest = () => JSON.parse(runSql(`
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'group', question_group,
        'optionKey', option_key,
        'label', label,
        'description', description,
        'visualKey', visual_key,
        'trackWeights', track_weights,
        'interestTags', interest_tags,
        'status', status,
        'sortOrder', sort_order
      )
      order by pg_catalog.array_position(array['work', 'result', 'style', 'career'], question_group), sort_order
    ),
    '[]'::jsonb
  )::text
  from public.assessment_options
  where status = 'active'
`)) as unknown

const expectedManifest = canonicalCatalog.map(option => ({
  group: option.group,
  optionKey: option.optionKey,
  label: option.label,
  description: option.description ?? null,
  visualKey: option.visualKey,
  trackWeights: option.trackWeights,
  interestTags: option.interestTags,
  status: option.status,
  sortOrder: option.sortOrder,
}))

describe('generated assessment seed artifact', () => {
  beforeAll(() => {
    const label = execFileSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{ index .Config.Labels "com.supabase.cli.project" }}',
        databaseContainer,
      ],
      { encoding: 'utf8' },
    ).trim()

    expect(label).toBe(projectId)
  })

  beforeEach(restoreCanonicalCatalog)
  afterAll(restoreCanonicalCatalog)

  it('inserts the exact manifest into an empty catalog', () => {
    runSql('truncate table public.assessment_options restart identity')

    runSeed()

    expect(activeManifest()).toEqual(expectedManifest)
  })

  it('is an idempotent no-op for the identical active catalog', () => {
    const before = databaseSnapshot()

    runSeed()

    expect(databaseSnapshot()).toBe(before)
  })

  it.each([
    [
      'changed',
      `update public.assessment_options
       set label = 'changed fixture'
       where option_key = 'work.photo_everyday'`,
    ],
    [
      'missing',
      `delete from public.assessment_options
       where option_key = 'work.photo_everyday'`,
    ],
    [
      'extra',
      `insert into public.assessment_options (
         question_group,
         option_key,
         label,
         visual_key,
         track_weights,
         interest_tags,
         status,
         sort_order
       ) values (
         'work',
         'work.extra_fixture',
         'extra fixture',
         'contact_sheet',
         '{"documentary":1,"art_photo":1,"commercial":1,"video":1}'::jsonb,
         '["exploration"]'::jsonb,
         'active',
         99
       )`,
    ],
    [
      'stale active',
      `update public.assessment_options
       set option_key = 'work.photo_everyday_legacy'
       where option_key = 'work.photo_everyday'`,
    ],
  ])('rejects a %s manifest without partial mutation', (_caseName, mutation) => {
    runSql(mutation)
    const before = databaseSnapshot()

    expectSeedDrift()

    expect(databaseSnapshot()).toBe(before)
  })
})
