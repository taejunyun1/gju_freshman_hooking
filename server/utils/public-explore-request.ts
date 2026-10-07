import { publicCounselingSchema } from '../../shared/schemas/public-explore'
import { createPublicCounselingService, PublicExploreError, type CounselingEmail } from '../modules/public-explore/counseling'
import { getPublicExploreService } from '../modules/public-explore/service'
import { AppError, toApiFailure } from './app-error'
import { readBoundedRequestBody, RequestBodyLimitError } from './bounded-request-body'
import { getTrustedClientIp } from './trusted-client-ip'
import { base64urlEncode, sha256, utf8 } from './web-crypto'

type PublicBindings = {
  PUBLIC_EXPLORE_LIMIT?: { limit: (input: { key: string }) => Promise<{ success: boolean }> }
  PUBLIC_COUNSELING_LIMIT?: { limit: (input: { key: string }) => Promise<{ success: boolean }> }
  COUNSELING_EMAIL?: { send: (email: CounselingEmail) => Promise<unknown> }
}
const messages = {
  PUBLIC_INPUT_INVALID: '이름·휴대전화·설문 선택과 개인정보 전달 동의를 확인해 주세요.',
  PUBLIC_EMAIL_FAILED: '상담 메일을 전송하지 못했습니다. 접수되지 않았으니 잠시 후 다시 시도하거나 학과 이메일로 문의해 주세요.',
  PUBLIC_EMAIL_UNAVAILABLE: '상담 메일 연결을 준비 중입니다. photographygju@gmail.com으로 직접 문의해 주세요.',
  PUBLIC_FORBIDDEN: '이 페이지를 새로고침한 뒤 다시 시도해 주세요.',
  PUBLIC_RATE_LIMITED: '요청이 잠시 많아졌습니다. 1분 후 다시 시도해 주세요.',
  PUBLIC_UNAVAILABLE: '학과 자료를 불러오지 못했습니다. 선택은 유지되니 잠시 후 다시 시도해 주세요.',
} as const

export const handlePublicExploreRequest = async (
  event: Parameters<typeof getRequestURL>[0], kind: 'options' | 'result' | 'counseling',
) => {
  const requestId = event.context.requestId ?? crypto.randomUUID()
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const env = (event.context.cloudflare?.env ?? {}) as PublicBindings
  try {
    if (env.PUBLIC_EXPLORE_LIMIT) {
      if (!(await env.PUBLIC_EXPLORE_LIMIT.limit({ key: getTrustedClientIp(event) })).success) {
        throw new PublicExploreError('PUBLIC_RATE_LIMITED', 429)
      }
    }
    else if (process.env.NODE_ENV === 'production') throw new PublicExploreError('PUBLIC_UNAVAILABLE', 503)
    const service = getPublicExploreService()
    if (kind === 'options') return { data: await service.getOptions(), requestId }
    if (getHeader(event, 'origin') !== getRequestURL(event).origin) throw new PublicExploreError('PUBLIC_FORBIDDEN', 403)
    if (getHeader(event, 'content-type')?.split(';')[0]?.trim() !== 'application/json') {
      throw new PublicExploreError('PUBLIC_INPUT_INVALID')
    }
    let input: unknown
    try { input = JSON.parse(await readBoundedRequestBody(event) ?? '') }
    catch (error) {
      if (error instanceof RequestBodyLimitError) throw error
      throw new PublicExploreError('PUBLIC_INPUT_INVALID')
    }
    if (kind === 'result') return { data: await service.recommend(input), requestId }
    const validated = publicCounselingSchema.safeParse(input)
    if (!validated.success) throw new PublicExploreError('PUBLIC_INPUT_INVALID')
    if (!env.COUNSELING_EMAIL || !env.PUBLIC_COUNSELING_LIMIT) throw new PublicExploreError('PUBLIC_EMAIL_UNAVAILABLE', 503)
    const phoneKey = base64urlEncode(await sha256(utf8(validated.data.phone)))
    if (!(await env.PUBLIC_COUNSELING_LIMIT.limit({ key: phoneKey })).success) throw new PublicExploreError('PUBLIC_RATE_LIMITED', 429)
    return {
      data: await createPublicCounselingService({
        recommend: service.recommend, send: email => env.COUNSELING_EMAIL!.send(email),
      }).submit(input), requestId,
    }
  }
  catch (error) {
    if (error instanceof AppError) {
      setResponseStatus(event, error.statusCode)
      return toApiFailure(error, requestId)
    }
    const failure = error instanceof PublicExploreError ? error
      : error instanceof RequestBodyLimitError ? new PublicExploreError('PUBLIC_INPUT_INVALID', 413)
        : new PublicExploreError('PUBLIC_UNAVAILABLE', 503)
    setResponseStatus(event, failure.status)
    return { error: { code: failure.code, message: messages[failure.code] }, requestId }
  }
}
