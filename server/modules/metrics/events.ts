import type { SupabaseClient } from '@supabase/supabase-js'

export const serverEventNames = [
  'registration_started',
  'registration_completed',
  'login_succeeded',
  'login_failed',
  'assessment_completed',
  'result_viewed',
] as const

export type ServerEventName = typeof serverEventNames[number]

export type ServerEvent = {
  anonymousId: string
  eventName: ServerEventName
  path: '/api/student/register' | '/api/student/login' | '/api/assessment/submit' | `/api/result/${string}`
  campaignId?: number | null
  prospectId?: number
  properties?: Record<string, unknown>
  requestId: string
}

export type BrowserEvent = {
  anonymousId: string
  eventName: 'landing_viewed' | 'assessment_started' | 'assessment_step_completed'
  path: '/api/events'
  properties: Record<string, unknown>
  prospectId?: number
  requestId: string
}

export type ProductEvent = ServerEvent | BrowserEvent
export type EventWriter = (event: ProductEvent) => Promise<void>

export const createEventWriter = (client: SupabaseClient): EventWriter => async (event) => {
  const campaignEligible = event.eventName === 'assessment_completed' || event.eventName === 'result_viewed'
  const campaignId = campaignEligible
    && 'campaignId' in event
    && (event.campaignId === null || (Number.isSafeInteger(event.campaignId) && (event.campaignId ?? 0) > 0))
    ? event.campaignId
    : null
  const { error } = await client.from('events').insert({
    anonymous_id: event.anonymousId,
    campaign_id: campaignId,
    event_name: event.eventName,
    path: event.path,
    properties: { ...(event.properties ?? {}), request_id: event.requestId },
    prospect_id: event.prospectId ?? null,
  })

  if (error) throw new Error('EVENT_WRITE_FAILED')
}
