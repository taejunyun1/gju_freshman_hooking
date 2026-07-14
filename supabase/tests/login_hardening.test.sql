begin;

select plan(14);

select has_function(
  'public',
  'complete_student_login',
  array['bigint', 'bytea', 'bytea', 'bytea', 'timestamp with time zone', 'timestamp with time zone'],
  'login completion requires the exact credential proof verified by the application'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure('public.complete_student_login(bigint,bytea,timestamptz,timestamptz)'),
    'execute'
  ), false),
  false,
  'service_role cannot execute legacy login completion without credential proof'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure('public.complete_student_login(bigint,bytea,bytea,bytea,timestamptz,timestamptz)'),
    'execute'
  ), false),
  true,
  'service_role can execute proof-bound login completion'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'anon',
    pg_catalog.to_regprocedure('public.complete_student_login(bigint,bytea,bytea,bytea,timestamptz,timestamptz)'),
    'execute'
  ), false),
  false,
  'anon cannot execute proof-bound login completion'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    pg_catalog.to_regprocedure('public.complete_student_login(bigint,bytea,bytea,bytea,timestamptz,timestamptz)'),
    'execute'
  ), false),
  false,
  'authenticated cannot execute proof-bound login completion'
);

select ok(
  coalesce((
    select p.prosecdef
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(
      'public.complete_student_login(bigint,bytea,bytea,bytea,timestamptz,timestamptz)'
    )
  ), false),
  'proof-bound login completion is security definer'
);

select ok(
  exists(
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as setting(value)
    where p.oid = pg_catalog.to_regprocedure(
      'public.complete_student_login(bigint,bytea,bytea,bytea,timestamptz,timestamptz)'
    )
      and setting.value = 'search_path=""'
  ),
  'proof-bound login completion has an empty search path'
);

insert into public.prospects (
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region
) values (
  '로그인증명71', decode(repeat('11', 32), 'hex'), decode(repeat('22', 16), 'hex'),
  decode(repeat('33', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
);

insert into public.student_credentials (
  prospect_id, password_hash, password_salt, failed_attempts
)
select id, decode(repeat('66', 32), 'hex'), decode(repeat('77', 16), 'hex'), 4
from public.prospects where nickname = '로그인증명71';

create function pg_temp.complete_login_with_proof(
  p_expected_password_hash bytea,
  p_expected_password_salt bytea,
  p_token_hash bytea
)
returns boolean
language plpgsql
as $$
declare
  v_result boolean;
begin
  execute $statement$
    select public.complete_student_login(
      (select id from public.prospects where nickname = '로그인증명71'),
      $1,
      $2,
      $3,
      pg_catalog.clock_timestamp() + interval '12 hours',
      pg_catalog.clock_timestamp() + interval '30 minutes'
    )
  $statement$ into v_result using p_expected_password_hash, p_expected_password_salt, p_token_hash;
  return v_result;
exception
  when undefined_function then return null;
end;
$$;

select is(
  pg_temp.complete_login_with_proof(
    decode(repeat('44', 32), 'hex'),
    decode(repeat('55', 16), 'hex'),
    decode(repeat('88', 32), 'hex')
  ),
  false,
  'stale credential proof is rejected after the password changes'
);

select is(
  (select count(*)::integer
   from public.student_sessions
   where prospect_id = (select id from public.prospects where nickname = '로그인증명71')),
  0,
  'stale credential proof creates no student session'
);

select is(
  (select credential.password_hash
   from public.student_credentials as credential
   join public.prospects as prospect on prospect.id = credential.prospect_id
   where prospect.nickname = '로그인증명71'),
  decode(repeat('66', 32), 'hex'),
  'stale login completion cannot overwrite the current credential'
);

select is(
  pg_temp.complete_login_with_proof(
    decode(repeat('66', 32), 'hex'),
    decode(repeat('77', 16), 'hex'),
    decode(repeat('99', 32), 'hex')
  ),
  true,
  'the exact current credential proof permits login completion'
);

select is(
  (select count(*)::integer
   from public.student_sessions
   where prospect_id = (select id from public.prospects where nickname = '로그인증명71')),
  1,
  'current credential proof creates exactly one session'
);

select is(
  (select credential.failed_attempts::integer
   from public.student_credentials as credential
   join public.prospects as prospect on prospect.id = credential.prospect_id
   where prospect.nickname = '로그인증명71'),
  0,
  'successful proof-bound completion resets login failures'
);

select is(
  (select credential.password_hash
   from public.student_credentials as credential
   join public.prospects as prospect on prospect.id = credential.prospect_id
   where prospect.nickname = '로그인증명71'),
  decode(repeat('66', 32), 'hex'),
  'successful login completion never changes protected credential material'
);

select * from finish();

rollback;
