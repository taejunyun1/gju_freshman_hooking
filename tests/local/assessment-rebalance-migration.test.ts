import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertCanonicalSeedTestBaseline,
  destructiveSeedTestOptIn,
  isDestructiveSeedTestEnabled,
} from '../../scripts/assessment-seed-test-safety'

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
const migrationSql = readFileSync(
  'supabase/migrations/202607210035_rebalance_documentary_assessment_options.sql',
  'utf8',
)
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

const runArtifact = (sql: string) => spawnSync('docker', dockerPsqlArgs, {
  encoding: 'utf8',
  input: sql,
})

const restoreCanonicalCatalog = () => {
  runSql('truncate table public.assessment_options restart identity')
  const result = runArtifact(seedSql)
  if (result.status !== 0) {
    throw new Error('failed to restore the canonical assessment catalog', {
      cause: new Error(result.stderr.trim()),
    })
  }
}

const databaseSnapshot = () => runSql(`
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(catalog) order by catalog.id),
    '[]'::jsonb
  )::text
  from public.assessment_options as catalog
`)

const nonTargetSnapshot = () => runSql(`
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(catalog) order by catalog.id),
    '[]'::jsonb
  )::text
  from public.assessment_options as catalog
  where option_key not in ('work.photo_everyday', 'work.brand_region')
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

const setPreviousProductionWeights = () => runSql(`
  update public.assessment_options
  set track_weights = case option_key
    when 'work.photo_everyday'
      then '{"documentary":2,"art_photo":3,"commercial":1,"video":0}'::jsonb
    when 'work.brand_region'
      then '{"documentary":2,"art_photo":1,"commercial":3,"video":2}'::jsonb
  end
  where option_key in ('work.photo_everyday', 'work.brand_region')
`)

const targetWeights = () => JSON.parse(runSql(`
  select pg_catalog.jsonb_object_agg(option_key, track_weights)::text
  from public.assessment_options
  where option_key in ('work.photo_everyday', 'work.brand_region')
`)) as Record<string, Record<string, number>>

const expectMigrationFailure = (message: string) => {
  const result = runArtifact(migrationSql)
  expect(result.status).not.toBe(0)
  expect(`${result.stdout}\n${result.stderr}`).toContain(message)
}

const describeDestructive = isDestructiveSeedTestEnabled(process.env) ? describe : describe.skip
let baselineVerified = false

describeDestructive('assessment documentary rebalance migration', () => {
  beforeAll(() => {
    if (process.env[destructiveSeedTestOptIn] !== '1') {
      throw new Error('destructive assessment migration test opt-in is required')
    }

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

    const [totalRows, activeRows] = runSql(`
      select count(*), count(*) filter (where status = 'active')
      from public.assessment_options
    `).split('|').map(Number)
    assertCanonicalSeedTestBaseline({
      activeRows,
      actualManifest: activeManifest(),
      expectedManifest,
      totalRows,
    })
    baselineVerified = true
  })

  beforeEach(() => {
    if (!baselineVerified) {
      throw new Error('assessment migration test baseline was not verified')
    }
    restoreCanonicalCatalog()
  })

  afterAll(() => {
    if (baselineVerified) {
      restoreCanonicalCatalog()
    }
    baselineVerified = false
  })

  it('upgrades the previous production weights without changing non-target rows', () => {
    setPreviousProductionWeights()
    const nonTargetsBefore = nonTargetSnapshot()

    const result = runArtifact(migrationSql)

    expect(result.status).toBe(0)
    expect(targetWeights()).toEqual({
      'work.brand_region': { documentary: 3, art_photo: 1, commercial: 2, video: 2 },
      'work.photo_everyday': { documentary: 3, art_photo: 2, commercial: 1, video: 0 },
    })
    expect(nonTargetSnapshot()).toBe(nonTargetsBefore)
  })

  it('is idempotent when the approved weights are already present', () => {
    const before = databaseSnapshot()

    const result = runArtifact(migrationSql)

    expect(result.status).toBe(0)
    expect(databaseSnapshot()).toBe(before)
  })

  it('rejects target row drift without modifying the catalog', () => {
    runSql(`
      update public.assessment_options
      set label = 'drifted target'
      where option_key = 'work.photo_everyday'
    `)
    const before = databaseSnapshot()

    expectMigrationFailure('work.photo_everyday drifted from the approved catalog')

    expect(databaseSnapshot()).toBe(before)
  })

  it('rejects non-target drift without modifying the catalog', () => {
    runSql(`
      update public.assessment_options
      set track_weights = '{"documentary":0,"art_photo":3,"commercial":1,"video":0}'::jsonb
      where option_key = 'result.photo_portfolio'
    `)
    const before = databaseSnapshot()

    expectMigrationFailure('non-target options drifted from the approved catalog')

    expect(databaseSnapshot()).toBe(before)
  })

  it('rolls back every target update when the update statement fails', () => {
    setPreviousProductionWeights()
    runSql(`
      create function public.reject_brand_region_rebalance()
      returns trigger
      language plpgsql
      set search_path = ''
      as $function$
      begin
        raise exception using errcode = 'P0001', message = 'forced rebalance failure';
      end
      $function$;

      create trigger reject_brand_region_rebalance
      before update on public.assessment_options
      for each row
      when (new.option_key = 'work.brand_region')
      execute function public.reject_brand_region_rebalance()
    `)
    const before = databaseSnapshot()

    try {
      expectMigrationFailure('forced rebalance failure')
      expect(databaseSnapshot()).toBe(before)
    }
    finally {
      runSql(`
        drop trigger if exists reject_brand_region_rebalance on public.assessment_options;
        drop function if exists public.reject_brand_region_rebalance()
      `)
    }
  })

  it('keeps the pristine empty-database seed flow valid', () => {
    runSql('truncate table public.assessment_options restart identity')

    const migration = runArtifact(migrationSql)
    const seed = runArtifact(seedSql)

    expect(migration.status).toBe(0)
    expect(seed.status).toBe(0)
    expect(activeManifest()).toEqual(expectedManifest)
  })
})
