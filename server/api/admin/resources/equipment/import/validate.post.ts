import type { ApiFailure, ApiSuccess } from '../../../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../../../modules/identity/admin-auth'
import { parseAdminResourceJsonBody, validateEquipmentImport } from '../../../../../modules/admin/resources'
import { AppError, toApiFailure } from '../../../../../utils/app-error'
import {
  readBoundedRequestBody,
  RequestBodyLimitError,
  RESOURCE_IMPORT_MAX_REQUEST_BODY_BYTES,
} from '../../../../../utils/bounded-request-body'

type Response = ReturnType<typeof validateEquipmentImport>
type Dependencies = {
  getContentType: (event: unknown) => string | undefined
  getRequestId: (event: unknown) => string
  readRawBody: (event: unknown) => Promise<string | undefined>
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createValidateEquipmentImportHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    await dependencies.requireAdmin(event)
    const body = await parseAdminResourceJsonBody(dependencies.getContentType(event), await dependencies.readRawBody(event))
    return { data: validateEquipmentImport(body), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError
      ? (error.code === 'RESOURCE_INVALID' ? new AppError('EQUIPMENT_IMPORT_INVALID') : error)
      : error instanceof RequestBodyLimitError
        ? new AppError('EQUIPMENT_IMPORT_INVALID')
        : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

export default defineEventHandler(event => createValidateEquipmentImportHandler({
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  readRawBody: requestEvent => readBoundedRequestBody(requestEvent, RESOURCE_IMPORT_MAX_REQUEST_BODY_BYTES),
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
