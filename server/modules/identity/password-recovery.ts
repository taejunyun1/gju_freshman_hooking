import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../../utils/app-error'
import { base64urlEncode, decodeBase64urlSecret, hmacSha256, randomBytes, sha256, utf8, type RandomBytes } from '../../utils/web-crypto'
import { getServerSupabaseClient } from '../../utils/supabase'
import { bytesFromPostgresBytea, postgresByteaFromBytes } from '../../utils/postgres-bytea'
import { hashPassword, verifyPassword } from './password'
import { normalizeKoreanPhone } from './phone'

const RECOVERY_REQUEST_TTL_MILLISECONDS = 24 * 60 * 60 * 1000

type PasswordMaterial = {
  passwordHash: Uint8Array
  passwordSalt: Uint8Array
}

export type PasswordRecoveryDependencies = {
  passwordPepper: Uint8Array
  phoneHmacKey?: Uint8Array
  now?: () => Date
  random?: RandomBytes
  consumeRateLimit: (input: { key: string, route: string, limit: number, window: string }) => Promise<boolean>
  derivePassword?: typeof hashPassword
  findRecoveryProspect: (input: { phoneHmac: Uint8Array, nickname: string, region: string }) => Promise<{ id: number } | null>
  createRequest: (input: { prospectId: number, expiresAt: Date }) => Promise<void>
  approveRequest: (input: { requestId: number, adminUserId: string, traceId: string }) => Promise<{ code: string, expiresAt: Date } | null>
  completeCredentialRecovery: (input: { codeHash: Uint8Array, passwordHash: Uint8Array, passwordSalt: Uint8Array }) => Promise<boolean>
  readStudentSession: (sessionToken: string) => Promise<{ prospectId: number, tokenHash: Uint8Array } | null>
  readCredentialByProspectId: (prospectId: number) => Promise<PasswordMaterial | null>
  verifyCurrentPassword?: (password: string, material: PasswordMaterial) => Promise<boolean>
  changeStudentPassword: (input: {
    sessionTokenHash: Uint8Array
    passwordHash: Uint8Array
    passwordSalt: Uint8Array
  }) => Promise<boolean>
}

export { bytesFromPostgresBytea, postgresByteaFromBytes } from '../../utils/postgres-bytea'

const asDate = (value: string): Date => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error('RECOVERY_STORE_INVALID')
  return parsed
}

const throwOnStoreError = (error: { code?: string } | null): void => {
  if (error && error.code !== 'PGRST116') throw new Error('RECOVERY_STORE_UNAVAILABLE')
}

const createSupabaseDependencies = (
  client: SupabaseClient,
  secrets: { passwordPepper: Uint8Array, phoneHmacKey: Uint8Array },
): PasswordRecoveryDependencies => ({
  ...secrets,
  consumeRateLimit: async ({ key, route, limit, window }) => {
    const { data, error } = await client.rpc('consume_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_route: route,
      p_window: window,
    })
    throwOnStoreError(error)
    return data === true
  },
  findRecoveryProspect: async ({ phoneHmac, nickname, region }) => {
    const { data, error } = await client.from('prospects')
      .select('id')
      .eq('phone_hmac', postgresByteaFromBytes(phoneHmac))
      .eq('nickname', nickname)
      .eq('region', region)
      .eq('status', 'active')
      .maybeSingle()
    throwOnStoreError(error)
    return data && typeof data.id === 'number' ? { id: data.id } : null
  },
  createRequest: async ({ prospectId, expiresAt }) => {
    const { error } = await client.from('credential_recovery_requests').insert({
      prospect_id: prospectId,
      expires_at: expiresAt.toISOString(),
    })
    throwOnStoreError(error)
  },
  approveRequest: async ({ requestId, adminUserId, traceId }) => {
    const { data, error } = await client.rpc('approve_credential_recovery_request', {
      p_admin_user_id: adminUserId,
      p_request_id: requestId,
      p_trace_id: traceId,
    })
    throwOnStoreError(error)
    const approved = Array.isArray(data) ? data[0] : null
    if (!approved || typeof approved.code !== 'string' || typeof approved.expires_at !== 'string') return null
    return { code: approved.code, expiresAt: asDate(approved.expires_at) }
  },
  completeCredentialRecovery: async ({ codeHash, passwordHash, passwordSalt }) => {
    const { data, error } = await client.rpc('complete_credential_recovery', {
      p_code_hash: postgresByteaFromBytes(codeHash),
      p_password_hash: postgresByteaFromBytes(passwordHash),
      p_password_salt: postgresByteaFromBytes(passwordSalt),
    })
    throwOnStoreError(error)
    return data === true
  },
  readStudentSession: async (sessionToken) => {
    if (!sessionToken) return null
    const tokenHash = await sha256(utf8(sessionToken))
    const { data, error } = await client.rpc('touch_student_session', { p_token_hash: postgresByteaFromBytes(tokenHash) })
    throwOnStoreError(error)
    const session = Array.isArray(data) ? data[0] : null
    return session && typeof session.prospect_id === 'number' ? { prospectId: session.prospect_id, tokenHash } : null
  },
  readCredentialByProspectId: async (prospectId) => {
    const { data, error } = await client.from('student_credentials')
      .select('password_hash,password_salt')
      .eq('prospect_id', prospectId)
      .maybeSingle()
    throwOnStoreError(error)
    if (!data || typeof data.password_hash !== 'string' || typeof data.password_salt !== 'string') return null
    return { passwordHash: bytesFromPostgresBytea(data.password_hash), passwordSalt: bytesFromPostgresBytea(data.password_salt) }
  },
  changeStudentPassword: async ({ sessionTokenHash, passwordHash, passwordSalt }) => {
    const { data, error } = await client.rpc('change_student_password', {
      p_password_hash: postgresByteaFromBytes(passwordHash),
      p_password_salt: postgresByteaFromBytes(passwordSalt),
      p_session_hash: postgresByteaFromBytes(sessionTokenHash),
    })
    throwOnStoreError(error)
    return data === true
  },
})

export const createPasswordRecoveryService = (dependencies: PasswordRecoveryDependencies) => {
  const now = dependencies.now ?? (() => new Date())
  const random = dependencies.random ?? randomBytes
  const derivePassword = dependencies.derivePassword ?? hashPassword
  const verifyCurrentPassword = dependencies.verifyCurrentPassword ?? ((password, material) => (
    verifyPassword(password, { hash: material.passwordHash, salt: material.passwordSalt }, dependencies.passwordPepper)
  ))

  const request = async (input: { phone: string, nickname: string, region: string, ip: string }): Promise<void> => {
    if (!dependencies.phoneHmacKey) return
    const phoneHmac = await hmacSha256(utf8(normalizeKoreanPhone(input.phone)), dependencies.phoneHmacKey)
    const ipAllowed = await dependencies.consumeRateLimit({
      key: input.ip,
      limit: 10,
      route: '/api/student/password/recovery/request:ip',
      window: '1 hour',
    })
    if (!ipAllowed) return
    const phoneAllowed = await dependencies.consumeRateLimit({
      key: base64urlEncode(phoneHmac),
      limit: 3,
      route: '/api/student/password/recovery/request:phone',
      window: '1 hour',
    })
    if (!phoneAllowed) return
    const prospect = await dependencies.findRecoveryProspect({ phoneHmac, nickname: input.nickname, region: input.region })
    if (!prospect) return
    await dependencies.createRequest({
      prospectId: prospect.id,
      expiresAt: new Date(now().getTime() + RECOVERY_REQUEST_TTL_MILLISECONDS),
    })
  }

  const approve = async (input: { requestId: number, adminUserId: string, traceId: string }): Promise<{ code: string, expiresAt: string }> => {
    const approved = await dependencies.approveRequest({
      requestId: input.requestId,
      adminUserId: input.adminUserId,
      traceId: input.traceId,
    })
    if (!approved) throw new AppError('RECOVERY_INVALID')
    if (!/^[A-Za-z0-9_-]{22}$/.test(approved.code)) throw new Error('RECOVERY_STORE_INVALID')
    return { code: approved.code, expiresAt: approved.expiresAt.toISOString() }
  }

  const complete = async (input: { code: string, ip: string, newPassword: string }): Promise<{ ok: true }> => {
    const codeHash = await sha256(utf8(input.code))
    const ipAllowed = await dependencies.consumeRateLimit({
      key: input.ip,
      limit: 10,
      route: '/api/student/password/recovery/complete:ip',
      window: '5 minutes',
    })
    if (!ipAllowed) throw new AppError('RECOVERY_INVALID')
    const codeAllowed = await dependencies.consumeRateLimit({
      key: base64urlEncode(codeHash),
      limit: 5,
      route: '/api/student/password/recovery/complete:code',
      window: '15 minutes',
    })
    if (!codeAllowed) throw new AppError('RECOVERY_INVALID')

    const passwordSalt = random(16)
    if (passwordSalt.length !== 16) throw new Error('PASSWORD_SALT_RANDOM_INVALID')
    const password = await derivePassword(input.newPassword, passwordSalt, dependencies.passwordPepper)
    const completed = await dependencies.completeCredentialRecovery({
      codeHash,
      passwordHash: password.hash,
      passwordSalt: password.salt,
    })
    if (!completed) throw new AppError('RECOVERY_INVALID')
    return { ok: true }
  }

  const changePassword = async (input: { sessionToken: string, currentPassword: string, newPassword: string }): Promise<{ ok: true }> => {
    const session = await dependencies.readStudentSession(input.sessionToken)
    if (!session) throw new AppError('AUTH_FAILED')
    const credential = await dependencies.readCredentialByProspectId(session.prospectId)
    if (!credential || !await verifyCurrentPassword(input.currentPassword, credential)) throw new AppError('AUTH_FAILED')

    const passwordSalt = random(16)
    if (passwordSalt.length !== 16) throw new Error('PASSWORD_SALT_RANDOM_INVALID')
    const password = await hashPassword(input.newPassword, passwordSalt, dependencies.passwordPepper)
    const changed = await dependencies.changeStudentPassword({
      sessionTokenHash: session.tokenHash,
      passwordHash: password.hash,
      passwordSalt: password.salt,
    })
    if (!changed) throw new AppError('AUTH_FAILED')
    return { ok: true }
  }

  return { request, approve, complete, changePassword }
}

export const getServerPasswordRecoveryService = () => {
  const runtimeConfig = useRuntimeConfig()
  return createPasswordRecoveryService(createSupabaseDependencies(getServerSupabaseClient(), {
    passwordPepper: decodeBase64urlSecret(runtimeConfig.passwordPepper),
    phoneHmacKey: decodeBase64urlSecret(runtimeConfig.phoneHmacKey),
  }))
}
