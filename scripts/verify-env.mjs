const requiredNames = [
  'NUXT_PUBLIC_SUPABASE_URL',
  'NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NUXT_SUPABASE_SECRET_KEY',
  'NUXT_PHONE_HMAC_KEY',
  'NUXT_PHONE_ENCRYPTION_KEY',
  'NUXT_PASSWORD_PEPPER',
]

const issues = []

for (const name of requiredNames) {
  if (!process.env[name]?.trim()) issues.push({ name, reason: 'missing or empty' })
}

for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('NUXT_') && /^postgres(?:ql)?:\/\//iu.test(value.trim())) {
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
