import { describe, expect, it, vi } from 'vitest'

import { createAdminRosterStudentPatchHandler } from '../../../server/api/admin/students/[id].patch'
import { createAdminRosterStudentStatusHandler } from '../../../server/api/admin/students/[id]/status.post'
import { createAdminRosterStudentPhoneHandler } from '../../../server/api/admin/students/[id]/phone.post'
import { createAdminRosterStudentPasswordReissueHandler } from '../../../server/api/admin/students/[id]/password/reissue.post'
import { createAdminRosterStudentAddHandler } from '../../../server/api/admin/students/index.post'
import { createRosterStudentCommands } from '../../../server/modules/admin/roster-student-commands'
import { protectApplicantName } from '../../../server/modules/identity/applicant-name'
import { protectPhone } from '../../../server/modules/identity/phone'
import { AppError } from '../../../server/utils/app-error'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const cycleId = '11111111-1111-4111-8111-111111111111'
const keyring = { phoneHmacKey: new Uint8Array(32).fill(1), nameHmacKey: new Uint8Array(32).fill(2), piiEncryptionKey: new Uint8Array(32).fill(3), currentPassword: { version: 1, pepper: new Uint8Array(32).fill(4) } }
const applicant = { name: '윤 태준', phone: '010-1234-5678', highSchool: '광주고', grade: '고3' }

const protectedRecord = async (overrides: Record<string, unknown> = {}) => {
  const [name, phone] = await Promise.all([
    protectApplicantName('윤 태준', keyring.nameHmacKey, keyring.piiEncryptionKey),
    protectPhone('01012345678', keyring.phoneHmacKey, keyring.piiEncryptionKey),
  ])
  return {
    id: 42,
    cycleId,
    status: 'active',
    isTest: false,
    nameCiphertext: Buffer.from(name.ciphertext).toString('hex'),
    nameIv: Buffer.from(name.iv).toString('hex'),
    phoneCiphertext: Buffer.from(phone.ciphertext).toString('hex'),
    phoneIv: Buffer.from(phone.iv).toString('hex'),
    schoolName: '광주고',
    applicantStage: 'high3',
    passwordGeneration: 3,
    ...overrides,
  }
}

describe('individual roster student commands', () => {
  it('adds one applicant through the add RPC and returns a one-time credential', async () => {
    const rpc = vi.fn(async () => ({ data: { kind: 'success', prospectId: 42 }, error: null }))
    const result = await createRosterStudentCommands({ keyring, rpc }).add({ cycleId, ...applicant }, { adminUserId: 'admin-1' })
    expect(result).toMatchObject({ id: 42, credential: { name: '윤 태준', phone: '01012345678', password: expect.any(String) } }); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('maps a duplicate current-cycle phone to a safe conflict', async () => {
    const rpc = vi.fn(async () => ({ data: { kind: 'conflict', code: 'PHONE_CONFLICT' }, error: null }))
    await expect(createRosterStudentCommands({ keyring, rpc }).add({ cycleId, ...applicant }, { adminUserId: 'admin-1' })).rejects.toMatchObject({ code: 'ROSTER_CONFLICT' })
  })
  it('keeps password generation unchanged when editing a profile', async () => {
    const rpc = vi.fn(async () => ({ data: { kind: 'success' }, error: null }))
    await createRosterStudentCommands({ keyring, rpc }).updateProfile({ studentId: 42, name: '새 이름', highSchool: '전남고', grade: '고2', passwordGeneration: 3 })
    expect(rpc).toHaveBeenCalledWith('update_roster_student_profile_v1', expect.not.objectContaining({ p_password_generation: expect.anything() }))
  })
  it('changes phone with a new password generation and one RPC', async () => {
    const record = await protectedRecord({ passwordGeneration: 2 })
    const rpc = vi.fn(async (name: string) => name === 'read_roster_student_v1' ? { data: record, error: null } : { data: { kind: 'success', passwordGeneration: 3 }, error: null })
    const result = await createRosterStudentCommands({ keyring, rpc }).changePhone({ studentId: 42, phone: '010-9999-5678', expectedGeneration: 2 })
    expect(result.passwordGeneration).toBe(3); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('returns a safe conflict for a stale password generation', async () => {
    const rpc = vi.fn(async () => ({ data: await protectedRecord({ passwordGeneration: 3 }), error: null }))
    await expect(createRosterStudentCommands({ keyring, rpc }).reissuePassword({ studentId: 42, expectedGeneration: 2 })).rejects.toMatchObject({ code: 'ROSTER_CONFLICT' })
  })
  it('deactivates with its status RPC and reactivates without resetting the password', async () => {
    const rpc = vi.fn(async () => ({ data: { kind: 'success' }, error: null })); const commands = createRosterStudentCommands({ keyring, rpc })
    await commands.setStatus({ studentId: 42, status: 'inactive' }); await commands.setStatus({ studentId: 42, status: 'active' })
    expect(rpc).toHaveBeenNthCalledWith(1, 'set_roster_student_status_v1', { p_prospect_id: 42, p_status: 'inactive' }); expect(rpc).toHaveBeenNthCalledWith(2, 'set_roster_student_status_v1', { p_prospect_id: 42, p_status: 'active' })
  })
  it('reissues a one-time credential with the next generation', async () => {
    const record = await protectedRecord({ passwordGeneration: 3 })
    const rpc = vi.fn(async (name: string) => name === 'read_roster_student_v1' ? { data: record, error: null } : { data: { kind: 'success', passwordGeneration: 4 }, error: null })
    const result = await createRosterStudentCommands({ keyring, rpc }).reissuePassword({ studentId: 42, expectedGeneration: 3 })
    expect(result).toMatchObject({ passwordGeneration: 4, credential: { password: expect.any(String) } })
  })
})

describe('individual roster student route handlers', () => {
  const event = () => ({ headers: {} as Record<string, string>, status: undefined as number | undefined })
  const responseDependencies = (target: ReturnType<typeof event>) => ({
    getRequestId: () => 'trace-id',
    setHeader: (_event: unknown, name: string, value: string) => { target.headers[name] = value },
    setStatus: (_event: unknown, status: number) => { target.status = status },
  })

  it('adds one student after ordinary admin auth and returns a private credential envelope', async () => {
    const target = event()
    const add = vi.fn(async () => ({ id: 42, credential: { name: '윤 태준', phone: '01012345678', password: '5678AB' } }))
    const response = await createAdminRosterStudentAddHandler({
      commands: { add },
      getBody: async () => ({ cycleId, ...applicant }),
      requireAdmin: async () => ({ userId: 'admin-1' }),
      ...responseDependencies(target),
    })(target)

    expect(add).toHaveBeenCalledWith({ cycleId, ...applicant }, { adminUserId: 'admin-1' })
    expect(target.headers['cache-control']).toBe('private, no-store')
    expect(response).toMatchObject({ data: { id: 42, credential: { password: '5678AB' } }, requestId: 'trace-id' })
  })

  it('patches a roster student profile through the command adapter', async () => {
    const target = event()
    const updateProfile = vi.fn(async () => ({ kind: 'success' as const }))
    const response = await createAdminRosterStudentPatchHandler({
      commands: { updateProfile },
      getParam: () => '42',
      getBody: async () => ({ name: '새 이름', highSchool: '광주고', grade: '고3', passwordGeneration: 2 }),
      requireAdmin: async () => ({ userId: 'admin-1' }),
      ...responseDependencies(target),
    })(target)

    expect(updateProfile).toHaveBeenCalledWith({ studentId: 42, name: '새 이름', highSchool: '광주고', grade: '고3', passwordGeneration: 2 })
    expect(response).toEqual({ data: { kind: 'success' }, requestId: 'trace-id' })
  })

  it('requires a confirmation body for status changes and maps command conflicts safely', async () => {
    const target = event()
    const response = await createAdminRosterStudentStatusHandler({
      commands: { setStatus: vi.fn(async () => ({ kind: 'success' as const })) },
      getParam: () => '42',
      getBody: async () => ({ status: 'inactive', confirmation: 'wrong' }),
      requireAdmin: async () => ({ userId: 'admin-1' }),
      ...responseDependencies(target),
    })(target)
    expect(target.status).toBe(422)
    expect(response).toMatchObject({ error: { code: 'ROSTER_INVALID' } })

    const conflictTarget = event()
    const conflict = await createAdminRosterStudentStatusHandler({
      commands: { setStatus: vi.fn(async () => { throw new AppError('ROSTER_CONFLICT') }) },
      getParam: () => '42',
      getBody: async () => ({ status: 'inactive', confirmation: '42 비활성화' }),
      requireAdmin: async () => ({ userId: 'admin-1' }),
      ...responseDependencies(conflictTarget),
    })(conflictTarget)
    expect(conflictTarget.status).toBe(409)
    expect(conflict).toMatchObject({ error: { code: 'ROSTER_CONFLICT' } })
  })

  it('requires recent admin auth for password reissue and returns the one-time credential', async () => {
    const target = event()
    const reissuePassword = vi.fn(async () => ({ passwordGeneration: 4, credential: { name: '지원자', phone: '01012345678', password: '5678CD' } }))
    const requireRecentAdmin = vi.fn(async () => ({ userId: 'admin-1' }))
    const response = await createAdminRosterStudentPasswordReissueHandler({
      commands: { reissuePassword },
      getParam: () => '42',
      getBody: async () => ({}),
      requireRecentAdmin,
      ...responseDependencies(target),
    })(target)

    expect(requireRecentAdmin).toHaveBeenCalledWith(target, { recentAuthMinutes: 15 })
    expect(reissuePassword).toHaveBeenCalledWith({ studentId: 42 })
    expect(response).toMatchObject({ data: { passwordGeneration: 4, credential: { password: '5678CD' } } })
  })

  it('requires recent admin auth for phone changes and lets the command read the current generation', async () => {
    const target = event()
    const changePhone = vi.fn(async () => ({ passwordGeneration: 5, credential: { name: '지원자', phone: '01099995678', password: '5678EF' } }))
    const requireRecentAdmin = vi.fn(async () => ({ userId: 'admin-1' }))
    const response = await createAdminRosterStudentPhoneHandler({
      commands: { changePhone },
      getParam: () => '42',
      getBody: async () => ({ phone: '010-9999-5678' }),
      requireRecentAdmin,
      ...responseDependencies(target),
    })(target)

    expect(requireRecentAdmin).toHaveBeenCalledWith(target, { recentAuthMinutes: 15 })
    expect(changePhone).toHaveBeenCalledWith({ studentId: 42, phone: '010-9999-5678' })
    expect(response).toMatchObject({ data: { passwordGeneration: 5, credential: { password: '5678EF' } } })
  })
})
