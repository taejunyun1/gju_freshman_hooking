import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { getServerApplicantRosterService } from '../../../modules/admin/applicant-roster'
import { getAdminContext } from '../../../utils/admin-context'
import { AppError, toApiFailure } from '../../../utils/app-error'

type Service = ReturnType<typeof getServerApplicantRosterService>
type Dependencies = { roster: Pick<Service, 'list'>, getRequestId: (event: unknown) => string, setHeader: (event: unknown, name: string, value: string) => void, setStatus: (event: unknown, status: number) => void, requireAdmin: (event: unknown) => unknown }
export const createAdmissionCyclesListHandler = (dependencies: Dependencies) => async (event: unknown): Promise<ApiSuccess<Awaited<ReturnType<Service['list']>>> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try { dependencies.requireAdmin(event); return { data: await dependencies.roster.list(), requestId } }
  catch (error) { const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR'); dependencies.setStatus(event, publicError.statusCode); return toApiFailure(publicError, requestId) }
}
export default defineEventHandler(event => createAdmissionCyclesListHandler({ roster: getServerApplicantRosterService(), getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string' ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(), requireAdmin: getAdminContext, setHeader: (event, name, value) => setResponseHeader(event as never, name, value), setStatus: (event, status) => setResponseStatus(event as never, status) })(event))
