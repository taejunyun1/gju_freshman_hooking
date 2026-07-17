import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve('scripts/verify-env.mjs')
const secret32 = (fill: number) => Buffer.alloc(32, fill).toString('base64url')
const required = {
  NUXT_CAMPAIGN_COOKIE_KEY: secret32(1),
  NUXT_NAME_HMAC_KEY: secret32(3),
  NUXT_PASSWORD_PEPPER_VERSION: '2',
  NUXT_PHONE_ENCRYPTION_KEY: secret32(4),
  NUXT_PHONE_HMAC_KEY: secret32(2),
  NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'safe-publishable-key',
  NUXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NUXT_PASSWORD_PEPPER: secret32(5),
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

  it('requires the dedicated campaign cookie key to encode exactly 32 bytes', () => {
    const result = runVerifier({ NUXT_CAMPAIGN_COOKIE_KEY: 'short-shared-secret' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('NUXT_CAMPAIGN_COOKIE_KEY')
    expect(result.stderr).not.toContain('short-shared-secret')
  })

  it.each([
    'NUXT_PHONE_HMAC_KEY',
    'NUXT_NAME_HMAC_KEY',
    'NUXT_PHONE_ENCRYPTION_KEY',
    'NUXT_PASSWORD_PEPPER',
  ])('requires %s to encode exactly 32 bytes', (name) => {
    const sentinel = `sentinel-${name}`
    const result = runVerifier({ [name]: sentinel })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(name)
    expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel)
  })

  it('requires a positive current password pepper version', () => {
    for (const version of ['0', '-1', '1.5', '01', '']) {
      const result = runVerifier({ NUXT_PASSWORD_PEPPER_VERSION: version })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('NUXT_PASSWORD_PEPPER_VERSION')
    }
  })

  it.each([
    ['NUXT_NAME_HMAC_KEY', required.NUXT_PHONE_HMAC_KEY],
    ['NUXT_PHONE_ENCRYPTION_KEY', required.NUXT_PASSWORD_PEPPER],
  ])('rejects duplicate key material assigned to %s', (name, duplicate) => {
    const result = runVerifier({ [name]: duplicate })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(name)
    expect(result.stderr).toContain('must use distinct key material')
    expect(`${result.stdout}${result.stderr}`).not.toContain(duplicate)
  })

  it('keeps the campaign cookie key outside the roster-key distinctness set', () => {
    const result = runVerifier({ NUXT_CAMPAIGN_COOKIE_KEY: required.NUXT_PHONE_HMAC_KEY })

    expect(result.status).toBe(0)
  })

  it('requires the previous password pepper and version together with a different version', () => {
    const previousSecret = secret32(6)
    const pepperOnly = runVerifier({ NUXT_PREVIOUS_PASSWORD_PEPPER: previousSecret })
    const versionOnly = runVerifier({ NUXT_PREVIOUS_PASSWORD_PEPPER_VERSION: '1' })
    const sameVersion = runVerifier({
      NUXT_PREVIOUS_PASSWORD_PEPPER: previousSecret,
      NUXT_PREVIOUS_PASSWORD_PEPPER_VERSION: '2',
    })
    const validPrevious = runVerifier({
      NUXT_PREVIOUS_PASSWORD_PEPPER: previousSecret,
      NUXT_PREVIOUS_PASSWORD_PEPPER_VERSION: '1',
    })

    expect(pepperOnly.status).not.toBe(0)
    expect(versionOnly.status).not.toBe(0)
    expect(sameVersion.status).not.toBe(0)
    expect(validPrevious.status).toBe(0)
  })

  it('rejects an optional previous pepper that duplicates any current key material', () => {
    const result = runVerifier({
      NUXT_PREVIOUS_PASSWORD_PEPPER: required.NUXT_NAME_HMAC_KEY,
      NUXT_PREVIOUS_PASSWORD_PEPPER_VERSION: '1',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('NUXT_PREVIOUS_PASSWORD_PEPPER')
    expect(result.stderr).toContain('must use distinct key material')
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

  it.each([
    'prefix=postgres://database.invalid/app',
    '{"database":"PoStGrEsQl://database.invalid/app"}',
  ])('rejects an embedded PostgreSQL URI in %s without printing its value', (embeddedUri) => {
    const sentinel = 'sentinel-embedded-database-secret'
    const unsafeValue = `${embeddedUri}?token=${sentinel}`
    const result = runVerifier({ NUXT_EMBEDDED_CONFIG: unsafeValue })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('NUXT_EMBEDDED_CONFIG')
    expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel)
    expect(`${result.stdout}${result.stderr}`).not.toContain(unsafeValue)
  })

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
