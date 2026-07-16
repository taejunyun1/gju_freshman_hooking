import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { getServerAdminCampaignsService, parseCampaignJsonBody } from '../../../modules/admin/campaigns'
import { type AdminContext, getServerRequireAdmin } from '../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../utils/app-error'
import { readBoundedRequestBody, RequestBodyLimitError } from '../../../utils/bounded-request-body'

type Service = ReturnType<typeof getServerAdminCampaignsService>
type Response = Awaited<ReturnType<Service['create']>>
type Dependencies = {
  campaigns: Pick<Service, 'create'>
  getContentType: (event: unknown) => string | undefined
  getRequestId: (event: unknown) => string
  readRawBody: (event: unknown) => Promise<string | undefined>
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminCampaignHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    await dependencies.requireAdmin(event)
    const input = await parseCampaignJsonBody(
      dependencies.getContentType(event),
      await dependencies.readRawBody(event),
    )
    return { data: await dependencies.campaigns.create(input), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error
      : error instanceof RequestBodyLimitError ? new AppError('CAMPAIGN_INVALID')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminCampaignHandler({
  campaigns: getServerAdminCampaignsService(),
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  readRawBody: requestEvent => readBoundedRequestBody(requestEvent, 4_096),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
