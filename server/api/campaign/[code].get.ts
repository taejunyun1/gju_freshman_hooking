import type { ApiFailure } from '../../../shared/types/api'
import { getServerAdminCampaignsService } from '../../modules/admin/campaigns'
import {
  campaignCookieName,
  campaignCookieOptions,
  issueServerCampaignCookie,
} from '../../utils/campaign-attribution'
import { AppError, toApiFailure } from '../../utils/app-error'

type Service = ReturnType<typeof getServerAdminCampaignsService>
type CookieOptions = ReturnType<typeof campaignCookieOptions>
type Dependencies = {
  campaigns: Pick<Service, 'resolve'>
  getCode: (event: unknown) => string | undefined
  getRequestId: (event: unknown) => string
  isProduction: () => boolean
  issueCookie: (campaignId: number) => Promise<string>
  redirect: (event: unknown, location: '/', status: 302) => unknown
  setCookie: (event: unknown, name: string, value: string, options: CookieOptions) => void
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createCampaignResolutionHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<unknown | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  try {
    const resolved = await dependencies.campaigns.resolve(dependencies.getCode(event) ?? '')
    const signed = await dependencies.issueCookie(resolved.campaignId)
    dependencies.setCookie(
      event,
      campaignCookieName,
      signed,
      campaignCookieOptions(dependencies.isProduction()),
    )
    return dependencies.redirect(event, '/', 302)
  }
  catch (error) {
    dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createCampaignResolutionHandler({
  campaigns: getServerAdminCampaignsService(),
  getCode: requestEvent => getRouterParam(requestEvent as never, 'code'),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  isProduction: () => process.env.NODE_ENV === 'production',
  issueCookie: issueServerCampaignCookie,
  redirect: (requestEvent, location, status) => sendRedirect(requestEvent as never, location, status),
  setCookie: (requestEvent, name, value, options) => setCookie(requestEvent as never, name, value, options),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
