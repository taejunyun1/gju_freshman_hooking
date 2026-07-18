import type { StudentSession } from '../../../shared/types/api'
import { postgresByteaFromBytes } from '../../utils/postgres-bytea'
import { getServerSupabaseClient } from '../../utils/supabase'
import { sha256, utf8 } from '../../utils/web-crypto'
import { revealApplicantName } from './applicant-name'
import { getServerRosterKeyring } from './roster-auth'

type RpcResult = { data: unknown, error: { code?: string } | null }
type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>

const throwOnStoreError = (error: { code?: string } | null): void => {
  if (error) throw new Error('IDENTITY_STORE_UNAVAILABLE')
}

const tokenHashFromRaw = async (sessionToken: string): Promise<Uint8Array> => sha256(utf8(sessionToken))

type EncryptedStudentSession = Omit<StudentSession, 'csrfToken' | 'nickname'> & {
  nameCiphertext: Uint8Array
  nameIv: Uint8Array
}

const bytesFromHex = (value: unknown): Uint8Array => {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/iu.test(value)) throw new Error('IDENTITY_STORE_INVALID')
  return Uint8Array.from(value.match(/../gu)!.map(byte => Number.parseInt(byte, 16)))
}

const parseSession = (input: unknown): EncryptedStudentSession | null => {
  if (
    !input
    || typeof input !== 'object'
    || (input as { kind?: unknown }).kind !== 'active'
  ) return null
  const row = input as { prospectId?: unknown, nameCiphertext?: unknown, nameIv?: unknown, expiresAt?: unknown }
  if (
    typeof row.prospectId !== 'number'
    || !Number.isSafeInteger(row.prospectId)
    || typeof row.expiresAt !== 'string'
  ) throw new Error('IDENTITY_STORE_INVALID')
  const nameCiphertext = bytesFromHex(row.nameCiphertext)
  const nameIv = bytesFromHex(row.nameIv)
  if (nameCiphertext.byteLength < 16 || nameCiphertext.byteLength > 128 || nameIv.byteLength !== 12) {
    throw new Error('IDENTITY_STORE_INVALID')
  }
  return {
    prospectId: row.prospectId,
    expiresAt: row.expiresAt,
    nameCiphertext,
    nameIv,
  }
}

export const createRosterSessionService = (dependencies: {
  rpc: Rpc
  decryptName: (protectedName: { ciphertext: Uint8Array, iv: Uint8Array }) => Promise<string>
}) => {
  const getStudentSession = async (sessionToken: string): Promise<Omit<StudentSession, 'csrfToken'> | null> => {
    if (!sessionToken) return null
    const { data, error } = await dependencies.rpc('read_roster_student_session_v1', {
      p_token_hash: postgresByteaFromBytes(await tokenHashFromRaw(sessionToken)),
    })
    throwOnStoreError(error)
    const session = parseSession(data)
    if (!session) return null
    try {
      const nickname = await dependencies.decryptName({ ciphertext: session.nameCiphertext, iv: session.nameIv })
      if (!nickname) throw new Error('IDENTITY_STORE_INVALID')
      return { prospectId: session.prospectId, nickname, expiresAt: session.expiresAt }
    }
    catch {
      throw new Error('IDENTITY_STORE_INVALID')
    }
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

export const createRosterSessionServiceFromSupabase = (client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult> }) => {
  const keyring = getServerRosterKeyring()
  return createRosterSessionService({
    rpc: async (name, args) => {
      const result = await client.rpc(name, args)
      return { data: result.data, error: result.error }
    },
    decryptName: protectedName => revealApplicantName(protectedName, keyring.piiEncryptionKey),
  })
}

export const getServerRosterSessionService = () => createRosterSessionServiceFromSupabase(getServerSupabaseClient())
