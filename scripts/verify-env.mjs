import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const requiredNames = [
  'NUXT_PUBLIC_SUPABASE_URL',
  'NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NUXT_SUPABASE_SECRET_KEY',
  'NUXT_PHONE_HMAC_KEY',
  'NUXT_PHONE_ENCRYPTION_KEY',
  'NUXT_PASSWORD_PEPPER',
  'NUXT_CAMPAIGN_COOKIE_KEY',
]

const issues = []
const openAiModelNames = new Set(['gpt-5.6-sol', 'gpt-5.6-luna'])
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
const openAiSafetyHmacKey = process.env.OPENAI_SAFETY_HMAC_KEY?.trim() ?? ''
const openAiModel = process.env.OPENAI_CAREER_NARRATIVE_MODEL?.trim() || 'gpt-5.6-sol'
const openAiTimeout = process.env.OPENAI_CAREER_NARRATIVE_TIMEOUT_MS?.trim() || '5000'
const openAiDailyCap = process.env.OPENAI_CAREER_NARRATIVE_DAILY_CAP?.trim() || '500'
const openAiProspectCap = process.env.OPENAI_CAREER_NARRATIVE_PROSPECT_CAP?.trim() || '5'

for (const name of requiredNames) {
  if (!process.env[name]?.trim()) issues.push({ name, reason: 'missing or empty' })
}

const isCanonicalExactBase64urlSecret = (encoded, byteLength) => {
  try {
    const decoded = Buffer.from(encoded, 'base64url')
    return decoded.byteLength === byteLength && decoded.toString('base64url') === encoded
  }
  catch {
    return false
  }
}

if (process.env.NUXT_CAMPAIGN_COOKIE_KEY) {
  const encoded = process.env.NUXT_CAMPAIGN_COOKIE_KEY
  const canonical = (() => {
    return isCanonicalExactBase64urlSecret(encoded, 32)
  })()
  if (!canonical) {
    issues.push({ name: 'NUXT_CAMPAIGN_COOKIE_KEY', reason: 'must encode exactly 32 bytes as unpadded base64url' })
  }
}

if ((openAiApiKey === '') !== (openAiSafetyHmacKey === '')) {
  issues.push({
    name: 'OPENAI_API_KEY/OPENAI_SAFETY_HMAC_KEY',
    reason: 'OPENAI_API_KEY and OPENAI_SAFETY_HMAC_KEY must be configured together',
  })
}

if (
  openAiSafetyHmacKey !== ''
  && !isCanonicalExactBase64urlSecret(openAiSafetyHmacKey, 32)
) {
  issues.push({
    name: 'OPENAI_SAFETY_HMAC_KEY',
    reason: 'must encode exactly 32 bytes as unpadded base64url',
  })
}

if (!openAiModelNames.has(openAiModel)) {
  issues.push({
    name: 'OPENAI_CAREER_NARRATIVE_MODEL',
    reason: 'must be gpt-5.6-sol or gpt-5.6-luna',
  })
}

const verifyBoundedInteger = (name, raw, minimum, maximum, reason) => {
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
    issues.push({ name, reason })
    return
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    issues.push({ name, reason })
  }
}

verifyBoundedInteger(
  'OPENAI_CAREER_NARRATIVE_TIMEOUT_MS',
  openAiTimeout,
  2_000,
  8_000,
  'must be an integer from 2000 through 8000',
)
verifyBoundedInteger(
  'OPENAI_CAREER_NARRATIVE_DAILY_CAP',
  openAiDailyCap,
  1,
  10_000,
  'must be an integer from 1 through 10000',
)
verifyBoundedInteger(
  'OPENAI_CAREER_NARRATIVE_PROSPECT_CAP',
  openAiProspectCap,
  5,
  5,
  'must remain exactly 5',
)

for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('NUXT_') && /postgres(?:ql)?:\/\//iu.test(value)) {
    issues.push({ name, reason: 'PostgreSQL URI is not allowed in a Worker variable' })
  }
  if (name.startsWith('NUXT_PUBLIC_OPENAI')) {
    issues.push({ name, reason: 'public OpenAI variables are forbidden' })
  }
}

if (process.env.NODE_ENV === 'production' && openAiApiKey !== '' && openAiSafetyHmacKey !== '') {
  if (openAiModel !== 'gpt-5.6-sol') {
    issues.push({
      name: 'OPENAI_CAREER_NARRATIVE_MODEL',
      reason: 'production provider activation must remain on gpt-5.6-sol',
    })
  }

  const approvalId = process.env.OPENAI_CAREER_NARRATIVE_MINOR_ROLLOUT_APPROVAL_ID?.trim() ?? ''
  if (!/^minor-rollout:\d{4}-\d{2}-\d{2}:[A-Za-z0-9._-]{3,80}$/u.test(approvalId)) {
    issues.push({
      name: 'OPENAI_CAREER_NARRATIVE_MINOR_ROLLOUT_APPROVAL_ID',
      reason: 'requires a dated minor-rollout approval identifier',
    })
  }

  const evidenceRelativePath = 'docs/operations/evidence/openai-career-model-eval.md'
  const evidencePath = fileURLToPath(new URL(`../${evidenceRelativePath}`, import.meta.url))
  if (!existsSync(evidencePath)) {
    issues.push({
      name: evidenceRelativePath,
      reason: 'checked-in aggregate model evaluation approval is required',
    })
  }
  else {
    const evidence = readFileSync(evidencePath, 'utf8')
    if (!evidence.includes('gpt-5.6-sol') || approvalId === '' || !evidence.includes(approvalId)) {
      issues.push({
        name: evidenceRelativePath,
        reason: 'must name gpt-5.6-sol and the active minor-rollout approval identifier',
      })
    }
  }
}

if (issues.length > 0) {
  for (const issue of issues) console.error(`${issue.name}: ${issue.reason}`)
  process.exitCode = 1
}
else {
  console.log('Environment contract verified.')
}
