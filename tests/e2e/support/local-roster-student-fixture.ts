import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const config = readFileSync('supabase/config.toml', 'utf8')
const projectId = config.match(/^project_id = "([a-z0-9-]+)"$/mu)?.[1]

if (!projectId) throw new Error('로컬 Supabase project_id를 확인할 수 없습니다.')

const databaseContainer = `supabase_db_${projectId}`
const currentCycleId = '00000000-0000-4000-8000-000000000002'

const passwordVersion = (): number => {
  const value = process.env.NUXT_PASSWORD_PEPPER_VERSION
  if (!value || !/^[1-9][0-9]{0,8}$/u.test(value)) {
    throw new Error('E2E NUXT_PASSWORD_PEPPER_VERSION이 올바르지 않습니다.')
  }
  return Number(value)
}

const requireLocalRuntime = (): void => {
  const rawStatus = execFileSync('pnpm', ['exec', 'supabase', 'status', '--output', 'json'], {
    encoding: 'utf8',
  })
  const status = JSON.parse(rawStatus) as { API_URL?: string, DB_URL?: string }

  for (const [name, value] of Object.entries({ API_URL: status.API_URL, DB_URL: status.DB_URL })) {
    if (!value) throw new Error(`로컬 Supabase ${name}을 확인할 수 없습니다.`)
    const hostname = new URL(value).hostname
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
      throw new Error(`시각 QA fixture는 로컬 ${name}만 허용합니다.`)
    }
  }

  const running = execFileSync(
    'docker',
    ['inspect', '--format={{.State.Running}}', databaseContainer],
    { encoding: 'utf8' },
  ).trim()
  if (running !== 'true') throw new Error('허용된 로컬 Supabase DB 컨테이너가 실행 중이 아닙니다.')
}

const secret = (name: 'NUXT_PHONE_HMAC_KEY' | 'NUXT_PASSWORD_PEPPER'): Buffer => {
  const value = process.env[name]
  if (!value) throw new Error(`E2E ${name}이 준비되지 않았습니다.`)
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.byteLength !== 32) throw new Error(`E2E ${name}은 32바이트여야 합니다.`)
  return decoded
}

const digest = (domain: string, value: string, key: Buffer): string => createHmac('sha256', key)
  .update(`${domain}\0${value}`, 'utf8')
  .digest('hex')

const passwordForPhone = (phone: string): string => `${phone.slice(-4)}AA`

export const provisionLocalRosterStudent = (phone: string): { password: string } => {
  if (!/^010\d{8}$/u.test(phone)) throw new Error('E2E fixture 전화번호 형식이 올바르지 않습니다.')
  requireLocalRuntime()

  const password = passwordForPhone(phone)
  const version = passwordVersion()
  const phoneHmac = digest('phone-lookup-v1', phone, secret('NUXT_PHONE_HMAC_KEY'))
  const passwordDigest = digest('password-verify-v1', password, secret('NUXT_PASSWORD_PEPPER'))
  const nickname = `visual-e2e-${phoneHmac.slice(0, 20)}`
  const fixtureSql = String.raw`
begin;
update public.admission_cycles
set status = 'archived', archived_at = pg_catalog.clock_timestamp()
where status = 'current' and id <> '${currentCycleId}'::uuid;

insert into public.admission_cycles(id, year, status, roster_version, password_key_version, archived_at)
values ('${currentCycleId}', 2030, 'current', 0, ${version}, null)
on conflict (id) do update set
  status = 'current',
  roster_version = 0,
  password_key_version = ${version},
  archived_at = null;

with inserted_prospect as (
  insert into public.prospects(
    nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region, admission_cycle_id, is_test
  ) values (
    '${nickname}',
    pg_catalog.decode('${phoneHmac}', 'hex'),
    pg_catalog.decode(repeat('00', 16), 'hex'),
    pg_catalog.decode(repeat('00', 12), 'hex'),
    '로컬 시각 QA 고교', 'high3', 'other', '${currentCycleId}'::uuid, true
  )
  on conflict (phone_hmac) do update set
    nickname = excluded.nickname,
    school_name = excluded.school_name,
    applicant_stage = excluded.applicant_stage,
    region = excluded.region,
    admission_cycle_id = excluded.admission_cycle_id,
    status = 'active',
    is_test = true,
    updated_at = pg_catalog.clock_timestamp()
  returning id
)
insert into public.student_credentials(
  prospect_id, password_hash, password_salt, password_bcrypt, password_generation, failed_attempts, locked_until
)
select
  id,
  pg_catalog.decode(repeat('00', 32), 'hex'),
  pg_catalog.decode(repeat('00', 16), 'hex'),
  extensions.crypt(pg_catalog.encode(pg_catalog.decode('${passwordDigest}', 'hex'), 'hex'), extensions.gen_salt('bf', 10)),
  1, 0, null
from inserted_prospect
on conflict (prospect_id) do update set
  password_bcrypt = excluded.password_bcrypt,
  password_generation = 1,
  failed_attempts = 0,
  locked_until = null,
  password_changed_at = pg_catalog.clock_timestamp(),
  updated_at = pg_catalog.clock_timestamp();
commit;
`

  execFileSync('docker', [
    'exec', '-i', databaseContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ], { encoding: 'utf8', input: fixtureSql, stdio: ['pipe', 'ignore', 'pipe'] })

  const verification = execFileSync('docker', [
    'exec', '-i', databaseContainer, 'psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ], {
    encoding: 'utf8',
    input: String.raw`select exists (
      select 1
      from public.prospects prospect
      join public.student_credentials credential on credential.prospect_id = prospect.id
      join public.admission_cycles cycle on cycle.id = prospect.admission_cycle_id
      where prospect.phone_hmac = pg_catalog.decode('${phoneHmac}', 'hex')
        and prospect.status = 'active'
        and cycle.status = 'current'
        and credential.password_generation = 1
        and extensions.crypt(pg_catalog.encode(pg_catalog.decode('${passwordDigest}', 'hex'), 'hex'), credential.password_bcrypt) = credential.password_bcrypt
    );`,
  }).trim()
  if (verification !== 't') throw new Error('로컬 시각 QA 학생 fixture 검증에 실패했습니다.')

  return { password }
}
