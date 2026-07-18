begin;

select plan(33);

select isnt(
  pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'),
  null,
  'roster login RPC exists with versioned digest candidates'
);

select isnt(
  pg_catalog.to_regprocedure('public.read_roster_student_session_v1(bytea)'),
  null,
  'roster session read RPC exists'
);

select isnt(
  pg_catalog.to_regprocedure('public.revoke_roster_student_session_v1(bytea)'),
  null,
  'roster session revoke RPC exists'
);

select is(
  (
    select count(*)
    from (values
      ('public'::name),
      ('anon'::name),
      ('authenticated'::name)
    ) roles(role)
    cross join (values
      ('login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'::text),
      ('read_roster_student_session_v1(bytea)'::text),
      ('revoke_roster_student_session_v1(bytea)'::text)
    ) functions(signature)
    where pg_catalog.to_regprocedure('public.' || functions.signature) is not null
      and has_function_privilege(roles.role, ('public.' || functions.signature)::regprocedure, 'execute')
  ),
  0::bigint,
  'public anon and authenticated cannot execute roster auth RPCs'
);

select is(
  (
    select count(*)
    from (values
      ('login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'::text),
      ('read_roster_student_session_v1(bytea)'::text),
      ('revoke_roster_student_session_v1(bytea)'::text)
    ) functions(signature)
    where pg_catalog.to_regprocedure('public.' || functions.signature) is not null
      and has_function_privilege('service_role', ('public.' || functions.signature)::regprocedure, 'execute')
  ),
  3::bigint,
  'service_role can execute every roster auth RPC'
);

select ok(
  coalesce(position('touch_student_session' in pg_get_functiondef(pg_catalog.to_regprocedure('public.read_roster_student_session_v1(bytea)'))), 0) = 0,
  'roster session read does not call the legacy touch function'
);

select ok(
  coalesce(position('password_hash' in pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'))), 0) = 0,
  'roster login RPC does not read legacy PBKDF2 hash columns'
);

select ok(
  coalesce(position('password_salt' in pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'))), 0) = 0,
  'roster login RPC does not read legacy PBKDF2 salt columns'
);

-- Keep the dblink fixture outside this session's transaction.  Both callers must
-- observe the same committed credential row for the FOR UPDATE regression.
create extension if not exists dblink with schema extensions;
select is(
  extensions.dblink_connect('roster_login_lock_setup', 'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'),
  'OK',
  'roster login concurrency setup connection opens'
);
select extensions.dblink_exec('roster_login_lock_setup', $$
  delete from public.prospects where nickname = 'free-tier-lock-race';
  delete from public.admission_cycles where id = 'c0240000-0000-4000-8000-000000000001';
  insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
  values ('c0240000-0000-4000-8000-000000000001', 2098, 'current', 0, 1);
  insert into public.prospects(
    nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage,
    region, status, admission_cycle_id, name_hmac, name_ciphertext, name_iv
  ) values (
    'free-tier-lock-race', decode(repeat('b3', 32), 'hex'), decode(repeat('13', 16), 'hex'),
    decode(repeat('23', 12), 'hex'), '경합고', 'high3', 'other', 'active',
    'c0240000-0000-4000-8000-000000000001', decode(repeat('33', 32), 'hex'),
    decode(repeat('43', 16), 'hex'), decode(repeat('53', 12), 'hex')
  );
  insert into public.student_credentials(
    prospect_id, password_hash, password_salt, password_bcrypt, password_generation
  ) select id, decode(repeat('00', 32), 'hex'), decode(repeat('00', 16), 'hex'),
    extensions.crypt(encode(decode(repeat('a3', 32), 'hex'), 'hex'), extensions.gen_salt('bf', 10)), 1
  from public.prospects where nickname = 'free-tier-lock-race';
$$);
select is(
  extensions.dblink_connect('roster_login_lock_a', 'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'),
  'OK',
  'first roster login concurrency connection opens'
);
select is(
  extensions.dblink_connect('roster_login_lock_b', 'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'),
  'OK',
  'second roster login concurrency connection opens'
);
select extensions.dblink_exec('roster_login_lock_a', 'set role service_role');
select extensions.dblink_exec('roster_login_lock_b', 'set role service_role');
create temporary table roster_login_lock_results(result jsonb);
select is(
  extensions.dblink_send_query(
    'roster_login_lock_a',
    $$select public.login_roster_student_v1(decode(repeat('b3',32),'hex'),decode(repeat('a4',32),'hex'),1,null,null,decode(repeat('c3',32),'hex'),decode(repeat('d3',32),'hex'),clock_timestamp()+interval '1 hour')$$
  ),
  1,
  'first failing login is dispatched'
);
select is(
  extensions.dblink_send_query(
    'roster_login_lock_b',
    $$select public.login_roster_student_v1(decode(repeat('b3',32),'hex'),decode(repeat('a4',32),'hex'),1,null,null,decode(repeat('c3',32),'hex'),decode(repeat('d4',32),'hex'),clock_timestamp()+interval '1 hour')$$
  ),
  1,
  'second failing login is dispatched'
);
insert into roster_login_lock_results select result from extensions.dblink_get_result('roster_login_lock_a') response(result jsonb);
insert into roster_login_lock_results select result from extensions.dblink_get_result('roster_login_lock_b') response(result jsonb);
select is(
  (select count(*) from roster_login_lock_results where result = '{"kind":"failed"}'::jsonb),
  2::bigint,
  'concurrent bad logins both return the generic failure'
);
select is(
  (
    select c.failed_attempts::integer
    from public.student_credentials c
    join public.prospects p on p.id = c.prospect_id
    where p.nickname = 'free-tier-lock-race'
  ),
  2,
  'row locking serializes concurrent credential failure updates'
);
select extensions.dblink_disconnect('roster_login_lock_a');
select extensions.dblink_disconnect('roster_login_lock_b');
select extensions.dblink_exec('roster_login_lock_setup', $$
  delete from public.prospects where nickname = 'free-tier-lock-race';
  delete from public.admission_cycles where id = 'c0240000-0000-4000-8000-000000000001';
  delete from public.rate_limit_buckets where route in ('roster-login-global', 'roster-login-ip');
$$);
select extensions.dblink_disconnect('roster_login_lock_setup');

create temporary table roster_login_fixture as
with cycle as (
  insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
  values ('c0240000-0000-4000-8000-000000000002', 2097, 'current', 0, 1)
  returning id
), prospect as (
  insert into public.prospects(
    nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage,
    region, status, admission_cycle_id, name_hmac, name_ciphertext, name_iv
  )
  select 'free-tier-login-fixture', decode(repeat('b1', 32), 'hex'), decode(repeat('11', 16), 'hex'),
    decode(repeat('21', 12), 'hex'), '경합고', 'high3', 'other', 'active', cycle.id,
    decode(repeat('31', 32), 'hex'), decode(repeat('41', 16), 'hex'), decode(repeat('51', 12), 'hex')
  from cycle
  returning id
), credential as (
  insert into public.student_credentials(
    prospect_id, password_hash, password_salt, password_bcrypt, password_generation
  )
  select id, decode(repeat('00', 32), 'hex'), decode(repeat('00', 16), 'hex'),
    extensions.crypt(encode(decode(repeat('a1', 32), 'hex'), 'hex'), extensions.gen_salt('bf', 10)), 1
  from prospect
  returning prospect_id
)
select prospect_id from credential;

insert into public.rate_limit_buckets(key_hash, route, window_started_at, count, expires_at)
select extensions.digest('roster-login-global', 'sha256'), 'roster-login-global',
  to_timestamp(floor(extract(epoch from clock_timestamp()) / 600) * 600), 800,
  to_timestamp(floor(extract(epoch from clock_timestamp()) / 600) * 600) + interval '10 minutes';
create temporary table roster_login_global_result as
select public.login_roster_student_v1(
  decode(repeat('b1',32),'hex'), decode(repeat('a1',32),'hex'), 1, null, null,
  decode(repeat('c1',32),'hex'), decode(repeat('d1',32),'hex'), clock_timestamp() + interval '1 hour'
) result;
select is((select result from roster_login_global_result), '{"kind":"failed"}'::jsonb, 'a full global bucket returns generic failure');
select is((select count(*) from public.student_sessions), 0::bigint, 'a full global bucket creates no session');
select is((select count from public.rate_limit_buckets where key_hash = extensions.digest('roster-login-global', 'sha256') and route = 'roster-login-global'), 801, 'the global bucket is atomically consumed at the 800 boundary');

delete from public.rate_limit_buckets where route in ('roster-login-global', 'roster-login-ip');
insert into public.rate_limit_buckets(key_hash, route, window_started_at, count, expires_at)
select extensions.digest(encode(decode(repeat('c1',32),'hex'), 'hex'), 'sha256'), 'roster-login-ip',
  to_timestamp(floor(extract(epoch from clock_timestamp()) / 600) * 600), 400,
  to_timestamp(floor(extract(epoch from clock_timestamp()) / 600) * 600) + interval '10 minutes';
create temporary table roster_login_ip_result as
select public.login_roster_student_v1(
  decode(repeat('b1',32),'hex'), decode(repeat('a1',32),'hex'), 1, null, null,
  decode(repeat('c1',32),'hex'), decode(repeat('d2',32),'hex'), clock_timestamp() + interval '1 hour'
) result;
select is((select result from roster_login_ip_result), '{"kind":"failed"}'::jsonb, 'a full IP bucket returns generic failure');
select is((select count from public.rate_limit_buckets where key_hash = extensions.digest(encode(decode(repeat('c1',32),'hex'), 'hex'), 'sha256') and route = 'roster-login-ip'), 401, 'the IP bucket is atomically consumed at the 400 boundary');
select is((select count(*) from public.student_sessions), 0::bigint, 'a full IP bucket creates no session');
select is((select count from public.rate_limit_buckets where key_hash = extensions.digest('roster-login-global', 'sha256') and route = 'roster-login-global'), 1, 'the global bucket is consumed before the IP bucket');

delete from public.rate_limit_buckets where route in ('roster-login-global', 'roster-login-ip');
select public.login_roster_student_v1(decode(repeat('b1',32),'hex'),decode(repeat('a2',32),'hex'),1,null,null,decode(repeat('c1',32),'hex'),decode(repeat('d3',32),'hex'),clock_timestamp()+interval '1 hour');
select public.login_roster_student_v1(decode(repeat('b1',32),'hex'),decode(repeat('a2',32),'hex'),1,null,null,decode(repeat('c1',32),'hex'),decode(repeat('d4',32),'hex'),clock_timestamp()+interval '1 hour');
select public.login_roster_student_v1(decode(repeat('b1',32),'hex'),decode(repeat('a2',32),'hex'),1,null,null,decode(repeat('c1',32),'hex'),decode(repeat('d5',32),'hex'),clock_timestamp()+interval '1 hour');
select public.login_roster_student_v1(decode(repeat('b1',32),'hex'),decode(repeat('a2',32),'hex'),1,null,null,decode(repeat('c1',32),'hex'),decode(repeat('d6',32),'hex'),clock_timestamp()+interval '1 hour');
select public.login_roster_student_v1(decode(repeat('b1',32),'hex'),decode(repeat('a2',32),'hex'),1,null,null,decode(repeat('c1',32),'hex'),decode(repeat('d7',32),'hex'),clock_timestamp()+interval '1 hour');
select ok((select locked_until > clock_timestamp() and failed_attempts = 5 from public.student_credentials where prospect_id = (select prospect_id from roster_login_fixture)), 'the fifth consecutive bad password creates a 30-minute lock');
create temporary table roster_login_lock_before as select locked_until from public.student_credentials where prospect_id = (select prospect_id from roster_login_fixture);
select public.login_roster_student_v1(decode(repeat('b1',32),'hex'),decode(repeat('a2',32),'hex'),1,null,null,decode(repeat('c1',32),'hex'),decode(repeat('d8',32),'hex'),clock_timestamp()+interval '1 hour');
select is((select locked_until from public.student_credentials where prospect_id = (select prospect_id from roster_login_fixture)), (select locked_until from roster_login_lock_before), 'an active lock is not extended by another bad password');
create temporary table roster_login_locked_result as
select public.login_roster_student_v1(decode(repeat('b1',32),'hex'),decode(repeat('a1',32),'hex'),1,null,null,decode(repeat('c1',32),'hex'),decode(repeat('d9',32),'hex'),clock_timestamp()+interval '1 hour') result;
select is((select result from roster_login_locked_result), '{"kind":"failed"}'::jsonb, 'an active lock rejects the correct password');
select is((select count(*) from public.student_sessions), 0::bigint, 'an active lock does not create a session');

update public.student_credentials set failed_attempts = 5, locked_until = clock_timestamp() - interval '1 second' where prospect_id = (select prospect_id from roster_login_fixture);
create temporary table roster_login_expired_result as
select public.login_roster_student_v1(decode(repeat('b1',32),'hex'),decode(repeat('a1',32),'hex'),1,null,null,decode(repeat('c1',32),'hex'),decode(repeat('da',32),'hex'),clock_timestamp()+interval '1 hour') result;
select is((select result ->> 'kind' from roster_login_expired_result), 'authenticated', 'an expired lock permits the correct password');
select is((select failed_attempts from public.student_credentials where prospect_id = (select prospect_id from roster_login_fixture)), 0::smallint, 'an expired-lock success resets failed attempts');
select is((select locked_until from public.student_credentials where prospect_id = (select prospect_id from roster_login_fixture)), null::timestamptz, 'an expired-lock success clears the lock');

select ok(
  position('public.consume_rate_limit(' in pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'))) > 0,
  'roster login consumes the fixed global rate bucket'
);
select ok(
  position('roster-login-global' in pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'))) < position('roster-login-ip' in pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'))),
  'the global limiter precedes the IP limiter in the authoritative RPC'
);
select is(
  (length(pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'))) - length(replace(pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)')), 'extensions.crypt', ''))) / length('extensions.crypt'),
  1,
  'each rate-admitted attempt has exactly one bcrypt comparison expression'
);
select ok(
  position('for update' in lower(pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)')))) > 0,
  'roster login locks the eligible credential row before changing failure state'
);

select * from finish();
rollback;
