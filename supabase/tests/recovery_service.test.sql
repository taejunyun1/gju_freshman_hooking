begin;

select plan(14);

select has_function(
  'public',
  'complete_credential_recovery',
  array['bytea', 'bytea', 'bytea'],
  'complete_credential_recovery accepts only hashes and already-derived password material'
);

select ok(
  coalesce((
    select p.prosecdef
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.complete_credential_recovery(bytea,bytea,bytea)')
  ), false),
  'complete_credential_recovery is security definer'
);

select ok(
  exists(
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as setting(value)
    where p.oid = pg_catalog.to_regprocedure('public.complete_credential_recovery(bytea,bytea,bytea)')
      and setting.value = 'search_path=""'
  ),
  'complete_credential_recovery has an empty search path'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'anon',
    pg_catalog.to_regprocedure('public.complete_credential_recovery(bytea,bytea,bytea)'),
    'execute'
  ), false),
  false,
  'anon cannot execute complete_credential_recovery'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    pg_catalog.to_regprocedure('public.complete_credential_recovery(bytea,bytea,bytea)'),
    'execute'
  ), false),
  false,
  'authenticated cannot execute complete_credential_recovery'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure('public.complete_credential_recovery(bytea,bytea,bytea)'),
    'execute'
  ), false),
  true,
  'service_role can execute complete_credential_recovery'
);

insert into public.prospects (
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region
) values (
  '빛의기록27', decode(repeat('11', 32), 'hex'), decode(repeat('22', 16), 'hex'),
  decode(repeat('33', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
);

insert into public.student_credentials (prospect_id, password_hash, password_salt)
select id, decode(repeat('44', 32), 'hex'), decode(repeat('55', 16), 'hex')
from public.prospects where nickname = '빛의기록27';

insert into public.credential_recovery_requests (
  prospect_id, status, code_hash, verified_at, expires_at
)
select id, 'verified', decode(repeat('66', 32), 'hex'), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '15 minutes'
from public.prospects where nickname = '빛의기록27';

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('77', 32), 'hex'), pg_catalog.clock_timestamp() + interval '12 hours', pg_catalog.clock_timestamp() + interval '30 minutes'
from public.prospects where nickname = '빛의기록27';

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('88', 32), 'hex'), pg_catalog.clock_timestamp() + interval '12 hours', pg_catalog.clock_timestamp() + interval '30 minutes'
from public.prospects where nickname = '빛의기록27';

select is(
  public.complete_credential_recovery(
    decode(repeat('66', 32), 'hex'), decode(repeat('99', 32), 'hex'), decode(repeat('aa', 16), 'hex')
  ),
  true,
  'a verified, unexpired recovery code completes once'
);

select is(
  (select password_hash from public.student_credentials) = decode(repeat('99', 32), 'hex'),
  true,
  'completion writes the already-derived password hash'
);

select is(
  (select password_salt from public.student_credentials) = decode(repeat('aa', 16), 'hex'),
  true,
  'completion writes the already-derived password salt'
);

select is(
  (select status from public.credential_recovery_requests),
  'consumed',
  'completion consumes the recovery request'
);

select is(
  (select count(*)::integer from public.student_sessions where revoked_at is null),
  0,
  'completion revokes every active student session'
);

select is(
  public.complete_credential_recovery(
    decode(repeat('66', 32), 'hex'), decode(repeat('bb', 32), 'hex'), decode(repeat('cc', 16), 'hex')
  ),
  false,
  'a consumed code cannot be reused'
);

insert into public.credential_recovery_requests (
  prospect_id, status, code_hash, requested_at, verified_at, expires_at
)
select id, 'verified', decode(repeat('dd', 32), 'hex'), pg_catalog.clock_timestamp() - interval '17 minutes', pg_catalog.clock_timestamp() - interval '16 minutes', pg_catalog.clock_timestamp() - interval '1 minute'
from public.prospects where nickname = '빛의기록27';

select is(
  public.complete_credential_recovery(
    decode(repeat('dd', 32), 'hex'), decode(repeat('ee', 32), 'hex'), decode(repeat('ff', 16), 'hex')
  ),
  false,
  'an expired verified code is rejected'
);

insert into public.credential_recovery_requests (
  prospect_id, status, code_hash, expires_at
)
select id, 'requested', decode(repeat('ab', 32), 'hex'), pg_catalog.clock_timestamp() + interval '1 hour'
from public.prospects where nickname = '빛의기록27';

select is(
  public.complete_credential_recovery(
    decode(repeat('ab', 32), 'hex'), decode(repeat('bc', 32), 'hex'), decode(repeat('cd', 16), 'hex')
  ),
  false,
  'an unverified code is rejected'
);

select * from finish();

rollback;
