import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { postgresByteaFromBytes } from '../../server/utils/postgres-bytea'
import { base64urlEncode, sha256, utf8 } from '../../server/utils/web-crypto'

type LocalStatus = Record<string, unknown>

const readStatusValue = (status: LocalStatus, ...keys: string[]): string => {
  for (const key of keys) {
    const value = status[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  throw new Error('LOCAL_ROUNDTRIP_CONFIG_MISSING')
}

const localRuntime = (): { serviceKey: string, url: string } => {
  const status = JSON.parse(execFileSync(
    'pnpm',
    ['exec', 'supabase', 'status', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )) as LocalStatus
  const url = readStatusValue(status, 'API_URL')
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('LOCAL_ROUNDTRIP_REMOTE_URL_REJECTED')
  }
  return {
    serviceKey: readStatusValue(status, 'SECRET_KEY', 'SERVICE_ROLE_KEY'),
    url,
  }
}

const requireSuccess = (error: unknown, message: string): void => {
  if (error) throw new Error(message)
}

describe('local PostgREST credential recovery', () => {
  it('roundtrips audited approval, exact app hashing, completion, invalidation, and revocation', async () => {
    const runtime = localRuntime()
    const client = createClient(runtime.url, runtime.serviceKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    })
    const fixture = randomUUID()
    const traceId = randomUUID()
    let adminUserId: string | undefined
    let prospectId: number | undefined
    let cleanupFailed = false
    let roundtripError: unknown

    try {
      const authUser = await client.auth.admin.createUser({
        email: `roundtrip-${fixture}@example.test`,
        email_confirm: true,
        password: `Aa!${randomBytes(24).toString('base64url')}`,
      })
      requireSuccess(authUser.error, 'LOCAL_ROUNDTRIP_AUTH_FIXTURE_FAILED')
      adminUserId = authUser.data.user?.id
      if (!adminUserId) throw new Error('LOCAL_ROUNDTRIP_AUTH_FIXTURE_FAILED')

      const adminInsert = await client.from('admin_users').insert({ id: adminUserId })
      requireSuccess(adminInsert.error, 'LOCAL_ROUNDTRIP_ADMIN_FIXTURE_FAILED')

      const prospectInsert = await client.from('prospects').insert({
        applicant_stage: 'high3',
        nickname: `원자복구${fixture.slice(0, 8)}`,
        phone_ciphertext: postgresByteaFromBytes(randomBytes(24)),
        phone_hmac: postgresByteaFromBytes(randomBytes(32)),
        phone_iv: postgresByteaFromBytes(randomBytes(12)),
        region: 'gwangju',
        school_name: '광주고등학교',
      }).select('id').single()
      requireSuccess(prospectInsert.error, 'LOCAL_ROUNDTRIP_PROSPECT_FIXTURE_FAILED')
      if (typeof prospectInsert.data?.id !== 'number') throw new Error('LOCAL_ROUNDTRIP_PROSPECT_FIXTURE_FAILED')
      prospectId = prospectInsert.data.id

      const originalHash = randomBytes(32)
      const originalSalt = randomBytes(16)
      requireSuccess((await client.from('student_credentials').insert({
        password_hash: postgresByteaFromBytes(originalHash),
        password_salt: postgresByteaFromBytes(originalSalt),
        prospect_id: prospectId,
      })).error, 'LOCAL_ROUNDTRIP_CREDENTIAL_FIXTURE_FAILED')

      const requestInsert = await client.from('credential_recovery_requests').insert({
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        prospect_id: prospectId,
      }).select('id').single()
      requireSuccess(requestInsert.error, 'LOCAL_ROUNDTRIP_REQUEST_FIXTURE_FAILED')
      if (typeof requestInsert.data?.id !== 'number') throw new Error('LOCAL_ROUNDTRIP_REQUEST_FIXTURE_FAILED')
      const approvedRequestId = requestInsert.data.id

      const secondCode = base64urlEncode(randomBytes(16))
      const secondCodeHash = await sha256(utf8(secondCode))
      const secondInsert = await client.from('credential_recovery_requests').insert({
        code_hash: postgresByteaFromBytes(secondCodeHash),
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        prospect_id: prospectId,
        status: 'verified',
        verified_at: new Date().toISOString(),
        verified_by_admin_id: adminUserId,
      }).select('id').single()
      requireSuccess(secondInsert.error, 'LOCAL_ROUNDTRIP_SECOND_CODE_FIXTURE_FAILED')
      if (typeof secondInsert.data?.id !== 'number') throw new Error('LOCAL_ROUNDTRIP_SECOND_CODE_FIXTURE_FAILED')
      const secondRequestId = secondInsert.data.id

      requireSuccess((await client.from('student_sessions').insert([
        {
          expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          idle_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          prospect_id: prospectId,
          token_hash: postgresByteaFromBytes(randomBytes(32)),
        },
        {
          expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          idle_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          prospect_id: prospectId,
          token_hash: postgresByteaFromBytes(randomBytes(32)),
        },
      ])).error, 'LOCAL_ROUNDTRIP_SESSION_FIXTURE_FAILED')

      const approval = await client.rpc('approve_credential_recovery_request', {
        p_admin_user_id: adminUserId,
        p_request_id: approvedRequestId,
        p_trace_id: traceId,
      })
      requireSuccess(approval.error, 'LOCAL_ROUNDTRIP_APPROVAL_FAILED')
      if (!Array.isArray(approval.data) || approval.data.length !== 1) throw new Error('LOCAL_ROUNDTRIP_APPROVAL_WIRE_INVALID')
      const approved = approval.data[0] as Record<string, unknown>
      if (Object.keys(approved).sort().join(',') !== 'code,expires_at') throw new Error('LOCAL_ROUNDTRIP_APPROVAL_WIRE_INVALID')
      if (typeof approved.code !== 'string' || !/^[A-Za-z0-9_-]{22}$/u.test(approved.code)) {
        throw new Error('LOCAL_ROUNDTRIP_APPROVAL_WIRE_INVALID')
      }
      if (typeof approved.expires_at !== 'string' || Number.isNaN(Date.parse(approved.expires_at))) {
        throw new Error('LOCAL_ROUNDTRIP_APPROVAL_WIRE_INVALID')
      }

      const returnedCodeHash = await sha256(utf8(approved.code))
      const newPasswordHash = randomBytes(32)
      const newPasswordSalt = randomBytes(16)
      const completion = await client.rpc('complete_credential_recovery', {
        p_code_hash: postgresByteaFromBytes(returnedCodeHash),
        p_password_hash: postgresByteaFromBytes(newPasswordHash),
        p_password_salt: postgresByteaFromBytes(newPasswordSalt),
      })
      requireSuccess(completion.error, 'LOCAL_ROUNDTRIP_COMPLETION_FAILED')
      if (completion.data !== true) throw new Error('LOCAL_ROUNDTRIP_COMPLETION_FAILED')

      const credential = await client.from('student_credentials')
        .select('password_hash,password_salt').eq('prospect_id', prospectId).single()
      requireSuccess(credential.error, 'LOCAL_ROUNDTRIP_CREDENTIAL_VERIFY_FAILED')
      if (
        credential.data?.password_hash !== postgresByteaFromBytes(newPasswordHash)
        || credential.data?.password_salt !== postgresByteaFromBytes(newPasswordSalt)
      ) throw new Error('LOCAL_ROUNDTRIP_CREDENTIAL_VERIFY_FAILED')

      const requests = await client.from('credential_recovery_requests')
        .select('id,status,code_hash').eq('prospect_id', prospectId)
      requireSuccess(requests.error, 'LOCAL_ROUNDTRIP_INVALIDATION_VERIFY_FAILED')
      const approvedRow = requests.data?.find(row => row.id === approvedRequestId)
      const secondRow = requests.data?.find(row => row.id === secondRequestId)
      if (
        approvedRow?.status !== 'consumed'
        || approvedRow.code_hash !== null
        || secondRow?.status !== 'expired'
        || secondRow.code_hash !== null
      ) throw new Error('LOCAL_ROUNDTRIP_INVALIDATION_VERIFY_FAILED')

      const sessions = await client.from('student_sessions').select('revoked_at').eq('prospect_id', prospectId)
      requireSuccess(sessions.error, 'LOCAL_ROUNDTRIP_SESSION_VERIFY_FAILED')
      if (!sessions.data || sessions.data.length !== 2 || sessions.data.some(row => typeof row.revoked_at !== 'string')) {
        throw new Error('LOCAL_ROUNDTRIP_SESSION_VERIFY_FAILED')
      }

      const audit = await client.from('audit_events')
        .select('action,target_type,target_id,metadata,request_id')
        .eq('request_id', traceId)
      requireSuccess(audit.error, 'LOCAL_ROUNDTRIP_AUDIT_VERIFY_FAILED')
      if (
        !audit.data
        || audit.data.length !== 1
        || audit.data[0]?.action !== 'credential_recovery_approved'
        || audit.data[0]?.target_type !== 'credential_recovery_request'
        || audit.data[0]?.target_id !== String(approvedRequestId)
        || JSON.stringify(audit.data[0]?.metadata) !== '{}'
      ) throw new Error('LOCAL_ROUNDTRIP_AUDIT_VERIFY_FAILED')

      const secondCompletion = await client.rpc('complete_credential_recovery', {
        p_code_hash: postgresByteaFromBytes(secondCodeHash),
        p_password_hash: postgresByteaFromBytes(randomBytes(32)),
        p_password_salt: postgresByteaFromBytes(randomBytes(16)),
      })
      requireSuccess(secondCompletion.error, 'LOCAL_ROUNDTRIP_SECOND_CODE_VERIFY_FAILED')
      expect(secondCompletion.data).toBe(false)
    }
    catch (error) {
      roundtripError = error
    }
    finally {
      if ((await client.from('audit_events').delete().eq('request_id', traceId)).error) cleanupFailed = true
      if (prospectId !== undefined && (await client.from('prospects').delete().eq('id', prospectId)).error) cleanupFailed = true
      if (adminUserId !== undefined && (await client.from('admin_users').delete().eq('id', adminUserId)).error) cleanupFailed = true
      if (adminUserId !== undefined && (await client.auth.admin.deleteUser(adminUserId)).error) cleanupFailed = true
    }
    if (cleanupFailed) throw new Error('LOCAL_ROUNDTRIP_CLEANUP_FAILED')
    if (roundtripError) throw roundtripError
  }, 30_000)
})
