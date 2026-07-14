import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
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
const seedSql = readFileSync('supabase/seed/assessment-options.sql', 'utf8')
const canonicalCatalog = JSON.parse(
  readFileSync('supabase/seed/assessment-options.json', 'utf8'),
) as CanonicalOption[]

const dockerPsqlArgs = (applicationName?: string) => [
  'exec',
  '-i',
  ...(applicationName === undefined ? [] : ['-e', `PGAPPNAME=${applicationName}`]),
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
  [...dockerPsqlArgs(), '-c', sql],
  { encoding: 'utf8' },
).trim()

const runSeed = () => {
  const result = spawnSync('docker', dockerPsqlArgs(), {
    encoding: 'utf8',
    input: seedSql,
  })
  if (result.status !== 0) {
    throw new Error('generated assessment seed failed against the local database', {
      cause: new Error(result.stderr.trim()),
    })
  }
}

type PsqlResult = {
  status: number | null
  stderr: string
  stdout: string
}

const expectSeedDriftResult = (result: PsqlResult) => {
  expect(result.status).not.toBe(0)
  const output = `${result.stdout}\n${result.stderr}`
  expect(output).toMatch(/ERROR:\s+P0001:/u)
  expect(output).toContain('assessment catalog manifest drift')
}

const expectSeedDrift = () => {
  const result = spawnSync('docker', dockerPsqlArgs(), {
    encoding: 'utf8',
    input: seedSql,
  })

  expectSeedDriftResult(result)
}

type RunningPsql = {
  child: ChildProcessWithoutNullStreams
  completion: Promise<PsqlResult>
  readStdout: () => string
}

const startPsql = (applicationName: string): RunningPsql => {
  const child = spawn('docker', dockerPsqlArgs(applicationName), {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  let stdout = ''
  child.stderr.setEncoding('utf8')
  child.stdout.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })
  child.stdout.on('data', chunk => { stdout += chunk })

  const completion = new Promise<PsqlResult>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', status => resolve({ status, stderr, stdout }))
  })

  return { child, completion, readStdout: () => stdout }
}

const waitForActivity = async (
  running: RunningPsql,
  applicationName: string,
  condition: string,
) => {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const count = Number(runSql(`
      select count(*)
      from pg_catalog.pg_stat_activity
      where application_name = '${applicationName}'
        and ${condition}
    `))
    if (count === 1) {
      return
    }
    if (running.child.exitCode !== null) {
      throw new Error(`${applicationName} exited before reaching the expected database state`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  throw new Error(`${applicationName} did not reach the expected database state`)
}

const stopPsql = async (running: RunningPsql, finalStatement: string) => {
  if (running.child.exitCode === null && !running.child.stdin.writableEnded) {
    running.child.stdin.end(`${finalStatement}\n`)
  }
  return running.completion
}

const waitForPsqlBoolean = async (running: RunningPsql) => {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const lines = running.readStdout().split('\n').map(line => line.trim())
    if (lines.includes('t')) {
      return true
    }
    if (lines.includes('f')) {
      return false
    }
    if (running.child.exitCode !== null) {
      throw new Error('assessment seed test lock session exited unexpectedly')
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('assessment seed test lock acquisition timed out')
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

const runnerLockExpression = `pg_catalog.hashtextextended('photo_next.assessment_seed_test.${projectId}', 0)`
const describeDestructive = isDestructiveSeedTestEnabled(process.env) ? describe : describe.skip
let baselineVerified = false
let runnerLock: RunningPsql | undefined

const tryAcquireRunnerLock = async () => {
  const running = startPsql('photo_next_assessment_seed_test_lock')
  try {
    running.child.stdin.write(`select pg_catalog.pg_try_advisory_lock(${runnerLockExpression});\n`)
    if (await waitForPsqlBoolean(running)) {
      return running
    }
    await stopPsql(running, '')
    return undefined
  }
  catch (error) {
    if (running.child.exitCode === null && !running.child.stdin.writableEnded) {
      running.child.stdin.end()
    }
    await running.completion.catch(() => undefined)
    throw error
  }
}

const acquireRunnerLock = async () => {
  const running = await tryAcquireRunnerLock()
  if (running === undefined) {
    throw new Error('another assessment seed test runner already holds the project lock')
  }
  return running
}

const releaseRunnerLock = async (running: RunningPsql) => {
  if (running.child.exitCode === null && !running.child.stdin.writableEnded) {
    running.child.stdin.end(`select pg_catalog.pg_advisory_unlock(${runnerLockExpression});\n`)
  }
  const result = await running.completion
  expect(result.status).toBe(0)
}

describeDestructive('generated assessment seed artifact', () => {
  beforeAll(async () => {
    if (process.env[destructiveSeedTestOptIn] !== '1') {
      throw new Error('destructive assessment seed test opt-in is required')
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
    runnerLock = await acquireRunnerLock()

    try {
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
    }
    catch (error) {
      await releaseRunnerLock(runnerLock)
      runnerLock = undefined
      throw error
    }
  })

  beforeEach(() => {
    if (!baselineVerified) {
      throw new Error('assessment seed test baseline was not verified')
    }
    restoreCanonicalCatalog()
  })
  afterAll(async () => {
    try {
      if (baselineVerified) {
        restoreCanonicalCatalog()
      }
    }
    finally {
      baselineVerified = false
      if (runnerLock !== undefined) {
        await releaseRunnerLock(runnerLock)
        runnerLock = undefined
      }
    }
  })

  it('rejects and closes a concurrent project runner lock session', async () => {
    expect(await tryAcquireRunnerLock()).toBeUndefined()
  })

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

  it('waits for a concurrent writer and rejects its committed drift', async () => {
    const writerName = 'photo_next_assessment_seed_writer'
    const seedName = 'photo_next_assessment_seed_concurrency'
    const writer = startPsql(writerName)
    let seed: RunningPsql | undefined

    try {
      writer.child.stdin.write(`begin;
        update public.assessment_options
        set label = 'concurrent committed fixture'
        where option_key = 'work.photo_everyday';
      `)
      await waitForActivity(writer, writerName, "state = 'idle in transaction'")

      seed = startPsql(seedName)
      seed.child.stdin.end(seedSql)
      await waitForActivity(
        seed,
        seedName,
        "state = 'active' and wait_event_type = 'Lock' and query ilike 'lock table public.assessment_options%'",
      )

      const writerResult = await stopPsql(writer, 'commit;')
      expect(writerResult.status).toBe(0)
      const committedWriterSnapshot = databaseSnapshot()

      const seedResult = await seed.completion
      expectSeedDriftResult(seedResult)
      expect(databaseSnapshot()).toBe(committedWriterSnapshot)
    }
    finally {
      if (writer.child.exitCode === null) {
        await stopPsql(writer, 'rollback;')
      }
      if (seed !== undefined && seed.child.exitCode === null) {
        seed.child.kill('SIGTERM')
        await seed.completion
      }
    }
  }, 10_000)

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
