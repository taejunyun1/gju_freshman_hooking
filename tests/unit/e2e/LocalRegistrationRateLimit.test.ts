import { describe, expect, it, vi } from 'vitest'

import {
  clearLocalRegistrationRateLimitBuckets,
  REGISTER_ROUTE,
  type LocalRegistrationRateLimitAdapter,
} from '../../e2e/support/local-registration-rate-limit'

const localAdapter = (
  overrides: Partial<LocalRegistrationRateLimitAdapter> = {},
): LocalRegistrationRateLimitAdapter => ({
  executeSql: vi.fn(),
  inspectContainer: vi.fn(() => 'true'),
  readProjectId: vi.fn(() => 'photo-next-mvp'),
  readSupabaseStatus: vi.fn(() => ({ API_URL: 'http://127.0.0.1:54321' })),
  ...overrides,
})

describe('local E2E registration rate-limit isolation', () => {
  it('deletes only the exact registration route through a parameterized local SQL call', () => {
    const adapter = localAdapter()

    clearLocalRegistrationRateLimitBuckets(adapter)

    expect(adapter.inspectContainer).toHaveBeenCalledWith('supabase_db_photo-next-mvp')
    expect(adapter.executeSql).toHaveBeenCalledOnce()
    expect(adapter.executeSql).toHaveBeenCalledWith(
      'supabase_db_photo-next-mvp',
      "delete from public.rate_limit_buckets where route = :'route';",
      { route: REGISTER_ROUTE },
    )
    expect(REGISTER_ROUTE).toBe('/api/student/register')
  })

  it.each([
    'https://project.supabase.co',
    'http://127.0.0.1.example.com:54321',
    'http://localhost@example.com:54321',
    'https://127.0.0.1:54321',
  ])('rejects a nonlocal or misleading Supabase API URL before inspecting Docker: %s', (apiUrl) => {
    const adapter = localAdapter({ readSupabaseStatus: vi.fn(() => ({ API_URL: apiUrl })) })

    expect(() => clearLocalRegistrationRateLimitBuckets(adapter)).toThrow('LOCAL_SUPABASE_RUNTIME_REQUIRED')
    expect(adapter.inspectContainer).not.toHaveBeenCalled()
    expect(adapter.executeSql).not.toHaveBeenCalled()
  })

  it.each([
    { projectId: '../photo-next', running: 'true' },
    { projectId: 'photo_next', running: 'true' },
    { projectId: 'photo-next-mvp', running: 'false' },
  ])('rejects an invalid project or stopped exact container before SQL: $projectId / $running', ({ projectId, running }) => {
    const adapter = localAdapter({
      inspectContainer: vi.fn(() => running),
      readProjectId: vi.fn(() => projectId),
    })

    expect(() => clearLocalRegistrationRateLimitBuckets(adapter)).toThrow('LOCAL_SUPABASE_RUNTIME_REQUIRED')
    expect(adapter.executeSql).not.toHaveBeenCalled()
  })
})
