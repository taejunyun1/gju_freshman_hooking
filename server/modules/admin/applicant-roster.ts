import { z } from 'zod'

import {
  admissionCycleSchema,
  rosterApplyRequestSchema,
  rosterApplyResultSchema,
  rosterCredentialSchema,
  rosterPreviewRequestSchema,
  rosterPreviewResultSchema,
  type ApplicantRosterRow,
  type RosterApplyRequest,
} from '../../../shared/schemas/admission-roster'
import { deriveApplicantNameHmac, protectApplicantName, revealApplicantName } from '../identity/applicant-name'
import { deriveInitialPassword, derivePasswordDigest, type RosterKeyring } from '../identity/roster-credentials'
import { derivePhoneHmac, protectPhone, revealPhone } from '../identity/phone'
import { AppError } from '../../utils/app-error'
import { decodeBase64urlSecret, sha256, utf8 } from '../../utils/web-crypto'
import { getServerSupabaseClient } from '../../utils/supabase'

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown, error: unknown }>
type CommandContext = { adminUserId: string, requestId: string }
type ProtectedRow = {
  phoneHmac: string
  phoneCiphertext: string
  phoneIv: string
  nameHmac: string
  nameCiphertext: string
  nameIv: string
  schoolName: string
  applicantStage: string
  passwordDigest: string
  passwordGeneration: number
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
const bytesFromHex = (value: string): Uint8Array => {
  if (!/^(?:[0-9a-f]{2})+$/iu.test(value)) throw new Error('ROSTER_STORE_INVALID')
  return Uint8Array.from(value.match(/../gu)!.map(byte => Number.parseInt(byte, 16)))
}
const stableRows = (rows: ApplicantRosterRow[]) => [...rows].sort((left, right) => left.phone.localeCompare(right.phone))
const requestDigest = async (cycleId: string, expectedVersion: number, rows: ApplicantRosterRow[]) => (
  hex(await sha256(utf8(JSON.stringify({ cycleId, expectedVersion, rows: stableRows(rows) }))))
)

const rpcData = async (rpc: Rpc, name: string, args?: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await rpc(name, args)
  if (error) throw new Error('ROSTER_STORE_UNAVAILABLE')
  return data
}
const throwResultError = (value: unknown): never | void => {
  if (!value || typeof value !== 'object') throw new Error('ROSTER_STORE_INVALID')
  const kind = (value as { kind?: unknown }).kind
  if (kind === 'validation_error') throw new AppError('ROSTER_INVALID')
  if (kind === 'conflict' || kind === 'forbidden') throw new AppError('ROSTER_CONFLICT')
}

const protectRow = async (row: ApplicantRosterRow, cycleId: string, keyring: RosterKeyring): Promise<ProtectedRow> => {
  const [phone, name, password] = await Promise.all([
    protectPhone(row.phone, keyring.phoneHmacKey, keyring.piiEncryptionKey),
    protectApplicantName(row.name, keyring.nameHmacKey, keyring.piiEncryptionKey),
    deriveInitialPassword({ cycleId, phone: row.phone, generation: 1, pepper: keyring.currentPassword.pepper }),
  ])
  return {
    phoneHmac: hex(phone.hmac), phoneCiphertext: hex(phone.ciphertext), phoneIv: hex(phone.iv),
    nameHmac: hex(name.hmac), nameCiphertext: hex(name.ciphertext), nameIv: hex(name.iv),
    schoolName: row.highSchool, applicantStage: row.grade,
    passwordDigest: hex(await derivePasswordDigest(password, keyring.currentPassword.pepper)), passwordGeneration: 1,
  }
}

const previewRows = async (rows: ApplicantRosterRow[], keyring: RosterKeyring) => Promise.all(rows.map(async row => ({
  phoneHmac: hex(await derivePhoneHmac(row.phone, keyring.phoneHmacKey)),
  nameHmac: hex(await deriveApplicantNameHmac(row.name, keyring.nameHmacKey)),
  schoolName: row.highSchool,
  applicantStage: row.grade,
})))

const startSchema = z.object({ year: z.number().int().min(2020).max(2200) }).strict()
const testRows: ApplicantRosterRow[] = [
  { name: '테스트 학생 1', phone: '01090000001', highSchool: '테스트고', grade: 'high3' },
  { name: '테스트 학생 2', phone: '01090000002', highSchool: '테스트고', grade: 'high3' },
  { name: '테스트 학생 3', phone: '01090000003', highSchool: '테스트고', grade: 'high3' },
  { name: '테스트 학생 4', phone: '01090000004', highSchool: '테스트고', grade: 'high3' },
  { name: '테스트 학생 5', phone: '01090000005', highSchool: '테스트고', grade: 'high3' },
]

export type ApplicantRosterDependencies = { keyring: RosterKeyring, rpc: Rpc }
export const createApplicantRosterService = ({ keyring, rpc }: ApplicantRosterDependencies) => ({
  async list() {
    const data = await rpcData(rpc, 'list_admission_cycles_v1')
    const parsed = z.array(admissionCycleSchema).safeParse(data)
    if (!parsed.success) throw new Error('ROSTER_STORE_INVALID')
    return parsed.data
  },
  async start(input: unknown, context: CommandContext) {
    const { year } = startSchema.safeParse(input).success ? startSchema.parse(input) : (() => { throw new AppError('ROSTER_INVALID') })()
    const cycleId = crypto.randomUUID()
    const students = await Promise.all(testRows.map(row => protectRow(row, cycleId, keyring)))
    const data = await rpcData(rpc, 'start_admission_cycle_v1', {
      p_cycle_id: cycleId, p_year: year, p_password_key_version: keyring.currentPassword.version,
      p_admin_user_id: context.adminUserId, p_test_students: students,
    })
    throwResultError(data)
    return data
  },
  async preview(input: unknown) {
    const parsed = rosterPreviewRequestSchema.safeParse(input)
    if (!parsed.success) throw new AppError('ROSTER_INVALID')
    const protectedRows = await previewRows(parsed.data.rows, keyring)
    const data = await rpcData(rpc, 'preview_applicant_roster_v1', {
      p_cycle_id: parsed.data.cycleId, p_rows: protectedRows,
    })
    throwResultError(data)
    const result = z.object({
      cycleId: z.string().uuid(), rosterVersion: z.number().int().nonnegative(),
      counts: z.object({
        add: z.number().int().nonnegative(), update: z.number().int().nonnegative(),
        inactive: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(),
      }).strict(),
      rows: z.array(z.object({
        rowNumber: z.number().int().positive(), action: z.enum(['add', 'update', 'unchanged']),
        phoneHmac: z.string().regex(/^[0-9a-f]{64}$/iu), changedFields: z.array(z.enum(['name', 'highSchool', 'grade'])),
      }).strict()),
      inactiveApplicantIds: z.array(z.number().int().positive()),
    }).strict().safeParse(data)
    if (!result.success || result.data.rows.length !== parsed.data.rows.length) throw new Error('ROSTER_STORE_INVALID')
    const rows = result.data.rows.map(previewRow => {
      const row = parsed.data.rows[previewRow.rowNumber - 1]
      if (!row || protectedRows[previewRow.rowNumber - 1]?.phoneHmac !== previewRow.phoneHmac) throw new Error('ROSTER_STORE_INVALID')
      const { phoneHmac: _phoneHmac, ...preview } = previewRow
      return { ...preview, row }
    })
    return rosterPreviewResultSchema.parse({ ...result.data, rows })
  },
  async apply(input: RosterApplyRequest, context: CommandContext) {
    const parsed = rosterApplyRequestSchema.safeParse(input)
    if (!parsed.success) throw new AppError('ROSTER_INVALID')
    const rows = await Promise.all(parsed.data.rows.map(row => protectRow(row, parsed.data.cycleId, keyring)))
    const data = await rpcData(rpc, 'apply_applicant_roster_v1', {
      p_cycle_id: parsed.data.cycleId, p_expected_version: parsed.data.expectedVersion,
      p_admin_user_id: context.adminUserId, p_request_digest: await requestDigest(parsed.data.cycleId, parsed.data.expectedVersion, parsed.data.rows),
      p_request_id: parsed.data.idempotencyKey, p_rows: rows,
    })
    throwResultError(data)
    const { kind: _kind, added, ...payload } = data as Record<string, unknown>
    const result = rosterApplyResultSchema.safeParse(payload)
    if (!result.success) throw new Error('ROSTER_STORE_INVALID')
    const additions = z.array(z.object({
      hmac: z.string().regex(/^[0-9a-f]{64}$/iu), generation: z.number().int().positive(),
    }).strict()).safeParse(added)
    if (!additions.success || additions.data.length !== result.data.counts.add) throw new Error('ROSTER_STORE_INVALID')
    const protectedRowsByPhoneHmac = new Map(rows.map((protectedRow, index) => [protectedRow.phoneHmac, parsed.data.rows[index]!]))
    const credentials = await Promise.all(additions.data.map(async addition => {
      const row = protectedRowsByPhoneHmac.get(addition.hmac)
      if (!row) throw new Error('ROSTER_STORE_INVALID')
      return rosterCredentialSchema.parse({
        name: row.name, phone: row.phone,
        password: await deriveInitialPassword({ cycleId: parsed.data.cycleId, phone: row.phone, generation: addition.generation, pepper: keyring.currentPassword.pepper }),
      })
    }))
    return { ...result.data, credentials }
  },
  async currentCredentials() {
    const data = await rpcData(rpc, 'read_current_roster_credentials_v1')
    const records = z.array(z.object({
      id: z.number().int().positive(),
      nameCiphertext: z.string(), nameIv: z.string(), phoneCiphertext: z.string(), phoneIv: z.string(),
      passwordGeneration: z.number().int().positive(), passwordKeyVersion: z.number().int().positive(),
      cycleId: z.string().uuid(),
    }).strict()).safeParse(data)
    if (!records.success) throw new Error('ROSTER_STORE_INVALID')
    return Promise.all(records.data.map(async record => {
      if (record.passwordKeyVersion !== keyring.currentPassword.version) throw new Error('ROSTER_KEY_VERSION_INVALID')
      const [name, phone] = await Promise.all([
        revealApplicantName({ ciphertext: bytesFromHex(record.nameCiphertext), iv: bytesFromHex(record.nameIv) }, keyring.piiEncryptionKey),
        revealPhone({ ciphertext: bytesFromHex(record.phoneCiphertext), iv: bytesFromHex(record.phoneIv) }, keyring.piiEncryptionKey),
      ])
      return rosterCredentialSchema.parse({ name, phone, password: await deriveInitialPassword({ cycleId: record.cycleId, phone, generation: record.passwordGeneration, pepper: keyring.currentPassword.pepper }) })
    }))
  },
})

export const getServerRosterKeyring = (): RosterKeyring => {
  const config = useRuntimeConfig() as Record<string, string | undefined>
  const version = Number(config.passwordPepperVersion ?? '')
  if (!Number.isInteger(version) || version < 1) throw new Error('CRYPTO_SECRET_INVALID')
  return {
    phoneHmacKey: decodeBase64urlSecret(config.phoneHmacKey ?? ''), nameHmacKey: decodeBase64urlSecret(config.nameHmacKey ?? ''),
    piiEncryptionKey: decodeBase64urlSecret(config.phoneEncryptionKey ?? ''),
    currentPassword: { version, pepper: decodeBase64urlSecret(config.passwordPepper ?? '') },
  }
}

export const getServerApplicantRosterService = () => createApplicantRosterService({
  keyring: getServerRosterKeyring(), rpc: async (name, args) => getServerSupabaseClient().rpc(name, args),
})
