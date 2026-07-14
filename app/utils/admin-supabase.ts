import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type ClientFactory = (
  url: string,
  publishableKey: string,
  options: { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
) => SupabaseClient

export type AdminAuthenticationStep = {
  enrollment: null | {
    qrCode: string
    secret: string
  }
  factorId: string
}

export type VerifiedAdminToken = {
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

export const cancelAdminEnrollment = async (
  client: SupabaseClient,
  factorId: string,
): Promise<void> => {
  try {
    const { data, error } = await client.auth.mfa.unenroll({ factorId })
    if (error || data?.id !== factorId) throw new Error('ADMIN_AUTH_FAILED')
  }
  catch {
    throw new Error('ADMIN_AUTH_FAILED')
  }
}

export const beginAdminAuthentication = async (
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<AdminAuthenticationStep> => {
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error('ADMIN_AUTH_FAILED')

  const { data: factors, error: factorError } = await client.auth.mfa.listFactors()
  if (factorError || !factors) throw new Error('ADMIN_AUTH_FAILED')

  const staleTotpFactors = factors.all.filter(factor => (
    factor.factor_type === 'totp' && factor.status === 'unverified'
  ))
  for (const factor of staleTotpFactors) {
    await cancelAdminEnrollment(client, factor.id)
  }

  const verifiedTotp = factors.totp[0]
  if (verifiedTotp) return { enrollment: null, factorId: verifiedTotp.id }

  const { data: enrollment, error: enrollmentError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'PHOTO:NEXT administrator',
  })
  if (enrollmentError || !enrollment || enrollment.type !== 'totp') throw new Error('ADMIN_AUTH_FAILED')
  return {
    enrollment: {
      qrCode: enrollment.totp.qr_code,
      secret: enrollment.totp.secret,
    },
    factorId: enrollment.id,
  }
}

export const verifyAdminTotp = async (
  client: SupabaseClient,
  factorId: string,
  code: string,
): Promise<VerifiedAdminToken> => {
  if (!/^\d{6}$/u.test(code)) throw new Error('ADMIN_MFA_CODE_INVALID')
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId })
  if (challengeError || !challenge) throw new Error('ADMIN_AUTH_FAILED')

  const { data: verified, error: verifyError } = await client.auth.mfa.verify({
    challengeId: challenge.id,
    code,
    factorId,
  })
  if (
    verifyError
    || !verified
    || typeof verified.access_token !== 'string'
    || typeof verified.expires_in !== 'number'
    || typeof verified.user?.id !== 'string'
  ) throw new Error('ADMIN_AUTH_FAILED')

  return {
    accessToken: verified.access_token,
    expiresIn: verified.expires_in,
    userId: verified.user.id,
  }
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
