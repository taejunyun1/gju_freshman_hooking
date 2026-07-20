import type { AdminContext } from '../modules/identity/admin-auth'
import { getServerRequireAdmin } from '../modules/identity/admin-auth'
import { toAppError } from '../utils/app-error'

// This authentication guard intentionally follows 00-request-context.

type AdminEvent = {
  path?: string
  context: Record<string, unknown>
}

type AdminAuthMiddlewareDependencies = {
  requireAdmin: (event: unknown) => Promise<AdminContext>
}

const protectedAdminApiPrefixes = [
  '/api/admin/admission-cycles',
  '/api/admin/counseling',
  '/api/admin/export',
  '/api/admin/faculty',
  '/api/admin/resources',
  '/api/admin/students',
] as const

const isProtectedAdminPath = (path: string | undefined): boolean => {
  if (typeof path !== 'string') return false
  const queryIndex = path.indexOf('?')
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex)
  return protectedAdminApiPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export const createAdminAuthMiddleware = (dependencies: AdminAuthMiddlewareDependencies) => async (event: AdminEvent): Promise<void> => {
  if (!isProtectedAdminPath(event.path)) return
  event.context.admin = await dependencies.requireAdmin(event)
}

export default defineEventHandler(async (event) => {
  if (!isProtectedAdminPath(event.path)) return

  try {
    await createAdminAuthMiddleware({ requireAdmin: getServerRequireAdmin() })(event as unknown as AdminEvent)
  }
  catch (error) {
    const appError = toAppError(error)
    throw createError({ statusCode: appError.statusCode, statusMessage: appError.code })
  }
})
