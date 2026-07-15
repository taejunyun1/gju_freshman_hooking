import type { ApiFailure, ApiSuccess } from '../../../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../../../modules/identity/admin-auth'
import {
  getServerAdminResourcesService,
  parseAdminResourceId,
  parseAdminResourceInventoryUpdate,
  parseAdminResourceJsonBody,
} from '../../../../../modules/admin/resources'
import { AppError, toApiFailure } from '../../../../../utils/app-error'
import { readBoundedRequestBody, RequestBodyLimitError } from '../../../../../utils/bounded-request-body'

type ResourcesService = ReturnType<typeof getServerAdminResourcesService>
type Response = Awaited<ReturnType<ResourcesService['updateInventory']>>
type Dependencies = {
  resources: Pick<ResourcesService, 'updateInventory'>
  getContentType: (event: unknown) => string | undefined
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  readRawBody: (event: unknown) => Promise<string | undefined>
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createUpdateAdminResourceInventoryHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const resourceId = parseAdminResourceId(dependencies.getParam(event, 'id'))
    const itemId = parseAdminResourceId(dependencies.getParam(event, 'itemId'))
    const admin = await dependencies.requireAdmin(event)
    const body = await parseAdminResourceJsonBody(
      dependencies.getContentType(event),
      await dependencies.readRawBody(event),
    )
    return {
      data: await dependencies.resources.updateInventory(
        resourceId,
        itemId,
        parseAdminResourceInventoryUpdate(body),
        { adminUserId: admin.userId, requestId },
      ),
      requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError
      ? error
      : error instanceof RequestBodyLimitError
        ? new AppError('RESOURCE_INVALID')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createUpdateAdminResourceInventoryHandler({
  resources: getServerAdminResourcesService(),
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  readRawBody: readBoundedRequestBody,
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
