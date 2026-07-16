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

for (const name of requiredNames) {
  if (!process.env[name]?.trim()) issues.push({ name, reason: 'missing or empty' })
}

if (process.env.NUXT_CAMPAIGN_COOKIE_KEY) {
  const encoded = process.env.NUXT_CAMPAIGN_COOKIE_KEY
  const canonical = (() => {
    try {
      const decoded = Buffer.from(encoded, 'base64url')
      return decoded.byteLength === 32 && decoded.toString('base64url') === encoded
    }
    catch {
      return false
    }
  })()
  if (!canonical) {
    issues.push({ name: 'NUXT_CAMPAIGN_COOKIE_KEY', reason: 'must encode exactly 32 bytes as unpadded base64url' })
  }
}

for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('NUXT_') && /postgres(?:ql)?:\/\//iu.test(value)) {
    issues.push({ name, reason: 'PostgreSQL URI is not allowed in a Worker variable' })
  }
}

if (issues.length > 0) {
  for (const issue of issues) console.error(`${issue.name}: ${issue.reason}`)
  process.exitCode = 1
}
else {
  console.log('Environment contract verified.')
}
