import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  expectedCommercialMatchingFixtureSummary,
  installCommercialMatchingFixture,
} from '../e2e/support/commercial-matching-fixture'

const databaseContainer = 'supabase_db_photo-next-mvp'

const sql = (statement: string): string => execFileSync('docker', [
  'exec', '-i', databaseContainer, 'psql', '-X', '-Atq',
  '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
], {
  encoding: 'utf8',
  input: statement,
  stdio: ['pipe', 'pipe', 'pipe'],
}).trim()

const mutableState = (): string => sql(String.raw`
select jsonb_build_object(
  'resources', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'status', status,
      'priority', priority,
      'metadata', metadata,
      'updatedAt', updated_at
    ) order by id)
    from public.resources
  ), '[]'::jsonb),
  'faculty', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'status', status,
      'weeklyCapacity', weekly_capacity,
      'lastVerifiedAt', last_verified_at,
      'updatedAt', updated_at
    ) order by id)
    from public.faculty
  ), '[]'::jsonb)
)::text;
`)

describe('commercial matching fixture lifecycle', () => {
  it('restores the exact prior resource and faculty state after successful use', () => {
    const before = mutableState()
    const fixture = installCommercialMatchingFixture()

    expect(fixture.summary).toEqual(expectedCommercialMatchingFixtureSummary)
    expect(mutableState()).not.toBe(before)

    fixture.cleanup()
    fixture.cleanup()
    expect(mutableState()).toBe(before)
  }, 20_000)

  it('restores the exact prior state when installation aborts after mutation', () => {
    const before = mutableState()

    expect(() => installCommercialMatchingFixture({
      afterMutation: () => {
        throw new Error('forced commercial fixture failure')
      },
    })).toThrow('forced commercial fixture failure')

    expect(mutableState()).toBe(before)
  }, 20_000)
})
