import { useAdminSessionStore } from '../stores/admin-session'

type AdminRoute = {
  fullPath: string
  path: string
}

type AdminSessionGuard = {
  clear: () => void
  isVerified: boolean
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
) => (
  to: AdminRoute,
): NavigationResult | undefined => {
  if (to.path === '/admin/login') return
  if (session.isVerified) return

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
    isVerified: session.hasVerifiedSession(),
  }, navigateTo)({ fullPath: to.fullPath, path: to.path })
})
