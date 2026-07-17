-- Loaded only after resetting through 202607160021 and before applying
-- 202607170022_admission_roster_expand.sql.
-- It deliberately contains no current cycle or password/credential material.

insert into public.prospects (
  nickname,
  phone_hmac,
  phone_ciphertext,
  phone_iv,
  school_name,
  applicant_stage,
  region,
  status
)
values (
  '연도전환기존지원자',
  decode(repeat('71', 32), 'hex'),
  decode(repeat('72', 16), 'hex'),
  decode(repeat('73', 12), 'hex'),
  '전환검증고등학교',
  'high3',
  'gwangju',
  'active'
);

insert into public.student_sessions (
  prospect_id,
  token_hash,
  expires_at,
  idle_expires_at
)
select
  id,
  decode(repeat('74', 32), 'hex'),
  pg_catalog.clock_timestamp() + interval '1 day',
  pg_catalog.clock_timestamp() + interval '12 hours'
from public.prospects
where nickname = '연도전환기존지원자';

insert into public.student_sessions (
  prospect_id,
  token_hash,
  expires_at,
  idle_expires_at,
  revoked_at
)
select
  id,
  decode(repeat('75', 32), 'hex'),
  timestamptz '2026-07-18 00:00:00+00',
  timestamptz '2026-07-17 12:00:00+00',
  timestamptz '2026-07-16 00:00:00+00'
from public.prospects
where nickname = '연도전환기존지원자';

insert into public.credential_recovery_requests (
  prospect_id,
  status,
  code_hash,
  requested_at,
  expires_at
)
select
  id,
  'requested',
  decode(repeat('76', 32), 'hex'),
  timestamptz '2026-07-16 00:00:00+00',
  timestamptz '2026-07-17 00:00:00+00'
from public.prospects
where nickname = '연도전환기존지원자';
