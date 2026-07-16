import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { getServerAdminCampaignsService, parseAdminCampaignListQuery } from '../../../modules/admin/campaigns'
import { type AdminContext, getServerRequireAdmin } from '../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../utils/app-error'

type Service = ReturnType<typeof getServerAdminCampaignsService>
type Response = Awaited<ReturnType<Service['list']>>
type Dependencies = {
  campaigns: Pick<Service, 'list'>
  getQuery: (event: unknown) => unknown
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createAdminCampaignsListHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    await dependencies.requireAdmin(event)
    return { data: await dependencies.campaigns.list(parseAdminCampaignListQuery(dependencies.getQuery(event))), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createAdminCampaignsListHandler({
  campaigns: getServerAdminCampaignsService(),
  getQuery: requestEvent => getQuery(requestEvent as never),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
