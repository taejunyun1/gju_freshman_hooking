begin;

select plan(19);

select has_function(
  'public',
  'register_student',
  array['bytea', 'bytea', 'bytea', 'text', 'text', 'text', 'text', 'bytea', 'bytea'],
  'register_student accepts only protected identity and credential material'
);

select ok(
  coalesce((
    select p.prosecdef
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(
      'public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'
    )
  ), false),
  'register_student is security definer'
);

select ok(
  exists(
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as setting(value)
    where p.oid = pg_catalog.to_regprocedure(
      'public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'
    )
      and setting.value = 'search_path=""'
  ),
  'register_student has an empty search path'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'anon',
    pg_catalog.to_regprocedure('public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'),
    'execute'
  ), false),
  false,
  'anon cannot execute register_student'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    pg_catalog.to_regprocedure('public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'),
    'execute'
  ), false),
  false,
  'authenticated cannot execute register_student'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure('public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'),
    'execute'
  ), false),
  true,
  'service_role can execute register_student'
);

select is(
  (
    select kind
    from public.register_student(
      decode(repeat('11', 32), 'hex'),
      decode(repeat('22', 16), 'hex'),
      decode(repeat('33', 12), 'hex'),
      '선명한프레임01',
      '광주고등학교',
      'high3',
      'gwangju',
      decode(repeat('44', 32), 'hex'),
      decode(repeat('55', 16), 'hex')
    )
  ),
  'created',
  'register_student creates the prospect and credential together'
);

select is(
  (select count(*)::integer from public.prospects where phone_hmac = decode(repeat('11', 32), 'hex')),
  1,
  'the protected phone has one prospect'
);

select is(
  (select count(*)::integer from public.student_credentials),
  1,
  'created prospects always have one credential'
);

select is(
  (
    select kind
    from public.register_student(
      decode(repeat('11', 32), 'hex'),
      decode(repeat('66', 16), 'hex'),
      decode(repeat('77', 12), 'hex'),
      '고요한프레임02',
      '다른학교',
      'graduate',
      'capital',
      decode(repeat('88', 32), 'hex'),
      decode(repeat('99', 16), 'hex')
    )
  ),
  'existing',
  'a duplicate phone returns existing without exposing a prospect'
);

create function pg_temp.touch_result_count(p_token_hash bytea)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  execute 'select count(*) from public.touch_student_session($1)' into v_count using p_token_hash;
  return v_count;
exception
  when undefined_function then return -1;
end;
$$;

create function pg_temp.touched_idle_window(p_token_hash bytea)
returns interval
language plpgsql
as $$
declare
  v_window interval;
begin
  execute 'select idle_expires_at - last_seen_at from public.touch_student_session($1)' into v_window using p_token_hash;
  return v_window;
exception
  when undefined_function then return null;
end;
$$;

select has_function(
  'public',
  'touch_student_session',
  array['bytea'],
  'touch_student_session accepts only the hashed session token'
);

select ok(
  coalesce((
    select p.prosecdef
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.touch_student_session(bytea)')
  ), false),
  'touch_student_session is security definer'
);

select ok(
  exists(
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as setting(value)
    where p.oid = pg_catalog.to_regprocedure('public.touch_student_session(bytea)')
      and setting.value = 'search_path=""'
  ),
  'touch_student_session has an empty search path'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'anon',
    pg_catalog.to_regprocedure('public.touch_student_session(bytea)'),
    'execute'
  ), false),
  false,
  'anon cannot execute touch_student_session'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    pg_catalog.to_regprocedure('public.touch_student_session(bytea)'),
    'execute'
  ), false),
  false,
  'authenticated cannot execute touch_student_session'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure('public.touch_student_session(bytea)'),
    'execute'
  ), false),
  true,
  'service_role can execute touch_student_session'
);

insert into public.student_sessions (
  prospect_id,
  token_hash,
  expires_at,
  idle_expires_at,
  last_seen_at
)
select
  id,
  decode(repeat('aa', 32), 'hex'),
  pg_catalog.clock_timestamp() + interval '12 hours',
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp() - interval '31 minutes'
from public.prospects
where phone_hmac = decode(repeat('11', 32), 'hex');

select is(
  pg_temp.touch_result_count(decode(repeat('aa', 32), 'hex')),
  0,
  'an idle-expired session cannot be refreshed'
);

select ok(
  (
    select idle_expires_at < pg_catalog.clock_timestamp()
    from public.student_sessions
    where token_hash = decode(repeat('aa', 32), 'hex')
  ),
  'an idle-expired session keeps its expired idle timestamp'
);

insert into public.student_sessions (
  prospect_id,
  token_hash,
  expires_at,
  idle_expires_at,
  last_seen_at
)
select
  id,
  decode(repeat('bb', 32), 'hex'),
  pg_catalog.clock_timestamp() + interval '12 hours',
  pg_catalog.clock_timestamp() + interval '5 minutes',
  pg_catalog.clock_timestamp() - interval '1 minute'
from public.prospects
where phone_hmac = decode(repeat('11', 32), 'hex');

select is(
  pg_temp.touched_idle_window(decode(repeat('bb', 32), 'hex')),
  interval '30 minutes',
  'an active session gets a fresh 30-minute idle expiry from database time'
);

select * from finish();

rollback;
