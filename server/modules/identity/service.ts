import type { SupabaseClient } from '@supabase/supabase-js'
import type { LoginInput, LoginResult, RegistrationInput, RegistrationResult, StudentSession } from '../../../shared/types/api'
import { AppError } from '../../utils/app-error'
import { decodeBase64urlSecret, randomBytes, type RandomBytes } from '../../utils/web-crypto'
import { bytesFromPostgresBytea, postgresByteaFromBytes } from '../../utils/postgres-bytea'
import { createEventWriter, type EventWriter } from '../metrics/events'
import { getServerSupabaseClient } from '../../utils/supabase'
import { generateNickname } from './nickname'
import { generateInitialPassword, hashPassword, verifyPassword } from './password'
import { protectPhone } from './phone'
import { createSessionToken } from './session'

const REGISTER_ROUTE = '/api/student/register' as const
const LOGIN_ROUTE = '/api/student/login' as const
const SESSION_IDLE_MILLISECONDS = 30 * 60 * 1000
const SESSION_ABSOLUTE_MILLISECONDS = 12 * 60 * 60 * 1000

export type IdentityRequestContext = {
  ip: string
  requestId: string
  campaignId?: number
}

type StoredProspect = {
  id: number
}

type StoredCredential = {
  prospectId: number
  nickname: string
  passwordHash: Uint8Array
  passwordSalt: Uint8Array
  lockedUntil: Date | null
}

type StoredSession = {
  prospectId: number
  nickname: string
  expiresAt: Date
  idleExpiresAt: Date
}

export type IdentityDependencies = {
  hmacKey: Uint8Array
  encryptionKey: Uint8Array
  passwordPepper: Uint8Array
  now?: () => Date
  random?: RandomBytes
  consumeRateLimit: (input: { key: string, route: string, limit: number, window: string }) => Promise<boolean>
  findProspectByPhoneHmac: (phoneHmac: Uint8Array) => Promise<StoredProspect | null>
  isNicknameAvailable: (nickname: string) => Promise<boolean>
  registerStudent: (input: {
    phoneHmac: Uint8Array
    phoneCiphertext: Uint8Array
    phoneIv: Uint8Array
    nickname: string
    schoolName: RegistrationInput['schoolName']
    applicantStage: RegistrationInput['applicantStage']
    region: RegistrationInput['region']
    passwordHash: Uint8Array
    passwordSalt: Uint8Array
  }) => Promise<{ kind: 'created' | 'existing' }>
  findCredentialByPhoneHmac: (phoneHmac: Uint8Array) => Promise<StoredCredential | null>
  recordLoginFailure: (phoneHmac: Uint8Array, now: Date) => Promise<unknown>
  completeLogin: (input: {
    prospectId: number
    tokenHash: Uint8Array
    expiresAt: Date
    idleExpiresAt: Date
    now: Date
  }) => Promise<{ expiresAt: Date } | null>
  readSession: (tokenHash: Uint8Array) => Promise<StoredSession | null>
  revokeSession: (tokenHash: Uint8Array, now: Date) => Promise<void>
  writeEvent: EventWriter
}

const base64FromBytes = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const asDate = (value: string): Date => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error('IDENTITY_STORE_INVALID')
  return parsed
}

const throwOnStoreError = (error: { code?: string } | null): void => {
  if (error && error.code !== 'PGRST116') {
    throw new Error('IDENTITY_STORE_UNAVAILABLE')
  }
}

const createSupabaseDependencies = (
  client: SupabaseClient,
  secrets: Pick<IdentityDependencies, 'hmacKey' | 'encryptionKey' | 'passwordPepper'>,
): IdentityDependencies => ({
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
  findProspectByPhoneHmac: async (phoneHmac) => {
    const { data, error } = await client.from('prospects')
      .select('id')
      .eq('phone_hmac', postgresByteaFromBytes(phoneHmac))
      .maybeSingle()
    throwOnStoreError(error)
    return data ? { id: data.id as number } : null
  },
  isNicknameAvailable: async (nickname) => {
    const { data, error } = await client.from('prospects').select('id').eq('nickname', nickname).limit(1)
    throwOnStoreError(error)
    return !data || data.length === 0
  },
  registerStudent: async (input) => {
    const { data, error } = await client.rpc('register_student', {
      p_applicant_stage: input.applicantStage,
      p_nickname: input.nickname,
      p_password_hash: postgresByteaFromBytes(input.passwordHash),
      p_password_salt: postgresByteaFromBytes(input.passwordSalt),
      p_phone_ciphertext: postgresByteaFromBytes(input.phoneCiphertext),
      p_phone_hmac: postgresByteaFromBytes(input.phoneHmac),
      p_phone_iv: postgresByteaFromBytes(input.phoneIv),
      p_region: input.region,
      p_school_name: input.schoolName,
    })
    throwOnStoreError(error)
    const result = Array.isArray(data) ? data[0] : null
    if (!result || (result.kind !== 'created' && result.kind !== 'existing')) throw new Error('IDENTITY_STORE_INVALID')
    return { kind: result.kind }
  },
  findCredentialByPhoneHmac: async (phoneHmac) => {
    const { data, error } = await client.from('student_credentials')
      .select('prospect_id,password_hash,password_salt,locked_until,prospect:prospects!inner(nickname)')
      .eq('prospects.phone_hmac', postgresByteaFromBytes(phoneHmac))
      .maybeSingle()
    throwOnStoreError(error)
    if (!data) return null

    const prospect = data.prospect as unknown as { nickname?: string } | null
    if (typeof prospect?.nickname !== 'string' || typeof data.password_hash !== 'string' || typeof data.password_salt !== 'string') {
      throw new Error('IDENTITY_STORE_INVALID')
    }

    return {
      prospectId: data.prospect_id as number,
      nickname: prospect.nickname,
      passwordHash: bytesFromPostgresBytea(data.password_hash),
      passwordSalt: bytesFromPostgresBytea(data.password_salt),
      lockedUntil: data.locked_until ? asDate(data.locked_until as string) : null,
    }
  },
  recordLoginFailure: async (phoneHmac) => {
    const { error } = await client.rpc('record_student_login_failure', {
      p_phone_hmac: postgresByteaFromBytes(phoneHmac),
    })
    throwOnStoreError(error)
  },
  completeLogin: async ({ prospectId, tokenHash, expiresAt, idleExpiresAt }) => {
    const { data, error } = await client.rpc('complete_student_login', {
      p_expires_at: expiresAt.toISOString(),
      p_idle_expires_at: idleExpiresAt.toISOString(),
      p_prospect_id: prospectId,
      p_token_hash: postgresByteaFromBytes(tokenHash),
    })
    throwOnStoreError(error)
    return data === true ? { expiresAt } : null
  },
  readSession: async (tokenHash) => {
    const { data, error } = await client.rpc('touch_student_session', {
      p_token_hash: postgresByteaFromBytes(tokenHash),
    })
    throwOnStoreError(error)
    const result = Array.isArray(data) ? data[0] : null
    if (!result) return null

    if (
      typeof result.prospect_id !== 'number'
      || typeof result.nickname !== 'string'
      || typeof result.expires_at !== 'string'
      || typeof result.idle_expires_at !== 'string'
    ) throw new Error('IDENTITY_STORE_INVALID')

    return {
      prospectId: result.prospect_id,
      nickname: result.nickname,
      expiresAt: asDate(result.expires_at),
      idleExpiresAt: asDate(result.idle_expires_at),
    }
  },
  revokeSession: async (tokenHash, now) => {
    const { error } = await client.from('student_sessions')
      .update({ revoked_at: now.toISOString() })
      .eq('token_hash', postgresByteaFromBytes(tokenHash))
      .is('revoked_at', null)
    throwOnStoreError(error)
  },
  writeEvent: createEventWriter(client),
})

const writeEventSafely = async (
  writeEvent: EventWriter,
  eventName: 'registration_started' | 'registration_completed' | 'login_succeeded' | 'login_failed',
  path: typeof REGISTER_ROUTE | typeof LOGIN_ROUTE,
  context: IdentityRequestContext,
): Promise<void> => {
  try {
    await writeEvent({ eventName, path, campaignId: context.campaignId, requestId: context.requestId })
  }
  catch {
    // Product telemetry must not expose or interrupt identity flows.
  }
}

export const createIdentityService = (dependencies: IdentityDependencies) => {
  const now = dependencies.now ?? (() => new Date())
  const random = dependencies.random ?? randomBytes

  const registerStudent = async (input: RegistrationInput, context: IdentityRequestContext): Promise<RegistrationResult> => {
    await writeEventSafely(dependencies.writeEvent, 'registration_started', REGISTER_ROUTE, context)
    const allowed = await dependencies.consumeRateLimit({ key: context.ip, route: REGISTER_ROUTE, limit: 5, window: '1 hour' })
    if (!allowed) throw new AppError('RATE_LIMITED')

    const protectedPhone = await protectPhone(input.phone, dependencies.hmacKey, dependencies.encryptionKey)
    if (await dependencies.findProspectByPhoneHmac(protectedPhone.hmac)) return { kind: 'existing' }

    const nickname = await generateNickname(dependencies.isNicknameAvailable, random)
    const initialPassword = generateInitialPassword(input.phone, random(2))
    const passwordSalt = random(16)
    const password = await hashPassword(initialPassword, passwordSalt, dependencies.passwordPepper)
    const registered = await dependencies.registerStudent({
      applicantStage: input.applicantStage,
      nickname,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      phoneCiphertext: protectedPhone.ciphertext,
      phoneHmac: protectedPhone.hmac,
      phoneIv: protectedPhone.iv,
      region: input.region,
      schoolName: input.schoolName,
    })
    if (registered.kind === 'existing') return { kind: 'existing' }

    await writeEventSafely(dependencies.writeEvent, 'registration_completed', REGISTER_ROUTE, context)
    return { kind: 'created', nickname, initialPassword }
  }

  const loginStudent = async (input: LoginInput, context: IdentityRequestContext): Promise<LoginResult> => {
    const fail = async (): Promise<LoginResult> => {
      await writeEventSafely(dependencies.writeEvent, 'login_failed', LOGIN_ROUTE, context)
      return { kind: 'failed' }
    }

    const ipAllowed = await dependencies.consumeRateLimit({ key: context.ip, route: LOGIN_ROUTE, limit: 10, window: '5 minutes' })
    if (!ipAllowed) return fail()

    const protectedPhone = await protectPhone(input.phone, dependencies.hmacKey, dependencies.encryptionKey)
    const phoneAllowed = await dependencies.consumeRateLimit({
      key: base64FromBytes(protectedPhone.hmac),
      route: LOGIN_ROUTE,
      limit: 5,
      window: '5 minutes',
    })
    if (!phoneAllowed) return fail()

    const credential = await dependencies.findCredentialByPhoneHmac(protectedPhone.hmac)
    const attemptAt = now()
    if (!credential || (credential.lockedUntil && credential.lockedUntil > attemptAt)) {
      if (!credential) await dependencies.recordLoginFailure(protectedPhone.hmac, attemptAt)
      return fail()
    }

    const passwordMatches = await verifyPassword(input.password, {
      hash: credential.passwordHash,
      salt: credential.passwordSalt,
    }, dependencies.passwordPepper)
    if (!passwordMatches) {
      await dependencies.recordLoginFailure(protectedPhone.hmac, attemptAt)
      return fail()
    }

    const sessionToken = await createSessionToken(random)
    const expiresAt = new Date(attemptAt.getTime() + SESSION_ABSOLUTE_MILLISECONDS)
    const idleExpiresAt = new Date(attemptAt.getTime() + SESSION_IDLE_MILLISECONDS)
    const completed = await dependencies.completeLogin({
      prospectId: credential.prospectId,
      tokenHash: sessionToken.hash,
      expiresAt,
      idleExpiresAt,
      now: attemptAt,
    })
    if (!completed) return fail()

    await writeEventSafely(dependencies.writeEvent, 'login_succeeded', LOGIN_ROUTE, context)
    return { kind: 'authenticated', sessionToken: sessionToken.raw, expiresAt: completed.expiresAt.toISOString() }
  }

  const getStudentSession = async (sessionToken: string): Promise<Omit<StudentSession, 'csrfToken'> | null> => {
    if (!sessionToken) return null
    const tokenHash = (await createSessionTokenFromRaw(sessionToken))
    const session = await dependencies.readSession(tokenHash)
    return session ? {
      prospectId: session.prospectId,
      nickname: session.nickname,
      expiresAt: session.expiresAt.toISOString(),
    } : null
  }

  const logoutStudent = async (sessionToken: string): Promise<void> => {
    if (!sessionToken) return
    const tokenHash = await createSessionTokenFromRaw(sessionToken)
    await dependencies.revokeSession(tokenHash, now())
  }

  return { registerStudent, loginStudent, getStudentSession, logoutStudent }
}

const createSessionTokenFromRaw = async (raw: string): Promise<Uint8Array> => {
  const { sha256, utf8 } = await import('../../utils/web-crypto')
  return sha256(utf8(raw))
}

export const getServerIdentityService = () => {
  const runtimeConfig = useRuntimeConfig()
  const secrets = {
    encryptionKey: decodeBase64urlSecret(runtimeConfig.phoneEncryptionKey),
    hmacKey: decodeBase64urlSecret(runtimeConfig.phoneHmacKey),
    passwordPepper: decodeBase64urlSecret(runtimeConfig.passwordPepper),
  }
  return createIdentityService(createSupabaseDependencies(getServerSupabaseClient(), secrets))
}
