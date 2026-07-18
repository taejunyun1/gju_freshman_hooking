import { execFileSync } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  provisionLocalRosterStudent,
  type LocalRosterStudentFixture,
} from '../e2e/support/local-roster-student-fixture'

const databaseContainer = 'supabase_db_photo-next-mvp'
const ownedCycleId = '10000000-0000-4000-8000-000000000031'
const phone = '01099993131'

const secret = (label: string): string => createHash('sha256')
  .update(`photo-next-e2e-${label}-v1`)
  .digest('base64url')

const sql = (statement: string, tuplesOnly = false): string => execFileSync('docker', [
  'exec', '-i', databaseContainer, 'psql', '-X', ...(tuplesOnly ? ['-Atq'] : []),
  '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
], {
  encoding: 'utf8',
  input: statement,
  stdio: ['pipe', 'pipe', 'pipe'],
}).trim()

const currentCycle = (): string => sql(String.raw`
select id::text from public.admission_cycles where status = 'current' limit 1;
`, true)

const phoneHmac = createHmac('sha256', Buffer.from(secret('phone-hmac'), 'base64url'))
  .update(`phone-lookup-v1\0${phone}`, 'utf8')
  .digest('hex')
const ownedNickname = `visual-e2e-${phoneHmac.slice(0, 20)}`

const cleanupOwnedState = (): void => {
  sql(String.raw`
begin;
delete from public.prospects
where nickname = '${ownedNickname}'
  and phone_hmac = pg_catalog.decode('${phoneHmac}', 'hex')
  and is_test = true;
delete from public.admission_cycles
where id = '${ownedCycleId}'::uuid
  and not exists (select 1 from public.prospects where admission_cycle_id = '${ownedCycleId}'::uuid);
commit;
`)
}

describe('local roster student fixture lifecycle', () => {
  const fixtures: LocalRosterStudentFixture[] = []
  let ownsCurrentCycle = false

  beforeAll(() => {
    process.env.NUXT_NAME_HMAC_KEY = secret('name-hmac')
    process.env.NUXT_PHONE_HMAC_KEY = secret('phone-hmac')
    process.env.NUXT_PHONE_ENCRYPTION_KEY = secret('phone-encryption')
    process.env.NUXT_PASSWORD_PEPPER = secret('password-pepper')
    process.env.NUXT_PASSWORD_PEPPER_VERSION = '1'
  })

  beforeEach(() => {
    fixtures.length = 0
    ownsCurrentCycle = false
    cleanupOwnedState()
    expect(sql(String.raw`select count(*) from public.prospects
where nickname = '${ownedNickname}'
  and phone_hmac = pg_catalog.decode('${phoneHmac}', 'hex');`, true)).toBe('0')
  })

  afterEach(() => {
    for (const fixture of fixtures.reverse()) fixture.cleanup()
    if (ownsCurrentCycle) cleanupOwnedState()
  })

  const ensureCurrentCycle = (): string => {
    const existing = currentCycle()
    if (existing !== '') return existing
    sql(String.raw`
insert into public.admission_cycles(id, year, status, roster_version, password_key_version, archived_at)
select '${ownedCycleId}'::uuid, candidate_year, 'current', 7, 1, null
from pg_catalog.generate_series(2199, 2020, -1) candidate_year
where not exists (select 1 from public.admission_cycles existing where existing.year = candidate_year)
order by candidate_year desc
limit 1;
`)
    ownsCurrentCycle = true
    return ownedCycleId
  }

  it('reuses the existing current admission cycle without changing it', () => {
    const cycleId = ensureCurrentCycle()
    const before = sql(String.raw`
select id, year, status, roster_version, password_key_version, archived_at is null
from public.admission_cycles where id = '${cycleId}'::uuid;
`, true)

    const fixture = provisionLocalRosterStudent(phone)
    fixtures.push(fixture)

    const after = sql(String.raw`
select id, year, status, roster_version, password_key_version, archived_at is null
from public.admission_cycles where id = '${cycleId}'::uuid;
`, true)
    expect(after).toBe(before)
    expect(sql("select count(*) from public.admission_cycles where status = 'current';", true)).toBe('1')
  }, 15_000)

  it('removes only its prospect and preserves the reused cycle during repeated cleanup', () => {
    const cycleId = ensureCurrentCycle()
    const before = sql(String.raw`
select id, year, status, roster_version, password_key_version, archived_at is null
from public.admission_cycles where id = '${cycleId}'::uuid;
`, true)
    const fixture = provisionLocalRosterStudent(phone)
    fixtures.push(fixture)
    expect(sql("select count(*) from public.prospects where nickname like 'visual-e2e-%';", true)).toBe('1')

    fixture.cleanup()
    fixture.cleanup()

    expect(sql("select count(*) from public.prospects where nickname like 'visual-e2e-%';", true)).toBe('0')
    expect(sql(String.raw`
select id, year, status, roster_version, password_key_version, archived_at is null
from public.admission_cycles where id = '${cycleId}'::uuid;
`, true)).toBe(before)
  }, 15_000)

  it('cleans its temporary cycle when a test body fails and finally runs', () => {
    expect(currentCycle()).toBe('')

    expect(() => {
      const fixture = provisionLocalRosterStudent(phone)
      try {
        throw new Error('forced visual assertion failure')
      }
      finally {
        fixture.cleanup()
      }
    }).toThrow('forced visual assertion failure')

    expect(currentCycle()).toBe('')
    expect(sql("select count(*) from public.prospects where nickname like 'visual-e2e-%';", true)).toBe('0')
  }, 15_000)

  it('cleans its inserted prospect and temporary cycle when verification aborts', () => {
    expect(currentCycle()).toBe('')

    expect(() => provisionLocalRosterStudent(phone, {
      beforeVerification: () => {
        throw new Error('forced verification failure')
      },
    })).toThrow('forced verification failure')

    expect(currentCycle()).toBe('')
    expect(sql("select count(*) from public.prospects where nickname like 'visual-e2e-%';", true)).toBe('0')
  }, 15_000)
})
