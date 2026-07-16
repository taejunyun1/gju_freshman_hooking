import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { getServerSupabaseClient } from './supabase'
import {
  base64urlEncode,
  decodeBase64urlSecret,
  hmacSha256,
  utf8,
  verifyHmacSha256,
} from './web-crypto'

export const campaignCookieName = 'photo_next_campaign'
export const campaignCookieMaxAgeSeconds = 60 * 60 * 24 * 30
const maximumClockSkewSeconds = 5 * 60

export const campaignCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  maxAge: campaignCookieMaxAgeSeconds,
  path: '/',
  sameSite: 'lax' as const,
  secure,
})

declare const verifiedCampaignIdBrand: unique symbol
export type VerifiedCampaignId = number & { readonly [verifiedCampaignIdBrand]: true }

const cookiePattern = /^v1\.([1-9][0-9]{0,15})\.([0-9]{10})\.([A-Za-z0-9_-]{43})$/u
const signatureDomain = 'PHOTO:NEXT/campaign-cookie/v1'
const safeIdSchema = z.number().int().positive().safe()

const signatureInput = (campaignId: number, expiresAt: number): Uint8Array => (
  utf8(`${signatureDomain}\n${campaignId}\n${expiresAt}`)
)

const parseCookie = (raw: string): { campaignId: number, expiresAt: number, signature: string } | null => {
  if (raw.length > 100) return null
  const match = cookiePattern.exec(raw)
  if (!match) return null
  const campaignId = Number(match[1])
  const expiresAt = Number(match[2])
  if (!safeIdSchema.safeParse(campaignId).success || !Number.isSafeInteger(expiresAt)) return null
  return { campaignId, expiresAt, signature: match[3]! }
}

export type CampaignAttributionDependencies = {
  key: Uint8Array
  loadEligibleCampaign: (campaignId: number, now: Date) => Promise<boolean>
  now?: () => Date
}

export const createCampaignAttributionService = (dependencies: CampaignAttributionDependencies) => {
  if (dependencies.key.byteLength !== 32) throw new Error('CAMPAIGN_COOKIE_KEY_INVALID')
  const now = dependencies.now ?? (() => new Date())

  const issue = async (rawCampaignId: number): Promise<string> => {
    const campaignId = safeIdSchema.parse(rawCampaignId)
    const nowSeconds = Math.floor(now().getTime() / 1000)
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error('CAMPAIGN_COOKIE_CLOCK_INVALID')
    const expiresAt = nowSeconds + campaignCookieMaxAgeSeconds
    const signature = base64urlEncode(await hmacSha256(
      signatureInput(campaignId, expiresAt),
      dependencies.key,
    ))
    return `v1.${campaignId}.${expiresAt}.${signature}`
  }

  const verify = async (raw: string | undefined): Promise<VerifiedCampaignId | null> => {
    if (!raw) return null
    const parsed = parseCookie(raw)
    if (!parsed) return null
    try {
      if (!await verifyHmacSha256(
        signatureInput(parsed.campaignId, parsed.expiresAt),
        decodeBase64urlSecret(parsed.signature),
        dependencies.key,
      )) return null
      const instant = now()
      const nowSeconds = Math.floor(instant.getTime() / 1000)
      if (!Number.isSafeInteger(nowSeconds)
        || parsed.expiresAt <= nowSeconds
        || parsed.expiresAt > nowSeconds + campaignCookieMaxAgeSeconds + maximumClockSkewSeconds) return null
      if (!await dependencies.loadEligibleCampaign(parsed.campaignId, instant)) return null
      return parsed.campaignId as VerifiedCampaignId
    }
    catch {
      // Attribution is optional and must never interrupt identity, assessment, or counseling flows.
      return null
    }
  }

  return { issue, verify }
}

const rawEligibilitySchema = z.object({
  id: safeIdSchema,
  status: z.literal('active'),
  starts_at: z.iso.datetime({ offset: true }).max(40).nullable(),
  ends_at: z.iso.datetime({ offset: true }).max(40).nullable(),
}).strict()

export const createSupabaseCampaignEligibilityLoader = (client: SupabaseClient) => async (
  campaignId: number,
  now: Date,
): Promise<boolean> => {
  const { data, error } = await client.from('campaigns')
    .select('id,status,starts_at,ends_at')
    .eq('id', campaignId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw new Error('CAMPAIGN_ATTRIBUTION_STORE_UNAVAILABLE')
  if (data === null) return false
  const parsed = rawEligibilitySchema.safeParse(data)
  if (!parsed.success || parsed.data.id !== campaignId) {
    throw new Error('CAMPAIGN_ATTRIBUTION_STORE_INVALID')
  }
  const instant = now.getTime()
  return (parsed.data.starts_at === null || Date.parse(parsed.data.starts_at) <= instant)
    && (parsed.data.ends_at === null || Date.parse(parsed.data.ends_at) > instant)
}

const getServerAttribution = () => {
  const runtimeConfig = useRuntimeConfig()
  return createCampaignAttributionService({
    key: decodeBase64urlSecret(runtimeConfig.campaignCookieKey),
    loadEligibleCampaign: createSupabaseCampaignEligibilityLoader(getServerSupabaseClient()),
  })
}

export const getServerVerifiedCampaignId = async (event: unknown): Promise<VerifiedCampaignId | null> => {
  const raw = getCookie(event as never, campaignCookieName)
  if (!raw) return null
  return Promise.resolve().then(() => getServerAttribution().verify(raw)).catch(() => null)
}

export const issueServerCampaignCookie = async (campaignId: number): Promise<string> => (
  getServerAttribution().issue(campaignId)
)
