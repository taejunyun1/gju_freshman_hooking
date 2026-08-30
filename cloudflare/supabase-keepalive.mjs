const keepalivePath = '/rest/v1/admission_cycles?select=id&limit=1'

export const createSupabaseKeepalive = ({ fetchImpl = fetch } = {}) => async (environment) => {
  const supabaseUrl = environment.NUXT_PUBLIC_SUPABASE_URL
  const publishableKey = environment.NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (typeof supabaseUrl !== 'string' || supabaseUrl === '' || typeof publishableKey !== 'string' || publishableKey === '') {
    throw new Error('SUPABASE_KEEPALIVE_CONFIG_REQUIRED')
  }

  const response = await fetchImpl(new URL(keepalivePath, supabaseUrl).toString(), {
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${publishableKey}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`SUPABASE_KEEPALIVE_FAILED:${response.status}`)

  return { status: 'ok' }
}
