import type { SupabaseClient } from '@supabase/supabase-js'

export const serverEventNames = [
  'registration_started',
  'registration_completed',
  'login_succeeded',
  'login_failed',
  'assessment_completed',
  'result_viewed',
  'counseling_requested',
] as const

export type ServerEventName = typeof serverEventNames[number]

type ServerEventBase = {
  anonymousId: string
  prospectId?: number
  properties?: Record<string, unknown>
  requestId: string
}

type IdentityServerEvent = ServerEventBase & {
  eventName: 'registration_started' | 'registration_completed' | 'login_succeeded' | 'login_failed'
  path: '/api/student/register' | '/api/student/login'
}

type AuthoritativeServerEvent = ServerEventBase & {
  campaignId: number | null
  eventName: 'assessment_completed' | 'result_viewed' | 'counseling_requested'
  path: '/api/assessment/submit' | '/api/counseling' | `/api/result/${string}`
}

export type ServerEvent = IdentityServerEvent | AuthoritativeServerEvent

type ExistingBrowserEvent = {
  anonymousId: string
  eventName: 'landing_viewed' | 'assessment_started' | 'assessment_step_completed'
  path: '/api/events'
  properties: Record<string, unknown>
  prospectId?: number
  requestId: string
}

type ResourceOpenedEvent = {
  anonymousId: string
  campaignId: number | null
  eventName: 'resource_opened'
  path: '/api/events'
  properties: {
    assessment_id: number
    resource_id: number
    resource_type: 'course' | 'equipment' | 'facility' | 'extracurricular' | 'project' | 'student_work' | 'career' | 'support'
  }
  prospectId: number
  requestId: string
}

export type BrowserEvent = ExistingBrowserEvent | ResourceOpenedEvent

export type ProductEvent = ServerEvent | BrowserEvent
export type EventWriter = (event: ProductEvent) => Promise<void>

export const createEventWriter = (client: SupabaseClient): EventWriter => async (event) => {
  const isAssessmentDerivedEvent = event.eventName === 'assessment_completed'
    || event.eventName === 'result_viewed'
    || event.eventName === 'resource_opened'
    || event.eventName === 'counseling_requested'
  const campaignId = isAssessmentDerivedEvent && 'campaignId' in event
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
