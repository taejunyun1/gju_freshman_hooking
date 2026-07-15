import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import { adminCounselingTransitionSchema, type AdminCounselingCurrent } from '../../../../../shared/schemas/counseling'
import {
  getServerAdminCounselingService,
  parseAdminCounselingJsonBody,
  parseAdminCounselingPublicId,
} from '../../../../modules/counseling/admin-service'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../../utils/app-error'
import { RequestBodyLimitError, readBoundedRequestBody } from '../../../../utils/bounded-request-body'

type TransitionHandlerDependencies = {
  counseling: Pick<ReturnType<typeof getServerAdminCounselingService>, 'transition'>
  getContentType: (event: unknown) => string | undefined
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  readRawBody: (event: unknown) => Promise<string | undefined>
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createTransitionCounselingHandler = (dependencies: TransitionHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<AdminCounselingCurrent> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const publicId = parseAdminCounselingPublicId(dependencies.getParam(event, 'id'))
    const admin = await dependencies.requireAdmin(event)
    const input = parseAdminCounselingJsonBody({
      contentType: dependencies.getContentType(event),
      rawBody: await dependencies.readRawBody(event),
      schema: adminCounselingTransitionSchema,
    })
    return {
      data: await dependencies.counseling.transition(publicId, input, {
        adminUserId: admin.userId,
        traceId: requestId,
      }),
      requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError
      ? error
      : error instanceof RequestBodyLimitError
        ? new AppError('COUNSELING_INVALID')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createTransitionCounselingHandler({
  counseling: getServerAdminCounselingService(),
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  readRawBody: readBoundedRequestBody,
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
