import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { postgresByteaFromBytes } from '../../utils/postgres-bytea'
import { getServerSupabaseClient } from '../../utils/supabase'
import { randomBytes, sha256, utf8, type RandomBytes } from '../../utils/web-crypto'
import { derivePhoneHmac } from './phone'
import { deriveInitialPassword, derivePasswordDigest, type RosterKeyring } from './roster-credentials'
import { getServerRosterKeyring } from './roster-auth'
import { createSessionToken } from './session'

const SESSION_ABSOLUTE_MILLISECONDS = 12 * 60 * 60 * 1000

type RpcResult = { data: unknown, error: { code?: string } | null }
type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>

type PinMutationResult = {
  kind: 'authenticated'
  prospectId: number
  expiresAt: string
}

const mutationResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('authenticated'), prospectId: z.number().int().positive(), expiresAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ kind: z.literal('failed') }).strict(),
])

const currentCycleSchema = z.object({
  id: z.string().uuid(),
  year: z.number().int().min(2000).max(9999),
  status: z.enum(['current', 'archived']),
}).passthrough()

type StudentPinDependencies = {
  currentCycle: () => Promise<{ year: number }>
  keyring: RosterKeyring
  now?: () => Date
  random?: RandomBytes
  rpc: Rpc
}

const throwOnStoreError = (error: { code?: string } | null): void => {
  if (error) throw new Error('IDENTITY_STORE_UNAVAILABLE')
}

const parseMutationResult = (input: unknown): PinMutationResult | null => {
  const parsed = mutationResultSchema.safeParse(input)
  if (!parsed.success) throw new Error('IDENTITY_STORE_INVALID')
  return parsed.data.kind === 'authenticated' ? parsed.data : null
}

const getCurrentCycle = async (client: SupabaseClient): Promise<{ year: number }> => {
  const { data, error } = await client.rpc('list_admission_cycles_v1')
  throwOnStoreError(error)
  const cycles = z.array(currentCycleSchema).safeParse(data)
  const current = cycles.success ? cycles.data.filter(cycle => cycle.status === 'current') : []
  if (current.length !== 1) throw new Error('IDENTITY_STORE_INVALID')
  return { year: current[0]!.year }
}

export const createStudentPinService = (dependencies: StudentPinDependencies) => {
  const now = dependencies.now ?? (() => new Date())
  const random = dependencies.random ?? randomBytes

  const replacementSession = async () => {
    const issuedAt = now()
    const session = await createSessionToken(random)
    return {
      session,
      expiresAt: new Date(issuedAt.getTime() + SESSION_ABSOLUTE_MILLISECONDS),
    }
  }

  const completeMutation = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await dependencies.rpc(name, args)
    throwOnStoreError(error)
    return parseMutationResult(data)
  }

  return {
    async changePin(input: { sessionToken: string, currentPin: string, nextPin: string }) {
      if (!input.sessionToken) return null
      const replacement = await replacementSession()
      const result = await completeMutation('change_roster_student_pin_self_v1', {
        p_session_token_hash: postgresByteaFromBytes(await sha256(utf8(input.sessionToken))),
        p_current_digest: postgresByteaFromBytes(await derivePasswordDigest(input.currentPin, dependencies.keyring.currentPassword.pepper)),
        p_current_key_version: dependencies.keyring.currentPassword.version,
        p_next_digest: postgresByteaFromBytes(await derivePasswordDigest(input.nextPin, dependencies.keyring.currentPassword.pepper)),
        p_next_token_hash: postgresByteaFromBytes(replacement.session.hash),
        p_expires_at: replacement.expiresAt.toISOString(),
      })
      return result === null ? null : { sessionToken: replacement.session.raw, expiresAt: result.expiresAt }
    },

    async resetForgottenPin(input: { phone: string }) {
      const [cycle, replacement] = await Promise.all([dependencies.currentCycle(), replacementSession()])
      const initialPin = await deriveInitialPassword({ admissionYear: cycle.year, phone: input.phone })
      const result = await completeMutation('reset_roster_student_pin_and_assessment_v1', {
        p_phone_hmac: postgresByteaFromBytes(await derivePhoneHmac(input.phone, dependencies.keyring.phoneHmacKey)),
        p_initial_digest: postgresByteaFromBytes(await derivePasswordDigest(initialPin, dependencies.keyring.currentPassword.pepper)),
        p_current_key_version: dependencies.keyring.currentPassword.version,
        p_next_token_hash: postgresByteaFromBytes(replacement.session.hash),
        p_expires_at: replacement.expiresAt.toISOString(),
      })
      return result === null ? null : { sessionToken: replacement.session.raw, expiresAt: result.expiresAt }
    },
  }
}

export const createStudentPinServiceFromSupabase = (client: SupabaseClient, keyring: RosterKeyring) => createStudentPinService({
  currentCycle: () => getCurrentCycle(client),
  keyring,
  rpc: async (name, args) => {
    const result = await client.rpc(name, args)
    return { data: result.data, error: result.error }
  },
})

export const getServerStudentPinService = () => createStudentPinServiceFromSupabase(
  getServerSupabaseClient(),
  getServerRosterKeyring(),
)
