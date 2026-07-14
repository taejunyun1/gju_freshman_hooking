import { z } from 'zod'
import { selectionLimits } from '../../shared/schemas/assessment'
import type { ApiFailure, ApiSuccess } from '../../shared/types/api'
import { getServerIdentityService } from '../modules/identity/service'
import { createEventWriter, type EventWriter } from '../modules/metrics/events'
import { getAnonymousVisitorId } from '../utils/anonymous-visitor'
import { AppError, toApiFailure } from '../utils/app-error'
import { studentSessionCookie } from '../utils/student-request-security'
import { getServerSupabaseClient } from '../utils/supabase'
import { getTrustedClientIp } from '../utils/trusted-client-ip'

const EVENT_ROUTE = '/api/events' as const
const MAX_BODY_BYTES = 8_192
const MAX_PROPERTIES_BYTES = 4_096
const encoder = new TextEncoder()
const catalogRevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)

const browserEventSchema = z.discriminatedUnion('eventName', [
  z.object({ eventName: z.literal('landing_viewed') }).strict(),
  z.object({
    eventName: z.literal('assessment_started'),
    catalogRevision: catalogRevisionSchema,
  }).strict(),
  z.object({
    eventName: z.literal('assessment_step_completed'),
    catalogRevision: catalogRevisionSchema,
    group: z.enum(['work', 'result', 'style', 'career']),
    selectedCount: z.number().int(),
  }).strict().superRefine((input, context) => {
    const limits = selectionLimits[input.group]
    if (input.selectedCount < limits.min || input.selectedCount > limits.max) {
      context.addIssue({ code: 'custom', message: 'selected count is outside group limits' })
    }
  }),
])

type StudentSession = {
  prospectId: number
  nickname: string
  expiresAt: string
}

type EventsHandlerDependencies = {
  consumeRateLimit: (input: { key: string, route: string, limit: number, window: string }) => Promise<boolean>
  getAnonymousId: (event: unknown) => string
  getContentType: (event: unknown) => string | undefined
  getIp: (event: unknown) => string
  getOrigin: (event: unknown) => string | undefined
  getRequestId: (event: unknown) => string
  getRequestOrigin: (event: unknown) => string
  getSessionToken: (event: unknown) => string | undefined
  readRawBody: (event: unknown) => Promise<string | undefined>
  readStudentSession: (sessionToken: string) => Promise<StudentSession | null>
  setHeader: (event: unknown, name: string, value: string) => void
  setStatus: (event: unknown, status: number) => void
  writeEvent: EventWriter
}

class EventOriginError extends Error {}

const isJson = (contentType: string | undefined) => contentType
  ?.split(';', 1)[0]
  ?.trim()
  .toLowerCase() === 'application/json'

const eventProperties = (event: z.infer<typeof browserEventSchema>, requestId: string) => {
  if (event.eventName === 'landing_viewed') return { request_id: requestId }
  if (event.eventName === 'assessment_started') {
    return { request_id: requestId, catalog_revision: event.catalogRevision }
  }
  return {
    request_id: requestId,
    catalog_revision: event.catalogRevision,
    group: event.group,
    selected_count: event.selectedCount,
  }
}

export const createEventsHandler = (dependencies: EventsHandlerDependencies) => async (
  event: unknown,
): Promise<ApiSuccess<{ accepted: true }> | ApiFailure> => {
  const requestId = dependencies.getRequestId(event)
  dependencies.setHeader(event, 'cache-control', 'private, no-store')
  try {
    if (dependencies.getOrigin(event) !== dependencies.getRequestOrigin(event)) {
      throw new EventOriginError()
    }
    if (!isJson(dependencies.getContentType(event))) throw new AppError('VALIDATION_FAILED')
    const raw = await dependencies.readRawBody(event)
    if (!raw || encoder.encode(raw).byteLength > MAX_BODY_BYTES) {
      throw new AppError('VALIDATION_FAILED')
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw) as unknown
    }
    catch {
      throw new AppError('VALIDATION_FAILED')
    }
    const parsed = browserEventSchema.safeParse(parsedJson)
    if (!parsed.success) throw new AppError('VALIDATION_FAILED')

    const anonymousId = dependencies.getAnonymousId(event)
    const ipAllowed = await dependencies.consumeRateLimit({
      key: `ip:${dependencies.getIp(event)}`,
      route: EVENT_ROUTE,
      limit: 60,
      window: '1 minute',
    })
    if (!ipAllowed) throw new AppError('RATE_LIMITED')
    const anonymousAllowed = await dependencies.consumeRateLimit({
      key: `anonymous:${anonymousId}`,
      route: EVENT_ROUTE,
      limit: 30,
      window: '1 minute',
    })
    if (!anonymousAllowed) throw new AppError('RATE_LIMITED')

    let prospectId: number | undefined
    const sessionToken = dependencies.getSessionToken(event)
    if (sessionToken) {
      try {
        prospectId = (await dependencies.readStudentSession(sessionToken))?.prospectId
      }
      catch {
        // Browser telemetry remains available when optional student attribution is unavailable.
      }
    }

    const properties = eventProperties(parsed.data, requestId)
    if (encoder.encode(JSON.stringify(properties)).byteLength > MAX_PROPERTIES_BYTES) {
      throw new Error('EVENT_PROPERTIES_INVALID')
    }
    await dependencies.writeEvent({
      anonymousId,
      eventName: parsed.data.eventName,
      path: EVENT_ROUTE,
      properties,
      prospectId,
      requestId,
    })

    return { data: { accepted: true }, requestId }
  }
  catch (error) {
    const status = error instanceof EventOriginError
      ? 403
      : error instanceof AppError
        ? error.statusCode
        : 500
    const publicError = error instanceof AppError ? error : error instanceof EventOriginError
      ? new AppError('VALIDATION_FAILED')
      : new AppError('INTERNAL_ERROR')
    dependencies.setStatus(event, status)
    return toApiFailure(publicError, requestId)
  }
}

const supabase = () => getServerSupabaseClient()

export default defineEventHandler(event => createEventsHandler({
  consumeRateLimit: async ({ key, route, limit, window }) => {
    const { data, error } = await supabase().rpc('consume_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_route: route,
      p_window: window,
    })
    if (error) throw new Error('EVENT_STORE_UNAVAILABLE')
    return data === true
  },
  getAnonymousId: getAnonymousVisitorId,
  getContentType: requestEvent => getHeader(requestEvent as never, 'content-type'),
  getIp: getTrustedClientIp,
  getOrigin: requestEvent => getHeader(requestEvent as never, 'origin'),
  getRequestId: (requestEvent) => {
    const context = (requestEvent as { context?: { requestId?: unknown } }).context
    return typeof context?.requestId === 'string' ? context.requestId : crypto.randomUUID()
  },
  getRequestOrigin: requestEvent => getRequestURL(requestEvent as never).origin,
  getSessionToken: requestEvent => getCookie(requestEvent as never, studentSessionCookie),
  readRawBody: requestEvent => readRawBody(requestEvent as never, 'utf8'),
  readStudentSession: getServerIdentityService().getStudentSession,
  setHeader: (requestEvent, name, value) => setResponseHeader(requestEvent as never, name, value),
  setStatus: (requestEvent, status) => setResponseStatus(requestEvent as never, status),
  writeEvent: createEventWriter(supabase()),
})(event))
