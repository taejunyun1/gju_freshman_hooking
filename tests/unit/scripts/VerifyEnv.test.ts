import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve('scripts/verify-env.mjs')
const required = {
  NUXT_PHONE_ENCRYPTION_KEY: 'safe-encryption-key',
  NUXT_PHONE_HMAC_KEY: 'safe-hmac-key',
  NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'safe-publishable-key',
  NUXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NUXT_PASSWORD_PEPPER: 'safe-password-pepper',
  NUXT_SUPABASE_SECRET_KEY: 'safe-secret-key',
}

const runVerifier = (overrides: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [script], {
  encoding: 'utf8',
  env: { ...required, ...overrides },
})

describe('Worker environment verifier', () => {
  it('exits nonzero when a required runtime variable is absent or empty', () => {
    const missing = runVerifier({ NUXT_PHONE_HMAC_KEY: undefined })
    const empty = runVerifier({ NUXT_PASSWORD_PEPPER: '   ' })

    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain('NUXT_PHONE_HMAC_KEY')
    expect(empty.status).not.toBe(0)
    expect(empty.stderr).toContain('NUXT_PASSWORD_PEPPER')
  })

  it('accepts a complete runtime contract', () => {
    expect(runVerifier().status).toBe(0)
  })

  it.each(['postgres://database.invalid/app', 'postgresql://database.invalid/app'])(
    'rejects %s in any Nuxt Worker variable without printing its value',
    (databaseUri) => {
      const sentinel = 'sentinel-database-secret'
      const unsafeValue = `${databaseUri}?token=${sentinel}`
      const result = runVerifier({ NUXT_DATABASE_URL: unsafeValue })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('NUXT_DATABASE_URL')
      expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel)
      expect(`${result.stdout}${result.stderr}`).not.toContain(unsafeValue)
    },
  )

  it('never prints required secret values to stdout or stderr', () => {
    const sentinel = 'sentinel-secret-never-print'
    const result = runVerifier({
      NUXT_PHONE_HMAC_KEY: sentinel,
      NUXT_SUPABASE_SECRET_KEY: `postgresql://${sentinel}`,
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel)
  })
})
