import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPreviewDeploy } from '../../../scripts/deploy-preview.mjs'

describe('deployment and E2E safety contracts', () => {
  it('enables local authenticator MFA without enabling phone MFA', () => {
    const config = readFileSync('supabase/config.toml', 'utf8')
    const section = (name: string): string => {
      const start = config.indexOf(`[${name}]\n`)
      if (start < 0) return ''
      const contentStart = start + name.length + 3
      const end = config.indexOf('\n[', contentStart)
      return config.slice(contentStart, end < 0 ? config.length : end).trim()
    }

    expect(section('auth.mfa.totp')).toMatch(/(?:^|\n)enroll_enabled = true(?:\n|$)/u)
    expect(section('auth.mfa.totp')).toMatch(/(?:^|\n)verify_enabled = true(?:\n|$)/u)
    expect(section('auth.mfa.phone')).toMatch(/(?:^|\n)enroll_enabled = false(?:\n|$)/u)
    expect(section('auth.mfa.phone')).toMatch(/(?:^|\n)verify_enabled = false(?:\n|$)/u)
  })

  it('starts an isolated E2E server and keeps the database reset explicitly local', () => {
    const playwrightConfig = readFileSync('playwright.config.ts', 'utf8')
    const globalSetup = readFileSync('tests/e2e/global-setup.ts', 'utf8')

    expect(playwrightConfig).toMatch(/reuseExistingServer:\s*false/u)
    expect(playwrightConfig).toMatch(/workers:\s*1/u)
    expect(globalSetup).toContain("['exec', 'supabase', 'db', 'reset', '--local']")
  })

  it('keeps registration rate-limit isolation inside E2E support instead of the application API', () => {
    const studentSupport = readFileSync('tests/e2e/support/student.ts', 'utf8')
    const localRateLimitSupport = readFileSync('tests/e2e/support/local-registration-rate-limit.ts', 'utf8')
    const registerApi = readFileSync('server/api/student/register.post.ts', 'utf8')

    expect(studentSupport).toContain('clearLocalRegistrationRateLimitBuckets')
    expect(localRateLimitSupport).toContain("'/api/student/register'")
    expect(localRateLimitSupport).toContain("where route = :'route'")
    expect(registerApi).not.toMatch(/e2e|playwright|x-test|bypass/iu)
  })

  it('arms counseling prospect cleanup before creating dependent fixtures', () => {
    const counselingE2e = readFileSync('tests/e2e/counseling.spec.ts', 'utf8')
    const studentSupport = readFileSync('tests/e2e/support/student.ts', 'utf8')
    const responseRead = 'const registerResponse = await registerResponsePromise'
    const callbackInvocation = 'await onRegistered?.({ nickname })'
    const credentialsCheck = "await expect(page).toHaveURL('/credentials')"
    const loginNavigation = "await page.getByRole('link', { name: '로그인하러 가기' }).click()"
    const counselingCallback = 'async ({ nickname: registeredNickname }) => {'
    const prospectAssignment = 'fixture.prospectId = await findProspectId(client, registeredNickname)'
    const facultyCreation = 'const faculty = await createFaculty(suffix)'
    const resultCreation = 'createOwnedResult(client, fixture.prospectId, faculty)'

    expect(studentSupport).toContain(responseRead)
    expect(studentSupport).toContain(callbackInvocation)
    expect(studentSupport.indexOf(responseRead)).toBeLessThan(studentSupport.indexOf(callbackInvocation))
    expect(studentSupport.indexOf(callbackInvocation)).toBeLessThan(studentSupport.indexOf(credentialsCheck))
    expect(studentSupport.indexOf(callbackInvocation)).toBeLessThan(studentSupport.indexOf(loginNavigation))
    expect(counselingE2e).toContain(counselingCallback)
    expect(counselingE2e).toContain(prospectAssignment)
    expect(counselingE2e).toContain(resultCreation)
    expect(counselingE2e.indexOf(prospectAssignment)).toBeLessThan(counselingE2e.indexOf(facultyCreation))
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

  it('routes Wrangler through the checked-in body guard before generated Nitro output', () => {
    const wrangler = readFileSync('wrangler.jsonc', 'utf8')
    const worker = readFileSync('cloudflare/worker.mjs', 'utf8')
    const guard = readFileSync('cloudflare/request-body-guard.mjs', 'utf8')
    const guardTypes = readFileSync('cloudflare/request-body-guard.d.mts', 'utf8')

    expect(wrangler).toMatch(/"main":\s*"cloudflare\/worker\.mjs"/u)
    expect(worker).toContain("from '../.output/server/index.mjs'")
    expect(worker).toContain('createBodyGuardWorker')
    expect(guard).toMatch(/DEFAULT_MAX_REQUEST_BODY_BYTES\s*=\s*65_536/u)
    expect(guardTypes).toContain('DEFAULT_MAX_REQUEST_BODY_BYTES')
  })
})
