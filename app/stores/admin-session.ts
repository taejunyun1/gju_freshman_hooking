import { defineStore } from 'pinia'
import { ref } from 'vue'

const ADMIN_SESSION_KEY = 'photo_next_admin_session_v1'

export type VerifiedAdminSession = {
  accessToken: string
  authenticatedAt: string
  expiresAt: string
  userId: string
}

const readStoredSession = (): VerifiedAdminSession | null => {
  if (typeof window === 'undefined') return null
  const stored = window.sessionStorage.getItem(ADMIN_SESSION_KEY)
  if (!stored) return null

  try {
    const session = JSON.parse(stored) as Partial<VerifiedAdminSession>
    if (
      typeof session.accessToken !== 'string'
      || typeof session.authenticatedAt !== 'string'
      || typeof session.expiresAt !== 'string'
      || typeof session.userId !== 'string'
    ) return null
    return {
      accessToken: session.accessToken,
      authenticatedAt: session.authenticatedAt,
      expiresAt: session.expiresAt,
      userId: session.userId,
    }
  }
  catch {
    return null
  }
}

export const useAdminSessionStore = defineStore('admin-session', () => {
  const session = ref<VerifiedAdminSession | null>(null)

  const restoreFromSessionStorage = (): void => {
    session.value = readStoredSession()
  }

  const hasVerifiedSession = (): boolean => (
    session.value !== null && Date.parse(session.value.expiresAt) > Date.now()
  )

  const setVerifiedSession = (verifiedSession: VerifiedAdminSession): void => {
    const allowedSession: VerifiedAdminSession = {
      accessToken: verifiedSession.accessToken,
      authenticatedAt: verifiedSession.authenticatedAt,
      expiresAt: verifiedSession.expiresAt,
      userId: verifiedSession.userId,
    }
    session.value = allowedSession
    if (typeof window !== 'undefined') window.sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(allowedSession))
  }

  const clear = (): void => {
    session.value = null
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(ADMIN_SESSION_KEY)
  }

  const authorizationHeaders = (): { Authorization: string } => {
    if (!hasVerifiedSession() || !session.value) {
      clear()
      throw new Error('ADMIN_SESSION_REQUIRED')
    }
    return { Authorization: `Bearer ${session.value.accessToken}` }
  }

  return { authorizationHeaders, clear, hasVerifiedSession, restoreFromSessionStorage, session, setVerifiedSession }
})
