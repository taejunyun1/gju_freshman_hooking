import { z } from 'zod'

import { counselingStatuses, trackKeys } from '../types/domain'
import { applicantStageSchema, regionSchema } from './identity'

export const campaignChannels = ['sms', 'qr', 'social', 'kakao', 'direct', 'other'] as const
export const campaignStatuses = ['draft', 'active', 'archived'] as const
export const exportJobStatuses = ['created', 'fetching', 'completed', 'failed'] as const
export const exportErrorCodes = [
  'EXPORT_AUTHORIZATION_FAILED',
  'EXPORT_DOWNLOAD_FAILED',
  'EXPORT_FETCH_FAILED',
  'EXPORT_FILTER_REQUIRED',
  'EXPORT_INTERNAL_ERROR',
  'EXPORT_REAUTH_REQUIRED',
  'EXPORT_ROW_LIMIT_EXCEEDED',
  'EXPORT_SESSION_EXPIRED',
  'EXPORT_WORKBOOK_FAILED',
] as const

const hasNoC0OrC1Controls = (value: string): boolean => [...value].every((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
})

const safeText = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine(hasNoC0OrC1Controls, '제어문자는 사용할 수 없습니다.')

const campaignCodeInputSchema = z.string().trim().min(1).max(200)
  .refine(hasNoC0OrC1Controls, '제어문자는 사용할 수 없습니다.')
  .transform(value => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, ''))
  .pipe(z.string().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u))

const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const stableErrorCodeSchema = z.enum(exportErrorCodes)
const rowCountSchema = z.number().int().min(0).max(30_000)
const containsKoreanPhone = (value: string): boolean => (
  /(?:010[0-9]{7,8}|8210[0-9]{7,8})/u.test(value.replace(/[^0-9]/gu, ''))
)

export const campaignCreateSchema = z.object({
  code: campaignCodeInputSchema,
  name: safeText(100),
  channel: z.enum(campaignChannels),
  status: z.enum(['draft', 'active']).default('draft'),
  startsAt: timestampSchema.nullable().optional(),
  endsAt: timestampSchema.nullable().optional(),
  sentCount: z.number().int().min(0).max(2_147_483_647).default(0),
}).strict().superRefine((campaign, context) => {
  if (campaign.startsAt && campaign.endsAt
    && Date.parse(campaign.endsAt) <= Date.parse(campaign.startsAt)) {
    context.addIssue({ code: 'custom', path: ['endsAt'], message: '종료 시각은 시작 시각보다 뒤여야 합니다.' })
  }
})

const storedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim(), 'stored text must already be trimmed')
  .refine(hasNoC0OrC1Controls, 'stored text cannot contain control characters')

export const campaignCodeSchema = z.string().min(3).max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)

export const adminCampaignStoredSchema = z.object({
  id: z.number().int().positive().safe(),
  code: campaignCodeSchema,
  name: storedText(100),
  channel: z.enum(campaignChannels),
  status: z.enum(campaignStatuses),
  startsAt: timestampSchema.nullable(),
  endsAt: timestampSchema.nullable(),
  sentCount: z.number().int().min(0).max(2_147_483_647),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict().superRefine((campaign, context) => {
  if (campaign.startsAt && campaign.endsAt
    && Date.parse(campaign.endsAt) <= Date.parse(campaign.startsAt)) {
    context.addIssue({ code: 'custom', path: ['endsAt'], message: 'stored campaign dates are reversed' })
  }
  if (Date.parse(campaign.updatedAt) < Date.parse(campaign.createdAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'stored campaign version is invalid' })
  }
})

export const adminCampaignMetricsSchema = z.object({
  version: z.literal('s6-daily-metrics-v1'),
  availability: z.literal('pending'),
  visits: z.null(),
  assessmentCompletions: z.null(),
  counselingConversions: z.null(),
}).strict()

export const adminCampaignSchema = adminCampaignStoredSchema
export const adminCampaignListItemSchema = adminCampaignStoredSchema.extend({
  metrics: adminCampaignMetricsSchema,
}).strict()

export const campaignArchiveSchema = z.object({
  expectedUpdatedAt: timestampSchema,
}).strict()

export const exportFilterSnapshotSchema = z.object({
  query: safeText(100)
    .refine(value => !containsKoreanPhone(value), '전화번호 원문은 내보내기 필터에 저장할 수 없습니다.')
    .optional(),
  stage: applicantStageSchema.optional(),
  region: regionSchema.optional(),
  school: safeText(40)
    .refine(value => !containsKoreanPhone(value), '전화번호 원문은 내보내기 필터에 저장할 수 없습니다.')
    .optional(),
  track: z.enum(trackKeys).optional(),
  campaignId: z.number().int().positive().safe().optional(),
  counselingStatus: z.enum(counselingStatuses).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
}).strict().superRefine((filters, context) => {
  if (filters.dateFrom && filters.dateTo && filters.dateTo < filters.dateFrom) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: '종료일은 시작일보다 빠를 수 없습니다.' })
  }
})

export const exportJobUpdateSchema = z.object({
  status: z.enum(exportJobStatuses),
  studentRowCount: rowCountSchema,
  participationRowCount: rowCountSchema,
  counselingRowCount: rowCountSchema,
  completedAt: timestampSchema.nullable(),
  downloadedAt: timestampSchema.nullable().optional(),
  errorCode: stableErrorCodeSchema.nullable(),
}).strict().superRefine((job, context) => {
  if (job.status === 'completed') {
    if (!job.completedAt) {
      context.addIssue({ code: 'custom', path: ['completedAt'], message: '완료 시각이 필요합니다.' })
    }
    if (job.errorCode !== null) {
      context.addIssue({ code: 'custom', path: ['errorCode'], message: '완료 작업에는 오류 코드가 없어야 합니다.' })
    }
    if (job.downloadedAt && job.completedAt
      && Date.parse(job.downloadedAt) < Date.parse(job.completedAt)) {
      context.addIssue({ code: 'custom', path: ['downloadedAt'], message: '다운로드 시각은 완료 시각보다 빠를 수 없습니다.' })
    }
    return
  }

  if (job.status === 'failed') {
    if (!job.completedAt) {
      context.addIssue({ code: 'custom', path: ['completedAt'], message: '실패 종료 시각이 필요합니다.' })
    }
    if (!job.errorCode) {
      context.addIssue({ code: 'custom', path: ['errorCode'], message: '안정적인 오류 코드가 필요합니다.' })
    }
    if (job.downloadedAt) {
      context.addIssue({ code: 'custom', path: ['downloadedAt'], message: '실패 작업에는 다운로드 시각이 없어야 합니다.' })
    }
    return
  }

  if (job.completedAt || job.downloadedAt || job.errorCode) {
    context.addIssue({ code: 'custom', message: '진행 중 작업에는 종료 정보가 없어야 합니다.' })
  }
})

export type CampaignCreate = z.infer<typeof campaignCreateSchema>
export type AdminCampaignStored = z.infer<typeof adminCampaignStoredSchema>
export type AdminCampaign = z.infer<typeof adminCampaignListItemSchema>
export type CampaignArchive = z.infer<typeof campaignArchiveSchema>
export type ExportFilterSnapshot = z.infer<typeof exportFilterSnapshotSchema>
export type ExportJobUpdate = z.infer<typeof exportJobUpdateSchema>
