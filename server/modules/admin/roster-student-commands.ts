import { z } from 'zod'

import {
  applicantRosterRowSchema,
  rosterCredentialSchema,
  type RosterCredential,
} from '../../../shared/schemas/admission-roster'
import { AppError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'
import { protectApplicantName, revealApplicantName } from '../identity/applicant-name'
import { protectPhone, revealPhone } from '../identity/phone'
import {
  deriveInitialPassword,
  derivePasswordDigest,
  nextPasswordGeneration,
  type RosterKeyring,
} from '../identity/roster-credentials'
import { getServerRosterKeyring } from './applicant-roster'

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown, error: unknown }>

type CommandDependencies = {
  keyring: RosterKeyring
  rpc: Rpc
}

type CommandContext = {
  adminUserId: string
}

const safeIdSchema = z.number().int().positive().safe()
const hex64Schema = z.string().regex(/^[0-9a-f]{64}$/iu)

const studentProfileInputSchema = z.object({
  studentId: safeIdSchema,
  name: z.string(),
  highSchool: z.string(),
  grade: z.string(),
  passwordGeneration: z.number().int().positive().optional(),
}).strict()

const changePhoneInputSchema = z.object({
  studentId: safeIdSchema,
  phone: z.string(),
  expectedGeneration: z.number().int().positive().optional(),
}).strict()

const statusInputSchema = z.object({
  studentId: safeIdSchema,
  status: z.enum(['active', 'inactive']),
}).strict()

const reissueInputSchema = z.object({
  studentId: safeIdSchema,
  expectedGeneration: z.number().int().positive().optional(),
}).strict()

const resultSchema = z.object({
  kind: z.enum(['success', 'conflict', 'validation_error', 'forbidden']).optional(),
}).passthrough()

const hex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
const bytea = (bytes: Uint8Array): string => `\\x${hex(bytes)}`
const hexBytea = (value: string): string => `\\x${hex64Schema.parse(value)}`
const bytesFromHex = (value: string): Uint8Array => {
  if (!/^(?:[0-9a-f]{2})+$/iu.test(value)) throw new Error('ROSTER_STUDENT_STORE_INVALID')
  return Uint8Array.from(value.match(/../gu)!.map(byte => Number.parseInt(byte, 16)))
}

const rpcData = async (rpc: Rpc, name: string, args?: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await rpc(name, args)
  if (error) throw new Error('ROSTER_STUDENT_STORE_UNAVAILABLE')
  return data
}

const assertSuccess = (value: unknown): Record<string, unknown> => {
  const parsed = resultSchema.safeParse(value)
  if (!parsed.success) throw new Error('ROSTER_STUDENT_STORE_INVALID')
  if (parsed.data.kind === 'validation_error') throw new AppError('ROSTER_INVALID')
  if (parsed.data.kind === 'conflict' || parsed.data.kind === 'forbidden') throw new AppError('ROSTER_CONFLICT')
  if (parsed.data.kind !== undefined && parsed.data.kind !== 'success') throw new Error('ROSTER_STUDENT_STORE_INVALID')
  return parsed.data
}

const protectApplicant = async (
  input: { name: string, phone: string, highSchool: string, grade: string },
  admissionYear: number,
  keyring: RosterKeyring,
) => {
  const row = applicantRosterRowSchema.parse(input)
  const [phone, name, password] = await Promise.all([
    protectPhone(row.phone, keyring.phoneHmacKey, keyring.piiEncryptionKey),
    protectApplicantName(row.name, keyring.nameHmacKey, keyring.piiEncryptionKey),
    deriveInitialPassword({ admissionYear, phone: row.phone }),
  ])
  return {
    row,
    password,
    protectedStudent: {
      phoneHmac: hex(phone.hmac),
      phoneCiphertext: hex(phone.ciphertext),
      phoneIv: hex(phone.iv),
      nameHmac: hex(name.hmac),
      nameCiphertext: hex(name.ciphertext),
      nameIv: hex(name.iv),
      schoolName: row.highSchool,
      applicantStage: row.grade,
      passwordDigest: hex(await derivePasswordDigest(password, keyring.currentPassword.pepper)),
      passwordGeneration: 1,
    },
  }
}

const protectProfile = async (
  input: { name: string, highSchool: string, grade: string },
  keyring: RosterKeyring,
) => {
  const row = applicantRosterRowSchema.omit({ phone: true }).parse(input)
  const name = await protectApplicantName(row.name, keyring.nameHmacKey, keyring.piiEncryptionKey)
  return {
    row,
    protectedName: {
      nameHmac: hex(name.hmac),
      nameCiphertext: hex(name.ciphertext),
      nameIv: hex(name.iv),
      schoolName: row.highSchool,
      applicantStage: row.grade,
    },
  }
}

const credential = (input: { name: string, phone: string, password: string }): RosterCredential => (
  rosterCredentialSchema.parse(input)
)

const cycleSchema = z.object({
  id: z.string().uuid(),
  year: z.number().int().min(2000).max(9999),
  status: z.enum(['current', 'archived']),
}).passthrough()

const listCycles = async (rpc: Rpc) => z.array(cycleSchema).parse(await rpcData(rpc, 'list_admission_cycles_v1'))

const resolveCycle = async (rpc: Rpc, cycleId?: string) => {
  const cycles = await listCycles(rpc)
  const cycle = cycleId === undefined
    ? cycles.find(candidate => candidate.status === 'current')
    : cycles.find(candidate => candidate.id === cycleId && candidate.status === 'current')
  if (!cycle) throw new AppError('ROSTER_CONFLICT')
  return cycle
}

const rosterStudentRecordSchema = z.object({
  id: safeIdSchema,
  cycleId: z.string().uuid(),
  status: z.enum(['active', 'inactive', 'deleted']),
  isTest: z.boolean(),
  nameCiphertext: z.string(),
  nameIv: z.string(),
  phoneCiphertext: z.string(),
  phoneIv: z.string(),
  schoolName: z.string(),
  applicantStage: z.string(),
  passwordGeneration: z.number().int().positive(),
}).strict()

const loadRosterStudent = async (
  rpc: Rpc,
  keyring: RosterKeyring,
  studentId: number,
) => {
  const record = rosterStudentRecordSchema.parse(await rpcData(rpc, 'read_roster_student_v1', { p_prospect_id: studentId }))
  if (record.status !== 'active' && record.status !== 'inactive') throw new AppError('ROSTER_CONFLICT')
  const [name, phone] = await Promise.all([
    revealApplicantName({ ciphertext: bytesFromHex(record.nameCiphertext), iv: bytesFromHex(record.nameIv) }, keyring.piiEncryptionKey),
    revealPhone({ ciphertext: bytesFromHex(record.phoneCiphertext), iv: bytesFromHex(record.phoneIv) }, keyring.piiEncryptionKey),
  ])
  return { ...record, name, phone }
}

export const createRosterStudentCommands = ({ keyring, rpc }: CommandDependencies) => ({
  add: async (input: unknown, context: CommandContext) => {
    const parsed = z.object({
      cycleId: z.string().uuid().optional(),
      name: z.string(),
      phone: z.string(),
      highSchool: z.string(),
      grade: z.string(),
    }).strict().safeParse(input)
    if (!parsed.success) throw new AppError('ROSTER_INVALID')
    const cycle = await resolveCycle(rpc, parsed.data.cycleId)
    const protectedInput = await protectApplicant({
      name: parsed.data.name,
      phone: parsed.data.phone,
      highSchool: parsed.data.highSchool,
      grade: parsed.data.grade,
    }, cycle.year, keyring)
    const data = assertSuccess(await rpcData(rpc, 'add_roster_student_v1', {
      p_cycle_id: cycle.id,
      p_admin_user_id: context.adminUserId,
      p_student: protectedInput.protectedStudent,
    }))
    const prospectId = safeIdSchema.parse(data.prospectId)
    return {
      id: prospectId,
      credential: credential({
        name: protectedInput.row.name,
        phone: protectedInput.row.phone,
        password: protectedInput.password,
      }),
    }
  },

  updateProfile: async (input: unknown) => {
    const parsed = studentProfileInputSchema.safeParse(input)
    if (!parsed.success) throw new AppError('ROSTER_INVALID')
    const protectedInput = await protectProfile({
      name: parsed.data.name,
      highSchool: parsed.data.highSchool,
      grade: parsed.data.grade,
    }, keyring)
    assertSuccess(await rpcData(rpc, 'update_roster_student_profile_v1', {
      p_prospect_id: parsed.data.studentId,
      p_name_hmac: hexBytea(protectedInput.protectedName.nameHmac),
      p_name_ciphertext: `\\x${protectedInput.protectedName.nameCiphertext}`,
      p_name_iv: `\\x${protectedInput.protectedName.nameIv}`,
      p_school_name: protectedInput.protectedName.schoolName,
      p_applicant_stage: protectedInput.protectedName.applicantStage,
    }))
    return { kind: 'success' as const }
  },

  changePhone: async (input: unknown) => {
    const parsed = changePhoneInputSchema.safeParse(input)
    if (!parsed.success) throw new AppError('ROSTER_INVALID')
    const current = await loadRosterStudent(rpc, keyring, parsed.data.studentId)
    if (parsed.data.expectedGeneration !== undefined && current.passwordGeneration !== parsed.data.expectedGeneration) throw new AppError('ROSTER_CONFLICT')
    const expectedGeneration = current.passwordGeneration
    const cycle = await resolveCycle(rpc, current.cycleId)
    const nextGeneration = nextPasswordGeneration(expectedGeneration)
    const nextPin = await deriveInitialPassword({ admissionYear: cycle.year, phone: parsed.data.phone })
    const phone = await protectPhone(parsed.data.phone, keyring.phoneHmacKey, keyring.piiEncryptionKey)
    const data = assertSuccess(await rpcData(rpc, 'change_roster_student_phone_v1', {
      p_prospect_id: parsed.data.studentId,
      p_expected_generation: expectedGeneration,
      p_next_generation: nextGeneration,
      p_phone_hmac: bytea(phone.hmac),
      p_phone_ciphertext: bytea(phone.ciphertext),
      p_phone_iv: bytea(phone.iv),
      p_password_digest: bytea(await derivePasswordDigest(nextPin, keyring.currentPassword.pepper)),
    }))
    return {
      passwordGeneration: z.number().int().positive().parse(data.passwordGeneration),
      credential: credential({ name: current.name, phone: parsed.data.phone, password: nextPin }),
    }
  },

  setStatus: async (input: unknown) => {
    const parsed = statusInputSchema.safeParse(input)
    if (!parsed.success) throw new AppError('ROSTER_INVALID')
    assertSuccess(await rpcData(rpc, 'set_roster_student_status_v1', {
      p_prospect_id: parsed.data.studentId,
      p_status: parsed.data.status,
    }))
    return { kind: 'success' as const }
  },

  reissuePassword: async (input: unknown) => {
    const parsed = reissueInputSchema.safeParse(input)
    if (!parsed.success) throw new AppError('ROSTER_INVALID')
    const current = await loadRosterStudent(rpc, keyring, parsed.data.studentId)
    if (parsed.data.expectedGeneration !== undefined && current.passwordGeneration !== parsed.data.expectedGeneration) throw new AppError('ROSTER_CONFLICT')
    const expectedGeneration = current.passwordGeneration
    const cycle = await resolveCycle(rpc, current.cycleId)
    const nextGeneration = nextPasswordGeneration(expectedGeneration)
    const nextPin = await deriveInitialPassword({ admissionYear: cycle.year, phone: current.phone })
    const data = assertSuccess(await rpcData(rpc, 'reissue_roster_student_password_v1', {
      p_prospect_id: parsed.data.studentId,
      p_expected_generation: expectedGeneration,
      p_next_generation: nextGeneration,
      p_password_digest: bytea(await derivePasswordDigest(nextPin, keyring.currentPassword.pepper)),
    }))
    return {
      passwordGeneration: z.number().int().positive().parse(data.passwordGeneration),
      credential: credential({ name: current.name, phone: current.phone, password: nextPin }),
    }
  },
})

export const getServerRosterStudentCommands = () => createRosterStudentCommands({
  keyring: getServerRosterKeyring(),
  rpc: async (name, args) => getServerSupabaseClient().rpc(name, args),
})
