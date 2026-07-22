begin;

select plan(23);

insert into public.admission_cycles (
  id, year, status, roster_version, password_key_version
) values (
  'b5000000-0000-4000-8000-000000000001', 2030, 'current', 0, 7
);

create function pg_temp.register_student(
  p_phone_hmac bytea default decode(repeat('11', 32), 'hex'),
  p_ip_hmac bytea default decode(repeat('88', 32), 'hex'),
  p_token_hash bytea default decode(repeat('99', 32), 'hex'),
  p_stage text default 'high3',
  p_key_version integer default 7
) returns jsonb
language sql
as $$
  select public.register_roster_student_v1(
    p_phone_hmac,
    decode(repeat('22', 16), 'hex'),
    decode(repeat('33', 12), 'hex'),
    decode(repeat('44', 32), 'hex'),
    decode(repeat('55', 16), 'hex'),
    decode(repeat('66', 12), 'hex'),
    decode(repeat('77', 32), 'hex'),
    p_key_version,
    p_ip_hmac,
    p_token_hash,
    pg_catalog.clock_timestamp() + interval '1 hour',
    '신규등록고',
    p_stage
  )
$$;

create temporary table first_registration as
select pg_temp.register_student() result;

select is((select result->>'kind' from first_registration), 'created', 'registration creates a student');
select is((select count(*) from public.prospects where admission_cycle_id = 'b5000000-0000-4000-8000-000000000001'), 1::bigint, 'registration creates one prospect');
select ok((select not is_test and status = 'active' and is_self_registered and region = 'other' from public.prospects where phone_hmac = decode(repeat('11', 32), 'hex')), 'registration creates an active non-test self-registered prospect');
select ok((select password_bcrypt ~ '^\\$2[ab]\\$10\\$[./A-Za-z0-9]{53}$' from public.student_credentials credential join public.prospects prospect on prospect.id = credential.prospect_id where prospect.phone_hmac = decode(repeat('11', 32), 'hex')), 'registration stores only a cost-10 bcrypt credential');
select is((select count(*) from public.student_sessions session join public.prospects prospect on prospect.id = session.prospect_id where prospect.phone_hmac = decode(repeat('11', 32), 'hex') and session.token_hash = decode(repeat('99', 32), 'hex') and session.revoked_at is null), 1::bigint, 'registration creates one active opaque student session');
select ok((select (result->>'prospectId')::bigint = prospect.id and (result->>'expiresAt')::timestamptz = session.expires_at from first_registration cross join public.prospects prospect join public.student_sessions session on session.prospect_id = prospect.id where prospect.phone_hmac = decode(repeat('11', 32), 'hex')), 'created result identifies the prospect and session expiry');

create temporary table duplicate_registration as
select pg_temp.register_student(p_token_hash => decode(repeat('9a', 32), 'hex')) result;
select is((select result->>'kind' from duplicate_registration), 'existing', 'same phone returns existing');
select is((select count(*) from public.prospects where phone_hmac = decode(repeat('11', 32), 'hex')), 1::bigint, 'existing registration does not create another prospect');
select is((select count(*) from public.student_sessions session join public.prospects prospect on prospect.id = session.prospect_id where prospect.phone_hmac = decode(repeat('11', 32), 'hex')), 1::bigint, 'existing registration does not create a session');

select is((pg_temp.register_student(p_phone_hmac => decode(repeat('12', 31), 'hex'))->>'kind'), 'validation_error', 'malformed phone HMAC is rejected');
select is((public.register_roster_student_v1(decode(repeat('15',32),'hex'),decode(repeat('22',16),'hex'),decode(repeat('33',12),'hex'),decode(repeat('44',31),'hex'),decode(repeat('55',16),'hex'),decode(repeat('66',12),'hex'),decode(repeat('77',32),'hex'),7,decode(repeat('88',32),'hex'),decode(repeat('9b',32),'hex'),pg_catalog.clock_timestamp()+interval '1 hour','신규등록고','high3')->>'kind'), 'validation_error', 'malformed name HMAC is rejected');
select is((public.register_roster_student_v1(decode(repeat('16',32),'hex'),decode(repeat('22',16),'hex'),decode(repeat('33',12),'hex'),decode(repeat('44',32),'hex'),decode(repeat('55',16),'hex'),decode(repeat('66',12),'hex'),decode(repeat('77',32),'hex'),7,decode(repeat('88',31),'hex'),decode(repeat('9c',32),'hex'),pg_catalog.clock_timestamp()+interval '1 hour','신규등록고','high3')->>'kind'), 'validation_error', 'malformed IP HMAC is rejected');
select is((public.register_roster_student_v1(decode(repeat('17',32),'hex'),decode(repeat('22',16),'hex'),decode(repeat('33',12),'hex'),decode(repeat('44',32),'hex'),decode(repeat('55',16),'hex'),decode(repeat('66',12),'hex'),decode(repeat('77',32),'hex'),7,decode(repeat('88',32),'hex'),decode(repeat('9d',31),'hex'),pg_catalog.clock_timestamp()+interval '1 hour','신규등록고','high3')->>'kind'), 'validation_error', 'malformed session token hash is rejected');
select is((pg_temp.register_student(p_phone_hmac => decode(repeat('13', 32), 'hex'), p_stage => 'middle1')->>'kind'), 'validation_error', 'invalid applicant stage is rejected');
select is((pg_temp.register_student(p_phone_hmac => decode(repeat('14', 32), 'hex'), p_key_version => 6)->>'kind'), 'validation_error', 'wrong password key version is rejected');
select is((public.register_roster_student_v1(decode(repeat('18',32),'hex'),decode(repeat('22',16),'hex'),decode(repeat('33',12),'hex'),decode(repeat('44',32),'hex'),decode(repeat('55',16),'hex'),decode(repeat('66',12),'hex'),decode(repeat('77',32),'hex'),7,decode(repeat('88',32),'hex'),decode(repeat('9e',32),'hex'),pg_catalog.clock_timestamp()+interval '13 hours','신규등록고','high3')->>'kind'), 'validation_error', 'session expiry beyond twelve hours is rejected');

delete from public.rate_limit_buckets;
insert into public.rate_limit_buckets(key_hash, route, window_started_at, count, expires_at)
select
  extensions.digest('roster-register-global', 'sha256'),
  'roster-register-global',
  pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) / 600) * 600),
  64,
  pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) / 600) * 600) + interval '10 minutes';
select is(
  (pg_temp.register_student(
    p_phone_hmac => decode(repeat('19', 32), 'hex'),
    p_ip_hmac => decode(repeat('8a', 32), 'hex'),
    p_token_hash => decode('03' || repeat('00', 31), 'hex')
  )->>'kind'),
  'rate_limited',
  'global registration bucket is shared across token hashes and bounded at 64'
);

delete from public.rate_limit_buckets;
select is((
  select (array_agg(pg_temp.register_student(
    p_phone_hmac => decode(lpad(to_hex(n + 2000), 64, '0'), 'hex'),
    p_ip_hmac => decode(repeat('aa', 32), 'hex'),
    p_token_hash => decode('02' || lpad(to_hex(n), 62, '0'), 'hex')
  )->>'kind' order by n))[9]
  from generate_series(1, 9) n
), 'rate_limited', 'IP registration bucket is bounded');

delete from public.rate_limit_buckets;
select is((
  select (array_agg(pg_temp.register_student(
    p_phone_hmac => decode(repeat('bb', 32), 'hex'),
    p_ip_hmac => decode(lpad(to_hex(n + 3000), 64, '0'), 'hex'),
    p_token_hash => decode('01' || lpad(to_hex(n), 62, '0'), 'hex')
  )->>'kind' order by n))[4]
  from generate_series(1, 4) n
), 'rate_limited', 'phone registration bucket is bounded');

select is((select count(*) from (values ('public'::name), ('anon'::name), ('authenticated'::name)) roles(role) where has_function_privilege(roles.role, 'public.register_roster_student_v1(bytea,bytea,bytea,bytea,bytea,bytea,bytea,integer,bytea,bytea,timestamptz,text,text)'::regprocedure, 'execute')), 0::bigint, 'public, anon, and authenticated cannot execute registration');
select ok(has_function_privilege('service_role', 'public.register_roster_student_v1(bytea,bytea,bytea,bytea,bytea,bytea,bytea,integer,bytea,bytea,timestamptz,text,text)'::regprocedure, 'execute'), 'service_role can execute registration');
select ok((select prosecdef from pg_catalog.pg_proc where oid = 'public.register_roster_student_v1(bytea,bytea,bytea,bytea,bytea,bytea,bytea,integer,bytea,bytea,timestamptz,text,text)'::regprocedure), 'registration is security definer');
select ok(exists(select 1 from pg_catalog.pg_proc procedure cross join lateral pg_catalog.unnest(coalesce(procedure.proconfig, array[]::text[])) setting(value) where procedure.oid = 'public.register_roster_student_v1(bytea,bytea,bytea,bytea,bytea,bytea,bytea,integer,bytea,bytea,timestamptz,text,text)'::regprocedure and setting.value = 'search_path=""'), 'registration has an empty search path');

select * from finish();
rollback;
