import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPreviewDeploy } from '../../../scripts/deploy-preview.mjs'
import { isMinorRolloutApprovalId } from '../../../server/utils/openai-career-approval'

describe('deployment and E2E safety contracts', () => {
  const baseEnvironment = () => ({
    HOME: process.env.HOME ?? '',
    PATH: process.env.PATH ?? '',
    NUXT_CAMPAIGN_COOKIE_KEY: 'A'.repeat(43),
    NUXT_PHONE_ENCRYPTION_KEY: 'safe-encryption-key',
    NUXT_PHONE_HMAC_KEY: 'safe-hmac-key',
    NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'safe-publishable-key',
    NUXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NUXT_PASSWORD_PEPPER: 'safe-password-pepper',
    NUXT_SUPABASE_SECRET_KEY: 'safe-secret-key',
  })

  const verifyEnvironment = (overrides: Record<string, string | undefined> = {}) => {
    const env: Record<string, string> = baseEnvironment()
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) Reflect.deleteProperty(env, name)
      else env[name] = value
    }
    return spawnSync(process.execPath, ['scripts/verify-env.mjs'], {
      encoding: 'utf8',
      env,
    })
  }

  it('keeps OpenAI server secrets optional as a deterministic production fallback', () => {
    const result = verifyEnvironment()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Environment contract verified.')
  })

  it.each([
    [{ OPENAI_API_KEY: 'server-key' }, 'OPENAI_API_KEY and OPENAI_SAFETY_HMAC_KEY must be configured together'],
    [{
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: 'not-base64url!',
    }, 'must encode exactly 32 bytes as unpadded base64url'],
    [{
      OPENAI_CAREER_NARRATIVE_MODEL: 'gpt-5.6',
    }, 'must be gpt-5.6-sol or gpt-5.6-luna'],
    [{
      OPENAI_CAREER_NARRATIVE_TIMEOUT_MS: '1999',
    }, 'must be an integer from 2000 through 8000'],
    [{
      OPENAI_CAREER_NARRATIVE_DAILY_CAP: '10001',
    }, 'must be an integer from 1 through 10000'],
    [{
      OPENAI_CAREER_NARRATIVE_PROSPECT_CAP: '4',
    }, 'must remain exactly 5'],
    [{
      NUXT_PUBLIC_OPENAI_API_KEY: '',
    }, 'public OpenAI variables are forbidden'],
  ] as const)('rejects an unsafe OpenAI deployment environment: %#', (overrides, message) => {
    const result = verifyEnvironment(overrides)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(message)
  })

  it('keeps production provider activation closed until the minor rollout evidence exists', () => {
    const result = verifyEnvironment({
      NODE_ENV: 'production',
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: 'A'.repeat(43),
      OPENAI_CAREER_NARRATIVE_MODEL: 'gpt-5.6-sol',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('OPENAI_CAREER_NARRATIVE_MINOR_ROLLOUT_APPROVAL_ID')
    expect(result.stderr).toContain('docs/operations/evidence/openai-career-model-eval.md')
  })

  it('uses the same colon-form approval identifier in deployment and runtime gates', () => {
    const approvalId = 'minor-rollout:2026-07-16:privacy-owner'
    const result = verifyEnvironment({
      NODE_ENV: 'production',
      OPENAI_API_KEY: 'server-key',
      OPENAI_SAFETY_HMAC_KEY: 'A'.repeat(43),
      OPENAI_CAREER_NARRATIVE_MODEL: 'gpt-5.6-sol',
      OPENAI_CAREER_NARRATIVE_MINOR_ROLLOUT_APPROVAL_ID: approvalId,
    })

    expect(isMinorRolloutApprovalId(approvalId)).toBe(true)
    expect(result.status).not.toBe(0)
    expect(result.stderr).not.toContain('OPENAI_CAREER_NARRATIVE_MINOR_ROLLOUT_APPROVAL_ID')
    expect(result.stderr).toContain('docs/operations/evidence/openai-career-model-eval.md')
  })

  it('keeps the paid model evaluation closed by default without provider calls or evidence', () => {
    const artifact = join(tmpdir(), `photo-next-paid-eval-${crypto.randomUUID()}.json`)
    const result = spawnSync(process.execPath, ['scripts/eval-openai-career-narrative.mjs'], {
      encoding: 'utf8',
      env: {
        HOME: process.env.HOME ?? '',
        PATH: process.env.PATH ?? '',
        OPENAI_API_KEY: 'must-not-be-used',
        PHOTO_NEXT_OPENAI_EVAL_ARTIFACT: artifact,
      },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Paid OpenAI evaluation is disabled.')
    expect(existsSync(artifact)).toBe(false)
    expect(existsSync('docs/operations/evidence/openai-career-model-eval.md')).toBe(false)
  })

  it('gates a synthetic aggregate-only sol/luna evaluation and never writes approval evidence', () => {
    const source = readFileSync('scripts/eval-openai-career-narrative.mjs', 'utf8')

    expect(source).toContain("PHOTO_NEXT_RUN_PAID_OPENAI_EVAL !== '1'")
    expect(source).toContain('PHOTO_NEXT_OPENAI_EVAL_API_KEY')
    expect(source).not.toMatch(/process\.env\.OPENAI_API_KEY/u)
    expect(source).toContain("'gpt-5.6-sol'")
    expect(source).toContain("'gpt-5.6-luna'")
    expect(source).toContain('20')
    expect(source).toContain('documentary-social')
    expect(source).toContain('documentary-archive')
    expect(source).toContain('art-photo')
    expect(source).toContain('commercial')
    expect(source).toContain('video-ai-drone')
    expect(source).toContain('prompt-injection-title')
    expect(source).toContain('refusal')
    expect(source).not.toContain('docs/operations/evidence/openai-career-model-eval.md')
    expect(source).not.toMatch(/nickname|phone|school|careerOther|equipment|facility/iu)
  })

  it('scans built public assets for both the OpenAI key name and test marker', () => {
    const verifier = readFileSync('scripts/verify-env.mjs', 'utf8')

    expect(verifier).toContain('.output/public')
    expect(verifier).toContain('OPENAI_API_KEY')
    expect(verifier).toContain('server-test-key')
  })

  it('scans forbidden markers beyond the first 8 MiB without loading the whole asset', () => {
    const root = mkdtempSync(join(tmpdir(), 'photo-next-public-scan-'))
    const scripts = join(root, 'scripts')
    const publicOutput = join(root, '.output', 'public')
    const verifier = join(scripts, 'verify-env.mjs')
    mkdirSync(scripts, { recursive: true })
    mkdirSync(publicOutput, { recursive: true })
    writeFileSync(verifier, readFileSync('scripts/verify-env.mjs'))
    writeFileSync(
      join(publicOutput, 'large-client-bundle.js'),
      Buffer.concat([
        Buffer.alloc(8 * 1024 * 1024 + 17, 0x61),
        Buffer.from('OPENAI_API_KEY'),
      ]),
    )

    try {
      const result = spawnSync(process.execPath, [verifier], {
        encoding: 'utf8',
        env: baseEnvironment(),
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('public build contains a forbidden OpenAI secret marker')
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps OpenAI out of Wrangler required secrets and preserves the approved runtime date', () => {
    const wrangler = readFileSync('wrangler.jsonc', 'utf8')

    expect(wrangler).toContain('"compatibility_date": "2026-07-14"')
    expect(wrangler).toContain('"nodejs_compat"')
    expect(wrangler).not.toMatch(/OPENAI_API_KEY|OPENAI_SAFETY_HMAC_KEY/u)
    expect(wrangler).not.toMatch(/"secrets"\s*:/u)
  })

  it('documents the exact provider-off release, minor policy, data boundary, and interactive secret workflow', () => {
    const runbook = readFileSync('docs/operations/openai-career-narrative.md', 'utf8')

    for (const command of [
      'pnpm wrangler secret put OPENAI_API_KEY --env staging',
      'pnpm wrangler secret put OPENAI_SAFETY_HMAC_KEY --env staging',
      'pnpm wrangler secret put OPENAI_API_KEY',
      'pnpm wrangler secret put OPENAI_SAFETY_HMAC_KEY',
    ]) {
      expect(runbook).toContain(command)
    }
    expect(runbook).toContain('프로덕션 기본값: provider 비활성')
    expect(runbook).toContain('under-14 or unknown')
    expect(runbook).toContain('같은 영업일')
    expect(runbook).toContain('resolved_inaccurate')
    expect(runbook).toContain('resolved_unsafe')
    expect(runbook).toContain('resolved_copy')
    expect(runbook).toContain('dismissed')
    expect(runbook).toContain('store:false')
    expect(runbook).toContain('최대 30일')
    expect(runbook).toContain('ZDR이 승인·설정되었다고 주장하지 않는다')
    expect(runbook).toContain('법률 자문이 아니다')
    expect(runbook).toContain('대화창')
    expect(runbook).toContain('shell history')
  })

  it('amends S6 retention and provider-disabled/provider-enabled performance gates', () => {
    const s6 = readFileSync(
      'docs/superpowers/plans/2026-07-14-photo-next-s6-operations-deployment.md',
      'utf8',
    )

    expect(s6).toContain('assessment_narrative_generations')
    expect(s6).toContain('career_narrative_reports')
    expect(s6).toContain('24 hours')
    expect(s6).toContain('30 days')
    expect(s6).toContain('2,000ms')
    expect(s6).toContain('7,000ms')
    expect(s6).toContain('12,000ms')
    expect(s6).toContain('15,000ms')
    expect(s6).toContain('api.openai.com')
  })

  it('documents only blank OpenAI secrets and bounded non-secret defaults', () => {
    const example = readFileSync('.env.example', 'utf8')

    expect(example).toContain('OPENAI_API_KEY=\n')
    expect(example).toContain('OPENAI_SAFETY_HMAC_KEY=\n')
    expect(example).toContain('OPENAI_CAREER_NARRATIVE_MODEL=gpt-5.6-sol\n')
    expect(example).toContain('OPENAI_CAREER_NARRATIVE_TIMEOUT_MS=5000\n')
    expect(example).toContain('OPENAI_CAREER_NARRATIVE_DAILY_CAP=500\n')
    expect(example).toContain('OPENAI_CAREER_NARRATIVE_PROSPECT_CAP=5\n')
    expect(example).not.toContain('server-test-key')
    expect(example).not.toMatch(/^NUXT_PUBLIC_OPENAI/mu)
  })

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

  it('serializes local integration files that share one real Supabase database', () => {
    const vitest = readFileSync('vitest.config.ts', 'utf8')
    const localProject = vitest.slice(vitest.indexOf("name: 'local-integration'"))

    expect(localProject).toMatch(/fileParallelism:\s*false/u)
  })

  it('forces the E2E server onto deterministic narrative fallback even when parent secrets exist', () => {
    const playwrightConfig = readFileSync('playwright.config.ts', 'utf8')

    expect(playwrightConfig).toMatch(/OPENAI_API_KEY:\s*''/u)
    expect(playwrightConfig).toMatch(/OPENAI_SAFETY_HMAC_KEY:\s*''/u)
    expect(playwrightConfig).toMatch(
      /OPENAI_CAREER_NARRATIVE_MINOR_ROLLOUT_APPROVAL_ID:\s*''/u,
    )
    expect(playwrightConfig).toMatch(/env:\s*localRuntimeEnvironment\(\)/u)
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
          NUXT_CAMPAIGN_COOKIE_KEY: 'A'.repeat(43),
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

  it('keeps the generated staging worker free of duplicate object keys', () => {
    const build = spawnSync('pnpm', ['build'], {
      encoding: 'utf8',
      env: baseEnvironment(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    })
    const buildOutput = `${build.stdout ?? ''}${build.stderr ?? ''}`
    expect(build.status, buildOutput).toBe(0)

    const preview = spawnSync(
      'pnpm',
      ['exec', 'wrangler', 'deploy', '--env', 'staging', '--dry-run'],
      {
        encoding: 'utf8',
        env: baseEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60_000,
      },
    )
    const previewOutput = `${preview.stdout ?? ''}${preview.stderr ?? ''}`
    expect(preview.status, previewOutput).toBe(0)
    expect(previewOutput).not.toContain('[duplicate-object-key]')
  }, 120_000)

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
