import type { SupabaseClient } from '@supabase/supabase-js'

export const serverEventNames = [
  'registration_started',
  'registration_completed',
  'login_succeeded',
  'login_failed',
] as const

export type ServerEventName = typeof serverEventNames[number]

export type ServerEvent = {
  anonymousId: string
  eventName: ServerEventName
  path: '/api/student/register' | '/api/student/login'
  campaignId?: number
  prospectId?: number
  properties?: Record<string, unknown>
  requestId: string
}

export type BrowserEvent = {
  anonymousId: string
  campaignId: null
  eventName: 'landing_viewed' | 'assessment_started' | 'assessment_step_completed'
  path: '/api/events'
  properties: Record<string, unknown>
  prospectId?: number
  requestId: string
}

export type ProductEvent = ServerEvent | BrowserEvent
export type EventWriter = (event: ProductEvent) => Promise<void>

export const createEventWriter = (client: SupabaseClient): EventWriter => async (event) => {
  const { error } = await client.from('events').insert({
    anonymous_id: event.anonymousId,
    campaign_id: event.campaignId ?? null,
    event_name: event.eventName,
    path: event.path,
    properties: event.properties ?? { request_id: event.requestId },
    prospect_id: event.prospectId ?? null,
  })

  if (error) throw new Error('EVENT_WRITE_FAILED')
}
