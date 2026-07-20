import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'

const requiredNames = [
  'NUXT_PUBLIC_SUPABASE_URL',
  'NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NUXT_SUPABASE_SECRET_KEY',
  'NUXT_PHONE_HMAC_KEY',
  'NUXT_NAME_HMAC_KEY',
  'NUXT_PHONE_ENCRYPTION_KEY',
  'NUXT_PASSWORD_PEPPER',
  'NUXT_PASSWORD_PEPPER_VERSION',
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

const exactSecretNames = [
  'NUXT_PHONE_HMAC_KEY',
  'NUXT_NAME_HMAC_KEY',
  'NUXT_PHONE_ENCRYPTION_KEY',
  'NUXT_PASSWORD_PEPPER',
]

const decodedSecrets = new Map()
for (const name of exactSecretNames) {
  const encoded = process.env[name]?.trim()
  if (encoded) {
    if (!isCanonicalExactBase64urlSecret(encoded, 32)) {
      issues.push({ name, reason: 'must encode exactly 32 bytes as unpadded base64url' })
    }
    else decodedSecrets.set(name, Buffer.from(encoded, 'base64url'))
  }
}

const positiveVersion = (value) => /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value))
const currentPasswordVersion = process.env.NUXT_PASSWORD_PEPPER_VERSION?.trim() ?? ''
if (currentPasswordVersion && !positiveVersion(currentPasswordVersion)) {
  issues.push({ name: 'NUXT_PASSWORD_PEPPER_VERSION', reason: 'must be a positive integer' })
}

const previousPasswordPepper = process.env.NUXT_PREVIOUS_PASSWORD_PEPPER?.trim() ?? ''
const previousPasswordVersion = process.env.NUXT_PREVIOUS_PASSWORD_PEPPER_VERSION?.trim() ?? ''
if ((previousPasswordPepper === '') !== (previousPasswordVersion === '')) {
  issues.push({
    name: 'NUXT_PREVIOUS_PASSWORD_PEPPER/NUXT_PREVIOUS_PASSWORD_PEPPER_VERSION',
    reason: 'must be configured together',
  })
}
else if (previousPasswordPepper !== '') {
  if (!isCanonicalExactBase64urlSecret(previousPasswordPepper, 32)) {
    issues.push({
      name: 'NUXT_PREVIOUS_PASSWORD_PEPPER',
      reason: 'must encode exactly 32 bytes as unpadded base64url',
    })
  }
  else {
    decodedSecrets.set('NUXT_PREVIOUS_PASSWORD_PEPPER', Buffer.from(previousPasswordPepper, 'base64url'))
  }
  if (!positiveVersion(previousPasswordVersion)) {
    issues.push({ name: 'NUXT_PREVIOUS_PASSWORD_PEPPER_VERSION', reason: 'must be a positive integer' })
  }
  else if (previousPasswordVersion === currentPasswordVersion) {
    issues.push({
      name: 'NUXT_PREVIOUS_PASSWORD_PEPPER_VERSION',
      reason: 'must differ from NUXT_PASSWORD_PEPPER_VERSION',
    })
  }
}

const seenSecretBytes = new Map()
for (const [name, bytes] of decodedSecrets) {
  const fingerprint = bytes.toString('hex')
  const priorName = seenSecretBytes.get(fingerprint)
  if (priorName !== undefined) {
    issues.push({ name, reason: `must use distinct key material from ${priorName}` })
  }
  else {
    seenSecretBytes.set(fingerprint, name)
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

const publicOutputRelativePath = '.output/public'
const publicOutputPath = fileURLToPath(new URL(`../${publicOutputRelativePath}`, import.meta.url))
const forbiddenPublicMarkers = ['OPENAI_API_KEY', 'server-test-key']
const forbiddenPublicMarkerBuffers = forbiddenPublicMarkers.map(marker => Buffer.from(marker))
const publicScanChunkBytes = 64 * 1024
const publicScanOverlapBytes = Math.max(
  ...forbiddenPublicMarkerBuffers.map(marker => marker.byteLength),
) - 1
const fileContainsForbiddenPublicMarker = (path) => {
  const descriptor = openSync(path, 'r')
  const chunk = Buffer.allocUnsafe(publicScanChunkBytes)
  let overlap = Buffer.alloc(0)
  try {
    while (true) {
      const bytesRead = readSync(descriptor, chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) return false
      const current = overlap.byteLength === 0
        ? chunk.subarray(0, bytesRead)
        : Buffer.concat([overlap, chunk.subarray(0, bytesRead)])
      if (forbiddenPublicMarkerBuffers.some(marker => current.includes(marker))) return true
      overlap = Buffer.from(current.subarray(
        Math.max(0, current.byteLength - publicScanOverlapBytes),
      ))
    }
  }
  finally {
    closeSync(descriptor)
  }
}

if (existsSync(publicOutputPath)) {
  const pending = [publicOutputPath]
  let markerFound = false
  while (pending.length > 0 && !markerFound) {
    const current = pending.pop()
    if (current === undefined) break
    for (const name of readdirSync(current)) {
      const path = `${current}/${name}`
      const stat = statSync(path)
      if (stat.isDirectory()) pending.push(path)
      else if (stat.isFile() && fileContainsForbiddenPublicMarker(path)) {
        markerFound = true
        break
      }
    }
  }
  if (markerFound) {
    issues.push({
      name: publicOutputRelativePath,
      reason: 'public build contains a forbidden OpenAI secret marker',
    })
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
