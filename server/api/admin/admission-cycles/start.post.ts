import type { ApiFailure, ApiSuccess } from '../../../../shared/types/api'
import { getServerApplicantRosterService } from '../../../modules/admin/applicant-roster'
import { requireRecentAdminContext } from '../../../utils/admin-context'
import { AppError, toApiFailure } from '../../../utils/app-error'
import { readBoundedRequestBody, RequestBodyLimitError } from '../../../utils/bounded-request-body'

type Service = ReturnType<typeof getServerApplicantRosterService>
type Dependencies = { roster: Pick<Service, 'start'>, getRequestId: (event: unknown) => string, readRawBody: (event: unknown) => Promise<string | undefined>, setHeader: (event: unknown, name: string, value: string) => void, setStatus: (event: unknown, status: number) => void, requireRecentAdmin: (event: unknown) => { userId: string } }
export const createStartAdmissionCycleHandler = (dependencies: Dependencies) => async (event: unknown): Promise<ApiSuccess<Awaited<ReturnType<Service['start']>>> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event); dependencies.setHeader(event, 'cache-control', 'private, no-store'); dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try { const admin = dependencies.requireRecentAdmin(event); const raw = await dependencies.readRawBody(event); return { data: await dependencies.roster.start(JSON.parse(raw ?? ''), { adminUserId: admin.userId, requestId }), requestId } }
  catch (error) { const publicError = error instanceof AppError ? error : error instanceof RequestBodyLimitError || error instanceof SyntaxError ? new AppError('ROSTER_INVALID') : new AppError('INTERNAL_ERROR'); dependencies.setStatus(event, publicError.statusCode); return toApiFailure(publicError, requestId) }
}
export default defineEventHandler(event => createStartAdmissionCycleHandler({ roster: getServerApplicantRosterService(), getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string' ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(), readRawBody: readBoundedRequestBody, requireRecentAdmin: requestEvent => requireRecentAdminContext(requestEvent, 15), setHeader: (event, name, value) => setResponseHeader(event as never, name, value), setStatus: (event, status) => setResponseStatus(event as never, status) })(event))
