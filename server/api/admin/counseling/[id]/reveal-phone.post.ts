import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import {
  getServerAdminCounselingService,
  parseAdminCounselingPublicId,
} from '../../../../modules/counseling/admin-service'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { AppError, toApiFailure } from '../../../../utils/app-error'

type RevealHandlerDependencies = {
  counseling: Pick<ReturnType<typeof getServerAdminCounselingService>, 'revealPhone'>
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  requireAdmin: (event: unknown, options: { recentAuthMinutes: number }) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createRevealCounselingPhoneHandler = (dependencies: RevealHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<{ phone: string }> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const publicId = parseAdminCounselingPublicId(dependencies.getParam(event, 'id'))
    const admin = await dependencies.requireAdmin(event, { recentAuthMinutes: 15 })
    return {
      data: {
        phone: await dependencies.counseling.revealPhone(publicId, {
          adminUserId: admin.userId,
          traceId: requestId,
        }),
      },
      requestId,
    }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createRevealCounselingPhoneHandler({
  counseling: getServerAdminCounselingService(),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
