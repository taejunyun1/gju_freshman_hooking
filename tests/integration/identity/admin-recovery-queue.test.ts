import { describe, expect, it, vi } from 'vitest'

const admin = {
  aal: 'aal2' as const,
  authenticatedAt: new Date('2026-07-14T10:00:00.000Z'),
  role: 'admin' as const,
  userId: 'admin-1',
}

describe('administrator recovery queue', () => {
  it('returns only pending nonexpired requests and exposes masked phone data only', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createRecoveryQueueService } = await import('../../../server/api/admin/recovery/index.get')
    const service = createRecoveryQueueService({
      findPendingRequests: async () => [
        {
          expiresAt: new Date('2026-07-14T11:00:00.000Z'),
          id: 77,
          phoneCiphertext: new Uint8Array([11, 22]),
          phoneIv: new Uint8Array([33, 44]),
          nickname: '빛의기록27',
          region: 'gwangju',
          requestedAt: new Date('2026-07-14T09:48:00.000Z'),
          status: 'requested',
        },
        {
          expiresAt: new Date('2026-07-14T09:59:00.000Z'),
          id: 78,
          phoneCiphertext: new Uint8Array([55]),
          phoneIv: new Uint8Array([66]),
          nickname: '만료요청00',
          region: 'capital',
          requestedAt: new Date('2026-07-14T09:00:00.000Z'),
          status: 'requested',
        },
        {
          expiresAt: new Date('2026-07-14T11:00:00.000Z'),
          id: 79,
          phoneCiphertext: new Uint8Array([77]),
          phoneIv: new Uint8Array([88]),
          nickname: '승인요청00',
          region: 'chungcheong',
          requestedAt: new Date('2026-07-14T09:00:00.000Z'),
          status: 'verified',
        },
      ],
      now: () => new Date('2026-07-14T10:00:00.000Z'),
      revealPhone: async ({ ciphertext }) => ciphertext[0] === 11 ? '01012345678' : '01099999999',
    })

    const result = await service.listPending()

    expect(result).toEqual([{
      age: '요청 12분 경과',
      id: 77,
      maskedPhone: '010-****-5678',
      nickname: '빛의기록27',
      region: '광주광역시',
      state: '승인 대기',
    }])
    expect(JSON.stringify(result)).not.toMatch(/01012345678|phoneCiphertext|phoneIv|phoneHmac|11,22|33,44/u)
  })

  it('records a sanitized copy action and rejects any payload containing the code', async () => {
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    const { createRecoveryCopyHandler } = await import('../../../server/api/admin/recovery/[id]/copy.post')
    const auditEvents: unknown[] = []
    const handler = createRecoveryCopyHandler({
      getParam: () => '77',
      getRequestId: () => '8f41e8dc-42e7-450c-a4e5-918d96335363',
      readBody: async (event: { body: unknown }) => event.body,
      requireAdmin: async () => admin,
      setStatus: vi.fn(),
      writeAuditEvent: async input => { auditEvents.push(input) },
    })

    const accepted = await handler({ body: { requestId: 77 } })
    const rejected = await handler({ body: { code: 'BwcHBwcHBwcHBwcHBwcHBw', requestId: 77 } })

    expect(accepted).toEqual({ data: { recorded: true }, requestId: '8f41e8dc-42e7-450c-a4e5-918d96335363' })
    expect(auditEvents).toEqual([{
      action: 'credential_recovery_code_copied',
      adminUserId: 'admin-1',
      metadata: {},
      requestId: '8f41e8dc-42e7-450c-a4e5-918d96335363',
      targetId: '77',
      targetType: 'credential_recovery_request',
    }])
    expect(rejected).toMatchObject({ error: { code: 'VALIDATION_FAILED' } })
    expect(JSON.stringify(auditEvents)).not.toContain('BwcHBwcHBwcHBwcHBwcHBw')
  })
})
