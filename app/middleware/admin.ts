import { useAdminSessionStore } from '../stores/admin-session'

type AdminRoute = {
  fullPath: string
  path: string
}

type AdminSessionGuard = {
  clear: () => void
  hasVerifiedSession: () => boolean
  restoreFromSessionStorage: () => void
}

type AdminLoginTarget = {
  path: string
  query: { redirect: string }
  replace: true
}

const safeAdminRedirect = (route: AdminRoute): string => (
  route.fullPath.startsWith('/admin/') && !route.fullPath.startsWith('//')
    ? route.fullPath
    : '/admin'
)

export const createAdminRouteGuard = <NavigationResult>(
  session: AdminSessionGuard,
  navigate: (target: AdminLoginTarget) => NavigationResult,
  runtime: { server: boolean },
) => (
  to: AdminRoute,
): NavigationResult | undefined => {
  if (to.path === '/admin/login') return
  if (runtime.server) return

  session.restoreFromSessionStorage()
  if (session.hasVerifiedSession()) return

  session.clear()
  return navigate({
    path: '/admin/login',
    query: { redirect: safeAdminRedirect(to) },
    replace: true,
  })
}

export default defineNuxtRouteMiddleware((to) => {
  const session = useAdminSessionStore()
  return createAdminRouteGuard({
    clear: session.clear,
    hasVerifiedSession: session.hasVerifiedSession,
    restoreFromSessionStorage: session.restoreFromSessionStorage,
  }, navigateTo, { server: import.meta.server })({ fullPath: to.fullPath, path: to.path })
})
