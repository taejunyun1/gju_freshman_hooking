import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { getServerAdminFacultyService, parseAdminFacultyId, parseAdminFacultyJsonBody, parseAdminFacultyPreview } from '../../../../modules/admin/faculty'
import { AppError, toApiFailure } from '../../../../utils/app-error'
import { FACULTY_MUTATION_MAX_REQUEST_BODY_BYTES, readBoundedRequestBody, RequestBodyLimitError } from '../../../../utils/bounded-request-body'

type Service = ReturnType<typeof getServerAdminFacultyService>
type Response = Awaited<ReturnType<Service['preview']>>
type Dependencies = {
  faculty: Pick<Service, 'preview'>
  getContentType: (event: unknown) => string | undefined
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  readRawBody: (event: unknown) => Promise<string | undefined>
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}
export const createPreviewAdminFacultyHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const id = parseAdminFacultyId(dependencies.getParam(event, 'id'))
    await dependencies.requireAdmin(event)
    const raw = await parseAdminFacultyJsonBody(dependencies.getContentType(event), await dependencies.readRawBody(event))
    const input = parseAdminFacultyPreview(raw)
    return { data: await dependencies.faculty.preview(id, input.faculty), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error
      : error instanceof RequestBodyLimitError ? new AppError('FACULTY_INVALID') : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}
export default defineEventHandler(event => createPreviewAdminFacultyHandler({
  faculty: getServerAdminFacultyService(),
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  readRawBody: requestEvent => readBoundedRequestBody(requestEvent, FACULTY_MUTATION_MAX_REQUEST_BODY_BYTES),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
