import type { StudentSession } from '../../../shared/types/api'
import { postgresByteaFromBytes } from '../../utils/postgres-bytea'
import { getServerSupabaseClient } from '../../utils/supabase'
import { sha256, utf8 } from '../../utils/web-crypto'

type RpcResult = { data: unknown, error: { code?: string } | null }
type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>

const throwOnStoreError = (error: { code?: string } | null): void => {
  if (error) throw new Error('IDENTITY_STORE_UNAVAILABLE')
}

const tokenHashFromRaw = async (sessionToken: string): Promise<Uint8Array> => sha256(utf8(sessionToken))

const parseSession = (input: unknown): Omit<StudentSession, 'csrfToken'> | null => {
  if (
    !input
    || typeof input !== 'object'
    || (input as { kind?: unknown }).kind !== 'active'
  ) return null
  const row = input as { prospectId?: unknown, nickname?: unknown, expiresAt?: unknown }
  if (
    typeof row.prospectId !== 'number'
    || !Number.isSafeInteger(row.prospectId)
    || typeof row.nickname !== 'string'
    || typeof row.expiresAt !== 'string'
  ) throw new Error('IDENTITY_STORE_INVALID')
  return {
    prospectId: row.prospectId,
    nickname: row.nickname,
    expiresAt: row.expiresAt,
  }
}

export const createRosterSessionService = (dependencies: { rpc: Rpc }) => {
  const getStudentSession = async (sessionToken: string): Promise<Omit<StudentSession, 'csrfToken'> | null> => {
    if (!sessionToken) return null
    const { data, error } = await dependencies.rpc('read_roster_student_session_v1', {
      p_token_hash: postgresByteaFromBytes(await tokenHashFromRaw(sessionToken)),
    })
    throwOnStoreError(error)
    return parseSession(data)
  }

  const logoutStudent = async (sessionToken: string): Promise<void> => {
    if (!sessionToken) return
    const { error } = await dependencies.rpc('revoke_roster_student_session_v1', {
      p_token_hash: postgresByteaFromBytes(await tokenHashFromRaw(sessionToken)),
    })
    throwOnStoreError(error)
  }

  return { getStudentSession, logoutStudent }
}

export const createRosterSessionServiceFromSupabase = (client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult> }) => createRosterSessionService({
  rpc: async (name, args) => {
    const result = await client.rpc(name, args)
    return { data: result.data, error: result.error }
  },
})

export const getServerRosterSessionService = () => createRosterSessionServiceFromSupabase(getServerSupabaseClient())
