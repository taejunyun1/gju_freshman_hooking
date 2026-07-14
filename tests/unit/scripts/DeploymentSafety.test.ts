import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPreviewDeploy } from '../../../scripts/deploy-preview.mjs'

describe('deployment and E2E safety contracts', () => {
  it('starts an isolated E2E server and keeps the database reset explicitly local', () => {
    const playwrightConfig = readFileSync('playwright.config.ts', 'utf8')
    const globalSetup = readFileSync('tests/e2e/global-setup.ts', 'utf8')

    expect(playwrightConfig).toMatch(/reuseExistingServer:\s*false/u)
    expect(globalSetup).toContain("['exec', 'supabase', 'db', 'reset', '--local']")
  })

  it.each(['--no-dry-run', '--dry-run=false'])(
    'rejects the package-level %s override before Wrangler can run',
    (override) => {
      const fakeBin = mkdtempSync(join(tmpdir(), 'photo-next-preview-'))
      const marker = join(fakeBin, 'wrangler-was-run')
      const fakeWrangler = join(fakeBin, 'wrangler')
      writeFileSync(fakeWrangler, '#!/bin/sh\ntouch "$WRANGLER_MARKER"\nexit 91\n')
      chmodSync(fakeWrangler, 0o755)

      const result = spawnSync('pnpm', ['deploy:preview', '--', override], {
        encoding: 'utf8',
        env: {
          ...process.env,
          NUXT_PHONE_ENCRYPTION_KEY: 'safe-encryption-key',
          NUXT_PHONE_HMAC_KEY: 'safe-hmac-key',
          NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'safe-publishable-key',
          NUXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
          NUXT_PASSWORD_PEPPER: 'safe-password-pepper',
          NUXT_SUPABASE_SECRET_KEY: 'safe-secret-key',
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          WRANGLER_MARKER: marker,
        },
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('does not accept arguments')
      expect(existsSync(marker)).toBe(false)
      rmSync(fakeBin, { force: true, recursive: true })
    },
  )

  it('runs Wrangler with only the fixed staging dry-run arguments', () => {
    const calls: unknown[][] = []
    const status = runPreviewDeploy([], (...args: unknown[]) => {
      calls.push(args)
      return { status: 0 }
    })

    expect(status).toBe(0)
    expect(calls).toEqual([
      ['wrangler', ['deploy', '--env', 'staging', '--dry-run'], { stdio: 'inherit' }],
    ])
  })

  it('keeps the package preview command behind verification and the closed wrapper', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['deploy:preview']).toBe(
      'node scripts/verify-env.mjs && node scripts/deploy-preview.mjs',
    )
  })
})
