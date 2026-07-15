import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const REGISTER_ROUTE = '/api/student/register' as const

const DELETE_REGISTER_ROUTE_SQL = "delete from public.rate_limit_buckets where route = :'route';"
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
const PROJECT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u

export type LocalRegistrationRateLimitAdapter = {
  executeSql: (container: string, sql: string, variables: Record<string, string>) => void
  inspectContainer: (container: string) => string
  readProjectId: () => string
  readSupabaseStatus: () => Record<string, unknown>
}

const defaultAdapter: LocalRegistrationRateLimitAdapter = {
  executeSql: (container, sql, variables) => {
    const variableArguments = Object.entries(variables)
      .flatMap(([name, value]) => ['-v', `${name}=${value}`])
    execFileSync(
      'docker',
      [
        'exec', '-i', container,
        'psql', '-X', '-v', 'ON_ERROR_STOP=1', ...variableArguments,
        '-U', 'postgres', '-d', 'postgres', '-Atq',
      ],
      { input: sql, stdio: ['pipe', 'ignore', 'pipe'] },
    )
  },
  inspectContainer: container => execFileSync(
    'docker',
    ['inspect', '--format={{.State.Running}}', container],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim(),
  readProjectId: () => readFileSync('supabase/config.toml', 'utf8')
    .match(/^project_id = "([^"]+)"$/mu)?.[1] ?? '',
  readSupabaseStatus: () => JSON.parse(execFileSync(
    'pnpm',
    ['exec', 'supabase', 'status', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )) as Record<string, unknown>,
}

const requireLocalApiUrl = (value: unknown): void => {
  if (typeof value !== 'string') throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')
  }
  if (
    url.protocol !== 'http:'
    || !LOCAL_HOSTS.has(url.hostname)
    || Boolean(url.username)
    || Boolean(url.password)
    || (url.pathname !== '/' && url.pathname !== '')
    || Boolean(url.search)
    || Boolean(url.hash)
  ) throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')
}

export const clearLocalRegistrationRateLimitBuckets = (
  adapter: LocalRegistrationRateLimitAdapter = defaultAdapter,
): void => {
  let status: Record<string, unknown>
  let projectId: string
  try {
    status = adapter.readSupabaseStatus()
    requireLocalApiUrl(status.API_URL)
    projectId = adapter.readProjectId()
  }
  catch {
    throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')
  }
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')

  const container = `supabase_db_${projectId}`
  let running: string
  try {
    running = adapter.inspectContainer(container)
  }
  catch {
    throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')
  }
  if (running !== 'true') throw new Error('LOCAL_SUPABASE_RUNTIME_REQUIRED')

  adapter.executeSql(container, DELETE_REGISTER_ROUTE_SQL, { route: REGISTER_ROUTE })
}
