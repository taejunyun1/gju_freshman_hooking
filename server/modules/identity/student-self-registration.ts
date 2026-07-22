import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { ApplicantRosterRow } from '../../../shared/schemas/admission-roster'
import type { RegistrationResult } from '../../../shared/types/api'
import { postgresByteaFromBytes } from '../../utils/postgres-bytea'
import { getServerSupabaseClient } from '../../utils/supabase'
import { hmacSha256, randomBytes, utf8, type RandomBytes } from '../../utils/web-crypto'
import { createEventWriter, type EventWriter } from '../metrics/events'
import { protectApplicantName } from './applicant-name'
import { protectPhone } from './phone'
import { getServerRosterKeyring, type RosterIdentityRequestContext } from './roster-auth'
import { deriveInitialPassword, derivePasswordDigest, type RosterKeyring } from './roster-credentials'
import { createSessionToken } from './session'

const REGISTRATION_ROUTE = '/api/student/register' as const
const SESSION_ABSOLUTE_MILLISECONDS = 12 * 60 * 60 * 1000
const ipRegistrationDomain = utf8('roster-registration-ip-v1\0')

type RpcResult = { data: unknown, error: { code?: string } | null }
type Rpc = (name: string, args?: Record<string, unknown>) => Promise<RpcResult>

type StudentSelfRegistrationDependencies = {
  keyring: RosterKeyring
  now?: () => Date
  random?: RandomBytes
  rpc: Rpc
  writeEvent: EventWriter
}

const currentCycleSchema = z.object({
  id: z.string().uuid(),
  year: z.number().int().min(2000).max(9999),
  status: z.enum(['current', 'archived']),
}).passthrough()

const registrationResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('created'),
    prospectId: z.number().int().positive().refine(Number.isSafeInteger),
    expiresAt: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({ kind: z.literal('existing') }).strict(),
  z.object({ kind: z.literal('rate_limited') }).strict(),
  z.object({ kind: z.literal('cycle_changed') }).strict(),
])

const throwOnStoreError = (error: { code?: string } | null): void => {
  if (error) throw new Error('IDENTITY_STORE_UNAVAILABLE')
}

const getCurrentCycle = async (rpc: Rpc): Promise<{ id: string, year: number }> => {
  const { data, error } = await rpc('list_admission_cycles_v1')
  throwOnStoreError(error)
  const cycles = z.array(currentCycleSchema).safeParse(data)
  const current = cycles.success ? cycles.data.filter(cycle => cycle.status === 'current') : []
  if (current.length !== 1) throw new Error('IDENTITY_STORE_INVALID')
  return { id: current[0]!.id, year: current[0]!.year }
}

const registrationIpHmac = async (ip: string, key: Uint8Array): Promise<Uint8Array> => {
  const value = utf8(ip)
  const payload = new Uint8Array(ipRegistrationDomain.byteLength + value.byteLength)
  payload.set(ipRegistrationDomain)
  payload.set(value, ipRegistrationDomain.byteLength)
  return hmacSha256(payload, key)
}

const writeEventSafely = async (
  writeEvent: EventWriter,
  eventName: 'registration_started' | 'registration_completed',
  context: RosterIdentityRequestContext,
  prospectId?: number,
): Promise<void> => {
  try {
    await writeEvent({
      anonymousId: context.anonymousId,
      eventName,
      path: REGISTRATION_ROUTE,
      ...(prospectId === undefined ? {} : { prospectId }),
      requestId: context.requestId,
    })
  }
  catch {
    // Telemetry must not affect registration.
  }
}

const parseRegistrationResult = (input: unknown) => {
  const parsed = registrationResultSchema.safeParse(input)
  if (!parsed.success) throw new Error('IDENTITY_STORE_INVALID')
  return parsed.data
}

export const createStudentSelfRegistrationService = (dependencies: StudentSelfRegistrationDependencies) => {
  const now = dependencies.now ?? (() => new Date())
  const random = dependencies.random ?? randomBytes

  const registerStudent = async (
    input: ApplicantRosterRow,
    context: RosterIdentityRequestContext,
  ): Promise<RegistrationResult> => {
    let cycle = await getCurrentCycle(dependencies.rpc)
    const [phone, name, ipHmac] = await Promise.all([
      protectPhone(input.phone, dependencies.keyring.phoneHmacKey, dependencies.keyring.piiEncryptionKey),
      protectApplicantName(input.name, dependencies.keyring.nameHmacKey, dependencies.keyring.piiEncryptionKey),
      registrationIpHmac(context.ip, dependencies.keyring.phoneHmacKey),
    ])

    await writeEventSafely(dependencies.writeEvent, 'registration_started', context)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const issuedAt = now()
      const expiresAt = new Date(issuedAt.getTime() + SESSION_ABSOLUTE_MILLISECONDS)
      const [initialPassword, session] = await Promise.all([
        deriveInitialPassword({ admissionYear: cycle.year, phone: input.phone }),
        createSessionToken(random),
      ])
      const passwordDigest = await derivePasswordDigest(
        initialPassword,
        dependencies.keyring.currentPassword.pepper,
      )
      const { data, error } = await dependencies.rpc('register_roster_student_v1', {
        p_expected_cycle_id: cycle.id,
        p_expected_cycle_year: cycle.year,
        p_phone_hmac: postgresByteaFromBytes(phone.hmac),
        p_phone_ciphertext: postgresByteaFromBytes(phone.ciphertext),
        p_phone_iv: postgresByteaFromBytes(phone.iv),
        p_name_hmac: postgresByteaFromBytes(name.hmac),
        p_name_ciphertext: postgresByteaFromBytes(name.ciphertext),
        p_name_iv: postgresByteaFromBytes(name.iv),
        p_password_digest: postgresByteaFromBytes(passwordDigest),
        p_password_key_version: dependencies.keyring.currentPassword.version,
        p_ip_hmac: postgresByteaFromBytes(ipHmac),
        p_token_hash: postgresByteaFromBytes(session.hash),
        p_expires_at: expiresAt.toISOString(),
        p_school_name: input.highSchool,
        p_applicant_stage: input.grade,
      })
      throwOnStoreError(error)
      const result = parseRegistrationResult(data)
      if (result.kind === 'cycle_changed') {
        if (attempt === 1) throw new Error('IDENTITY_STORE_INVALID')
        cycle = await getCurrentCycle(dependencies.rpc)
        continue
      }
      if (result.kind !== 'created') return result

      await writeEventSafely(dependencies.writeEvent, 'registration_completed', context, result.prospectId)
      return { kind: 'created', sessionToken: session.raw, expiresAt: result.expiresAt }
    }

    throw new Error('IDENTITY_STORE_INVALID')
  }

  return { registerStudent }
}

export const createStudentSelfRegistrationServiceFromSupabase = (
  client: SupabaseClient,
  keyring: RosterKeyring,
) => createStudentSelfRegistrationService({
  keyring,
  rpc: async (name, args) => {
    const result = await client.rpc(name, args)
    return { data: result.data, error: result.error }
  },
  writeEvent: createEventWriter(client),
})

export const getServerStudentSelfRegistrationService = () => createStudentSelfRegistrationServiceFromSupabase(
  getServerSupabaseClient(),
  getServerRosterKeyring(),
)
