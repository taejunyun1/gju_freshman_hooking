import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../../utils/app-error'
import { base64urlEncode, decodeBase64urlSecret, hmacSha256, randomBytes, sha256, utf8, type RandomBytes } from '../../utils/web-crypto'
import { getServerSupabaseClient } from '../../utils/supabase'
import { hashPassword, verifyPassword } from './password'
import { normalizeKoreanPhone } from './phone'

const APPROVAL_CODE_BYTES = 16
const APPROVAL_CODE_TTL_MILLISECONDS = 15 * 60 * 1000
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
  findRecoveryProspect: (input: { phoneHmac: Uint8Array, nickname: string, region: string }) => Promise<{ id: number } | null>
  createRequest: (input: { prospectId: number, expiresAt: Date }) => Promise<void>
  approveRequest: (input: { requestId: number, adminUserId: string, codeHash: Uint8Array, expiresAt: Date, verifiedAt: Date }) => Promise<boolean>
  writeAuditEvent: (input: {
    adminUserId: string
    action: 'credential_recovery_approved'
    targetType: 'credential_recovery_request'
    targetId: string
    requestId: string
  }) => Promise<void>
  completeCredentialRecovery: (input: { codeHash: Uint8Array, passwordHash: Uint8Array, passwordSalt: Uint8Array }) => Promise<boolean>
  readStudentSession: (sessionToken: string) => Promise<{ prospectId: number, tokenHash: Uint8Array } | null>
  readCredentialByProspectId: (prospectId: number) => Promise<PasswordMaterial | null>
  verifyCurrentPassword?: (password: string, material: PasswordMaterial) => Promise<boolean>
  revokeOtherStudentSessionsAndUpdatePassword: (input: {
    prospectId: number
    sessionTokenHash: Uint8Array
    passwordHash: Uint8Array
    passwordSalt: Uint8Array
    now: Date
  }) => Promise<boolean>
}

const base64FromBytes = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const bytesFromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

const throwOnStoreError = (error: { code?: string } | null): void => {
  if (error && error.code !== 'PGRST116') throw new Error('RECOVERY_STORE_UNAVAILABLE')
}

const createSupabaseDependencies = (
  client: SupabaseClient,
  secrets: { passwordPepper: Uint8Array, phoneHmacKey: Uint8Array },
): PasswordRecoveryDependencies => ({
  ...secrets,
  findRecoveryProspect: async ({ phoneHmac, nickname, region }) => {
    const { data, error } = await client.from('prospects')
      .select('id')
      .eq('phone_hmac', base64FromBytes(phoneHmac))
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
  approveRequest: async ({ requestId, adminUserId, codeHash, expiresAt, verifiedAt }) => {
    const { data, error } = await client.from('credential_recovery_requests')
      .update({
        code_hash: base64FromBytes(codeHash),
        expires_at: expiresAt.toISOString(),
        status: 'verified',
        verified_at: verifiedAt.toISOString(),
        verified_by_admin_id: adminUserId,
      })
      .eq('id', requestId)
      .eq('status', 'requested')
      .select('id')
      .maybeSingle()
    throwOnStoreError(error)
    return data?.id === requestId
  },
  writeAuditEvent: async (input) => {
    const { error } = await client.from('audit_events').insert({
      action: input.action,
      admin_user_id: input.adminUserId,
      metadata: {},
      request_id: input.requestId,
      target_id: input.targetId,
      target_type: input.targetType,
    })
    throwOnStoreError(error)
  },
  completeCredentialRecovery: async ({ codeHash, passwordHash, passwordSalt }) => {
    const { data, error } = await client.rpc('complete_credential_recovery', {
      p_code_hash: base64FromBytes(codeHash),
      p_password_hash: base64FromBytes(passwordHash),
      p_password_salt: base64FromBytes(passwordSalt),
    })
    throwOnStoreError(error)
    return data === true
  },
  readStudentSession: async (sessionToken) => {
    if (!sessionToken) return null
    const tokenHash = await sha256(utf8(sessionToken))
    const { data, error } = await client.rpc('touch_student_session', { p_token_hash: base64FromBytes(tokenHash) })
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
    return { passwordHash: bytesFromBase64(data.password_hash), passwordSalt: bytesFromBase64(data.password_salt) }
  },
  revokeOtherStudentSessionsAndUpdatePassword: async ({ prospectId, sessionTokenHash, passwordHash, passwordSalt, now }) => {
    const { data: credential, error: credentialError } = await client.from('student_credentials')
      .update({
        failed_attempts: 0,
        locked_until: null,
        password_changed_at: now.toISOString(),
        password_hash: base64FromBytes(passwordHash),
        password_salt: base64FromBytes(passwordSalt),
        updated_at: now.toISOString(),
      })
      .eq('prospect_id', prospectId)
      .select('prospect_id')
      .maybeSingle()
    throwOnStoreError(credentialError)
    if (credential?.prospect_id !== prospectId) return false

    const { error: sessionsError } = await client.from('student_sessions')
      .update({ revoked_at: now.toISOString() })
      .eq('prospect_id', prospectId)
      .neq('token_hash', base64FromBytes(sessionTokenHash))
      .is('revoked_at', null)
    throwOnStoreError(sessionsError)
    return true
  },
})

export const createPasswordRecoveryService = (dependencies: PasswordRecoveryDependencies) => {
  const now = dependencies.now ?? (() => new Date())
  const random = dependencies.random ?? randomBytes
  const verifyCurrentPassword = dependencies.verifyCurrentPassword ?? ((password, material) => (
    verifyPassword(password, { hash: material.passwordHash, salt: material.passwordSalt }, dependencies.passwordPepper)
  ))

  const request = async (input: { phone: string, nickname: string, region: string }): Promise<void> => {
    if (!dependencies.phoneHmacKey) return
    const phoneHmac = await hmacSha256(utf8(normalizeKoreanPhone(input.phone)), dependencies.phoneHmacKey)
    const prospect = await dependencies.findRecoveryProspect({ phoneHmac, nickname: input.nickname, region: input.region })
    if (!prospect) return
    await dependencies.createRequest({
      prospectId: prospect.id,
      expiresAt: new Date(now().getTime() + RECOVERY_REQUEST_TTL_MILLISECONDS),
    })
  }

  const approve = async (input: { requestId: number, adminUserId: string, traceId: string }): Promise<{ code: string, expiresAt: string }> => {
    const codeBytes = random(APPROVAL_CODE_BYTES)
    if (codeBytes.length !== APPROVAL_CODE_BYTES) throw new Error('RECOVERY_CODE_RANDOM_INVALID')
    const code = base64urlEncode(codeBytes)
    const verifiedAt = now()
    const expiresAt = new Date(verifiedAt.getTime() + APPROVAL_CODE_TTL_MILLISECONDS)
    const approved = await dependencies.approveRequest({
      requestId: input.requestId,
      adminUserId: input.adminUserId,
      codeHash: await sha256(utf8(code)),
      expiresAt,
      verifiedAt,
    })
    if (!approved) throw new AppError('RECOVERY_INVALID')
    await dependencies.writeAuditEvent({
      adminUserId: input.adminUserId,
      action: 'credential_recovery_approved',
      requestId: input.traceId,
      targetId: String(input.requestId),
      targetType: 'credential_recovery_request',
    })
    return { code, expiresAt: expiresAt.toISOString() }
  }

  const complete = async (input: { code: string, newPassword: string }): Promise<{ ok: true }> => {
    const passwordSalt = random(16)
    if (passwordSalt.length !== 16) throw new Error('PASSWORD_SALT_RANDOM_INVALID')
    const password = await hashPassword(input.newPassword, passwordSalt, dependencies.passwordPepper)
    const completed = await dependencies.completeCredentialRecovery({
      codeHash: await sha256(utf8(input.code)),
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
    const changed = await dependencies.revokeOtherStudentSessionsAndUpdatePassword({
      prospectId: session.prospectId,
      sessionTokenHash: session.tokenHash,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      now: now(),
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
