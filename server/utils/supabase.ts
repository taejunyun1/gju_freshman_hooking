import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const createServerSupabaseClient = (url: string, secretKey: string): SupabaseClient => {
  if (!url || !secretKey) throw new Error('SERVER_CONFIG_INVALID')

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

export const getServerSupabaseClient = (): SupabaseClient => {
  const runtimeConfig = useRuntimeConfig()
  return createServerSupabaseClient(runtimeConfig.public.supabaseUrl, runtimeConfig.supabaseSecretKey)
}
