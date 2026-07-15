import type { ApiFailure, ApiSuccess } from '../../../../../shared/types/api'
import { type AdminContext, getServerRequireAdmin } from '../../../../modules/identity/admin-auth'
import { getServerAdminResourcesService, parseAdminResourceId } from '../../../../modules/admin/resources'
import { AppError, toApiFailure } from '../../../../utils/app-error'
import {
  readBoundedRequestBytes,
  RequestBodyLimitError,
  RESOURCE_IMAGE_FILE_MAX_BYTES,
  RESOURCE_IMAGE_MAX_REQUEST_BODY_BYTES,
  RESOURCE_IMAGE_MULTIPART_OVERHEAD_BYTES,
} from '../../../../utils/bounded-request-body'

type ResourcesService = ReturnType<typeof getServerAdminResourcesService>
type Response = Awaited<ReturnType<ResourcesService['uploadImage']>>
type ImageInput = { bytes: Uint8Array, mimeType: string }
type Dependencies = {
  resources: Pick<ResourcesService, 'uploadImage'>
  getParam: (event: unknown, name: string) => string | undefined
  getRequestId: (event: unknown) => string
  readImage: (event: unknown) => Promise<ImageInput>
  requireAdmin: (event: unknown) => Promise<AdminContext>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
}

export const createUploadAdminResourceImageHandler = (dependencies: Dependencies) => async (
  event: unknown,
): Promise<ApiSuccess<Response> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  dependencies.setHeader(event, 'content-type', 'application/json; charset=utf-8')
  try {
    const id = parseAdminResourceId(dependencies.getParam(event, 'id'))
    const admin = await dependencies.requireAdmin(event)
    return { data: await dependencies.resources.uploadImage(id, await dependencies.readImage(event), { adminUserId: admin.userId, requestId }), requestId }
  }
  catch (error) {
    const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, publicError.statusCode)
    return toApiFailure(publicError, requestId)
  }
}

const bytesAt = (value: string) => new TextEncoder().encode(value)

const findBytes = (haystack: Uint8Array, needle: Uint8Array, start = 0) => {
  outer: for (let index = start; index <= haystack.byteLength - needle.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer
    }
    return index
  }
  return -1
}

const requestContentType = (event: unknown) => {
  const request = event as {
    node?: { req?: { headers?: Record<string, string | string[] | undefined> } }
    web?: { request?: { headers?: Headers } }
  }
  const webValue = request.web?.request?.headers?.get('content-type')
  const nodeValue = request.node?.req?.headers?.['content-type']
  return webValue ?? (Array.isArray(nodeValue) ? nodeValue[0] : nodeValue)
}

export const readResourceImage = async (event: unknown): Promise<ImageInput> => {
  const contentType = requestContentType(event)
  const boundaryMatch = /^multipart\/form-data;\s*boundary=(?:"([A-Za-z0-9'()+_,./:=?-]{1,70})"|([A-Za-z0-9'()+_,./:=?-]{1,70}))$/iu
    .exec(contentType ?? '')
  if (!boundaryMatch) throw new AppError('RESOURCE_IMAGE_INVALID')
  let body: Uint8Array | undefined
  try {
    body = await readBoundedRequestBytes(event, RESOURCE_IMAGE_MAX_REQUEST_BODY_BYTES)
  }
  catch (error) {
    if (error instanceof RequestBodyLimitError) throw new AppError('RESOURCE_IMAGE_TOO_LARGE')
    throw error
  }
  if (!body) throw new AppError('RESOURCE_IMAGE_INVALID')
  const boundary = boundaryMatch[1] ?? boundaryMatch[2]
  if (!boundary) throw new AppError('RESOURCE_IMAGE_INVALID')
  const opening = bytesAt(`--${boundary}\r\n`)
  if (findBytes(body, opening) !== 0) throw new AppError('RESOURCE_IMAGE_INVALID')
  const headerTerminator = bytesAt('\r\n\r\n')
  const headerEnd = findBytes(body, headerTerminator, opening.byteLength)
  if (headerEnd < 0 || headerEnd - opening.byteLength > RESOURCE_IMAGE_MULTIPART_OVERHEAD_BYTES) {
    throw new AppError('RESOURCE_IMAGE_INVALID')
  }
  let headers: string
  try {
    headers = new TextDecoder('utf-8', { fatal: true }).decode(body.slice(opening.byteLength, headerEnd))
  }
  catch {
    throw new AppError('RESOURCE_IMAGE_INVALID')
  }
  const lines = headers.split('\r\n')
  const disposition = lines.find(line => line.toLowerCase().startsWith('content-disposition:'))
  const mimeHeader = lines.find(line => line.toLowerCase().startsWith('content-type:'))
  if (!disposition || !/^content-disposition:\s*form-data;\s*name="image"(?:;\s*filename="[^"\r\n]{1,255}")?$/iu.test(disposition)) {
    throw new AppError('RESOURCE_IMAGE_INVALID')
  }
  const mimeType = mimeHeader?.replace(/^content-type:\s*/iu, '').trim().toLowerCase()
  if (!mimeType || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new AppError('RESOURCE_IMAGE_INVALID')
  }
  const dataStart = headerEnd + headerTerminator.byteLength
  const closing = bytesAt(`\r\n--${boundary}--\r\n`)
  const dataEnd = findBytes(body, closing, dataStart)
  if (dataEnd < 0 || dataEnd + closing.byteLength !== body.byteLength) {
    throw new AppError('RESOURCE_IMAGE_INVALID')
  }
  const bytes = body.slice(dataStart, dataEnd)
  if (bytes.byteLength > RESOURCE_IMAGE_FILE_MAX_BYTES) throw new AppError('RESOURCE_IMAGE_TOO_LARGE')
  if (body.byteLength - bytes.byteLength > RESOURCE_IMAGE_MULTIPART_OVERHEAD_BYTES) {
    throw new AppError('RESOURCE_IMAGE_INVALID')
  }
  return { bytes, mimeType }
}

export default defineEventHandler(event => createUploadAdminResourceImageHandler({
  resources: getServerAdminResourcesService(),
  getParam: (requestEvent, name) => getRouterParam(requestEvent as never, name),
  getRequestId: requestEvent => typeof (requestEvent as { context?: { requestId?: unknown } }).context?.requestId === 'string'
    ? (requestEvent as { context: { requestId: string } }).context.requestId : crypto.randomUUID(),
  readImage: readResourceImage,
  requireAdmin: getServerRequireAdmin(),
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
})(event))
