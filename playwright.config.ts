import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1'

type SupabaseStatus = Record<string, unknown>

const readStatusValue = (status: SupabaseStatus, ...names: string[]): string => {
  for (const name of names) {
    const value = status[name]
    if (typeof value === 'string' && value.length > 0) return value
  }
  throw new Error('Local Supabase status is missing a required runtime field.')
}

const localRuntimeEnvironment = (): Record<string, string> => {
  let status: SupabaseStatus
  try {
    const output = execFileSync('pnpm', ['exec', 'supabase', 'status', '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    status = JSON.parse(output) as SupabaseStatus
  }
  catch {
    throw new Error('The local Supabase stack must be running before E2E tests.')
  }

  const supabaseUrl = readStatusValue(status, 'API_URL')
  const parsedUrl = new URL(supabaseUrl)
  if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
    throw new Error('E2E tests only support the local Supabase stack.')
  }

  return {
    NUXT_PHONE_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    NUXT_PHONE_HMAC_KEY: randomBytes(32).toString('base64url'),
    NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: readStatusValue(status, 'PUBLISHABLE_KEY', 'ANON_KEY'),
    NUXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NUXT_PASSWORD_PEPPER: randomBytes(32).toString('base64url'),
    NUXT_SUPABASE_SECRET_KEY: readStatusValue(status, 'SECRET_KEY', 'SERVICE_ROLE_KEY'),
  }
}

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    env: localRuntimeEnvironment(),
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
  },
})
