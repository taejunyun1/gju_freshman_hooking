import type { SupabaseClient } from '@supabase/supabase-js'
import type { LoginInput, LoginResult } from '../../../shared/types/api'
import { getServerSupabaseClient } from '../../utils/supabase'
import { postgresByteaFromBytes } from '../../utils/postgres-bytea'
import { decodeBase64urlSecret, hmacSha256, randomBytes, utf8, type RandomBytes } from '../../utils/web-crypto'
import { createEventWriter, type EventWriter } from '../metrics/events'
import { derivePhoneHmac } from './phone'
import { derivePasswordDigest, type RosterKeyring } from './roster-credentials'
import { createSessionToken } from './session'

const LOGIN_ROUTE = '/api/student/login' as const
const SESSION_ABSOLUTE_MILLISECONDS = 12 * 60 * 60 * 1000
const ipLoginDomain = utf8('roster-login-ip-v1\0')

export type RosterIdentityRequestContext = {
  anonymousId: string
  ip: string
  requestId: string
}

type RpcResult = { data: unknown, error: { code?: string } | null }
type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>

type RosterAuthDependencies = {
  keyring: RosterKeyring
  now?: () => Date
  random?: RandomBytes
  rpc: Rpc
  writeEvent: EventWriter
}

const throwOnStoreError = (error: { code?: string } | null): void => {
  if (error) throw new Error('IDENTITY_STORE_UNAVAILABLE')
}

const ipHmac = async (ip: string, key: Uint8Array): Promise<Uint8Array> => {
  const payload = new Uint8Array(ipLoginDomain.byteLength + utf8(ip).byteLength)
  payload.set(ipLoginDomain)
  payload.set(utf8(ip), ipLoginDomain.byteLength)
  return hmacSha256(payload, key)
}

const writeEventSafely = async (
  writeEvent: EventWriter,
  eventName: 'login_succeeded' | 'login_failed',
  context: RosterIdentityRequestContext,
  prospectId?: number,
): Promise<void> => {
  try {
    await writeEvent({
      anonymousId: context.anonymousId,
      eventName,
      path: LOGIN_ROUTE,
      ...(prospectId === undefined ? {} : { prospectId }),
      requestId: context.requestId,
    })
  }
  catch {
    // Telemetry must not affect authentication.
  }
}

const parseLoginResult = (input: unknown): { kind: 'failed' } | {
  kind: 'authenticated'
  prospectId: number
  nickname: string
  expiresAt: string
} => {
  if (!input || typeof input !== 'object') throw new Error('IDENTITY_STORE_INVALID')
  const row = input as { kind?: unknown, prospectId?: unknown, nickname?: unknown, expiresAt?: unknown }
  if (row.kind === 'failed') return { kind: 'failed' }
  if (
    row.kind !== 'authenticated'
    || typeof row.prospectId !== 'number'
    || !Number.isSafeInteger(row.prospectId)
    || typeof row.nickname !== 'string'
    || typeof row.expiresAt !== 'string'
  ) throw new Error('IDENTITY_STORE_INVALID')
  return {
    kind: 'authenticated',
    prospectId: row.prospectId,
    nickname: row.nickname,
    expiresAt: row.expiresAt,
  }
}

export const createRosterAuthService = (dependencies: RosterAuthDependencies) => {
  const now = dependencies.now ?? (() => new Date())
  const random = dependencies.random ?? randomBytes

  const loginStudent = async (input: LoginInput, context: RosterIdentityRequestContext): Promise<LoginResult> => {
    const attemptAt = now()
    const expiresAt = new Date(attemptAt.getTime() + SESSION_ABSOLUTE_MILLISECONDS)
    const session = await createSessionToken(random)
    const currentDigest = await derivePasswordDigest(input.password, dependencies.keyring.currentPassword.pepper)
    const previousDigest = dependencies.keyring.previousPassword
      ? await derivePasswordDigest(input.password, dependencies.keyring.previousPassword.pepper)
      : null
    const { data, error } = await dependencies.rpc('login_roster_student_v1', {
      p_phone_hmac: postgresByteaFromBytes(await derivePhoneHmac(input.phone, dependencies.keyring.phoneHmacKey)),
      p_current_digest: postgresByteaFromBytes(currentDigest),
      p_current_version: dependencies.keyring.currentPassword.version,
      p_previous_digest: previousDigest ? postgresByteaFromBytes(previousDigest) : null,
      p_previous_version: dependencies.keyring.previousPassword?.version ?? null,
      p_ip_hmac: postgresByteaFromBytes(await ipHmac(context.ip, dependencies.keyring.phoneHmacKey)),
      p_token_hash: postgresByteaFromBytes(session.hash),
      p_expires_at: expiresAt.toISOString(),
    })
    throwOnStoreError(error)
    const result = parseLoginResult(data)
    if (result.kind === 'failed') {
      await writeEventSafely(dependencies.writeEvent, 'login_failed', context)
      return { kind: 'failed' }
    }

    await writeEventSafely(dependencies.writeEvent, 'login_succeeded', context, result.prospectId)
    return { kind: 'authenticated', sessionToken: session.raw, expiresAt: result.expiresAt }
  }

  return { loginStudent }
}

const positiveVersion = (value: string): number => {
  if (!/^[1-9][0-9]{0,8}$/u.test(value)) throw new Error('CRYPTO_SECRET_INVALID')
  return Number(value)
}

export const getServerRosterKeyring = (): RosterKeyring => {
  const runtimeConfig = useRuntimeConfig()
  const previousPepper = typeof runtimeConfig.previousPasswordPepper === 'string' && runtimeConfig.previousPasswordPepper !== ''
    ? decodeBase64urlSecret(runtimeConfig.previousPasswordPepper)
    : undefined
  const previousVersion = typeof runtimeConfig.previousPasswordPepperVersion === 'string' && runtimeConfig.previousPasswordPepperVersion !== ''
    ? positiveVersion(runtimeConfig.previousPasswordPepperVersion)
    : undefined
  return {
    phoneHmacKey: decodeBase64urlSecret(runtimeConfig.phoneHmacKey),
    nameHmacKey: decodeBase64urlSecret(runtimeConfig.nameHmacKey),
    piiEncryptionKey: decodeBase64urlSecret(runtimeConfig.phoneEncryptionKey),
    currentPassword: {
      version: positiveVersion(runtimeConfig.passwordPepperVersion),
      pepper: decodeBase64urlSecret(runtimeConfig.passwordPepper),
    },
    ...(previousPepper === undefined || previousVersion === undefined
      ? {}
      : { previousPassword: { version: previousVersion, pepper: previousPepper } }),
  }
}

export const createRosterAuthServiceFromSupabase = (
  client: SupabaseClient,
  keyring: RosterKeyring,
) => createRosterAuthService({
  keyring,
  rpc: async (name, args) => {
    const result = await client.rpc(name, args)
    return { data: result.data, error: result.error }
  },
  writeEvent: createEventWriter(client),
})

export const getServerRosterAuthService = () => createRosterAuthServiceFromSupabase(
  getServerSupabaseClient(),
  getServerRosterKeyring(),
)
