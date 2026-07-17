import { describe, expect, it } from 'vitest'

import {
  campaignCreateSchema,
  exportFilterSnapshotSchema,
  exportJobUpdateSchema,
} from '../../../shared/schemas/admin'
import { admissionCycleSchema } from '../../../shared/schemas/admission-roster'

describe('administrator operation schemas', () => {
  it('accepts PostgreSQL timestamptz offsets for admission cycles', () => {
    expect(admissionCycleSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      year: 2027,
      status: 'current',
      rosterVersion: 0,
      passwordKeyVersion: 1,
      createdAt: '2026-07-17T11:30:46.643159+00:00',
      archivedAt: null,
    }).success).toBe(true)
  })

  it('normalizes bounded campaign codes and rejects unknown fields', () => {
    expect(campaignCreateSchema.parse({
      code: ' OPEN DAY 2026 ',
      name: '2026 오픈데이',
      channel: 'qr',
    })).toMatchObject({ code: 'open-day-2026' })

    expect(campaignCreateSchema.safeParse({
      code: 'open-day-2026',
      name: '2026 오픈데이',
      channel: 'qr',
      token: 'secret',
    }).success).toBe(false)

    expect(campaignCreateSchema.safeParse({
      code: 'reverse-offset',
      name: '역순 시간대',
      channel: 'direct',
      startsAt: '2026-07-15T03:00:00+00:00',
      endsAt: '2026-07-15T10:00:00+09:00',
    }).success).toBe(false)
    expect(campaignCreateSchema.safeParse({
      code: 'valid-offset',
      name: '정상 시간대',
      channel: 'direct',
      startsAt: '2026-07-15T10:00:00+09:00',
      endsAt: '2026-07-15T03:00:00+00:00',
    }).success).toBe(true)
  })

  it('accepts only bounded, non-sensitive export filters', () => {
    expect(exportFilterSnapshotSchema.safeParse({
      stage: 'high3',
      region: 'gwangju',
      track: 'documentary',
      campaignId: 7,
      counselingStatus: 'new',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-15',
    }).success).toBe(true)

    for (const unsafe of [
      { phoneList: ['01012345678'] },
      { query: '010-1234-5678' },
      { query: '010(1234)5678' },
      { query: '010/1234/5678' },
      { school: '010-1234-5678' },
      { school: '학교\n이름' },
      { dateFrom: '2026-02-30' },
      { campaignId: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(exportFilterSnapshotSchema.safeParse(unsafe).success).toBe(false)
    }
  })

  it('keeps export lifecycle updates strict and internally consistent', () => {
    expect(exportJobUpdateSchema.safeParse({
      status: 'completed',
      studentRowCount: 3,
      participationRowCount: 5,
      counselingRowCount: 1,
      completedAt: '2026-07-15T10:00:00+09:00',
      errorCode: null,
    }).success).toBe(true)

    expect(exportJobUpdateSchema.safeParse({
      status: 'failed',
      studentRowCount: 0,
      participationRowCount: 0,
      counselingRowCount: 0,
      completedAt: '2026-07-15T10:00:00+09:00',
      errorCode: 'raw upstream message',
    }).success).toBe(false)

    expect(exportJobUpdateSchema.safeParse({
      status: 'failed',
      studentRowCount: 0,
      participationRowCount: 0,
      counselingRowCount: 0,
      completedAt: '2026-07-15T10:00:00+09:00',
      errorCode: 'PHONE_01012345678',
    }).success).toBe(false)

    expect(exportJobUpdateSchema.safeParse({
      status: 'failed',
      studentRowCount: 0,
      participationRowCount: 0,
      counselingRowCount: 0,
      completedAt: '2026-07-15T10:00:00+09:00',
      errorCode: 'EXPORT_FETCH_FAILED',
    }).success).toBe(true)

    expect(exportJobUpdateSchema.safeParse({
      status: 'completed',
      studentRowCount: 1,
      participationRowCount: 1,
      counselingRowCount: 1,
      completedAt: '2026-07-15T03:00:00+00:00',
      downloadedAt: '2026-07-15T10:00:00+09:00',
      errorCode: null,
    }).success).toBe(false)
    expect(exportJobUpdateSchema.safeParse({
      status: 'completed',
      studentRowCount: 1,
      participationRowCount: 1,
      counselingRowCount: 1,
      completedAt: '2026-07-15T10:00:00+09:00',
      downloadedAt: '2026-07-15T03:00:00+00:00',
      errorCode: null,
    }).success).toBe(true)
  })
})
