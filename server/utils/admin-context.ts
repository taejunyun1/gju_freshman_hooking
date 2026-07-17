import type { AdminContext } from '../modules/identity/admin-auth'
import { AppError } from './app-error'

const isAdminContext = (value: unknown): value is AdminContext => {
  if (!value || typeof value !== 'object') return false
  const admin = value as Record<string, unknown>
  return (
    typeof admin.userId === 'string'
    && admin.userId.length > 0
    && admin.role === 'admin'
    && (admin.aal === 'aal1' || admin.aal === 'aal2')
    && admin.authenticatedAt instanceof Date
    && !Number.isNaN(admin.authenticatedAt.getTime())
  )
}

export const getAdminContext = (event: unknown): AdminContext => {
  const admin = (event as { context?: { admin?: unknown } }).context?.admin
  if (!isAdminContext(admin)) throw new AppError('ADMIN_REQUIRED')
  return admin
}

export const requireRecentAdminContext = (event: unknown, minutes: number, now = new Date()): AdminContext => {
  const admin = getAdminContext(event)
  const age = now.getTime() - admin.authenticatedAt.getTime()
  if (!Number.isFinite(age) || age < 0 || age > minutes * 60_000) throw new AppError('REAUTH_REQUIRED')
  return admin
}
