import type { AdminContext } from '../modules/identity/admin-auth'
import { getServerRequireAdmin } from '../modules/identity/admin-auth'
import { toAppError } from '../utils/app-error'

type AdminEvent = {
  path?: string
  context: Record<string, unknown>
}

type AdminAuthMiddlewareDependencies = {
  requireAdmin: (event: unknown) => Promise<AdminContext>
}

const isProtectedAdminPath = (path: string | undefined): boolean => (
  typeof path === 'string' && path.startsWith('/api/admin/') && path !== '/api/admin/session'
)

export const createAdminAuthMiddleware = (dependencies: AdminAuthMiddlewareDependencies) => async (event: AdminEvent): Promise<void> => {
  if (!isProtectedAdminPath(event.path)) return
  event.context.admin = await dependencies.requireAdmin(event)
}

export default defineEventHandler(async (event) => {
  try {
    await createAdminAuthMiddleware({ requireAdmin: getServerRequireAdmin() })(event as unknown as AdminEvent)
  }
  catch (error) {
    const appError = toAppError(error)
    throw createError({ statusCode: appError.statusCode, statusMessage: appError.code })
  }
})
