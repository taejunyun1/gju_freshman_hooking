import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type ClientFactory = (
  url: string,
  publishableKey: string,
  options: { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
) => SupabaseClient

export type AdminPasswordToken = {
  accessToken: string
  expiresIn: number
  userId: string
}

export const createAdminSupabaseClient = (
  url: string,
  publishableKey: string,
  factory: ClientFactory = createClient,
): SupabaseClient => {
  if (!url || !publishableKey) throw new Error('ADMIN_AUTH_CONFIG_REQUIRED')
  return factory(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

export const signInAdminWithPassword = async (
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<AdminPasswordToken> => {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  const session = data.session
  if (
    error
    || !session
    || typeof session.access_token !== 'string'
    || typeof session.expires_in !== 'number'
    || typeof session.user?.id !== 'string'
  ) throw new Error('ADMIN_AUTH_FAILED')

  const signedIn = {
    accessToken: session.access_token,
    expiresIn: session.expires_in,
    userId: session.user.id,
  }

  try {
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' })
    if (signOutError) throw signOutError
  }
  catch {
    throw new Error('ADMIN_AUTH_FAILED')
  }

  return signedIn
}

let adminSupabaseClient: SupabaseClient | undefined

export const getAdminSupabaseClient = (): SupabaseClient => {
  if (typeof window === 'undefined') throw new Error('ADMIN_AUTH_BROWSER_ONLY')
  if (adminSupabaseClient) return adminSupabaseClient

  const runtimeConfig = useRuntimeConfig()
  adminSupabaseClient = createAdminSupabaseClient(
    runtimeConfig.public.supabaseUrl,
    runtimeConfig.public.supabasePublishableKey,
  )
  return adminSupabaseClient
}
