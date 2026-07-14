import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'

const ADMIN_AUTH_MAX_AGE_MILLISECONDS = 8 * 60 * 60 * 1000

export type AdminContext = {
  userId: string
  role: 'admin'
  aal: 'aal2'
  authenticatedAt: Date
}

type VerifiedAccessToken = {
  userId: string
  aal: string
  authenticatedAt: Date
}

type ActiveAdmin = {
  id: string
  role: 'admin'
}

export type RequireAdminOptions = {
  recentAuthMinutes?: number
}

export type AdminAuthDependencies = {
  now?: () => Date
  readAccessToken: (event: unknown) => string | null
  verifyAccessToken: (accessToken: string) => Promise<VerifiedAccessToken | null>
  findActiveAdmin: (userId: string) => Promise<ActiveAdmin | null>
}

const getAuthenticatedAt = (claims: Record<string, unknown>): Date | null => {
  const authTime = claims.auth_time
  if (typeof authTime === 'number' && Number.isFinite(authTime) && authTime > 0) return new Date(authTime * 1000)

  const amr = claims.amr
  if (!Array.isArray(amr)) return null
  const timestamps = amr.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const timestamp = (item as Record<string, unknown>).timestamp
    return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0 ? [timestamp] : []
  })
  return timestamps.length === 0 ? null : new Date(Math.max(...timestamps) * 1000)
}

const createSupabaseDependencies = (client: SupabaseClient): Omit<AdminAuthDependencies, 'now' | 'readAccessToken'> => ({
  verifyAccessToken: async (accessToken) => {
    const { data, error } = await client.auth.getClaims(accessToken)
    if (error || !data?.claims) return null

    const claims = data.claims as Record<string, unknown>
    const userId = claims.sub
    const aal = claims.aal
    const authenticatedAt = getAuthenticatedAt(claims)
    if (typeof userId !== 'string' || typeof aal !== 'string' || !authenticatedAt || Number.isNaN(authenticatedAt.getTime())) return null
    return { userId, aal, authenticatedAt }
  },
  findActiveAdmin: async (userId) => {
    const { data, error } = await client.from('admin_users')
      .select('id,role,is_active')
      .eq('id', userId)
      .eq('is_active', true)
      .maybeSingle()
    if (error && error.code !== 'PGRST116') throw new Error('ADMIN_STORE_UNAVAILABLE')
    return data?.id === userId && data.role === 'admin' && data.is_active === true ? { id: userId, role: 'admin' } : null
  },
})

export const createRequireAdmin = (dependencies: AdminAuthDependencies) => async (
  event: unknown,
  options: RequireAdminOptions = {},
): Promise<AdminContext> => {
  const accessToken = dependencies.readAccessToken(event)
  if (!accessToken) throw new AppError('ADMIN_REQUIRED')

  const verified = await dependencies.verifyAccessToken(accessToken)
  if (!verified) throw new AppError('ADMIN_REQUIRED')
  if (verified.aal !== 'aal2') throw new AppError('MFA_REQUIRED')

  const now = (dependencies.now ?? (() => new Date()))()
  const age = now.getTime() - verified.authenticatedAt.getTime()
  const maxAge = Math.min(
    ADMIN_AUTH_MAX_AGE_MILLISECONDS,
    options.recentAuthMinutes === undefined ? ADMIN_AUTH_MAX_AGE_MILLISECONDS : options.recentAuthMinutes * 60 * 1000,
  )
  if (!Number.isFinite(age) || age < 0 || age > maxAge) throw new AppError('REAUTH_REQUIRED')

  const admin = await dependencies.findActiveAdmin(verified.userId)
  if (!admin || admin.role !== 'admin') throw new AppError('ADMIN_REQUIRED')

  return { userId: verified.userId, role: 'admin', aal: 'aal2', authenticatedAt: verified.authenticatedAt }
}

const accessTokenFromHeader = (event: unknown): string | null => {
  const authorization = getHeader(event as never, 'authorization')
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/u)
  return match?.[1] ?? null
}

export const getServerRequireAdmin = () => createRequireAdmin({
  ...createSupabaseDependencies(getServerSupabaseClient()),
  readAccessToken: accessTokenFromHeader,
})

export const requireAdmin = (event: unknown, options?: RequireAdminOptions): Promise<AdminContext> => (
  getServerRequireAdmin()(event, options)
)
