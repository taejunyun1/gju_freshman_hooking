import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  adminCampaignSchema,
  adminCampaignListItemSchema,
  adminCampaignStoredSchema,
  campaignArchiveSchema,
  campaignChannels,
  campaignCodeSchema,
  campaignCreateSchema,
  campaignStatuses,
  type AdminCampaign,
  type AdminCampaignStored,
  type CampaignCreate,
} from '../../../shared/schemas/admin'
import { AppError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'
import { base64urlEncode } from '../../utils/web-crypto'

const safeIdSchema = z.number().int().positive().safe()
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const rawCampaignRowSchema = z.object({
  id: safeIdSchema,
  code: campaignCodeSchema,
  name: z.string().min(1).max(100),
  channel: z.enum(campaignChannels),
  status: z.enum(campaignStatuses),
  starts_at: timestampSchema.nullable(),
  ends_at: timestampSchema.nullable(),
  sent_count: z.number().int().min(0).max(2_147_483_647),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict()

export const decodeAdminCampaignRow = (raw: unknown): AdminCampaignStored => {
  try {
    const row = rawCampaignRowSchema.parse(raw)
    return adminCampaignStoredSchema.parse({
      id: row.id,
      code: row.code,
      name: row.name,
      channel: row.channel,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      sentCount: row.sent_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  }
  catch {
    throw new Error('ADMIN_CAMPAIGN_STORE_INVALID')
  }
}

const cursorSchema = z.object({ createdAt: timestampSchema, id: safeIdSchema }).strict()
export type AdminCampaignsCursor = z.infer<typeof cursorSchema>

export const encodeAdminCampaignsCursor = (cursor: AdminCampaignsCursor): string => (
  base64urlEncode(new TextEncoder().encode(JSON.stringify(cursorSchema.parse(cursor))))
)

const decodeCursor = (encoded: string): AdminCampaignsCursor => {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length > 200 || encoded.length % 4 === 1) {
    throw new Error('INVALID_CURSOR')
  }
  try {
    const padded = encoded.replaceAll('-', '+').replaceAll('_', '/')
      + '='.repeat((4 - encoded.length % 4) % 4)
    const binary = atob(padded)
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, character => character.charCodeAt(0)),
    )
    const parsed = cursorSchema.parse(JSON.parse(decoded) as unknown)
    if (encodeAdminCampaignsCursor(parsed) !== encoded) throw new Error('INVALID_CURSOR')
    return parsed
  }
  catch {
    throw new Error('INVALID_CURSOR')
  }
}

const boundedQuery = z.string().trim().min(1).max(100).refine(value => (
  [...value].every((character) => {
    const point = character.codePointAt(0) ?? 0
    return point > 0x1F && (point < 0x7F || point > 0x9F)
  })
))

const listQuerySchema = z.object({
  query: boundedQuery.optional(),
  status: z.enum(campaignStatuses).optional(),
  channel: z.enum(campaignChannels).optional(),
  limit: z.string().regex(/^[1-9][0-9]?$/u).transform(Number)
    .pipe(z.number().int().min(1).max(50)).default(20),
  cursor: z.string().min(1).max(200).transform((value, context) => {
    try { return decodeCursor(value) }
    catch {
      context.addIssue({ code: 'custom', message: 'invalid cursor' })
      return z.NEVER
    }
  }).optional(),
}).strict()

export type AdminCampaignListInput = z.infer<typeof listQuerySchema>

export const parseAdminCampaignListQuery = (raw: unknown): AdminCampaignListInput => {
  const parsed = listQuerySchema.safeParse(raw)
  if (!parsed.success) throw new AppError('CAMPAIGN_INVALID')
  return parsed.data
}

export const parseAdminCampaignId = (raw: string | undefined): number => {
  const parsed = z.string().regex(/^[1-9][0-9]{0,15}$/u).transform(Number).pipe(safeIdSchema).safeParse(raw)
  if (!parsed.success) throw new AppError('CAMPAIGN_INVALID')
  return parsed.data
}

const isJson = (contentType: string | undefined): boolean => contentType
  ?.split(';', 1)[0]
  ?.trim()
  .toLowerCase() === 'application/json'

const parseJson = (contentType: string | undefined, rawBody: string | undefined): unknown => {
  if (!isJson(contentType) || !rawBody || new TextEncoder().encode(rawBody).byteLength > 4_096) {
    throw new AppError('CAMPAIGN_INVALID')
  }
  try { return JSON.parse(rawBody) as unknown }
  catch { throw new AppError('CAMPAIGN_INVALID') }
}

export const parseCampaignJsonBody = async (
  contentType: string | undefined,
  rawBody: string | undefined,
): Promise<CampaignCreate> => {
  const parsed = campaignCreateSchema.safeParse(parseJson(contentType, rawBody))
  if (!parsed.success) throw new AppError('CAMPAIGN_INVALID')
  return parsed.data
}

export const parseCampaignArchiveJsonBody = async (
  contentType: string | undefined,
  rawBody: string | undefined,
) => {
  const parsed = campaignArchiveSchema.safeParse(parseJson(contentType, rawBody))
  if (!parsed.success) throw new AppError('CAMPAIGN_INVALID')
  return parsed.data
}

export type AdminCampaignsServiceDependencies = {
  listCampaigns: (input: AdminCampaignListInput & { limit: number }) => Promise<AdminCampaignStored[]>
  createCampaign: (campaign: Omit<AdminCampaignStored, 'id' | 'createdAt' | 'updatedAt'>) => Promise<
    { kind: 'created', campaign: AdminCampaignStored } | { kind: 'conflict' }
  >
  archiveCampaign: (input: { id: number, expectedUpdatedAt: string, archivedAt: string }) => Promise<
    | { kind: 'updated', campaign: AdminCampaignStored }
    | { kind: 'conflict', current: AdminCampaignStored }
    | { kind: 'not_found' }
  >
  findActiveCampaignByCode: (code: string) => Promise<AdminCampaignStored | null>
  now?: () => Date
}

const isEligible = (campaign: AdminCampaignStored, now: Date): boolean => (
  campaign.status === 'active'
  && (campaign.startsAt === null || Date.parse(campaign.startsAt) <= now.getTime())
  && (campaign.endsAt === null || Date.parse(campaign.endsAt) > now.getTime())
)

const withPendingMetrics = (campaign: AdminCampaignStored): AdminCampaign => adminCampaignListItemSchema.parse({
  ...campaign,
  metrics: {
    version: 's6-daily-metrics-v1',
    availability: 'pending',
    visits: null,
    assessmentCompletions: null,
    counselingConversions: null,
  },
})

export const createAdminCampaignsService = (dependencies: AdminCampaignsServiceDependencies) => {
  const now = dependencies.now ?? (() => new Date())
  return {
    list: async (input: AdminCampaignListInput) => {
      const stored = await dependencies.listCampaigns({ ...input, limit: input.limit + 1 })
      if (!Array.isArray(stored) || stored.length > input.limit + 1) {
        throw new Error('ADMIN_CAMPAIGN_STORE_INVALID')
      }
      const decoded = stored.map(row => adminCampaignStoredSchema.parse(row))
      const page = decoded.slice(0, input.limit)
      const items = page.map(withPendingMetrics)
      return {
        items,
        nextCursor: decoded.length > input.limit && page.length > 0
          ? encodeAdminCampaignsCursor({ createdAt: page.at(-1)!.createdAt, id: page.at(-1)!.id })
          : null,
      }
    },
    create: async (raw: unknown) => {
      const parsed = campaignCreateSchema.safeParse(raw)
      if (!parsed.success) throw new AppError('CAMPAIGN_INVALID')
      const outcome = await dependencies.createCampaign({
        code: parsed.data.code,
        name: parsed.data.name,
        channel: parsed.data.channel,
        status: parsed.data.status,
        startsAt: parsed.data.startsAt ?? null,
        endsAt: parsed.data.endsAt ?? null,
        sentCount: parsed.data.sentCount,
      })
      if (outcome.kind === 'conflict') throw new AppError('CAMPAIGN_CONFLICT')
      return { campaign: adminCampaignSchema.parse(outcome.campaign) }
    },
    archive: async (id: number, expectedUpdatedAt: string) => {
      const version = campaignArchiveSchema.safeParse({ expectedUpdatedAt })
      if (!version.success) throw new AppError('CAMPAIGN_INVALID')
      const outcome = await dependencies.archiveCampaign({
        id: safeIdSchema.parse(id),
        expectedUpdatedAt: version.data.expectedUpdatedAt,
        archivedAt: now().toISOString(),
      })
      if (outcome.kind === 'not_found') throw new AppError('CAMPAIGN_NOT_FOUND')
      if (outcome.kind === 'conflict') throw new AppError('CAMPAIGN_CONFLICT')
      return { campaign: adminCampaignSchema.parse(outcome.campaign) }
    },
    resolve: async (rawCode: string) => {
      const parsed = campaignCodeSchema.safeParse(rawCode)
      if (!parsed.success) throw new AppError('CAMPAIGN_NOT_FOUND')
      const raw = await dependencies.findActiveCampaignByCode(parsed.data)
      if (raw === null) throw new AppError('CAMPAIGN_NOT_FOUND')
      const campaign = adminCampaignStoredSchema.parse(raw)
      if (campaign.code !== parsed.data || !isEligible(campaign, now())) {
        throw new AppError('CAMPAIGN_NOT_FOUND')
      }
      return { campaignId: campaign.id, code: campaign.code }
    },
  }
}

const selection = 'id,code,name,channel,status,starts_at,ends_at,sent_count,created_at,updated_at'
const escapeLike = (value: string): string => value
  .replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
const quotePostgrest = (value: string): string => `"${value.replaceAll('"', '\\"')}"`
const storeError = (): never => { throw new Error('ADMIN_CAMPAIGN_STORE_FAILED') }

export const createSupabaseAdminCampaignsDependencies = (
  client: SupabaseClient,
): AdminCampaignsServiceDependencies => ({
  listCampaigns: async (input) => {
    let query = client.from('campaigns').select(selection)
    if (input.query) {
      const pattern = quotePostgrest(`%${escapeLike(input.query)}%`)
      query = query.or(`name.ilike.${pattern},code.ilike.${pattern}`)
    }
    if (input.status) query = query.eq('status', input.status)
    if (input.channel) query = query.eq('channel', input.channel)
    if (input.cursor) {
      query = query.or(`created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`)
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.limit)
    if (error || !Array.isArray(data)) return storeError()
    return data.map(decodeAdminCampaignRow)
  },
  createCampaign: async (campaign) => {
    const { data, error } = await client.from('campaigns').insert({
      code: campaign.code,
      name: campaign.name,
      channel: campaign.channel,
      status: campaign.status,
      starts_at: campaign.startsAt,
      ends_at: campaign.endsAt,
      sent_count: campaign.sentCount,
    }).select(selection).single()
    if (error?.code === '23505') return { kind: 'conflict' }
    if (error || data === null) return storeError()
    return { kind: 'created', campaign: decodeAdminCampaignRow(data) }
  },
  archiveCampaign: async ({ id, expectedUpdatedAt, archivedAt }) => {
    const { data, error } = await client.from('campaigns')
      .update({ status: 'archived', updated_at: archivedAt })
      .eq('id', id)
      .eq('updated_at', expectedUpdatedAt)
      .neq('status', 'archived')
      .select(selection)
      .maybeSingle()
    if (error) return storeError()
    if (data !== null) return { kind: 'updated', campaign: decodeAdminCampaignRow(data) }
    const { data: current, error: loadError } = await client.from('campaigns')
      .select(selection).eq('id', id).maybeSingle()
    if (loadError) return storeError()
    if (current === null) return { kind: 'not_found' }
    return { kind: 'conflict', current: decodeAdminCampaignRow(current) }
  },
  findActiveCampaignByCode: async (code) => {
    const { data, error } = await client.from('campaigns').select(selection)
      .eq('code', code).eq('status', 'active').maybeSingle()
    if (error) return storeError()
    return data === null ? null : decodeAdminCampaignRow(data)
  },
})

export const getServerAdminCampaignsService = () => createAdminCampaignsService(
  createSupabaseAdminCampaignsDependencies(getServerSupabaseClient()),
)
