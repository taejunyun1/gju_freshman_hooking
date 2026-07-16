import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { adminFacultyWriteSchema } from '../../shared/schemas/admin-faculty'
import { trackLabels } from '../../shared/types/domain'
import {
  createAdminFacultyService,
  createSupabaseAdminFacultyDependencies,
  parseAdminFacultyListQuery,
} from '../../server/modules/admin/faculty'
import { recommendFaculty } from '../../server/modules/matching/faculty'

type LocalRuntime = { apiUrl: string, databaseContainer: string, secretKey: string }

const localRuntime = (): LocalRuntime => {
  const status = JSON.parse(execFileSync(
    'pnpm', ['exec', 'supabase', 'status', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )) as { API_URL?: unknown, SECRET_KEY?: unknown, SERVICE_ROLE_KEY?: unknown }
  const apiUrl = status.API_URL
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
  if (typeof apiUrl !== 'string' || typeof secretKey !== 'string') throw new Error('LOCAL_FACULTY_RUNTIME_REQUIRED')
  const url = new URL(apiUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('LOCAL_FACULTY_REMOTE_URL_REJECTED')
  }
  const projectId = readFileSync('supabase/config.toml', 'utf8')
    .match(/^project_id = "([a-z0-9-]+)"$/mu)?.[1]
  if (!projectId) throw new Error('LOCAL_FACULTY_RUNTIME_REQUIRED')
  return { apiUrl, databaseContainer: `supabase_db_${projectId}`, secretKey }
}

const runSql = (runtime: LocalRuntime, sql: string) => execFileSync(
  'docker', [
    'exec', '-i', runtime.databaseContainer,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atq',
  ],
  { encoding: 'utf8', input: sql },
).trim()

const mutationRelevantTables = [
  'faculty',
  'faculty_tags',
  'faculty_specialist_links',
  'counseling_requests',
  'counseling_faculty_recommendations',
  'audit_events',
] as const

const fingerprint = async (client: SupabaseClient) => {
  const values: Record<string, string> = {}
  for (const table of mutationRelevantTables) {
    const { data, error } = await client.from(table).select('*').order('id', { ascending: true })
    if (error) throw new Error(`LOCAL_FACULTY_FINGERPRINT_${table.toUpperCase()}_FAILED`)
    values[table] = createHash('sha256').update(JSON.stringify(data ?? [])).digest('hex')
  }
  return values
}

describe('local administrator faculty preview', () => {
  it('uses the real PostgREST adapter without changing six mutation-relevant tables and pages timestamp ties', async () => {
    const runtime = localRuntime()
    const client = createClient(runtime.apiUrl, runtime.secretKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    })
    const original = JSON.parse(runSql(runtime, `
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', id, 'status', status, 'weeklyCapacity', weekly_capacity,
          'updatedAt', updated_at
        ) order by id
      )::text
      from public.faculty;
    `)) as Array<{
      id: number
      status: 'draft' | 'active' | 'archived'
      updatedAt: string
      weeklyCapacity: number
    }>
    const preSetupFingerprint = await fingerprint(client)
    let testError: unknown
    let cleanupError: unknown

    try {
      runSql(runtime, `
        update public.faculty
        set status = 'active',
            weekly_capacity = case when consultation_role = 'primary' then 10 else 0 end;
      `)
      const adapter = createSupabaseAdminFacultyDependencies(client)
      const service = createAdminFacultyService({
        ...adapter,
        now: () => new Date('2026-07-16T00:00:00.000Z'),
        recommendFaculty,
      })
      const target = await adapter.loadFaculty({ id: 2 })
      if (target === null) throw new Error('LOCAL_FACULTY_TARGET_MISSING')
      const {
        id: _id,
        status: _status,
        openAssignedCount: _openAssignedCount,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...candidateWrite
      } = target
      const write = adminFacultyWriteSchema.parse({
        ...candidateWrite,
        tags: candidateWrite.tags
          .filter(tag => tag.category !== 'track' || tag.key in trackLabels)
          .map(tag => ({
            ...tag,
            isPrimary: false,
            label: tag.category === 'track'
              ? trackLabels[tag.key as keyof typeof trackLabels]
              : tag.label,
          })),
      })
      const before = await fingerprint(client)

      const preview = await service.preview(target.id, write)
      expect(preview.scenarios).toHaveLength(4)

      const first = await service.list(parseAdminFacultyListQuery({ limit: '2' }))
      expect(first.items).toHaveLength(2)
      expect(first.nextCursor).not.toBeNull()
      expect(new Set(first.items.map(item => item.updatedAt)).size).toBe(1)
      const second = await service.list(parseAdminFacultyListQuery({
        cursor: first.nextCursor!, limit: '2',
      }))
      expect(second.items).toHaveLength(2)
      expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(4)
      expect(second.items.every(item => item.updatedAt === first.items[0]!.updatedAt)).toBe(true)

      expect(await fingerprint(client)).toEqual(before)
    }
    catch (error) { testError = error }
    finally {
      try {
        const values = original.map((row) => {
          if (!Number.isSafeInteger(row.id) || row.id < 1
            || !['draft', 'active', 'archived'].includes(row.status)
            || !Number.isInteger(row.weeklyCapacity) || row.weeklyCapacity < 0
            || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}:\d{2}$/u.test(row.updatedAt)) {
            throw new Error('LOCAL_FACULTY_RESTORE_SNAPSHOT_INVALID')
          }
          return `(${row.id}, '${row.status}', ${row.weeklyCapacity}, '${row.updatedAt}'::timestamptz)`
        }).join(',')
        runSql(runtime, `
          update public.faculty as faculty
          set status = original.status,
              weekly_capacity = original.weekly_capacity,
              updated_at = original.updated_at
          from (values ${values}) as original(id, status, weekly_capacity, updated_at)
          where faculty.id = original.id;
        `)
        expect(await fingerprint(client)).toEqual(preSetupFingerprint)
      }
      catch (error) { cleanupError = error }
    }
    if (cleanupError) throw cleanupError
    if (testError) throw testError
  }, 30_000)
})
