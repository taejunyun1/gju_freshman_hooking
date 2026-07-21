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
  parseAdminResourceJsonBody,
  parseAdminResourceWrite,
  type AdminResourcesServiceDependencies,
} from '../../../server/modules/admin/resources'
import { AppError } from '../../../server/utils/app-error'
import { RequestBodyLimitError } from '../../../server/utils/bounded-request-body'
import { equipmentCategories } from '../../../shared/types/result'

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
    requirement_type: 'major_elective',
  },
  imagePath: null,
  createdAt,
  updatedAt,
  tags: [{ key: 'photography', weight: 3, isPrimary: true }],
  ...overrides,
})

const rawResourceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  type: 'course',
  title: '사진영상학개론',
  summary: '사진과 영상의 기초를 익힙니다.',
  connection_template: '{interest}를 {title}에서 실현합니다.',
  status: 'draft',
  visibility: 'public',
  priority: 10,
  source_date: '2026-07-14',
  metadata: {
    academic_year: 2026,
    grade_year: 1,
    term: '1학기',
    credits: 3,
    goal: '촬영 기초를 익힌다.',
    requirement_type: 'major_elective',
  },
  image_path: null,
  created_at: createdAt,
  updated_at: updatedAt,
  resource_tags: [{ tag_key: 'photography', weight: 3, is_primary: true }],
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
  transitionResource: vi.fn(async input => ({
    kind: 'updated' as const,
    resource: storedResource({ status: input.status }),
  })),
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
    requirement_type: 'major_elective',
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

const archiveCareerWrite = () => ({
  ...courseWrite(),
  type: 'career' as const,
  sourceDate: '2025-11-06',
  tags: [
    { key: 'video', weight: 3, isPrimary: true },
    { key: 'news', weight: 2, isPrimary: false },
  ],
  metadata: {
    seedKey: 'archive:career:park_jinwoo',
    archive: {
      sourceUrl: 'https://gjphoto94.notion.site/2a163cb8bb55800c9057c4973527db76?source=copy_link',
      sourcePageTitle: '졸업생 인터뷰',
      sourceLastEditedDate: '2025-11-06',
      evidenceStatus: 'snapshot',
      trackEvidence: ['video', 'documentary'],
      interestEvidence: ['news', 'field', 'drone'],
      verificationNote: '인터뷰 본문에만 직무가 있어 body_only 상태로 보존합니다.',
    },
    publicName: '박진우',
    graduationYear: 2022,
    graduationYearStatus: 'confirmed',
    graduationYearCandidates: [],
    roleAtSource: '영상 촬영 기자',
    roleCandidates: [],
    roleStatus: 'body_only',
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

  it('decodes and lists a legacy noncanonical stored equipment category without weakening writes', async () => {
    const legacyRow = rawResourceRow({
      type: 'equipment',
      metadata: {
        category: 'Body',
        locationKey: 'department_equipment_room',
        locationLabel: '기자재실',
        accessMode: 'inquiry',
        accessLabel: '문의 전용',
      },
    })
    expect(decodeAdminResourceRow(legacyRow)).toMatchObject({
      type: 'equipment',
      metadata: { category: 'Body' },
    })

    const rows = [legacyRow, rawResourceRow({ id: 41 })]
    const query = {
      limit: () => query,
      order: () => query,
      select: () => query,
      then: <Result>(resolve: (value: { data: unknown[], error: null }) => Result | PromiseLike<Result>) => (
        Promise.resolve({ data: rows, error: null }).then(resolve)
      ),
    }
    const adapter = createSupabaseAdminResourcesDependencies({ from: () => query } as never)
    await expect(adapter.listResources({ limit: 21 })).resolves.toHaveLength(2)

    expect(() => parseAdminResourceWrite({
      ...equipmentWrite(),
      metadata: { ...equipmentWrite().metadata, category: 'Body' },
    })).toThrowError(new AppError('RESOURCE_INVALID'))

    for (const metadata of [
      { category: '' },
      { category: ' Body' },
      { category: 'B'.repeat(101) },
      { category: 'Body', confirmedQuantity: 100_001 },
    ]) {
      expect(() => decodeAdminResourceRow(rawResourceRow({ type: 'equipment', metadata })))
        .toThrow('ADMIN_RESOURCE_STORE_INVALID')
    }
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
  it('accepts only the exact JSON media type with at most one UTF-8 charset parameter', async () => {
    await expect(parseAdminResourceJsonBody('application/json', '{}')).resolves.toEqual({})
    await expect(parseAdminResourceJsonBody('Application/JSON; Charset=UTF-8', '{}')).resolves.toEqual({})

    for (const contentType of [
      'application/jsonp',
      'application/json.evil',
      'application/json; charset=utf-8; charset=utf-8',
      'application/json; profile=admin',
      'application/json; charset=utf-16',
    ]) {
      await expect(parseAdminResourceJsonBody(contentType, '{}'))
        .rejects.toThrowError(new AppError('RESOURCE_INVALID'))
    }
  })

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

  it('accepts only the six canonical equipment categories at the admin write boundary', () => {
    for (const category of equipmentCategories) {
      expect(parseAdminResourceWrite({
        ...equipmentWrite(),
        metadata: { ...equipmentWrite().metadata, category },
      }).metadata).toMatchObject({ category })
    }
    const { category: _category, ...legacyMetadata } = equipmentWrite().metadata
    expect(parseAdminResourceWrite({
      ...equipmentWrite(),
      metadata: legacyMetadata,
    }).metadata).not.toHaveProperty('category')
    expect(() => parseAdminResourceWrite({
      ...equipmentWrite(),
      metadata: { ...equipmentWrite().metadata, category: 'Body' },
    })).toThrowError(new AppError('RESOURCE_INVALID'))
  })

  it('accepts only the two official course requirement classifications', () => {
    for (const requirement_type of ['major_required', 'major_elective'] as const) {
      expect(parseAdminResourceWrite({
        ...courseWrite(),
        metadata: { ...courseWrite().metadata, requirement_type },
      }).metadata).toMatchObject({ requirement_type })
    }
    expect(() => parseAdminResourceWrite({
      ...courseWrite(),
      metadata: { ...courseWrite().metadata, requirement_type: 'required' },
    })).toThrowError(new AppError('RESOURCE_INVALID'))
  })

  it('strictly round-trips bounded archive evidence and accepts HTTPS sources only', () => {
    expect(parseAdminResourceWrite(archiveCareerWrite())).toEqual(archiveCareerWrite())

    expect(() => parseAdminResourceWrite({
      ...archiveCareerWrite(),
      tags: [
        { key: 'news', weight: 3, isPrimary: true },
        { key: 'video', weight: 2, isPrimary: false },
      ],
    })).toThrowError(new AppError('RESOURCE_INVALID'))

    expect(() => parseAdminResourceWrite({
      ...archiveCareerWrite(),
      tags: [{ key: 'video', weight: 3, isPrimary: true }],
    })).toThrowError(new AppError('RESOURCE_INVALID'))

    expect(() => parseAdminResourceWrite({
      ...archiveCareerWrite(),
      sourceDate: '2025-11-07',
    })).toThrowError(new AppError('RESOURCE_INVALID'))

    expect(() => parseAdminResourceWrite({
      ...archiveCareerWrite(),
      metadata: {
        ...archiveCareerWrite().metadata,
        archive: {
          ...archiveCareerWrite().metadata.archive,
          sourceUrl: 'http://gjphoto94.notion.site/alumni',
        },
      },
    })).toThrowError(new AppError('RESOURCE_INVALID'))

    expect(() => parseAdminResourceWrite({
      ...archiveCareerWrite(),
      metadata: { ...archiveCareerWrite().metadata, privateEmail: 'student@example.com' },
    })).toThrowError(new AppError('RESOURCE_INVALID'))

    const archiveFacilityWrite = {
      ...courseWrite(),
      type: 'facility',
      sourceDate: '2025-05-05',
      tags: [
        { key: 'video', weight: 3, isPrimary: true },
        { key: 'studio', weight: 2, isPrimary: false },
      ],
      metadata: {
        seedKey: 'archive:facility:studio_c_video',
        facilityKey: 'studio_c_video',
        facilityType: '영상 촬영 스튜디오',
        activities: ['영상·인터뷰 촬영 후보'],
        exampleCourses: ['영상 인터뷰 내러티브 워크숍'],
        operation_note: null,
        last_verified_at: null,
        supportingEvidence: true,
        archive: {
          sourceUrl: 'https://gjuphoto.com/facilities/',
          sourcePageTitle: '학과 시설 및 기자재',
          sourceLastEditedDate: '2025-05-05',
          evidenceStatus: 'verify_required',
          trackEvidence: ['video', 'commercial'],
          interestEvidence: ['studio', 'interview'],
          verificationNote: '세부 사양과 현재 운영 상태를 확인해야 합니다.',
        },
      },
    } as const
    expect(parseAdminResourceWrite(archiveFacilityWrite)).toMatchObject({ type: 'facility' })
    expect(() => parseAdminResourceWrite({
      ...archiveFacilityWrite,
      metadata: { ...archiveFacilityWrite.metadata, supportingEvidence: false },
    })).toThrowError(new AppError('RESOURCE_INVALID'))

    expect(decodeAdminResourceRow(rawResourceRow({
      type: 'career',
      source_date: archiveCareerWrite().sourceDate,
      metadata: archiveCareerWrite().metadata,
      resource_tags: archiveCareerWrite().tags.map(tag => ({
        tag_key: tag.key, weight: tag.weight, is_primary: tag.isPrimary,
      })),
    }))).toMatchObject({ type: 'career', metadata: archiveCareerWrite().metadata })
    expect(() => decodeAdminResourceRow(rawResourceRow({
      type: 'career',
      source_date: archiveCareerWrite().sourceDate,
      metadata: archiveCareerWrite().metadata,
      resource_tags: [
        { tag_key: 'news', weight: 3, is_primary: true },
        { tag_key: 'video', weight: 2, is_primary: false },
      ],
    }))).toThrow('ADMIN_RESOURCE_STORE_INVALID')
  })

  it.each(['marker removal', 'seed key change'] as const)(
    'blocks archive identity mutation in the service before the update dependency: %s',
    async (mutation) => {
      const write = archiveCareerWrite()
      const current = storedResource({
        ...write,
        metadata: {
          ...write.metadata,
          archive: { ...write.metadata.archive, evidenceStatus: 'verify_required' },
        },
      })
      const updateResource = vi.fn(async () => ({
        kind: 'updated' as const,
        resource: storedResource({ ...write, metadata: {} }),
      }))
      const next = {
        ...write,
        metadata: mutation === 'marker removal'
          ? {}
          : { ...write.metadata, seedKey: 'archive:career:changed_identity' },
      }

      await expect(createAdminResourcesService(dependencies({
        loadResource: vi.fn(async () => current),
        updateResource,
      })).update(42, { expectedUpdatedAt: updatedAt, resource: next }, {
        adminUserId: admin.userId,
        requestId,
      })).rejects.toMatchObject({ code: 'RESOURCE_ARCHIVE_IDENTITY_REQUIRED', statusCode: 422 })
      expect(updateResource).not.toHaveBeenCalled()
    },
  )

  it('allows a reviewed archive evidence-state update when its marker and seed key remain unchanged', async () => {
    const next = archiveCareerWrite()
    const current = storedResource({
      ...next,
      metadata: {
        ...next.metadata,
        archive: { ...next.metadata.archive, evidenceStatus: 'verify_required' },
      },
    })
    const updateResource = vi.fn(async () => ({
      kind: 'updated' as const,
      resource: storedResource(next),
    }))

    const updated = await createAdminResourcesService(dependencies({
      loadResource: vi.fn(async () => current),
      updateResource,
    })).update(42, { expectedUpdatedAt: updatedAt, resource: next }, {
      adminUserId: admin.userId,
      requestId,
    })

    expect(updated.resource.metadata).toEqual(next.metadata)
    expect(updateResource).toHaveBeenCalledOnce()
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

    const identityAdapter = createSupabaseAdminResourcesDependencies({
      rpc: vi.fn(async () => ({
        data: { status: 'validation_error', code: 'RESOURCE_ARCHIVE_IDENTITY_REQUIRED' },
        error: null,
      })),
    } as never)
    await expect(identityAdapter.updateResource({
      id: 42,
      expectedUpdatedAt: updatedAt,
      resource: record,
      tags,
      adminUserId: admin.userId,
      requestId,
    })).rejects.toMatchObject({ code: 'RESOURCE_ARCHIVE_IDENTITY_REQUIRED', statusCode: 422 })

    const publishAdapter = createSupabaseAdminResourcesDependencies({
      rpc: vi.fn(async () => ({
        data: { status: 'validation_error', code: 'COURSE_METADATA_REQUIRED' },
        error: null,
      })),
    } as never)
    await expect(publishAdapter.transitionResource({
      id: 42,
      expectedUpdatedAt: updatedAt,
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
    ['publish', createPublishAdminResourceHandler],
    ['archive', createArchiveAdminResourceHandler],
  ] as const)('requires a strict bounded optimistic-lock body before %s', async (_label, createHandler) => {
    const malformedBodies = [
      { contentType: 'application/json', body: undefined },
      { contentType: 'application/json', body: 'null' },
      { contentType: 'application/json', body: '{}' },
      { contentType: 'application/json', body: JSON.stringify({ expectedUpdatedAt: updatedAt, extra: true }) },
      { contentType: 'text/plain', body: JSON.stringify({ expectedUpdatedAt: updatedAt }) },
    ]

    for (const malformed of malformedBodies) {
      const transitionResource = vi.fn(async input => ({
        kind: 'updated' as const,
        resource: storedResource({ status: input.status }),
      }))
      const target = event()
      const handler = createHandler({
        resources: createAdminResourcesService(dependencies({ transitionResource })),
        getContentType: () => malformed.contentType,
        getParam: () => '42',
        readRawBody: async () => malformed.body,
        requireAdmin: async () => admin,
        ...responseDependencies(target),
      } as never)

      expect(await handler(target)).toMatchObject({ error: { code: 'RESOURCE_INVALID' } })
      expect(transitionResource).not.toHaveBeenCalled()
    }

    const transitionResource = vi.fn(async input => ({
      kind: 'updated' as const,
      resource: storedResource({ status: input.status }),
    }))
    const target = event()
    const oversized = createHandler({
      resources: createAdminResourcesService(dependencies({ transitionResource })),
      getContentType: () => 'application/json',
      getParam: () => '42',
      readRawBody: async () => { throw new RequestBodyLimitError() },
      requireAdmin: async () => admin,
      ...responseDependencies(target),
    } as never)
    expect(await oversized(target)).toMatchObject({ error: { code: 'RESOURCE_INVALID' } })
    expect(transitionResource).not.toHaveBeenCalled()
  })

  it.each([
    ['publish', 'active', createPublishAdminResourceHandler],
    ['archive', 'archived', createArchiveAdminResourceHandler],
  ] as const)('passes expectedUpdatedAt into the atomic %s transition', async (_label, status, createHandler) => {
    const transitionResource = vi.fn(async input => ({
      kind: 'updated' as const,
      resource: storedResource({ status: input.status }),
    }))
    const target = event()
    const handler = createHandler({
      resources: createAdminResourcesService(dependencies({ transitionResource: transitionResource as never })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies({ expectedUpdatedAt: updatedAt }),
      ...responseDependencies(target),
    } as never)

    expect(await handler(target)).toMatchObject({ data: { resource: { status } } })
    expect(transitionResource).toHaveBeenCalledWith({
      id: 42,
      expectedUpdatedAt: updatedAt,
      status,
      adminUserId: admin.userId,
      requestId,
      changedFields: ['status'],
    })
  })

  it('blocks verify-required archive evidence until an administrator changes it to a publishable state', async () => {
    const archiveWrite = archiveCareerWrite()
    const verifyRequired = storedResource({
      type: archiveWrite.type,
      title: archiveWrite.title,
      sourceDate: archiveWrite.sourceDate,
      visibility: archiveWrite.visibility,
      tags: archiveWrite.tags,
      metadata: {
        ...archiveWrite.metadata,
        archive: { ...archiveWrite.metadata.archive, evidenceStatus: 'verify_required' },
      },
    })
    const blockedTransition = vi.fn(async () => ({
      kind: 'updated' as const,
      resource: storedResource({ status: 'active' }),
    }))
    const blockedTarget = event()
    const blockedHandler = createPublishAdminResourceHandler({
      resources: createAdminResourcesService(dependencies({
        loadResource: vi.fn(async () => verifyRequired),
        transitionResource: blockedTransition,
      })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies({ expectedUpdatedAt: updatedAt }),
      ...responseDependencies(blockedTarget),
    })

    expect(await blockedHandler(blockedTarget)).toMatchObject({ error: {
      code: 'RESOURCE_ARCHIVE_VERIFICATION_REQUIRED',
    } })
    expect(blockedTarget.status).toBe(422)
    expect(blockedTransition).not.toHaveBeenCalled()

    const reviewed = storedResource({
      ...verifyRequired,
      metadata: {
        ...verifyRequired.metadata,
        archive: { ...verifyRequired.metadata.archive, evidenceStatus: 'snapshot' },
      },
    })
    const reviewedTransition = vi.fn(async () => ({
      kind: 'updated' as const,
      resource: storedResource({ ...reviewed, status: 'active', updatedAt: '2026-07-15T03:00:00.000Z' }),
    }))
    const published = await createAdminResourcesService(dependencies({
      loadResource: vi.fn(async () => reviewed),
      transitionResource: reviewedTransition,
    })).publish(42, updatedAt, { adminUserId: admin.userId, requestId })

    expect(published.resource.status).toBe('active')
    expect(reviewedTransition).toHaveBeenCalledOnce()
  })

  it.each([
    ['publish', 'active'] as const,
    ['archive', 'archived'] as const,
  ])('treats an equivalent offset timestamp as the same optimistic instant for %s', async (method, status) => {
    const transitionResource = vi.fn(async input => ({
      kind: 'updated' as const,
      resource: storedResource({ status: input.status }),
    }))
    const service = createAdminResourcesService(dependencies({ transitionResource }))
    const equivalentOffset = '2026-07-15T11:00:00+09:00'

    const response = method === 'publish'
      ? await service.publish(42, equivalentOffset, { adminUserId: admin.userId, requestId })
      : await service.archive(42, equivalentOffset, { adminUserId: admin.userId, requestId })

    expect(response.resource.status).toBe(status)
    expect(transitionResource).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: equivalentOffset,
    }))
  })

  it.each([
    ['publish', createPublishAdminResourceHandler],
    ['archive', createArchiveAdminResourceHandler],
  ] as const)('returns a strict current public DTO when a stale %s loses the lock', async (_label, createHandler) => {
    const current = storedResource({ title: '다른 관리자가 먼저 전환함', updatedAt: '2026-07-15T03:00:00.000Z' })
    const target = event()
    const handler = createHandler({
      resources: createAdminResourcesService(dependencies({
        transitionResource: vi.fn(async () => ({ kind: 'conflict' as const, current })) as never,
      })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies({ expectedUpdatedAt: updatedAt }),
      ...responseDependencies(target),
    } as never)

    const response = await handler(target)

    expect(target.status).toBe(409)
    expect(response).toMatchObject({ error: {
      code: 'RESOURCE_CONFLICT',
      current: { id: 42, title: '다른 관리자가 먼저 전환함', updatedAt: '2026-07-15T03:00:00.000Z' },
    } })
    expect(JSON.stringify(response)).not.toContain('connection_template')
  })

  it.each([
    ['publish', createPublishAdminResourceHandler],
    ['archive', createArchiveAdminResourceHandler],
  ] as const)('prioritizes the loaded version conflict before %s validation and the RPC race check', async (_label, createHandler) => {
    const current = storedResource({
      metadata: {},
      title: '최신 본은 아직 게시 검증 전',
      updatedAt: '2026-07-15T03:00:00.000Z',
    })
    const transitionResource = vi.fn(async () => ({
      kind: 'updated' as const,
      resource: current,
    }))
    const target = event()
    const handler = createHandler({
      resources: createAdminResourcesService(dependencies({
        loadResource: vi.fn(async () => current),
        transitionResource,
      })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies({ expectedUpdatedAt: updatedAt }),
      ...responseDependencies(target),
    } as never)

    expect(await handler(target)).toMatchObject({ error: {
      code: 'RESOURCE_CONFLICT',
      current: { title: '최신 본은 아직 게시 검증 전', updatedAt: '2026-07-15T03:00:00.000Z' },
    } })
    expect(target.status).toBe(409)
    expect(transitionResource).not.toHaveBeenCalled()
  })

  it('forwards the optimistic version to the transition RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: { status: 'validation_error', code: 'COURSE_METADATA_REQUIRED' },
      error: null,
    }))
    const adapter = createSupabaseAdminResourcesDependencies({ rpc } as never)

    await expect(adapter.transitionResource({
      id: 42,
      expectedUpdatedAt: updatedAt,
      status: 'active',
      changedFields: ['status'],
      adminUserId: admin.userId,
      requestId,
    } as never)).rejects.toMatchObject({ code: 'COURSE_METADATA_REQUIRED' })
    expect(rpc).toHaveBeenCalledWith('transition_admin_resource', {
      p_admin_user_id: admin.userId,
      p_expected_updated_at: updatedAt,
      p_request_id: requestId,
      p_resource_id: 42,
      p_status: 'active',
    })
  })

  it('maps the archive verification RPC outcome to the stable public business error', async () => {
    const adapter = createSupabaseAdminResourcesDependencies({
      rpc: vi.fn(async () => ({
        data: { status: 'validation_error', code: 'RESOURCE_ARCHIVE_VERIFICATION_REQUIRED' },
        error: null,
      })),
    } as never)

    await expect(adapter.transitionResource({
      id: 42,
      expectedUpdatedAt: updatedAt,
      status: 'active',
      changedFields: ['status'],
      adminUserId: admin.userId,
      requestId,
    })).rejects.toMatchObject({ code: 'RESOURCE_ARCHIVE_VERIFICATION_REQUIRED', statusCode: 422 })
  })

  it('strictly requires a locked resource version in updated and conflict transition outcomes', async () => {
    for (const status of ['updated', 'conflict'] as const) {
      const from = vi.fn()
      const adapter = createSupabaseAdminResourcesDependencies({
        from,
        rpc: vi.fn(async () => ({ data: { status }, error: null })),
      } as never)

      await expect(adapter.transitionResource({
        id: 42,
        expectedUpdatedAt: updatedAt,
        status: 'active',
        changedFields: ['status'],
        adminUserId: admin.userId,
        requestId,
      })).rejects.toThrow('ADMIN_RESOURCE_STORE_FAILED')
      expect(from).not.toHaveBeenCalled()
    }
  })

  it('promotes a committed transition to a conflict when the reload has a later version', async () => {
    const committedAt = '2026-07-15T03:00:00.000Z'
    const laterAt = '2026-07-15T04:00:00.000Z'
    const query = {
      eq: () => query,
      maybeSingle: async () => ({ data: rawResourceRow({ updated_at: laterAt, title: '후속 변경' }), error: null }),
      select: () => query,
    }
    const adapter = createSupabaseAdminResourcesDependencies({
      from: vi.fn(() => query),
      rpc: vi.fn(async () => ({
        data: { status: 'updated', resourceUpdatedAt: committedAt },
        error: null,
      })),
    } as never)

    await expect(adapter.transitionResource({
      id: 42,
      expectedUpdatedAt: updatedAt,
      status: 'active',
      changedFields: ['status'],
      adminUserId: admin.userId,
      requestId,
    })).resolves.toMatchObject({
      kind: 'conflict',
      current: { title: '후속 변경', updatedAt: laterAt },
    })
  })

  it.each([
    ['course requirement', storedResource({ metadata: {
      academic_year: 2026, grade_year: 1, term: '1학기', credits: 3, goal: '촬영 기초를 익힌다.',
    } }), 'COURSE_METADATA_REQUIRED'],
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
      ...jsonRequestDependencies({ expectedUpdatedAt: updatedAt }),
      ...responseDependencies(target),
    })
    expect(await handler(target)).toMatchObject({ error: { code } })
  })

  it('counts only verified inventory and publishes through an audited transaction', async () => {
    const draftEquipment = storedResource({ type: 'equipment', metadata: {} })
    const activeEquipment = storedResource({ type: 'equipment', status: 'active', metadata: {} })
    const loadResource = vi.fn()
      .mockResolvedValueOnce(draftEquipment)
      .mockResolvedValueOnce(draftEquipment)
      .mockResolvedValue(activeEquipment)
    const transitionResource = vi.fn(async input => ({
      kind: 'updated' as const,
      resource: storedResource({ type: 'equipment', status: input.status, metadata: {} }),
    }))
    const target = event()
    const handler = createPublishAdminResourceHandler({
      resources: createAdminResourcesService(dependencies({
        loadResource,
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
      ...jsonRequestDependencies({ expectedUpdatedAt: updatedAt }),
      ...responseDependencies(target),
    })
    const response = await handler(target)

    expect(transitionResource).toHaveBeenCalledWith({
      id: 42,
      expectedUpdatedAt: updatedAt,
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
    const transitionResource = vi.fn(async input => ({
      kind: 'updated' as const,
      resource: storedResource({
        type: 'equipment', status: input.status, metadata: { confirmedQuantity: 2 },
      }),
    }))
    const service = createAdminResourcesService(dependencies({
      loadResource: vi.fn(async () => storedResource({ type: 'equipment', metadata: {} })),
      listInventory,
      transitionResource,
    }))

    const response = await service.publish(42, updatedAt, { adminUserId: admin.userId, requestId })

    expect(listInventory).toHaveBeenCalledTimes(2)
    expect(response.resource.metadata).toMatchObject({ confirmedQuantity: 2 })
    expect(response.inventory).toHaveLength(2)
  })

  it('retries resource-inventory-resource reads until an equipment snapshot has one version', async () => {
    const laterAt = '2026-07-15T03:00:00.000Z'
    const loadResource = vi.fn()
      .mockResolvedValueOnce(storedResource({ type: 'equipment', metadata: {}, updatedAt }))
      .mockResolvedValueOnce(storedResource({ type: 'equipment', metadata: {}, updatedAt: laterAt }))
      .mockResolvedValueOnce(storedResource({ type: 'equipment', metadata: {}, updatedAt: laterAt }))
    const listInventory = vi.fn()
      .mockResolvedValueOnce([inventory()])
      .mockResolvedValueOnce([
        inventory({ updatedAt: laterAt }),
        inventory({ id: 2, inventoryCode: 'CAM-002', sourceRow: 2, updatedAt: laterAt }),
      ])
    const service = createAdminResourcesService(dependencies({ loadResource, listInventory }))

    const response = await service.detail(42)

    expect(response.resource.updatedAt).toBe(laterAt)
    expect(response.resource.metadata).toMatchObject({ confirmedQuantity: 2 })
    expect(response.inventory).toHaveLength(2)
    expect(loadResource).toHaveBeenCalledTimes(3)
    expect(listInventory).toHaveBeenCalledTimes(2)
  })

  it('fails closed after three continuously changing equipment snapshot attempts', async () => {
    const versions = [
      updatedAt,
      '2026-07-15T03:00:00.000Z',
      '2026-07-15T04:00:00.000Z',
      '2026-07-15T05:00:00.000Z',
    ]
    const loadResource = vi.fn()
    for (const version of versions) {
      loadResource.mockResolvedValueOnce(storedResource({ type: 'equipment', metadata: {}, updatedAt: version }))
    }
    const listInventory = vi.fn(async () => [inventory()])
    const service = createAdminResourcesService(dependencies({ loadResource, listInventory }))

    await expect(service.detail(42)).rejects.toThrow('ADMIN_RESOURCE_SNAPSHOT_UNSTABLE')
    expect(loadResource).toHaveBeenCalledTimes(4)
    expect(listInventory).toHaveBeenCalledTimes(3)
  })

  it('returns latest strict conflict truth when equipment changes after a successful transition', async () => {
    const committedAt = '2026-07-15T03:00:00.000Z'
    const laterAt = '2026-07-15T04:00:00.000Z'
    const latestInventory = [
      inventory({ updatedAt: laterAt }),
      inventory({ id: 2, inventoryCode: 'CAM-002', sourceRow: 2, updatedAt: laterAt }),
    ]
    const loadResource = vi.fn()
      .mockResolvedValueOnce(storedResource({ type: 'equipment', metadata: {}, updatedAt }))
      .mockResolvedValueOnce(storedResource({ type: 'equipment', metadata: {}, updatedAt }))
      .mockResolvedValueOnce(storedResource({ type: 'equipment', metadata: {}, updatedAt: laterAt }))
      .mockResolvedValueOnce(storedResource({ type: 'equipment', metadata: {}, updatedAt: laterAt }))
    const listInventory = vi.fn()
      .mockResolvedValueOnce([inventory()])
      .mockResolvedValueOnce(latestInventory)
      .mockResolvedValueOnce(latestInventory)
    const transitionResource = vi.fn(async () => ({
      kind: 'updated' as const,
      resource: storedResource({ type: 'equipment', status: 'active', metadata: {}, updatedAt: committedAt }),
    }))
    const service = createAdminResourcesService(dependencies({
      loadResource,
      listInventory,
      transitionResource,
    }))

    await expect(service.publish(42, updatedAt, { adminUserId: admin.userId, requestId }))
      .rejects.toMatchObject({
        code: 'RESOURCE_CONFLICT',
        current: { updatedAt: laterAt, metadata: { confirmedQuantity: 2 } },
      })
  })

  it('archives without deleting and records only changed field names', async () => {
    const transitionResource = vi.fn(async input => ({
      kind: 'updated' as const,
      resource: storedResource({ status: input.status }),
    }))
    const target = event()
    const handler = createArchiveAdminResourceHandler({
      resources: createAdminResourcesService(dependencies({ transitionResource })),
      getParam: () => '42',
      requireAdmin: async () => admin,
      ...jsonRequestDependencies({ expectedUpdatedAt: updatedAt }),
      ...responseDependencies(target),
    })
    await handler(target)
    expect(transitionResource).toHaveBeenCalledWith({
      id: 42,
      expectedUpdatedAt: updatedAt,
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
