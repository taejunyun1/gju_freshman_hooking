import { createClient } from '@supabase/supabase-js'

type BootstrapInput = {
  email: string
  password: string
  supabaseUrl: string
}

export type LocalAdminBootstrapAdapter = {
  createUser: (email: string, password: string) => Promise<string>
  signIn: (email: string, password: string) => Promise<void>
  upsertAdmin: (userId: string) => Promise<void>
}

export const isLocalSupabaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  }
  catch {
    return false
  }
}

export const bootstrapLocalAdmin = async (
  input: BootstrapInput,
  adapter: LocalAdminBootstrapAdapter,
  write: (message: string) => void,
): Promise<void> => {
  if (!isLocalSupabaseUrl(input.supabaseUrl)) throw new Error('LOCAL_SUPABASE_URL_REQUIRED')
  if (!input.email || !input.password) throw new Error('LOCAL_ADMIN_INPUT_REQUIRED')

  const userId = await adapter.createUser(input.email, input.password)
  await adapter.signIn(input.email, input.password)
  await adapter.upsertAdmin(userId)

  write('Local administrator ready. Sign in at /admin/login.')
}

const requiredEnvironmentValue = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error('LOCAL_ADMIN_ENV_REQUIRED')
  return value
}

const main = async (): Promise<void> => {
  const supabaseUrl = requiredEnvironmentValue('SUPABASE_URL')
  if (!isLocalSupabaseUrl(supabaseUrl)) throw new Error('LOCAL_SUPABASE_URL_REQUIRED')

  const secretKey = requiredEnvironmentValue('SUPABASE_SECRET_KEY')
  const publishableKey = requiredEnvironmentValue('SUPABASE_PUBLISHABLE_KEY')
  const email = requiredEnvironmentValue('PHOTO_NEXT_LOCAL_ADMIN_EMAIL')
  const password = requiredEnvironmentValue('PHOTO_NEXT_LOCAL_ADMIN_PASSWORD')
  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })

  await bootstrapLocalAdmin({ email, password, supabaseUrl }, {
    createUser: async (userEmail, userPassword) => {
      const { data, error } = await adminClient.auth.admin.createUser({
        email: userEmail,
        email_confirm: true,
        password: userPassword,
      })
      if (error || !data.user) throw new Error('LOCAL_ADMIN_CREATE_FAILED')
      return data.user.id
    },
    signIn: async (userEmail, userPassword) => {
      const { error } = await authClient.auth.signInWithPassword({ email: userEmail, password: userPassword })
      if (error) throw new Error('LOCAL_ADMIN_SIGN_IN_FAILED')
    },
    upsertAdmin: async (userId) => {
      const { error } = await adminClient.from('admin_users').upsert({ id: userId, is_active: true, role: 'admin' })
      if (error) throw new Error('LOCAL_ADMIN_ALLOW_LIST_FAILED')
    },
  }, message => process.stdout.write(`${message}\n`))
}

if (process.argv[1]?.endsWith('/scripts/bootstrap-local-admin.ts')) {
  main().catch(() => {
    process.stderr.write('Local administrator bootstrap failed.\n')
    process.exitCode = 1
  })
}
