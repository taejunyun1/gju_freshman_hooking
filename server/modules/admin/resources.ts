import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  adminEquipmentInventoryItemSchema,
  adminEquipmentInventoryUpdateSchema,
  adminResourceSchema,
  adminResourceStatusSchema,
  adminResourceTransitionSchema,
  adminResourceTypeSchema,
  adminResourceVisibilitySchema,
  adminResourceWriteSchema,
  type AdminEquipmentInventoryItem,
  type AdminEquipmentInventoryUpdate,
  type AdminResource,
  type AdminResourceWrite,
} from '../../../shared/schemas/admin-resources'
import { AppError, InventoryConflictError, ResourceConflictError } from '../../utils/app-error'
import { getServerSupabaseClient } from '../../utils/supabase'
import { base64urlEncode } from '../../utils/web-crypto'

const safeIdSchema = z.number().int().positive().safe()
const timestampSchema = z.iso.datetime({ offset: true }).max(40)
const timestampInstantPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u
const timestampInstantToken = (value: string): string => {
  const match = timestampInstantPattern.exec(value)
  if (!match) throw new Error('ADMIN_RESOURCE_TIMESTAMP_INVALID')
  const wholeSecond = Date.parse(`${match[1]}${match[3]}`)
  if (!Number.isFinite(wholeSecond)) throw new Error('ADMIN_RESOURCE_TIMESTAMP_INVALID')
  return `${wholeSecond / 1000}:${(match[2] ?? '').replace(/0+$/u, '')}`
}
const sameResourceVersion = (left: string, right: string): boolean => (
  timestampInstantToken(left) === timestampInstantToken(right)
)
const storedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim())
  .refine(value => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
  }))

const storedResourceSchema = adminResourceSchema

export type StoredAdminResource = z.infer<typeof storedResourceSchema>

const rawResourceRowSchema = z.object({
  id: safeIdSchema,
  type: adminResourceTypeSchema,
  title: storedText(200),
  summary: storedText(1000),
  connection_template: storedText(1000),
  status: adminResourceStatusSchema,
  visibility: adminResourceVisibilitySchema,
  priority: z.number().int().min(0).max(32767),
  source_date: z.iso.date().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  image_path: z.string().min(1).max(512).nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  resource_tags: z.array(z.object({
    tag_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
    weight: z.number().int().min(0).max(3),
    is_primary: z.boolean(),
  }).strict()).min(1).max(100),
  matching_tags: z.array(z.object({
    tag_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  }).strict()).min(1).max(100).optional(),
}).strict()

export const decodeAdminResourceRow = (input: unknown): StoredAdminResource => {
  try {
    const row = rawResourceRowSchema.parse(input)
    return storedResourceSchema.parse({
      id: row.id,
      type: row.type,
      title: row.title,
      summary: row.summary,
      connectionTemplate: row.connection_template,
      status: row.status,
      visibility: row.visibility,
      priority: row.priority,
      sourceDate: row.source_date,
      metadata: row.metadata,
      imagePath: row.image_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tags: row.resource_tags.map(tag => ({
        key: tag.tag_key,
        weight: tag.weight,
        isPrimary: tag.is_primary,
      })),
    })
  }
  catch {
    throw new Error('ADMIN_RESOURCE_STORE_INVALID')
  }
}

const rawInventoryRowSchema = z.object({
  id: safeIdSchema,
  equipment_resource_id: safeIdSchema,
  inventory_code: storedText(100),
  source_row: z.number().int().min(1).max(1_000_000),
  location_key: z.enum(['department_equipment_room', 'fantasy_lab']),
  access_mode: z.enum(['reservation', 'inquiry']),
  availability_state: z.enum(['available', 'unavailable', 'unknown']),
  note: storedText(1000).nullable(),
  data_quality_status: z.enum(['verified', 'duplicate_code', 'unidentified', 'quantity_check']),
  source_date: z.iso.date(),
  updated_at: timestampSchema,
}).strict()

export const decodeAdminEquipmentInventoryRow = (input: unknown): AdminEquipmentInventoryItem => {
  try {
    const row = rawInventoryRowSchema.parse(input)
    return adminEquipmentInventoryItemSchema.parse({
      id: row.id,
      equipmentResourceId: row.equipment_resource_id,
      inventoryCode: row.inventory_code,
      sourceRow: row.source_row,
      locationKey: row.location_key,
      accessMode: row.access_mode,
      availabilityState: row.availability_state,
      note: row.note,
      dataQualityStatus: row.data_quality_status,
      sourceDate: row.source_date,
      updatedAt: row.updated_at,
    })
  }
  catch {
    throw new Error('ADMIN_RESOURCE_INVENTORY_STORE_INVALID')
  }
}

const cursorSchema = z.object({ updatedAt: timestampSchema, id: safeIdSchema }).strict()
export type AdminResourcesCursor = z.infer<typeof cursorSchema>

export const encodeAdminResourcesCursor = (input: AdminResourcesCursor): string => (
  base64urlEncode(new TextEncoder().encode(JSON.stringify(cursorSchema.parse(input))))
)

const decodeCursor = (encoded: string): AdminResourcesCursor => {
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
    if (encodeAdminResourcesCursor(parsed) !== encoded) throw new Error('INVALID_CURSOR')
    return parsed
  }
  catch {
    throw new Error('INVALID_CURSOR')
  }
}

const boundedQuery = z.string().trim().min(1).max(100).refine(value => [...value].every((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint > 0x1F && (codePoint < 0x7F || codePoint > 0x9F)
}))
const listQuerySchema = z.object({
  query: boundedQuery.optional(),
  type: adminResourceTypeSchema.optional(),
  status: adminResourceStatusSchema.optional(),
  visibility: adminResourceVisibilitySchema.optional(),
  tag: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u).optional(),
  sourceDateFrom: z.iso.date().optional(),
  sourceDateTo: z.iso.date().optional(),
  limit: z.string().regex(/^[1-9][0-9]?$/u).transform(Number).pipe(z.number().int().min(1).max(50)).default(20),
  cursor: z.string().min(1).max(200).transform((value, context) => {
    try {
      return decodeCursor(value)
    }
    catch {
      context.addIssue({ code: 'custom', message: 'invalid cursor' })
      return z.NEVER
    }
  }).optional(),
}).strict().superRefine((query, context) => {
  if (query.sourceDateFrom && query.sourceDateTo && query.sourceDateFrom > query.sourceDateTo) {
    context.addIssue({ code: 'custom', path: ['sourceDateTo'], message: 'reversed bounds' })
  }
})

export type AdminResourcesListInput = z.infer<typeof listQuerySchema>

export const parseAdminResourcesListQuery = (input: unknown): AdminResourcesListInput => {
  const parsed = listQuerySchema.safeParse(input)
  if (!parsed.success) throw new AppError('RESOURCE_INVALID')
  return parsed.data
}

export const parseAdminResourceId = (input: string | undefined): number => {
  const parsed = z.string().regex(/^[1-9][0-9]{0,15}$/u).transform(Number)
    .pipe(safeIdSchema).safeParse(input)
  if (!parsed.success) throw new AppError('RESOURCE_INVALID')
  return parsed.data
}

export const parseAdminResourceWrite = (input: unknown): AdminResourceWrite => {
  const parsed = adminResourceWriteSchema.safeParse(input)
  if (!parsed.success) throw new AppError('RESOURCE_INVALID')
  return parsed.data
}

export const parseAdminResourceTransition = (input: unknown): { expectedUpdatedAt: string } => {
  const parsed = adminResourceTransitionSchema.safeParse(input)
  if (!parsed.success) throw new AppError('RESOURCE_INVALID')
  return parsed.data
}

export const parseAdminResourceUpdate = (input: unknown): {
  expectedUpdatedAt: string
  resource: AdminResourceWrite
} => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new AppError('RESOURCE_INVALID')
  const { expectedUpdatedAt, ...resource } = input as Record<string, unknown>
  const version = timestampSchema.safeParse(expectedUpdatedAt)
  if (!version.success) throw new AppError('RESOURCE_INVALID')
  return { expectedUpdatedAt: version.data, resource: parseAdminResourceWrite(resource) }
}

export const parseAdminResourceInventoryUpdate = (input: unknown): AdminEquipmentInventoryUpdate => {
  const parsed = adminEquipmentInventoryUpdateSchema.safeParse(input)
  if (!parsed.success) throw new AppError('RESOURCE_INVALID')
  return parsed.data
}

export const parseAdminResourceJsonBody = async (
  contentType: string | undefined,
  rawBody: string | undefined,
): Promise<unknown> => {
  if (!contentType || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8\s*)?$/iu.test(contentType) || rawBody === undefined) {
    throw new AppError('RESOURCE_INVALID')
  }
  if (new TextEncoder().encode(rawBody).byteLength > 1_048_576) throw new AppError('RESOURCE_INVALID')
  try {
    return JSON.parse(rawBody) as unknown
  }
  catch {
    throw new AppError('RESOURCE_INVALID')
  }
}

type ResourceMutationContext = { adminUserId: string, requestId: string }
type StoreListInput = Omit<AdminResourcesListInput, 'limit'> & { limit: number }
type ResourceRecordInput = Omit<AdminResourceWrite, 'tags'>

export type AdminResourcesServiceDependencies = {
  listResources: (input: StoreListInput) => Promise<StoredAdminResource[]>
  loadResource: (input: { id: number }) => Promise<StoredAdminResource | null>
  listInventory: (input: { resourceId: number }) => Promise<AdminEquipmentInventoryItem[]>
  updateInventoryItem: (input: ResourceMutationContext & {
    resourceId: number
    itemId: number
    input: AdminEquipmentInventoryUpdate
  }) => Promise<
    | { kind: 'updated', item: AdminEquipmentInventoryItem, resourceUpdatedAt: string }
    | { kind: 'conflict', current: AdminEquipmentInventoryItem }
  >
  createResource: (input: ResourceMutationContext & {
    resource: ResourceRecordInput
    tags: AdminResourceWrite['tags']
  }) => Promise<StoredAdminResource>
  updateResource: (input: ResourceMutationContext & {
    id: number
    expectedUpdatedAt: string
    resource: ResourceRecordInput
    tags: AdminResourceWrite['tags']
  }) => Promise<{ kind: 'updated', resource: StoredAdminResource } | { kind: 'conflict', current: StoredAdminResource }>
  transitionResource: (input: ResourceMutationContext & {
    id: number
    expectedUpdatedAt: string
    status: 'active' | 'archived'
    changedFields: ['status']
  }) => Promise<
    | { kind: 'updated', resource: StoredAdminResource }
    | { kind: 'conflict', current: StoredAdminResource }
  >
  attachImage: (input: ResourceMutationContext & {
    id: number
    expectedUpdatedAt: string
    imagePath: string
  }) => Promise<{
    kind: 'committed'
    resourceId: number
    previousImagePath: string | null
    committedUpdatedAt: string
  }>
  uploadImage: (input: { path: string, bytes: Uint8Array, mimeType: string }) => Promise<void>
  removeImages: (paths: string[]) => Promise<void>
  randomId: () => string
}

const parseStoredResource = (input: unknown): StoredAdminResource => {
  const parsed = storedResourceSchema.safeParse(input)
  if (!parsed.success) throw new Error('ADMIN_RESOURCE_STORE_INVALID')
  return parsed.data
}

const parseInventory = (input: unknown, resourceId: number): AdminEquipmentInventoryItem[] => {
  const parsed = z.array(adminEquipmentInventoryItemSchema).max(1000).safeParse(input)
  if (!parsed.success || parsed.data.some(item => item.equipmentResourceId !== resourceId)) {
    throw new Error('ADMIN_RESOURCE_INVENTORY_STORE_INVALID')
  }
  return parsed.data
}

const withInventoryTruth = (
  resource: StoredAdminResource,
  inventory: AdminEquipmentInventoryItem[],
): AdminResource => {
  const parsed = parseStoredResource(resource)
  if (parsed.type !== 'equipment') return adminResourceSchema.parse(parsed)
  const { confirmedQuantity: _ignoredQuantity, ...metadata } = parsed.metadata
  return adminResourceSchema.parse({
    ...parsed,
    metadata: {
      ...metadata,
      confirmedQuantity: inventory.filter(item => item.dataQualityStatus === 'verified').length,
    },
  })
}

const publicResource = async (
  dependencies: AdminResourcesServiceDependencies,
  resource: StoredAdminResource,
) => {
  let current = parseStoredResource(resource)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (current.type !== 'equipment') return { resource: current, inventory: [] }
    const inventory = parseInventory(
      await dependencies.listInventory({ resourceId: current.id }),
      current.id,
    )
    const reloadedRaw = await dependencies.loadResource({ id: current.id })
    if (reloadedRaw === null) throw new AppError('RESOURCE_NOT_FOUND')
    const reloaded = parseStoredResource(reloadedRaw)
    if (reloaded.id !== current.id) throw new Error('ADMIN_RESOURCE_STORE_INVALID')
    if (sameResourceVersion(current.updatedAt, reloaded.updatedAt)) {
      return { resource: withInventoryTruth(reloaded, inventory), inventory }
    }
    current = reloaded
  }
  throw new Error('ADMIN_RESOURCE_SNAPSHOT_UNSTABLE')
}

const loadResource = async (dependencies: AdminResourcesServiceDependencies, id: number) => {
  const raw = await dependencies.loadResource({ id })
  if (raw === null) throw new AppError('RESOURCE_NOT_FOUND')
  const resource = parseStoredResource(raw)
  if (resource.id !== id) throw new Error('ADMIN_RESOURCE_STORE_INVALID')
  return resource
}

const assertExpectedResourceVersion = (
  resource: AdminResource,
  expectedUpdatedAt: string,
): void => {
  if (sameResourceVersion(resource.updatedAt, expectedUpdatedAt)) return
  throw new ResourceConflictError(resource)
}

const splitWrite = (write: AdminResourceWrite) => {
  const { tags, ...resource } = write
  return { resource, tags }
}

const archiveSeedKey = (metadata: unknown): string | null => {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null
  const candidate = metadata as { archive?: unknown, seedKey?: unknown }
  if (typeof candidate.archive !== 'object' || candidate.archive === null || Array.isArray(candidate.archive)) {
    return null
  }
  return typeof candidate.seedKey === 'string' ? candidate.seedKey : ''
}

const assertArchiveIdentityPreserved = (
  current: StoredAdminResource,
  next: AdminResourceWrite,
): void => {
  const currentSeedKey = archiveSeedKey(current.metadata)
  if (currentSeedKey === null) return
  if (currentSeedKey === '' || archiveSeedKey(next.metadata) !== currentSeedKey) {
    throw new AppError('RESOURCE_ARCHIVE_IDENTITY_REQUIRED')
  }
}

const assertPublishable = (
  resource: StoredAdminResource,
  inventory: AdminEquipmentInventoryItem[],
) => {
  if (!resource.sourceDate) throw new AppError('RESOURCE_SOURCE_REQUIRED')
  if (resource.tags.filter(tag => tag.isPrimary).length !== 1) {
    throw new AppError('RESOURCE_PRIMARY_TAG_REQUIRED')
  }
  const archive = 'archive' in resource.metadata ? resource.metadata.archive : undefined
  if (archive && !new Set<string>(['snapshot', 'recurring', 'historical']).has(archive.evidenceStatus)) {
    throw new AppError('RESOURCE_ARCHIVE_VERIFICATION_REQUIRED')
  }
  if (resource.type === 'course') {
    const metadata = resource.metadata
    if (
      !Number.isInteger(metadata.academic_year)
      || typeof metadata.grade_year !== 'number' || metadata.grade_year < 1 || metadata.grade_year > 4
      || typeof metadata.term !== 'string' || metadata.term.trim() === ''
      || typeof metadata.credits !== 'number' || !Number.isInteger(metadata.credits)
      || metadata.credits < 0 || metadata.credits > 30
      || typeof metadata.goal !== 'string' || metadata.goal.trim() === ''
    ) throw new AppError('COURSE_METADATA_REQUIRED')
  }
  if (resource.type === 'student_work') {
    const metadata = resource.metadata
    if (typeof metadata.consent_at !== 'string' || !timestampSchema.safeParse(metadata.consent_at).success) {
      throw new AppError('WORK_CONSENT_REQUIRED')
    }
    if (
      !resource.imagePath
      || typeof metadata.image_alt !== 'string'
      || metadata.image_alt.trim() === ''
    ) throw new AppError('WORK_MEDIA_REQUIRED')
    if (
      typeof metadata.related_course !== 'string' || metadata.related_course.trim() === ''
      || typeof metadata.related_year !== 'number' || !Number.isInteger(metadata.related_year)
      || metadata.related_year < 1 || metadata.related_year > 4
      || typeof metadata.related_track !== 'string' || metadata.related_track.trim() === ''
    ) throw new AppError('WORK_RELATION_REQUIRED')
  }
  if (resource.type === 'equipment' && !inventory.some(item => item.dataQualityStatus === 'verified')) {
    throw new AppError('EQUIPMENT_INVENTORY_UNVERIFIED')
  }
  if (resource.type === 'facility') {
    const note = resource.metadata.operation_note ?? resource.metadata.operationNote
    const verifiedAt = resource.metadata.last_verified_at ?? resource.metadata.lastVerifiedAt
    if (
      typeof note !== 'string' || note.trim() === ''
      || typeof verifiedAt !== 'string' || !timestampSchema.safeParse(verifiedAt).success
    ) throw new AppError('FACILITY_OPERATION_UNVERIFIED')
  }
}

const detectedImageMimeType = (bytes: Uint8Array): string | null => {
  if (
    bytes.byteLength >= 3
    && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
  ) return 'image/jpeg'
  if (
    bytes.byteLength >= 8
    && [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
      .every((value, index) => bytes[index] === value)
  ) return 'image/png'
  if (
    bytes.byteLength >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  ) return 'image/webp'
  return null
}

export const createAdminResourcesService = (dependencies: AdminResourcesServiceDependencies) => ({
  list: async (input: AdminResourcesListInput) => {
    const { limit, ...filters } = input
    const stored = await dependencies.listResources({ ...filters, limit: limit + 1 })
    if (!Array.isArray(stored) || stored.length > limit + 1) throw new Error('ADMIN_RESOURCE_STORE_INVALID')
    const page = stored.slice(0, limit).map(parseStoredResource)
    const items = await Promise.all(page.map(async resource => (
      (await publicResource(dependencies, resource)).resource
    )))
    const boundary = stored.length > limit ? page.at(-1) : undefined
    return {
      items,
      nextCursor: boundary
        ? encodeAdminResourcesCursor({ updatedAt: boundary.updatedAt, id: boundary.id })
        : null,
    }
  },
  detail: async (id: number) => publicResource(dependencies, await loadResource(dependencies, id)),
  create: async (write: AdminResourceWrite, context: ResourceMutationContext) => {
    const created = parseStoredResource(await dependencies.createResource({ ...splitWrite(write), ...context }))
    return publicResource(dependencies, created)
  },
  update: async (id: number, input: { expectedUpdatedAt: string, resource: AdminResourceWrite }, context: ResourceMutationContext) => {
    const current = await loadResource(dependencies, id)
    if (sameResourceVersion(current.updatedAt, input.expectedUpdatedAt)) {
      assertArchiveIdentityPreserved(current, input.resource)
    }
    const result = await dependencies.updateResource({ id, expectedUpdatedAt: input.expectedUpdatedAt, ...splitWrite(input.resource), ...context })
    if (result.kind === 'conflict') {
      const current = await publicResource(dependencies, parseStoredResource(result.current))
      throw new ResourceConflictError(current.resource)
    }
    return publicResource(dependencies, parseStoredResource(result.resource))
  },
  updateInventory: async (
    resourceId: number,
    itemId: number,
    input: AdminEquipmentInventoryUpdate,
    context: ResourceMutationContext,
  ) => {
    const outcome = await dependencies.updateInventoryItem({ resourceId, itemId, input, ...context })
    if (outcome.kind === 'conflict') throw new InventoryConflictError(outcome.current)
    const resourceUpdatedAt = timestampSchema.safeParse(outcome.resourceUpdatedAt)
    if (!resourceUpdatedAt.success) throw new Error('ADMIN_RESOURCE_INVENTORY_STORE_INVALID')
    return {
      item: adminEquipmentInventoryItemSchema.parse(outcome.item),
      resourceUpdatedAt: resourceUpdatedAt.data,
    }
  },
  publish: async (id: number, expectedUpdatedAt: string, context: ResourceMutationContext) => {
    const current = await publicResource(dependencies, await loadResource(dependencies, id))
    assertExpectedResourceVersion(current.resource, expectedUpdatedAt)
    assertPublishable(current.resource, current.inventory)
    const transition = await dependencies.transitionResource({
      id, expectedUpdatedAt, status: 'active', changedFields: ['status'], ...context,
    })
    if (transition.kind === 'conflict') {
      const current = await publicResource(dependencies, parseStoredResource(transition.current))
      throw new ResourceConflictError(current.resource)
    }
    const published = parseStoredResource(transition.resource)
    const committed = await publicResource(dependencies, published)
    if (!sameResourceVersion(published.updatedAt, committed.resource.updatedAt)) {
      throw new ResourceConflictError(committed.resource)
    }
    return committed
  },
  archive: async (id: number, expectedUpdatedAt: string, context: ResourceMutationContext) => {
    const current = await publicResource(dependencies, await loadResource(dependencies, id))
    assertExpectedResourceVersion(current.resource, expectedUpdatedAt)
    const transition = await dependencies.transitionResource({
      id, expectedUpdatedAt, status: 'archived', changedFields: ['status'], ...context,
    })
    if (transition.kind === 'conflict') {
      const current = await publicResource(dependencies, parseStoredResource(transition.current))
      throw new ResourceConflictError(current.resource)
    }
    const archived = parseStoredResource(transition.resource)
    const committed = await publicResource(dependencies, archived)
    if (!sameResourceVersion(archived.updatedAt, committed.resource.updatedAt)) {
      throw new ResourceConflictError(committed.resource)
    }
    return committed
  },
  uploadImage: async (
    id: number,
    image: { bytes: Uint8Array, mimeType: string },
    context: ResourceMutationContext,
  ) => {
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    }
    const extension = extensions[image.mimeType]
    if (
      !extension
      || !(image.bytes instanceof Uint8Array)
      || detectedImageMimeType(image.bytes) !== image.mimeType
    ) {
      throw new AppError('RESOURCE_IMAGE_INVALID')
    }
    if (image.bytes.byteLength > 8 * 1024 * 1024) throw new AppError('RESOURCE_IMAGE_TOO_LARGE')
    const current = await loadResource(dependencies, id)
    const imagePath = `resources/${id}/${dependencies.randomId()}.${extension}`
    try {
      await dependencies.uploadImage({ path: imagePath, bytes: image.bytes, mimeType: image.mimeType })
    }
    catch {
      throw new AppError('RESOURCE_IMAGE_UPLOAD_FAILED')
    }
    let committed: Awaited<ReturnType<AdminResourcesServiceDependencies['attachImage']>>
    try {
      committed = await dependencies.attachImage({
        id, imagePath, expectedUpdatedAt: current.updatedAt, ...context,
      })
    }
    catch (error) {
      try {
        await dependencies.removeImages([imagePath])
      }
      catch {
        // The stable public failure remains the DB attach failure; orphan cleanup is retriable operationally.
      }
      if (error instanceof AppError) throw error
      throw new AppError('RESOURCE_IMAGE_UPLOAD_FAILED')
    }
    if (
      committed.resourceId !== id
      || committed.previousImagePath !== current.imagePath
      || !timestampSchema.safeParse(committed.committedUpdatedAt).success
    ) throw new Error('ADMIN_RESOURCE_IMAGE_COMMIT_INVALID')
    if (committed.previousImagePath?.startsWith(`resources/${id}/`) && committed.previousImagePath !== imagePath) {
      try {
        await dependencies.removeImages([committed.previousImagePath])
      }
      catch {
        // A stale previous object is safer than deleting the newly attached object.
      }
    }
    const attached = await loadResource(dependencies, id)
    if (attached.imagePath !== imagePath || attached.updatedAt !== committed.committedUpdatedAt) {
      throw new Error('ADMIN_RESOURCE_IMAGE_RELOAD_INVALID')
    }
    return publicResource(dependencies, attached)
  },
})

const resourceSelection = `
  id,type,title,summary,connection_template,status,visibility,priority,source_date,
  metadata,image_path,created_at,updated_at,
  resource_tags(tag_key,weight,is_primary)
`
const inventorySelection = `
  id,equipment_resource_id,inventory_code,source_row,location_key,access_mode,
  availability_state,note,data_quality_status,source_date,updated_at
`

const escapeLikePattern = (value: string): string => value
  .replaceAll('\\', '\\\\')
  .replaceAll('%', '\\%')
  .replaceAll('_', '\\_')

const quotePostgrestValue = (value: string): string => (
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
)

const storeError = (): never => { throw new Error('ADMIN_RESOURCE_STORE_FAILED') }

const resourceMutationErrorCodeSchema = z.enum([
  'RESOURCE_INVALID',
  'RESOURCE_SOURCE_REQUIRED',
  'RESOURCE_PRIMARY_TAG_REQUIRED',
  'RESOURCE_ARCHIVE_VERIFICATION_REQUIRED',
  'RESOURCE_ARCHIVE_IDENTITY_REQUIRED',
  'COURSE_METADATA_REQUIRED',
  'WORK_CONSENT_REQUIRED',
  'WORK_MEDIA_REQUIRED',
  'WORK_RELATION_REQUIRED',
  'EQUIPMENT_INVENTORY_UNVERIFIED',
  'FACILITY_OPERATION_UNVERIFIED',
])
const mutationOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('updated') }).strict(),
  z.object({ status: z.literal('conflict') }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('validation_error'), code: resourceMutationErrorCodeSchema }).strict(),
])
const transitionOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('updated'), resourceUpdatedAt: timestampSchema }).strict(),
  z.object({ status: z.literal('conflict'), resourceUpdatedAt: timestampSchema }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('validation_error'), code: resourceMutationErrorCodeSchema }).strict(),
])
const attachOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('committed'),
    resourceId: safeIdSchema,
    previousImagePath: z.string().min(1).max(512).nullable(),
    committedUpdatedAt: timestampSchema,
  }).strict(),
  z.object({ status: z.literal('conflict') }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('validation_error'), code: resourceMutationErrorCodeSchema }).strict(),
])
const inventoryMutationOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('updated'),
    item: rawInventoryRowSchema,
    resourceUpdatedAt: timestampSchema,
  }).strict(),
  z.object({ status: z.literal('conflict'), current: rawInventoryRowSchema }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({
    status: z.literal('validation_error'),
    code: z.enum(['RESOURCE_INVALID', 'EQUIPMENT_INVENTORY_UNVERIFIED']),
  }).strict(),
])

const throwMutationOutcome = (outcome: z.infer<typeof mutationOutcomeSchema>): never => {
  if (outcome.status === 'not_found') throw new AppError('RESOURCE_NOT_FOUND')
  if (outcome.status === 'validation_error') throw new AppError(outcome.code)
  if (outcome.status === 'conflict') throw new AppError('RESOURCE_CONFLICT')
  return storeError()
}

export const createSupabaseAdminResourcesDependencies = (
  client: SupabaseClient,
): AdminResourcesServiceDependencies => {
  const adapter: AdminResourcesServiceDependencies = {
    listResources: async (input) => {
      const selection = input.tag === undefined
        ? resourceSelection
        : `${resourceSelection},matching_tags:resource_tags!inner(tag_key)`
      let query = client.from('resources').select(selection)
      if (input.query !== undefined) {
        const pattern = quotePostgrestValue(`%${escapeLikePattern(input.query)}%`)
        query = query.or(`title.ilike.${pattern},summary.ilike.${pattern}`)
      }
      if (input.type !== undefined) query = query.eq('type', input.type)
      if (input.status !== undefined) query = query.eq('status', input.status)
      if (input.visibility !== undefined) query = query.eq('visibility', input.visibility)
      if (input.tag !== undefined) query = query.eq('matching_tags.tag_key', input.tag)
      if (input.sourceDateFrom !== undefined) query = query.gte('source_date', input.sourceDateFrom)
      if (input.sourceDateTo !== undefined) query = query.lte('source_date', input.sourceDateTo)
      if (input.cursor !== undefined) {
        query = query.or(`updated_at.lt.${input.cursor.updatedAt},and(updated_at.eq.${input.cursor.updatedAt},id.lt.${input.cursor.id})`)
      }
      const { data, error } = await query.order('updated_at', { ascending: false })
        .order('id', { ascending: false }).limit(input.limit)
      if (error) storeError()
      return (data ?? []).map(decodeAdminResourceRow)
    },
    loadResource: async ({ id }) => {
      const { data, error } = await client.from('resources').select(resourceSelection).eq('id', id).maybeSingle()
      if (error) storeError()
      return data === null ? null : decodeAdminResourceRow(data)
    },
    listInventory: async ({ resourceId }) => {
      const { data, error } = await client.from('equipment_inventory_items').select(inventorySelection)
        .eq('equipment_resource_id', resourceId).order('source_row', { ascending: true }).order('id', { ascending: true })
      if (error) storeError()
      return (data ?? []).map(decodeAdminEquipmentInventoryRow)
    },
    updateInventoryItem: async (input) => {
      const { data, error } = await client.rpc('update_admin_resource_inventory', {
        p_admin_user_id: input.adminUserId,
        p_expected_updated_at: input.input.expectedUpdatedAt,
        p_inventory_item_id: input.itemId,
        p_inventory_resource_id: input.resourceId,
        p_request_id: input.requestId,
        p_update: {
          inventoryCode: input.input.inventoryCode,
          locationKey: input.input.locationKey,
          accessMode: input.input.accessMode,
          availabilityState: input.input.availabilityState,
          note: input.input.note,
          dataQualityStatus: input.input.dataQualityStatus,
        },
      })
      if (error) storeError()
      const outcome = inventoryMutationOutcomeSchema.safeParse(data)
      if (!outcome.success) return storeError()
      if (outcome.data.status === 'not_found') throw new AppError('RESOURCE_NOT_FOUND')
      if (outcome.data.status === 'validation_error') throw new AppError(outcome.data.code)
      return outcome.data.status === 'updated'
        ? {
            kind: 'updated',
            item: decodeAdminEquipmentInventoryRow(outcome.data.item),
            resourceUpdatedAt: outcome.data.resourceUpdatedAt,
          }
        : { kind: 'conflict', current: decodeAdminEquipmentInventoryRow(outcome.data.current) }
    },
    createResource: async (input) => {
      const { data, error } = await client.rpc('create_admin_resource', {
        p_admin_user_id: input.adminUserId,
        p_request_id: input.requestId,
        p_resource: input.resource,
        p_tags: input.tags,
      })
      if (error || typeof data !== 'number') storeError()
      const created = await adapter.loadResource({ id: data })
      if (created === null) storeError()
      return parseStoredResource(created)
    },
    updateResource: async (input) => {
      const { data, error } = await client.rpc('update_admin_resource', {
        p_admin_user_id: input.adminUserId,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_request_id: input.requestId,
        p_resource_id: input.id,
        p_resource: input.resource,
        p_tags: input.tags,
      })
      if (error) storeError()
      const outcome = mutationOutcomeSchema.safeParse(data)
      if (!outcome.success) return storeError()
      if (outcome.data.status === 'not_found' || outcome.data.status === 'validation_error') {
        throwMutationOutcome(outcome.data)
      }
      const current = await adapter.loadResource({ id: input.id })
      if (current === null) throw new AppError('RESOURCE_NOT_FOUND')
      return outcome.data.status === 'updated'
        ? { kind: 'updated', resource: current }
        : { kind: 'conflict', current }
    },
    transitionResource: async (input) => {
      const { data, error } = await client.rpc('transition_admin_resource', {
        p_admin_user_id: input.adminUserId,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_request_id: input.requestId,
        p_resource_id: input.id,
        p_status: input.status,
      })
      if (error) storeError()
      const outcome = transitionOutcomeSchema.safeParse(data)
      if (!outcome.success) return storeError()
      if (outcome.data.status === 'not_found' || outcome.data.status === 'validation_error') {
        throwMutationOutcome(outcome.data)
      }
      const current = await adapter.loadResource({ id: input.id })
      if (current === null) throw new AppError('RESOURCE_NOT_FOUND')
      return outcome.data.status === 'updated'
        && sameResourceVersion(current.updatedAt, outcome.data.resourceUpdatedAt)
        ? { kind: 'updated', resource: current }
        : { kind: 'conflict', current }
    },
    attachImage: async (input) => {
      const { data, error } = await client.rpc('attach_admin_resource_image', {
        p_admin_user_id: input.adminUserId,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_image_path: input.imagePath,
        p_request_id: input.requestId,
        p_resource_id: input.id,
      })
      if (error) storeError()
      const outcome = attachOutcomeSchema.safeParse(data)
      if (!outcome.success) return storeError()
      if (outcome.data.status === 'not_found') throw new AppError('RESOURCE_NOT_FOUND')
      if (outcome.data.status === 'validation_error') throw new AppError(outcome.data.code)
      if (outcome.data.status === 'conflict') throw new AppError('RESOURCE_CONFLICT')
      return {
        kind: 'committed',
        resourceId: outcome.data.resourceId,
        previousImagePath: outcome.data.previousImagePath,
        committedUpdatedAt: outcome.data.committedUpdatedAt,
      }
    },
    uploadImage: async ({ path, bytes, mimeType }) => {
      const { error } = await client.storage.from('resource-images').upload(path, bytes, {
        contentType: mimeType,
        upsert: false,
      })
      if (error) throw new Error('ADMIN_RESOURCE_IMAGE_STORE_FAILED')
    },
    removeImages: async (paths) => {
      if (paths.length === 0) return
      const { error } = await client.storage.from('resource-images').remove(paths)
      if (error) throw new Error('ADMIN_RESOURCE_IMAGE_REMOVE_FAILED')
    },
    randomId: () => crypto.randomUUID(),
  }
  return adapter
}

export const getServerAdminResourcesService = () => (
  createAdminResourcesService(createSupabaseAdminResourcesDependencies(getServerSupabaseClient()))
)

const equipmentImportRowSchema = z.object({
  sourceRow: z.number().int().min(1).max(1_000_000),
  name: storedText(200),
  inventoryCode: storedText(100),
  locationKey: z.enum(['department_equipment_room', 'fantasy_lab']),
  category: storedText(100),
  accessMode: z.enum(['reservation', 'inquiry']),
  availabilityState: z.enum(['available', 'unavailable', 'unknown']),
  note: storedText(1000).nullable(),
  dataQualityStatus: z.enum(['verified', 'duplicate_code', 'unidentified', 'quantity_check']),
  sourceDate: z.iso.date(),
  tags: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)).min(1).max(30),
}).strict()

const equipmentImportSchema = z.object({
  rows: z.array(equipmentImportRowSchema).min(1).max(500),
  knownResourceCodes: z.array(storedText(100)).max(1000).default([]),
}).strict()

export const validateEquipmentImport = (input: unknown) => {
  const parsed = equipmentImportSchema.safeParse(input)
  if (!parsed.success) throw new AppError('EQUIPMENT_IMPORT_INVALID')
  const rows = parsed.data.rows
  const byCode = new Map<string, number[]>()
  rows.forEach((row) => {
    byCode.set(row.inventoryCode, [...(byCode.get(row.inventoryCode) ?? []), row.sourceRow])
  })
  const known = new Set(parsed.data.knownResourceCodes)
  return {
    expected: { total: 144, departmentEquipmentRoom: 83, fantasyLab: 61, reservation: 81, inquiry: 63 },
    actual: {
      total: rows.length,
      departmentEquipmentRoom: rows.filter(row => row.locationKey === 'department_equipment_room').length,
      fantasyLab: rows.filter(row => row.locationKey === 'fantasy_lab').length,
      reservation: rows.filter(row => row.accessMode === 'reservation').length,
      inquiry: rows.filter(row => row.accessMode === 'inquiry').length,
    },
    duplicateInventoryCodeGroups: [...byCode.entries()]
      .filter(([, sourceRows]) => sourceRows.length > 1)
      .map(([inventoryCode, sourceRows]) => ({ inventoryCode, sourceRows })),
    unidentifiedRows: rows.filter(row => row.dataQualityStatus === 'unidentified').map(row => row.sourceRow),
    quantityCheckRows: rows.filter(row => row.dataQualityStatus === 'quantity_check').map(row => row.sourceRow),
    unmatchedSourceRows: rows.filter(row => !known.has(row.inventoryCode)).map(row => row.sourceRow),
  }
}
