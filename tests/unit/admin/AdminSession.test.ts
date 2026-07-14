import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdminSessionStore } from '../../../app/stores/admin-session'

describe('administrator session store', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
    vi.setSystemTime(new Date('2026-07-14T10:00:00.000Z'))
  })

  it('persists an allow-listed verified session only in sessionStorage', () => {
    const localStorageWrite = vi.spyOn(window.localStorage, 'setItem')
    const store = useAdminSessionStore()

    store.setVerifiedSession({
      accessToken: 'short-lived-token',
      authenticatedAt: '2026-07-14T09:59:00.000Z',
      expiresAt: '2026-07-14T11:00:00.000Z',
      refreshToken: 'must-never-be-persisted',
      userId: 'admin-1',
    } as Parameters<typeof store.setVerifiedSession>[0])

    const persisted = sessionStorage.getItem('photo_next_admin_session_v1')
    expect(persisted).toContain('short-lived-token')
    expect(persisted).not.toContain('must-never-be-persisted')
    expect(localStorage.getItem('photo_next_admin_session_v1')).toBeNull()
    expect(localStorageWrite).not.toHaveBeenCalled()
  })

  it('clears an expired token before building an authorization header', () => {
    const store = useAdminSessionStore()
    store.setVerifiedSession({
      accessToken: 'expired-token',
      authenticatedAt: '2026-07-14T08:00:00.000Z',
      expiresAt: '2026-07-14T09:59:59.000Z',
      userId: 'admin-1',
    })

    expect(() => store.authorizationHeaders()).toThrow('ADMIN_SESSION_REQUIRED')
    expect(store.session).toBeNull()
    expect(sessionStorage.getItem('photo_next_admin_session_v1')).toBeNull()
  })

  it('rechecks wall-clock expiry after a previously valid header read', () => {
    const store = useAdminSessionStore()
    store.setVerifiedSession({
      accessToken: 'short-lived-token',
      authenticatedAt: '2026-07-14T09:59:00.000Z',
      expiresAt: '2026-07-14T10:01:00.000Z',
      userId: 'admin-1',
    })
    expect(store.authorizationHeaders()).toEqual({ Authorization: 'Bearer short-lived-token' })

    vi.setSystemTime(new Date('2026-07-14T10:01:00.001Z'))

    expect(() => store.authorizationHeaders()).toThrow('ADMIN_SESSION_REQUIRED')
    expect(sessionStorage.getItem('photo_next_admin_session_v1')).toBeNull()
  })

  it('restores allow-listed fields only after an explicit client restoration step', () => {
    sessionStorage.setItem('photo_next_admin_session_v1', JSON.stringify({
      accessToken: 'short-lived-token',
      authenticatedAt: '2026-07-14T09:59:00.000Z',
      expiresAt: '2026-07-14T11:00:00.000Z',
      refreshToken: 'must-never-enter-the-store',
      userId: 'admin-1',
    }))
    setActivePinia(createPinia())

    const store = useAdminSessionStore()
    expect(store.session).toBeNull()

    store.restoreFromSessionStorage()

    expect(store.session).toEqual({
      accessToken: 'short-lived-token',
      authenticatedAt: '2026-07-14T09:59:00.000Z',
      expiresAt: '2026-07-14T11:00:00.000Z',
      userId: 'admin-1',
    })
  })

  it('does not touch browser storage while creating the store', () => {
    const storageRead = vi.spyOn(window.sessionStorage, 'getItem')

    useAdminSessionStore()

    expect(storageRead).not.toHaveBeenCalled()
  })
})
