import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createArchiveAdminCampaignHandler } from '../../../server/api/admin/campaigns/[id]/archive.post'
import { createAdminCampaignHandler } from '../../../server/api/admin/campaigns/index.post'
import { createAdminCampaignsListHandler } from '../../../server/api/admin/campaigns/index.get'
import { createCampaignResolutionHandler } from '../../../server/api/campaign/[code].get'
import { createSubmitAssessmentHandler } from '../../../server/api/assessment/submit.post'
import { createEventsHandler } from '../../../server/api/events.post'
import { createRegisterHandler } from '../../../server/api/student/register.post'
import { createEventWriter } from '../../../server/modules/metrics/events'
import {
  createAdminCampaignsService,
  decodeAdminCampaignRow,
  encodeAdminCampaignsCursor,
  parseAdminCampaignId,
  parseAdminCampaignListQuery,
  parseCampaignJsonBody,
  type AdminCampaignsServiceDependencies,
} from '../../../server/modules/admin/campaigns'
import {
  campaignCookieName,
  campaignCookieOptions,
  createCampaignAttributionService,
} from '../../../server/utils/campaign-attribution'
import { AppError } from '../../../server/utils/app-error'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestId = '77777777-7777-4777-8777-777777777777'
const anonymousId = '88888888-8888-4888-8888-888888888888'
const admin = {
  aal: 'aal2' as const,
  authenticatedAt: new Date('2026-07-16T01:00:00.000Z'),
  role: 'admin' as const,
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}
const now = new Date('2026-07-16T02:00:00.000Z')
const createdAt = '2026-07-15T01:00:00.123456Z'
const updatedAt = '2026-07-16T01:00:00.654321Z'

const storedCampaign = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  code: 'open-day-2026',
  name: '2026 오픈데이',
  channel: 'qr' as const,
  status: 'active' as const,
  startsAt: null,
  endsAt: null,
  sentCount: 120,
  createdAt,
  updatedAt,
  ...overrides,
})

const dependencies = (
  overrides: Partial<AdminCampaignsServiceDependencies> = {},
): AdminCampaignsServiceDependencies => ({
  listCampaigns: vi.fn(async () => [storedCampaign()]),
  createCampaign: vi.fn(async input => ({ kind: 'created' as const, campaign: storedCampaign(input) })),
  archiveCampaign: vi.fn(async () => ({
    kind: 'updated' as const,
    campaign: storedCampaign({ status: 'archived', updatedAt: '2026-07-16T02:00:00.000000Z' }),
  })),
  findActiveCampaignByCode: vi.fn(async code => code === 'open-day-2026' ? storedCampaign() : null),
  now: () => now,
  ...overrides,
})

const target = () => ({
  headers: {} as Record<string, string>,
  status: undefined as number | undefined,
})
const responseDependencies = (event: ReturnType<typeof target>) => ({
  getRequestId: () => requestId,
  setHeader: (_event: unknown, name: string, value: string) => { event.headers[name] = value },
  setStatus: (_event: unknown, status: number) => { event.status = status },
})

describe('administrator campaign service and API', () => {
  beforeEach(() => vi.stubGlobal('defineEventHandler', (handler: unknown) => handler))

  it('normalizes human codes, rejects unknown JSON fields, and keeps ID bounds exact', async () => {
    expect(parseCampaignJsonBody('application/json', JSON.stringify({
      code: ' OPEN DAY 2026 ',
      name: '2026 오픈데이',
      channel: 'qr',
    }))).resolves.toMatchObject({ code: 'open-day-2026', status: 'draft' })
    await expect(parseCampaignJsonBody('application/json', JSON.stringify({
      code: 'open-day-2026', name: '오픈데이', channel: 'qr', secret: 'raw-token',
    }))).rejects.toMatchObject({ code: 'CAMPAIGN_INVALID' })
    expect(() => parseAdminCampaignId('9007199254740992')).toThrowError(AppError)
    expect(parseAdminCampaignId('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('strictly decodes microsecond store rows and rejects coercion or unknown columns', () => {
    const raw = {
      id: 7,
      code: 'open-day-2026',
      name: '2026 오픈데이',
      channel: 'qr',
      status: 'active',
      starts_at: null,
      ends_at: null,
      sent_count: 120,
      created_at: createdAt,
      updated_at: updatedAt,
    }
    expect(decodeAdminCampaignRow(raw)).toMatchObject({ createdAt, updatedAt })
    expect(() => decodeAdminCampaignRow({ ...raw, id: '7' })).toThrowError('ADMIN_CAMPAIGN_STORE_INVALID')
    expect(() => decodeAdminCampaignRow({ ...raw, raw_secret: 'must-not-pass' })).toThrowError('ADMIN_CAMPAIGN_STORE_INVALID')
    expect(() => parseAdminCampaignListQuery({
      limit: '20', cursor: `${encodeAdminCampaignsCursor({ createdAt, id: 7 })}=`,
    })).toThrowError(AppError)
  })

  it('uses a stable created_at/id cursor and explicitly versions metrics as pending until S6', async () => {
    const listCampaigns = vi.fn(async () => [
      storedCampaign({ id: 9, code: 'third-campaign' }),
      storedCampaign({ id: 8, code: 'second-campaign' }),
      storedCampaign({ id: 7, createdAt: '2026-07-14T01:00:00.000001Z' }),
    ])
    const service = createAdminCampaignsService(dependencies({ listCampaigns }))

    const result = await service.list(parseAdminCampaignListQuery({
      query: 'open', status: 'active', channel: 'qr', limit: '2',
    }))

    expect(listCampaigns).toHaveBeenCalledWith({
      query: 'open', status: 'active', channel: 'qr', limit: 3,
    })
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      id: 9,
      metrics: {
        version: 's6-daily-metrics-v1',
        availability: 'pending',
        visits: null,
        assessmentCompletions: null,
        counselingConversions: null,
      },
    })
    expect(result.nextCursor).toBe(encodeAdminCampaignsCursor({ createdAt, id: 8 }))
  })

  it('requires an AAL2 administrator for list/create/archive and never returns internal store detail', async () => {
    const event = target()
    const service = createAdminCampaignsService(dependencies())
    const list = createAdminCampaignsListHandler({
      campaigns: service,
      getQuery: () => ({ limit: '20' }),
      requireAdmin: async () => admin,
      ...responseDependencies(event),
    })
    const listed = await list(event)
    expect(listed).toMatchObject({ data: { items: [{ code: 'open-day-2026' }] }, requestId })
    expect(event.headers).toEqual({
      'cache-control': 'private, no-store',
      'content-type': 'application/json; charset=utf-8',
    })

    const createEvent = target()
    const create = createAdminCampaignHandler({
      campaigns: service,
      getContentType: () => 'application/json',
      readRawBody: async () => JSON.stringify({ code: ' OPEN DAY 2026 ', name: '오픈데이', channel: 'qr' }),
      requireAdmin: async () => admin,
      ...responseDependencies(createEvent),
    })
    expect(await create(createEvent)).toMatchObject({ data: { campaign: { code: 'open-day-2026' } } })

    const archiveEvent = target()
    const archive = createArchiveAdminCampaignHandler({
      campaigns: service,
      getContentType: () => 'application/json',
      getParam: () => '7',
      readRawBody: async () => JSON.stringify({ expectedUpdatedAt: updatedAt }),
      requireAdmin: async () => admin,
      ...responseDependencies(archiveEvent),
    })
    expect(await archive(archiveEvent)).toMatchObject({ data: { campaign: { status: 'archived' } } })
  })

  it('maps duplicate codes and stale archive attempts to a stable conflict', async () => {
    const duplicate = createAdminCampaignsService(dependencies({
      createCampaign: vi.fn(async () => ({ kind: 'conflict' as const })),
    }))
    await expect(duplicate.create({ code: 'same-code', name: '중복', channel: 'direct' }))
      .rejects.toMatchObject({ code: 'CAMPAIGN_CONFLICT', statusCode: 409 })

    const stale = createAdminCampaignsService(dependencies({
      archiveCampaign: vi.fn(async () => ({ kind: 'conflict' as const, current: storedCampaign() })),
    }))
    await expect(stale.archive(7, '2026-07-15T00:00:00.000000Z'))
      .rejects.toMatchObject({ code: 'CAMPAIGN_CONFLICT', statusCode: 409 })
  })
})

describe('signed campaign attribution', () => {
  const key = new Uint8Array(32).fill(17)

  it('requires a dedicated exact 32-byte key before any signing operation', () => {
    for (const invalidKey of [new Uint8Array(31), new Uint8Array(33)]) {
      expect(() => createCampaignAttributionService({
        key: invalidKey,
        loadEligibleCampaign: async () => true,
      })).toThrowError('CAMPAIGN_COOKIE_KEY_INVALID')
    }
  })

  it('accepts only an untampered, unexpired cookie whose campaign remains active and date-eligible', async () => {
    const loadEligibleCampaign = vi.fn(async (campaignId: number, instant: Date) => (
      campaignId === 7 && instant.toISOString() === now.toISOString()
    ))
    const attribution = createCampaignAttributionService({ key, loadEligibleCampaign, now: () => now })
    const cookie = await attribution.issue(7)

    await expect(attribution.verify(cookie)).resolves.toBe(7)
    await expect(attribution.verify(cookie.replace('.7.', '.8.'))).resolves.toBeNull()
    const [version, id, expiry, signature] = cookie.split('.') as [string, string, string, string]
    for (const tampered of [
      `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`,
      `${signature.slice(0, 21)}${signature[21] === 'A' ? 'B' : 'A'}${signature.slice(22)}`,
      `${signature.slice(0, -1)}${signature.at(-1) === 'A' ? 'B' : 'A'}`,
    ]) {
      await expect(attribution.verify(`${version}.${id}.${expiry}.${tampered}`)).resolves.toBeNull()
    }
    await expect(attribution.verify('7')).resolves.toBeNull()
    expect(loadEligibleCampaign).toHaveBeenCalledTimes(1)
  })

  it('rejects cookies issued beyond five minutes of future clock skew', async () => {
    const future = new Date(now.getTime() + 6 * 60 * 1000)
    const issuer = createCampaignAttributionService({ key, loadEligibleCampaign: async () => true, now: () => future })
    const verifier = createCampaignAttributionService({ key, loadEligibleCampaign: async () => true, now: () => now })

    await expect(verifier.verify(await issuer.issue(7))).resolves.toBeNull()

    const withinSkew = new Date(now.getTime() + 4 * 60 * 1000)
    const nearIssuer = createCampaignAttributionService({ key, loadEligibleCampaign: async () => true, now: () => withinSkew })
    await expect(verifier.verify(await nearIssuer.issue(7))).resolves.toBe(7)
  })

  it('fails closed for expired, archived, date-ineligible, or unavailable campaigns without breaking flows', async () => {
    const issuedAt = new Date('2026-06-01T00:00:00.000Z')
    const issuer = createCampaignAttributionService({
      key,
      loadEligibleCampaign: async () => true,
      now: () => issuedAt,
    })
    const expired = await issuer.issue(7)
    const expiredVerifier = createCampaignAttributionService({ key, loadEligibleCampaign: async () => true, now: () => now })
    await expect(expiredVerifier.verify(expired)).resolves.toBeNull()

    for (const loadEligibleCampaign of [
      async () => false,
      async () => { throw new Error('store unavailable') },
    ]) {
      const verifier = createCampaignAttributionService({ key, loadEligibleCampaign, now: () => now })
      const cookie = await verifier.issue(7)
      await expect(verifier.verify(cookie)).resolves.toBeNull()
    }
  })

  it('resolves only an active in-window code, sets the protected 30-day cookie, and redirects locally', async () => {
    const service = createAdminCampaignsService(dependencies())
    const attribution = createCampaignAttributionService({ key, loadEligibleCampaign: async () => true, now: () => now })
    const cookies: unknown[] = []
    const redirects: unknown[] = []
    const event = target()
    const handler = createCampaignResolutionHandler({
      campaigns: service,
      getCode: () => 'open-day-2026',
      issueCookie: campaignId => attribution.issue(campaignId),
      isProduction: () => true,
      redirect: (_event, location, status) => { redirects.push({ location, status }); return 'redirected' },
      setCookie: (_event, name, value, options) => { cookies.push({ name, value, options }) },
      ...responseDependencies(event),
    })

    await expect(handler(event)).resolves.toBe('redirected')
    expect(cookies).toEqual([{
      name: campaignCookieName,
      value: expect.stringMatching(/^v1\.[1-9][0-9]{0,15}\.[0-9]{10}\.[A-Za-z0-9_-]{43}$/u),
      options: campaignCookieOptions(true),
    }])
    expect(redirects).toEqual([{ location: '/', status: 302 }])
  })

  it('returns a private 404 and sets no cookie for draft, archived, future, ended, or unknown codes', async () => {
    for (const campaign of [
      null,
      storedCampaign({ status: 'draft' }),
      storedCampaign({ status: 'archived' }),
      storedCampaign({ startsAt: '2026-07-17T00:00:00.000Z' }),
      storedCampaign({ endsAt: now.toISOString() }),
    ]) {
      const event = target()
      const cookies: unknown[] = []
      const service = createAdminCampaignsService(dependencies({
        findActiveCampaignByCode: vi.fn(async () => campaign),
      }))
      const handler = createCampaignResolutionHandler({
        campaigns: service,
        getCode: () => 'open-day-2026',
        issueCookie: async () => 'must-not-be-issued',
        isProduction: () => false,
        redirect: () => 'redirected',
        setCookie: (...args) => cookies.push(args),
        ...responseDependencies(event),
      })
      const response = await handler(event)
      expect(event.status).toBe(404)
      expect(response).toMatchObject({ error: { code: 'CAMPAIGN_NOT_FOUND' }, requestId })
      expect(cookies).toEqual([])
    }

    const inclusive = createAdminCampaignsService(dependencies({
      findActiveCampaignByCode: vi.fn(async () => storedCampaign({ startsAt: now.toISOString() })),
    }))
    await expect(inclusive.resolve('open-day-2026')).resolves.toEqual({ campaignId: 7, code: 'open-day-2026' })
  })
})

describe('verified campaign wiring', () => {
  const verifiedCampaignId = 7 as never

  it('passes verified attribution into registration without accepting a client campaign field', async () => {
    const getCampaignId = vi.fn(async () => verifiedCampaignId)
    const registerStudent = vi.fn(async () => ({ kind: 'existing' as const }))
    const handler = createRegisterHandler({
      identity: { registerStudent },
      getCampaignId,
      getContext: () => ({ anonymousId, ip: '203.0.113.7', requestId }),
      readBody: async () => ({
        phone: '01012345678', schoolName: '광주고등학교', applicantStage: 'high3', region: 'gwangju',
      }),
      setStatus: () => undefined,
    })
    await handler({})
    const context = registerStudent.mock.calls[0]![1]
    expect(getCampaignId).not.toHaveBeenCalled()
    await expect(context.resolveCampaignId()).resolves.toBe(7)
    expect(getCampaignId).toHaveBeenCalledOnce()
  })

  it('does not resolve campaign attribution for rejected identity or assessment bodies', async () => {
    const registerCampaign = vi.fn(async () => verifiedCampaignId)
    const registerStudent = vi.fn(async () => ({ kind: 'existing' as const }))
    const registerEvent: { status?: number } = {}
    const register = createRegisterHandler({
      identity: { registerStudent },
      getCampaignId: registerCampaign,
      getContext: () => ({ anonymousId, ip: '203.0.113.7', requestId }),
      readBody: async () => ({ phone: 'invalid', campaignId: 99 }),
      setStatus: (_event, status) => { registerEvent.status = status },
    })
    await register(registerEvent)
    expect(registerEvent.status).toBe(400)
    expect(registerCampaign).not.toHaveBeenCalled()
    expect(registerStudent).not.toHaveBeenCalled()

    const assessmentCampaign = vi.fn(async () => verifiedCampaignId)
    const submitAssessment = vi.fn(async () => ({ publicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))
    const assessmentEvent: { status?: number } = {}
    const assessment = createSubmitAssessmentHandler({
      assessment: { submitAssessment },
      getCampaignId: assessmentCampaign,
      getContentType: () => 'application/json',
      getContext: () => ({ anonymousId, ip: '203.0.113.7', requestId, sessionToken: 'session', resolveCampaignId: async () => null }),
      readRawBody: async () => '{invalid-json',
      setHeader: () => undefined,
      setStatus: (_event, status) => { assessmentEvent.status = status },
    })
    await assessment(assessmentEvent)
    expect(assessmentEvent.status).toBe(422)
    expect(assessmentCampaign).not.toHaveBeenCalled()
    expect(submitAssessment).not.toHaveBeenCalled()
  })

  it('derives browser event campaign server-side and never accepts it from the body', async () => {
    const writeEvent = vi.fn(async () => undefined)
    const handler = createEventsHandler({
      consumeRateLimit: async () => true,
      getAnonymousId: () => anonymousId,
      getCampaignId: async () => verifiedCampaignId,
      getContentType: () => 'application/json',
      getIp: () => '203.0.113.7',
      getOrigin: () => 'https://photo-next.example',
      getRequestId: () => requestId,
      getRequestOrigin: () => 'https://photo-next.example',
      getSessionToken: () => undefined,
      readRawBody: async () => JSON.stringify({ eventName: 'landing_viewed' }),
      readStudentSession: async () => null,
      setHeader: () => undefined,
      setStatus: () => undefined,
      writeEvent,
    })
    await handler({})
    expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({ verifiedCampaignId: 7 }))
  })

  it('persists verified non-result attribution but never lets authoritative events fall through to it', async () => {
    const key = new Uint8Array(32).fill(17)
    const attribution = createCampaignAttributionService({ key, loadEligibleCampaign: async () => true, now: () => now })
    const verified = await attribution.verify(await attribution.issue(7))
    if (verified === null) throw new Error('expected verified fixture')
    const insert = vi.fn(async () => ({ error: null }))
    const writer = createEventWriter({ from: vi.fn(() => ({ insert })) } as never)

    await writer({ anonymousId, eventName: 'landing_viewed', path: '/api/events', properties: {}, requestId, verifiedCampaignId: verified })
    await writer({ anonymousId, eventName: 'registration_completed', path: '/api/student/register', requestId, verifiedCampaignId: verified })
    await writer({ anonymousId, campaignId: null, eventName: 'counseling_requested', path: '/api/counseling', requestId, verifiedCampaignId: verified } as never)
    await writer({ anonymousId, campaignId: 99, eventName: 'login_succeeded', path: '/api/student/login', requestId } as never)

    expect(insert.mock.calls.map(call => call[0].campaign_id)).toEqual([7, 7, null, null])
  })

  it('passes a lazy verified resolver into assessment completion without resolving in the handler', async () => {
    const getCampaignId = vi.fn(async () => verifiedCampaignId)
    const submitAssessment = vi.fn(async () => ({ publicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))
    const assessment = createSubmitAssessmentHandler({
      assessment: { submitAssessment },
      getCampaignId,
      getContentType: () => 'application/json',
      getContext: () => ({ anonymousId, ip: '203.0.113.7', requestId, sessionToken: 'session', resolveCampaignId: async () => null }),
      readRawBody: async () => JSON.stringify({ fixture: true }),
      setHeader: () => undefined,
      setStatus: () => undefined,
    })
    await assessment({})
    const submitContext = submitAssessment.mock.calls[0]![1]
    expect(getCampaignId).not.toHaveBeenCalled()
    await expect(submitContext.resolveCampaignId()).resolves.toBe(7)
    expect(getCampaignId).toHaveBeenCalledOnce()
  })
})
