import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../modules/identity/admin-auth'
import { bytesFromPostgresBytea } from '../../../modules/identity/password-recovery'
import { revealPhone } from '../../../modules/identity/phone'
import { toApiFailure } from '../../../utils/app-error'
import { getServerSupabaseClient } from '../../../utils/supabase'
import { decodeBase64urlSecret } from '../../../utils/web-crypto'

type StoredRecoveryRequest = {
  expiresAt: Date
  id: number
  nickname: string
  phoneCiphertext: Uint8Array
  phoneIv: Uint8Array
  region: string
  requestedAt: Date
  status: string
}

export type AdminRecoveryQueueItem = {
  age: string
  id: number
  maskedPhone: string
  nickname: string
  region: string
  state: '승인 대기'
}

type RecoveryQueueDependencies = {
  findPendingRequests: (now: Date) => Promise<StoredRecoveryRequest[]>
  now?: () => Date
  revealPhone: (value: { ciphertext: Uint8Array, iv: Uint8Array }) => Promise<string>
}

type RecoveryListHandlerDependencies = {
  getRequestId: (event: unknown) => string
  listPending: () => Promise<AdminRecoveryQueueItem[]>
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setStatus: (event: unknown, status: number) => void
}

const regionLabels: Record<string, string> = {
  capital: '수도권',
  chungcheong: '충청권',
  gangwon_jeju: '강원·제주',
  gwangju: '광주광역시',
  gyeongsang: '경상권',
  jeonbuk: '전북',
  other: '기타',
  overseas: '해외',
}

const maskPhone = (phone: string): string => {
  const match = phone.match(/^(010)\d{4}(\d{4})$/u)
  if (!match) throw new Error('RECOVERY_PHONE_INVALID')
  return `${match[1]}-****-${match[2]}`
}

const requestAge = (requestedAt: Date, now: Date): string => {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - requestedAt.getTime()) / 60_000))
  if (elapsedMinutes < 60) return `요청 ${elapsedMinutes}분 경과`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `요청 ${elapsedHours}시간 경과`
  return `요청 ${Math.floor(elapsedHours / 24)}일 경과`
}

export const createRecoveryQueueService = (dependencies: RecoveryQueueDependencies) => ({
  listPending: async (): Promise<AdminRecoveryQueueItem[]> => {
    const now = (dependencies.now ?? (() => new Date()))()
    const requests = await dependencies.findPendingRequests(now)
    const pending = requests.filter(request => request.status === 'requested' && request.expiresAt.getTime() > now.getTime())

    return Promise.all(pending.map(async request => ({
      age: requestAge(request.requestedAt, now),
      id: request.id,
      maskedPhone: maskPhone(await dependencies.revealPhone({
        ciphertext: request.phoneCiphertext,
        iv: request.phoneIv,
      })),
      nickname: request.nickname,
      region: regionLabels[request.region] ?? '기타',
      state: '승인 대기' as const,
    })))
  },
})

const asDate = (value: unknown): Date => {
  if (typeof value !== 'string') throw new Error('RECOVERY_STORE_INVALID')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('RECOVERY_STORE_INVALID')
  return date
}

const getServerRecoveryQueueService = () => {
  const client = getServerSupabaseClient()
  const runtimeConfig = useRuntimeConfig()
  const encryptionKey = decodeBase64urlSecret(runtimeConfig.phoneEncryptionKey)

  return createRecoveryQueueService({
    findPendingRequests: async (now) => {
      const { data, error } = await client.from('credential_recovery_requests')
        .select('id,status,requested_at,expires_at,prospect:prospects!inner(nickname,region,phone_ciphertext,phone_iv)')
        .eq('status', 'requested')
        .gt('expires_at', now.toISOString())
        .order('requested_at', { ascending: true })
      if (error) throw new Error('RECOVERY_STORE_UNAVAILABLE')

      return (data ?? []).map((row) => {
        const prospect = row.prospect as unknown as Record<string, unknown> | null
        if (
          !prospect
          || typeof row.id !== 'number'
          || typeof row.status !== 'string'
          || typeof prospect.nickname !== 'string'
          || typeof prospect.region !== 'string'
          || typeof prospect.phone_ciphertext !== 'string'
          || typeof prospect.phone_iv !== 'string'
        ) throw new Error('RECOVERY_STORE_INVALID')

        return {
          expiresAt: asDate(row.expires_at),
          id: row.id,
          nickname: prospect.nickname,
          phoneCiphertext: bytesFromPostgresBytea(prospect.phone_ciphertext),
          phoneIv: bytesFromPostgresBytea(prospect.phone_iv),
          region: prospect.region,
          requestedAt: asDate(row.requested_at),
          status: row.status,
        }
      })
    },
    revealPhone: value => revealPhone(value, encryptionKey),
  })
}

export const createRecoveryListHandler = (dependencies: RecoveryListHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<{ requests: AdminRecoveryQueueItem[] }> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  try {
    await dependencies.requireAdmin(event)
    return { data: { requests: await dependencies.listPending() }, requestId }
  }
  catch (error) {
    const failure = toApiFailure(error, requestId)
    dependencies.setStatus(event, failure.error.code === 'INTERNAL_ERROR' ? 500 : 403)
    return failure
  }
}

export default defineEventHandler((event) => {
  const queue = getServerRecoveryQueueService()
  return createRecoveryListHandler({
    getRequestId: (requestEvent) => {
      const context = (requestEvent as { context?: { requestId?: unknown } }).context
      return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
    },
    listPending: queue.listPending,
    requireAdmin: getServerRequireAdmin(),
    setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
  })(event)
})
