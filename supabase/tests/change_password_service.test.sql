begin;

select plan(19);

select has_function(
  'public',
  'change_student_password',
  array['bytea', 'bytea', 'bytea'],
  'change_student_password accepts only the initiating session hash and already-derived password material'
);

select ok(
  coalesce((
    select p.prosecdef
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.change_student_password(bytea,bytea,bytea)')
  ), false),
  'change_student_password is security definer'
);

select ok(
  exists(
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as setting(value)
    where p.oid = pg_catalog.to_regprocedure('public.change_student_password(bytea,bytea,bytea)')
      and setting.value = 'search_path=""'
  ),
  'change_student_password has an empty search path'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'anon',
    pg_catalog.to_regprocedure('public.change_student_password(bytea,bytea,bytea)'),
    'execute'
  ), false),
  false,
  'anon cannot execute change_student_password'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    pg_catalog.to_regprocedure('public.change_student_password(bytea,bytea,bytea)'),
    'execute'
  ), false),
  false,
  'authenticated cannot execute change_student_password'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure('public.change_student_password(bytea,bytea,bytea)'),
    'execute'
  ), false),
  true,
  'service_role can execute change_student_password'
);

insert into public.prospects (
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region
) values (
  '안전한변경27', decode(repeat('11', 32), 'hex'), decode(repeat('22', 16), 'hex'),
  decode(repeat('33', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
);

insert into public.student_credentials (prospect_id, password_hash, password_salt)
select id, decode(repeat('44', 32), 'hex'), decode(repeat('55', 16), 'hex')
from public.prospects where nickname = '안전한변경27';

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('66', 32), 'hex'), pg_catalog.clock_timestamp() + interval '12 hours', pg_catalog.clock_timestamp() + interval '30 minutes'
from public.prospects where nickname = '안전한변경27';

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('77', 32), 'hex'), pg_catalog.clock_timestamp() + interval '12 hours', pg_catalog.clock_timestamp() + interval '30 minutes'
from public.prospects where nickname = '안전한변경27';

select is(
  public.change_student_password(
    decode(repeat('66', 32), 'hex'), decode(repeat('88', 32), 'hex'), decode(repeat('99', 16), 'hex')
  ),
  true,
  'an active initiating session changes the password'
);

select is(
  (select password_hash from public.student_credentials) = decode(repeat('88', 32), 'hex'),
  true,
  'a successful change writes the already-derived password hash'
);

select is(
  (select revoked_at is null from public.student_sessions where token_hash = decode(repeat('66', 32), 'hex')),
  true,
  'a successful change preserves the initiating session'
);

select is(
  (select revoked_at is not null from public.student_sessions where token_hash = decode(repeat('77', 32), 'hex')),
  true,
  'a successful change revokes sibling sessions'
);

select ok(
  exists(
    select 1
    from public.student_sessions
    where token_hash = decode(repeat('66', 32), 'hex')
      and revoked_at is null
      and expires_at > pg_catalog.clock_timestamp()
      and idle_expires_at > pg_catalog.clock_timestamp()
  ),
  'the starting session is active before recovery interleaves'
);

insert into public.credential_recovery_requests (
  prospect_id, status, code_hash, verified_at, expires_at
)
select id, 'verified', decode(repeat('aa', 32), 'hex'), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '15 minutes'
from public.prospects where nickname = '안전한변경27';

select is(
  public.complete_credential_recovery(
    decode(repeat('aa', 32), 'hex'), decode(repeat('bb', 32), 'hex'), decode(repeat('cc', 16), 'hex')
  ),
  true,
  'recovery can revoke the session after the initial application session read'
);

select is(
  (select revoked_at is not null from public.student_sessions where token_hash = decode(repeat('66', 32), 'hex')),
  true,
  'recovery revokes the starting session'
);

select is(
  public.change_student_password(
    decode(repeat('66', 32), 'hex'), decode(repeat('dd', 32), 'hex'), decode(repeat('ee', 16), 'hex')
  ),
  false,
  'the mutation-time session recheck rejects a session recovery revoked between read and change'
);

select is(
  (select password_hash from public.student_credentials) = decode(repeat('bb', 32), 'hex'),
  true,
  'the change cannot overwrite the password written by recovery'
);

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('ef', 32), 'hex'), pg_catalog.clock_timestamp() - interval '1 minute', pg_catalog.clock_timestamp() - interval '2 minutes'
from public.prospects where nickname = '안전한변경27';

select is(
  public.change_student_password(
    decode(repeat('ef', 32), 'hex'), decode(repeat('f1', 32), 'hex'), decode(repeat('f2', 16), 'hex')
  ),
  false,
  'database-time absolute expiry rejects a password change'
);

select is(
  (select password_hash from public.student_credentials) = decode(repeat('bb', 32), 'hex'),
  true,
  'absolute expiry cannot update the recovered password'
);

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('f3', 32), 'hex'), pg_catalog.clock_timestamp() + interval '12 hours', pg_catalog.clock_timestamp() - interval '1 minute'
from public.prospects where nickname = '안전한변경27';

select is(
  public.change_student_password(
    decode(repeat('f3', 32), 'hex'), decode(repeat('f4', 32), 'hex'), decode(repeat('f5', 16), 'hex')
  ),
  false,
  'database-time idle expiry rejects a password change'
);

select is(
  (select password_hash from public.student_credentials) = decode(repeat('bb', 32), 'hex'),
  true,
  'idle expiry cannot update the recovered password'
);

select * from finish();

rollback;
