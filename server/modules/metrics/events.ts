import type { SupabaseClient } from '@supabase/supabase-js'

export const serverEventNames = [
  'registration_started',
  'registration_completed',
  'login_succeeded',
  'login_failed',
] as const

export type ServerEventName = typeof serverEventNames[number]

export type ServerEvent = {
  eventName: ServerEventName
  path: '/api/student/register' | '/api/student/login'
  campaignId?: number
  requestId: string
}

export type EventWriter = (event: ServerEvent) => Promise<void>

export const createEventWriter = (client: SupabaseClient): EventWriter => async (event) => {
  const { error } = await client.from('events').insert({
    campaign_id: event.campaignId ?? null,
    event_name: event.eventName,
    path: event.path,
    properties: { request_id: event.requestId },
  })

  if (error) throw new Error('EVENT_WRITE_FAILED')
}
