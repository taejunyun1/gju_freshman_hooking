import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createArchiveAdminResourceHandler } from '../../../server/api/admin/resources/[id]/archive.post'
import { createAdminResourceDetailHandler } from '../../../server/api/admin/resources/[id].get'
import {
  createUploadAdminResourceImageHandler,
  readResourceImage,
} from '../../../server/api/admin/resources/[id]/image.post'
import { createPublishAdminResourceHandler } from '../../../server/api/admin/resources/[id]/publish.post'
import { createUpdateAdminResourceHandler } from '../../../server/api/admin/resources/[id].put'
import { createUpdateAdminResourceInventoryHandler } from '../../../server/api/admin/resources/[id]/inventory/[itemId].put'
import { createValidateEquipmentImportHandler } from '../../../server/api/admin/resources/equipment/import/validate.post'
import { createAdminResourcesListHandler } from '../../../server/api/admin/resources/index.get'
import { createAdminResourceHandler } from '../../../server/api/admin/resources/index.post'
import {
  createAdminResourcesService,
  createSupabaseAdminResourcesDependencies,
  decodeAdminResourceRow,
  encodeAdminResourcesCursor,
  parseAdminResourceWrite,
  type AdminResourcesServiceDependencies,
} from '../../../server/modules/admin/resources'
import { AppError } from '../../../server/utils/app-error'
import { RequestBodyLimitError } from '../../../server/utils/bounded-request-body'

vi.hoisted(() => {
  Object.assign(globalThis, { defineEventHandler: (handler: unknown) => handler })
})

const requestId = '77777777-7777-4777-8777-777777777777'
const admin = {
  aal: 'aal2' as const,
  authenticatedAt: new Date('2026-07-15T01:00:00.000Z'),
  role: 'admin' as const,
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}
const updatedAt = '2026-07-15T02:00:00.000Z'
const createdAt = '2026-07-15T01:00:00.000Z'

const storedResource = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  type: 'course',
  title: '사진영상학개론',
  summary: '사진과 영상의 기초를 익힙니다.',
  connectionTemplate: '{interest}를 {title}에서 실현합니다.',
  status: 'draft',
  visibility: 'public',
  priority: 10,
  sourceDate: '2026-07-14',
  metadata: {
    academic_year: 2026,
    grade_year: 1,
    term: '1학기',
    credits: 3,
    goal: '촬영 기초를 익힌다.',
  },
  imagePath: null,
  createdAt,
  updatedAt,
  tags: [{ key: 'photography', weight: 3, isPrimary: true }],
  ...overrides,
})

const inventory = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  equipmentResourceId: 42,
  inventoryCode: 'CAM-001',
  sourceRow: 1,
  locationKey: 'department_equipment_room',
  accessMode: 'reservation',
  availabilityState: 'available',
  note: null,
  dataQualityStatus: 'verified',
  sourceDate: '2026-07-14',
  updatedAt,
  ...overrides,
})

const dependencies = (
  overrides: Partial<AdminResourcesServiceDependencies> = {},
): AdminResourcesServiceDependencies => ({
  listResources: vi.fn(async () => [storedResource()]),
  loadResource: vi.fn(async () => storedResource()),
  listInventory: vi.fn(async () => []),
  createResource: vi.fn(async input => storedResource({
    ...input.resource,
    tags: input.tags,
  })),
  updateResource: vi.fn(async input => ({ kind: 'updated' as const, resource: storedResource({
    ...input.resource,
    tags: input.tags,
  }) })),
  transitionResource: vi.fn(async input => storedResource({ status: input.status })),
  attachImage: vi.fn(async () => ({
    kind: 'committed' as const,
    resourceId: 42,
    previousImagePath: null,
    committedUpdatedAt: updatedAt,
  })),
  uploadImage: vi.fn(async () => undefined),
  removeImages: vi.fn(async () => undefined),
  randomId: () => '11111111-1111-4111-8111-111111111111',
  updateInventoryItem: vi.fn(async () => ({
    kind: 'updated' as const,
    item: inventory(),
    resourceUpdatedAt: updatedAt,
  })),
  ...overrides,
})

const event = () => ({
  headers: {} as Record<string, string>,
  status: undefined as number | undefined,
})

const responseDependencies = (target: ReturnType<typeof event>) => ({
  getRequestId: () => requestId,
  setHeader: (_event: unknown, name: string, value: string) => { target.headers[name] = value },
  setStatus: (_event: unknown, status: number) => { target.status = status },
})

const jsonRequestDependencies = (body: unknown) => ({
  getContentType: () => 'application/json',
  readRawBody: async () => JSON.stringify(body),
})

const courseWrite = () => ({
  type: 'course',
  title: '사진영상학개론',
  summary: '사진과 영상의 기초를 익힙니다.',
  connectionTemplate: '{interest}를 {title}에서 실현합니다.',
  sourceDate: '2026-07-14',
  visibility: 'public',
  priority: 10,
  tags: [{ key: 'photography', weight: 3, isPrimary: true }],
  metadata: {
    academic_year: 2026,
    grade_year: 1,
    term: '1학기',
    credits: 3,
    goal: '촬영 기초를 익힌다.',
  },
  imagePath: null,
})

const equipmentWrite = () => ({
  ...courseWrite(),
  type: 'equipment' as const,
  metadata: {
    category: 'body',
    locationKey: 'department_equipment_room',
    locationLabel: '사진영상미디어학과 기자재실',
    accessMode: 'reservation',
    accessLabel: '예약 가능',
    reservationUrl: 'https://gjureserve.co.kr',
  },
})

describe('administrator resource list and detail', () => {
  beforeEach(() => vi.stubGlobal('defineEventHandler', (handler: unknown) => handler))

  it('requires AAL2 admin, sets private JSON headers, and preserves the updated_at/id cursor', async () => {
    const listResources = vi.fn(async () => [
      storedResource({ id: 44 }),
      storedResource({ id: 43 }),
      storedResource({ id: 42, updatedAt: '2026-07-14T02:00:00.000Z' }),
    ])
    const serviceDependencies = dependencies({ listResources })
    const target = event()
    const requireAdmin = vi.fn(async () => admin)
    const handler = createAdminResourcesListHandler({
      resources: createAdminResourcesService(serviceDependencies),
      getQuery: () => ({
        query: '사진', type: 'course', status: 'draft', visibility: 'public',
        tag: 'photography', sourceDateFrom: '2026-07-01', sourceDateTo: '2026-07-31', limit: '2',
      }),
      requireAdmin,
      ...responseDependencies(target),
    })

    const response = await handler(target)

    expect(requireAdmin).toHaveBeenCalledWith(target)
    expect(listResources).toHaveBeenCalledWith({
      query: '사진', type: 'course', status: 'draft', visibility: 'public', tag: 'photography',
      sourceDateFrom: '2026-07-01', sourceDateTo: '2026-07-31', limit: 3,
    })
    expect(target.headers).toMatchObject({
      'cache-control': 'private, no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    expect(response).toMatchObject({ data: { items: [{ id: 44 }, { id: 43 }] } })
    if (!('data' in response)) throw new Error('expected data')
    expect(response.data.nextCursor).toBe(encodeAdminResourcesCursor({ updatedAt, id: 43 }))
  })

  it('strictly rejects unexpected DB columns and returns every equipment inventory row', async () => {
    expect(() => decodeAdminResourceRow({
      id: 42,
      type: 'course',
      title: '사진영상학개론',
      summary: '설명',
      connection_template: '연결',
      status: 'draft',
      visibility: 'public',
      priority: 0,
      source_date: '2026-07-14',
      metadata: {},
      image_path: null,
      created_at: createdAt,
      updated_at: updatedAt,
      resource_tags: [{ tag_key: 'photo', weight: 3, is_primary: true }],
      leaked_column: 'secret',
    })).toThrow('ADMIN_RESOURCE_STORE_INVALID')

    const rows = [
      inventory(),
      inventory({ id: 2, sourceRow: 2, dataQualityStatus: 'duplicate_code' }),
    ]
    const service = createAdminResourcesService(dependencies({
      loadResource: vi.fn(async () => storedResource({ type: 'equipment', metadata: {} })),
      listInventory: vi.fn(async () => rows),
    }))
    const target = event()
    const handler = createAdminResourceDetailHandler({
      resources: service,
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })

    const response = await handler(target)
    expect(response).toMatchObject({ data: {
      resource: { id: 42, metadata: { confirmedQuantity: 1 } },
      inventory: rows,
    } })
  })

  it.each([
    { academic_year: 2026, grade_year: 5, term: '1학기', credits: 3, goal: '목표' },
    { academic_year: 2026, grade_year: 1, term: '1학기', credits: '3', goal: '목표' },
    { academic_year: 2026, grade_year: 1, term: '1학기', credits: 3, goal: '목표', privateKey: 'leak' },
  ])('fails closed on invalid or unexpected nested stored metadata %#', (metadata) => {
    expect(() => decodeAdminResourceRow({
      id: 42,
      type: 'course',
      title: '사진영상학개론',
      summary: '설명',
      connection_template: '연결',
      status: 'draft',
      visibility: 'public',
      priority: 0,
      source_date: '2026-07-14',
      metadata,
      image_path: null,
      created_at: createdAt,
      updated_at: updatedAt,
      resource_tags: [{ tag_key: 'photo', weight: 3, is_primary: true }],
    })).toThrow('ADMIN_RESOURCE_STORE_INVALID')
  })

  it('uses an inner tag filter without dropping the full tag relation and quotes text filters', async () => {
    const calls = { eq: [] as Array<[string, unknown]>, or: [] as string[], select: [] as string[] }
    const query = {
      eq: (column: string, value: unknown) => { calls.eq.push([column, value]); return query },
      gte: () => query,
      limit: () => query,
      lte: () => query,
      or: (value: string) => { calls.or.push(value); return query },
      order: () => query,
      select: (value: string) => { calls.select.push(value); return query },
      then: <Result>(resolve: (value: { data: unknown[], error: null }) => Result | PromiseLike<Result>) => (
        Promise.resolve({ data: [], error: null }).then(resolve)
      ),
    }
    const client = { from: vi.fn(() => query) } as never
    const adapter = createSupabaseAdminResourcesDependencies(client)

    await adapter.listResources({ query: '빛%,_"', tag: 'photography', limit: 21 })

    expect(calls.select[0]).toContain('resource_tags(tag_key,weight,is_primary)')
    expect(calls.select[0]).toContain('matching_tags:resource_tags!inner(tag_key)')
    expect(calls.eq).toContainEqual(['matching_tags.tag_key', 'photography'])
    expect(calls.or[0]).toBe('title.ilike."%빛\\\\%,\\\\_\\"%",summary.ilike."%빛\\\\%,\\\\_\\"%"')
  })
})

describe('administrator resource writes', () => {
  it('strictly validates tags and type-specific metadata before any write', () => {
    expect(() => parseAdminResourceWrite({
      ...courseWrite(),
      tags: [
        { key: 'photo', weight: 3, isPrimary: true },
        { key: 'photo', weight: 2, isPrimary: false },
      ],
    })).toThrowError(new AppError('RESOURCE_INVALID'))
    expect(() => parseAdminResourceWrite({
      ...courseWrite(),
      metadata: { ...courseWrite().metadata, confirmed_quantity: 999 },
    })).toThrowError(new AppError('RESOURCE_INVALID'))
    for (const quantityKey of ['confirmedQuantity', 'confirmed_quantity']) {
      expect(() => parseAdminResourceWrite({
        ...equipmentWrite(),
        metadata: { ...equipmentWrite().metadata, [quantityKey]: 999 },
      })).toThrowError(new AppError('RESOURCE_INVALID'))
    }
  })

  it('creates resource and tags atomically with the authenticated audit context', async () => {
    const createResource = vi.fn(async input => storedResource({ ...input.resource, tags: input.tags }))
    const target = event()
    const handler = createAdminResourceHandler({
      resources: createAdminResourcesService(dependencies({ createResource })),
      requireAdmin: async () => admin,
      ...jsonRequestDependencies(courseWrite()),
      ...responseDependencies(target),
    })

    const response = await handler(target)

    expect(createResource).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: admin.userId,
      requestId,
      tags: courseWrite().tags,
    }))
    expect(response).toMatchObject({ data: { resource: { id: 42, status: 'draft' } } })
  })

  it('maps bounded JSON body overflow to the stable resource input error', async () => {
    const target = event()
    const handler = createAdminResourceHandler({
      resources: createAdminResourcesService(dependencies()),
      getContentType: () => 'application/json',
      readRawBody: async () => { throw new RequestBodyLimitError() },
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })
    expect(await handler(target)).toMatchObject({ error: { code: 'RESOURCE_INVALID' } })
  })

  it('requires expectedUpdatedAt and returns strict current DTO on stale write', async () => {
    const target = event()
    const missingVersion = createUpdateAdminResourceHandler({
      resources: createAdminResourcesService(dependencies()),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies(courseWrite()),
      ...responseDependencies(target),
    })
    expect(await missingVersion(target)).toMatchObject({ error: { code: 'RESOURCE_INVALID' } })

    const current = storedResource({ title: '다른 관리자가 수정함' })
    const updateResource = vi.fn(async () => ({ kind: 'conflict' as const, current }))
    const conflict = createUpdateAdminResourceHandler({
      resources: createAdminResourcesService(dependencies({ updateResource })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies({ ...courseWrite(), expectedUpdatedAt: createdAt }),
      ...responseDependencies(target),
    })
    const response = await conflict(target)

    expect(target.status).toBe(409)
    expect(response).toMatchObject({ error: {
      code: 'RESOURCE_CONFLICT',
      current: { id: 42, title: '다른 관리자가 수정함' },
    } })
    expect(JSON.stringify(response)).not.toContain('connection_template')

    const invalidConflict = createUpdateAdminResourceHandler({
      resources: createAdminResourcesService(dependencies({
        updateResource: vi.fn(async () => ({
          kind: 'conflict' as const,
          current: storedResource({ metadata: { ...courseWrite().metadata, leaked: true } }),
        })),
      })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies({ ...courseWrite(), expectedUpdatedAt: createdAt }),
      ...responseDependencies(target),
    })
    expect(await invalidConflict(target)).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
  })

  it('maps closed RPC business outcomes to stable resource errors', async () => {
    const resource = { ...courseWrite() }
    const { tags, ...record } = resource
    const updateAdapter = createSupabaseAdminResourcesDependencies({
      rpc: vi.fn(async () => ({ data: { status: 'not_found' }, error: null })),
    } as never)
    await expect(updateAdapter.updateResource({
      id: 404,
      expectedUpdatedAt: updatedAt,
      resource: record,
      tags,
      adminUserId: admin.userId,
      requestId,
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })

    const publishAdapter = createSupabaseAdminResourcesDependencies({
      rpc: vi.fn(async () => ({
        data: { status: 'validation_error', code: 'COURSE_METADATA_REQUIRED' },
        error: null,
      })),
    } as never)
    await expect(publishAdapter.transitionResource({
      id: 42,
      status: 'active',
      changedFields: ['status'],
      adminUserId: admin.userId,
      requestId,
    })).rejects.toMatchObject({ code: 'COURSE_METADATA_REQUIRED' })
  })
})

describe('administrator equipment inventory writes', () => {
  const inventoryWrite = () => ({
    expectedUpdatedAt: updatedAt,
    inventoryCode: 'CAM-002',
    locationKey: 'fantasy_lab',
    accessMode: 'inquiry',
    availabilityState: 'available',
    note: '점검 완료',
    dataQualityStatus: 'verified',
  })

  it('strictly updates one item with optimistic locking and audit context', async () => {
    const updatedItem = inventory({
      inventoryCode: 'CAM-002',
      locationKey: 'fantasy_lab',
      accessMode: 'inquiry',
      note: '점검 완료',
      updatedAt: '2026-07-15T04:00:00.000Z',
    })
    const updateInventoryItem = vi.fn(async () => ({
      kind: 'updated' as const,
      item: updatedItem,
      resourceUpdatedAt: '2026-07-15T04:00:00.000Z',
    }))
    const target = event()
    const handler = createUpdateAdminResourceInventoryHandler({
      resources: createAdminResourcesService(dependencies({ updateInventoryItem })),
      getParam: (_event, name) => name === 'id' ? '42' : '1',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies(inventoryWrite()),
      ...responseDependencies(target),
    })

    const response = await handler(target)

    expect(updateInventoryItem).toHaveBeenCalledWith({
      resourceId: 42,
      itemId: 1,
      input: inventoryWrite(),
      adminUserId: admin.userId,
      requestId,
    })
    expect(target.headers['cache-control']).toBe('private, no-store')
    expect(response).toMatchObject({ data: {
      item: updatedItem,
      resourceUpdatedAt: '2026-07-15T04:00:00.000Z',
    } })
  })

  it('rejects unknown fields and returns the strict current item on conflict', async () => {
    const target = event()
    const invalid = createUpdateAdminResourceInventoryHandler({
      resources: createAdminResourcesService(dependencies()),
      getParam: (_event, name) => name === 'id' ? '42' : '1',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies({ ...inventoryWrite(), rawSource: 'leak' }),
      ...responseDependencies(target),
    })
    expect(await invalid(target)).toMatchObject({ error: { code: 'RESOURCE_INVALID' } })

    const current = inventory()
    const conflict = createUpdateAdminResourceInventoryHandler({
      resources: createAdminResourcesService(dependencies({
        updateInventoryItem: vi.fn(async () => ({ kind: 'conflict' as const, current })),
      })),
      getParam: (_event, name) => name === 'id' ? '42' : '1',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies(inventoryWrite()),
      ...responseDependencies(target),
    })
    expect(await conflict(target)).toMatchObject({ error: {
      code: 'RESOURCE_CONFLICT',
      current,
    } })
  })

  it('maps an active last-verified invariant rejection to the stable business error', async () => {
    const adapter = createSupabaseAdminResourcesDependencies({
      rpc: vi.fn(async () => ({
        data: { status: 'validation_error', code: 'EQUIPMENT_INVENTORY_UNVERIFIED' },
        error: null,
      })),
    } as never)

    await expect(adapter.updateInventoryItem({
      resourceId: 42,
      itemId: 1,
      input: { ...inventoryWrite(), dataQualityStatus: 'unidentified' },
      adminUserId: admin.userId,
      requestId,
    })).rejects.toMatchObject({ code: 'EQUIPMENT_INVENTORY_UNVERIFIED' })
  })

  it.each(['inventoryCode', 'locationKey', 'accessMode', 'availabilityState', 'dataQualityStatus'] as const)(
    'rejects a null %s scalar before the inventory dependency',
    async (field) => {
      const updateInventoryItem = vi.fn(async () => ({
        kind: 'updated' as const,
        item: inventory(),
        resourceUpdatedAt: updatedAt,
      }))
      const target = event()
      const handler = createUpdateAdminResourceInventoryHandler({
        resources: createAdminResourcesService(dependencies({ updateInventoryItem })),
        getParam: (_event, name) => name === 'id' ? '42' : '1',
        requireAdmin: async () => admin,
        ...jsonRequestDependencies({ ...inventoryWrite(), [field]: null }),
        ...responseDependencies(target),
      })

      expect(await handler(target)).toMatchObject({ error: { code: 'RESOURCE_INVALID' } })
      expect(updateInventoryItem).not.toHaveBeenCalled()
    },
  )
})

describe('publishing, archiving, and inventory truth', () => {
  it.each([
    ['course metadata', storedResource({ metadata: {} }), 'COURSE_METADATA_REQUIRED'],
    ['work consent', storedResource({ type: 'student_work', metadata: {}, imagePath: 'resources/42/work.webp' }), 'WORK_CONSENT_REQUIRED'],
    ['work media', storedResource({ type: 'student_work', metadata: {
      consent_at: createdAt, related_course: '기초사진', related_year: 1, related_track: 'art_photo', image_alt: '',
    }, imagePath: null }), 'WORK_MEDIA_REQUIRED'],
    ['work relation', storedResource({ type: 'student_work', metadata: {
      consent_at: createdAt, image_alt: '작품 이미지', related_course: '', related_year: 1, related_track: '',
    }, imagePath: 'resources/42/work.webp' }), 'WORK_RELATION_REQUIRED'],
    ['facility operation', storedResource({ type: 'facility', metadata: {
      location_label: '스튜디오 A', operation_note: '  ', activities: ['촬영'], last_verified_at: null,
    } }), 'FACILITY_OPERATION_UNVERIFIED'],
  ])('blocks %s with a stable error code', async (_label, resource, code) => {
    const target = event()
    const handler = createPublishAdminResourceHandler({
      resources: createAdminResourcesService(dependencies({ loadResource: vi.fn(async () => resource) })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })
    expect(await handler(target)).toMatchObject({ error: { code } })
  })

  it('counts only verified inventory and publishes through an audited transaction', async () => {
    const transitionResource = vi.fn(async input => storedResource({
      type: 'equipment', status: input.status, metadata: {},
    }))
    const target = event()
    const handler = createPublishAdminResourceHandler({
      resources: createAdminResourcesService(dependencies({
        loadResource: vi.fn(async () => storedResource({ type: 'equipment', metadata: {} })),
        listInventory: vi.fn(async () => [
          inventory(),
          inventory({ id: 2, dataQualityStatus: 'duplicate_code', sourceRow: 2 }),
          inventory({ id: 3, dataQualityStatus: 'unidentified', sourceRow: 3 }),
          inventory({ id: 4, dataQualityStatus: 'quantity_check', sourceRow: 4 }),
        ]),
        transitionResource,
      })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })
    const response = await handler(target)

    expect(transitionResource).toHaveBeenCalledWith({
      id: 42,
      status: 'active',
      adminUserId: admin.userId,
      requestId,
      changedFields: ['status'],
    })
    expect(response).toMatchObject({ data: { resource: {
      status: 'active', metadata: { confirmedQuantity: 1 },
    } } })
  })

  it('reloads committed inventory truth after publishing instead of reusing the pre-lock snapshot', async () => {
    const listInventory = vi.fn()
      .mockResolvedValueOnce([inventory()])
      .mockResolvedValueOnce([
        inventory(),
        inventory({ id: 2, inventoryCode: 'CAM-002', sourceRow: 2 }),
      ])
    const transitionResource = vi.fn(async input => storedResource({
      type: 'equipment', status: input.status, metadata: { confirmedQuantity: 2 },
    }))
    const service = createAdminResourcesService(dependencies({
      loadResource: vi.fn(async () => storedResource({ type: 'equipment', metadata: {} })),
      listInventory,
      transitionResource,
    }))

    const response = await service.publish(42, { adminUserId: admin.userId, requestId })

    expect(listInventory).toHaveBeenCalledTimes(2)
    expect(response.resource.metadata).toMatchObject({ confirmedQuantity: 2 })
    expect(response.inventory).toHaveLength(2)
  })

  it('archives without deleting and records only changed field names', async () => {
    const transitionResource = vi.fn(async input => storedResource({ status: input.status }))
    const target = event()
    const handler = createArchiveAdminResourceHandler({
      resources: createAdminResourcesService(dependencies({ transitionResource })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })
    await handler(target)
    expect(transitionResource).toHaveBeenCalledWith({
      id: 42,
      status: 'archived',
      adminUserId: admin.userId,
      requestId,
      changedFields: ['status'],
    })
  })
})

describe('resource image and equipment import validation', () => {
  const multipartImage = (fileBytes: number, extraHeaderBytes = 0) => {
    const boundary = 'photo-next-boundary'
    const prefix = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="image.png"\r\nContent-Type: image/png\r\nX-Padding: ${'x'.repeat(extraHeaderBytes)}\r\n\r\n`,
    )
    const file = new Uint8Array(fileBytes)
    file.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
    const body = new Uint8Array(prefix.byteLength + file.byteLength + suffix.byteLength)
    body.set(prefix)
    body.set(file, prefix.byteLength)
    body.set(suffix, prefix.byteLength + file.byteLength)
    return { body, boundary }
  }

  it('bounds multipart bytes before parsing and independently rejects file and overhead excess', async () => {
    const overFile = multipartImage(8 * 1024 * 1024 + 1)
    await expect(readResourceImage({
      _requestBody: overFile.body,
      node: { req: { headers: {
        'content-length': String(overFile.body.byteLength),
        'content-type': `multipart/form-data; boundary=${overFile.boundary}`,
      } } },
    })).rejects.toMatchObject({ code: 'RESOURCE_IMAGE_TOO_LARGE' })

    const overBody = multipartImage(8, 64 * 1024)
    await expect(readResourceImage({
      _requestBody: overBody.body,
      node: { req: { headers: {
        'content-length': String(overBody.body.byteLength),
        'content-type': `multipart/form-data; boundary=${overBody.boundary}`,
      } } },
    })).rejects.toMatchObject({ code: 'RESOURCE_IMAGE_INVALID' })

    const parseSpy = vi.fn()
    await expect(readResourceImage({
      node: { req: { headers: {
        'content-length': String(8 * 1024 * 1024 + 64 * 1024 + 1),
        'content-type': `multipart/form-data; boundary=${overBody.boundary}`,
        'x-photo-next-body-overflow': '1',
      }, [Symbol.asyncIterator]: parseSpy } },
    })).rejects.toMatchObject({ code: 'RESOURCE_IMAGE_TOO_LARGE' })
    expect(parseSpy).not.toHaveBeenCalled()
  })

  it('uses MIME-derived random paths and applies compensating cleanup in the safe order', async () => {
    const calls: string[] = []
    const loadResource = vi.fn()
      .mockResolvedValueOnce(storedResource({ imagePath: 'resources/42/old.webp' }))
      .mockResolvedValueOnce(storedResource({ imagePath: 'resources/42/11111111-1111-4111-8111-111111111111.png' }))
    const service = createAdminResourcesService(dependencies({
      loadResource,
      uploadImage: vi.fn(async ({ path }) => { calls.push(`upload:${path}`) }),
      attachImage: vi.fn(async ({ imagePath }) => {
        calls.push(`attach:${imagePath}`)
        return {
          kind: 'committed' as const,
          resourceId: 42,
          previousImagePath: 'resources/42/old.webp',
          committedUpdatedAt: updatedAt,
        }
      }),
      removeImages: vi.fn(async paths => { calls.push(`remove:${paths.join(',')}`) }),
    }))
    const target = event()
    const handler = createUploadAdminResourceImageHandler({
      resources: service,
      getParam: () => '42',
      readImage: async () => ({ bytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), mimeType: 'image/png' }),
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })
    const response = await handler(target)

    expect(calls).toEqual([
      'upload:resources/42/11111111-1111-4111-8111-111111111111.png',
      'attach:resources/42/11111111-1111-4111-8111-111111111111.png',
      'remove:resources/42/old.webp',
    ])
    expect(JSON.stringify(response)).not.toMatch(/signed|bytes|AQID/iu)

    calls.length = 0
    const failingService = createAdminResourcesService(dependencies({
      loadResource: vi.fn(async () => storedResource({ imagePath: 'resources/42/old.webp' })),
      uploadImage: vi.fn(async ({ path }) => { calls.push(`upload:${path}`) }),
      attachImage: vi.fn(async () => { throw new Error('DB details') }),
      removeImages: vi.fn(async paths => { calls.push(`remove:${paths.join(',')}`) }),
    }))
    await expect(failingService.uploadImage(42, {
      bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), mimeType: 'image/webp',
    }, { adminUserId: admin.userId, requestId })).rejects.toThrow('RESOURCE_IMAGE_UPLOAD_FAILED')
    expect(calls).toEqual([
      'upload:resources/42/11111111-1111-4111-8111-111111111111.webp',
      'remove:resources/42/11111111-1111-4111-8111-111111111111.webp',
    ])

    await expect(service.uploadImage(42, {
      bytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      mimeType: 'image/jpeg',
    }, { adminUserId: admin.userId, requestId })).rejects.toThrow('RESOURCE_IMAGE_INVALID')
  })

  it('never deletes a newly committed image when the post-commit reload fails', async () => {
    const calls: string[] = []
    const loadResource = vi.fn()
      .mockResolvedValueOnce(storedResource({ imagePath: 'resources/42/old.webp' }))
      .mockRejectedValueOnce(new Error('reload unavailable'))
    const service = createAdminResourcesService(dependencies({
      loadResource,
      uploadImage: vi.fn(async ({ path }) => { calls.push(`upload:${path}`) }),
      attachImage: vi.fn(async ({ imagePath }) => {
        calls.push(`commit:${imagePath}`)
        return {
          kind: 'committed' as const,
          resourceId: 42,
          previousImagePath: 'resources/42/old.webp',
          committedUpdatedAt: '2026-07-15T03:00:00.000Z',
        }
      }),
      removeImages: vi.fn(async paths => { calls.push(`remove:${paths.join(',')}`) }),
    }))

    await expect(service.uploadImage(42, {
      bytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      mimeType: 'image/png',
    }, { adminUserId: admin.userId, requestId })).rejects.toThrow('reload unavailable')
    expect(calls).toEqual([
      'upload:resources/42/11111111-1111-4111-8111-111111111111.png',
      'commit:resources/42/11111111-1111-4111-8111-111111111111.png',
      'remove:resources/42/old.webp',
    ])
  })

  it('validates the bounded 144-row artifact without a DB dependency and reports every issue class', async () => {
    const rows = Array.from({ length: 144 }, (_, index) => ({
      sourceRow: index + 1,
      name: `장비 ${index + 1}`,
      inventoryCode: `CODE-${index + 1}`,
      locationKey: index < 83 ? 'department_equipment_room' : 'fantasy_lab',
      category: 'body',
      accessMode: index < 81 ? 'reservation' : 'inquiry',
      availabilityState: 'available',
      note: null,
      dataQualityStatus: 'verified',
      sourceDate: '2026-07-14',
      tags: ['photography'],
    }))
    rows[1]!.inventoryCode = rows[0]!.inventoryCode
    rows[2]!.dataQualityStatus = 'unidentified'
    rows[3]!.dataQualityStatus = 'quantity_check'
    rows[4]!.inventoryCode = 'UNMATCHED-001'
    const target = event()
    const handler = createValidateEquipmentImportHandler({
      getContentType: () => 'application/json',
      readRawBody: async () => JSON.stringify({ rows, knownResourceCodes: rows.slice(0, 4).map(row => row.inventoryCode) }),
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })

    const response = await handler(target)

    expect(response).toMatchObject({ data: {
      expected: { total: 144, departmentEquipmentRoom: 83, fantasyLab: 61, reservation: 81, inquiry: 63 },
      actual: { total: 144, departmentEquipmentRoom: 83, fantasyLab: 61, reservation: 81, inquiry: 63 },
      duplicateInventoryCodeGroups: [{ inventoryCode: 'CODE-1', sourceRows: [1, 2] }],
      unidentifiedRows: [3],
      quantityCheckRows: [4],
    } })
    if (!('data' in response)) throw new Error('expected data')
    expect(response.data.unmatchedSourceRows).toContain(5)

    const overflow = createValidateEquipmentImportHandler({
      getContentType: () => 'application/json',
      readRawBody: async () => { throw new RequestBodyLimitError() },
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    })
    expect(await overflow(target)).toMatchObject({ error: { code: 'EQUIPMENT_IMPORT_INVALID' } })
  })
})
