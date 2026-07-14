begin;

select plan(29);

select has_function(
  'public',
  'approve_credential_recovery_request',
  array['bigint', 'uuid', 'uuid'],
  'approval accepts the recovery request, administrator, and trace UUID atomically'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure('public.approve_credential_recovery_request(bigint,uuid)'),
    'execute'
  ), false),
  false,
  'service_role cannot execute the legacy approval signature'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure('public.approve_credential_recovery_request(bigint,uuid,uuid)'),
    'execute'
  ), false),
  true,
  'service_role can execute only the audited approval signature'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'anon',
    pg_catalog.to_regprocedure('public.approve_credential_recovery_request(bigint,uuid,uuid)'),
    'execute'
  ), false),
  false,
  'anon cannot execute audited recovery approval'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    pg_catalog.to_regprocedure('public.approve_credential_recovery_request(bigint,uuid,uuid)'),
    'execute'
  ), false),
  false,
  'authenticated cannot execute audited recovery approval'
);

select ok(
  coalesce((
    select p.prosecdef
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.approve_credential_recovery_request(bigint,uuid,uuid)')
  ), false),
  'audited recovery approval is security definer'
);

select ok(
  exists(
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as setting(value)
    where p.oid = pg_catalog.to_regprocedure('public.approve_credential_recovery_request(bigint,uuid,uuid)')
      and setting.value = 'search_path=""'
  ),
  'audited recovery approval has an empty search path'
);

insert into auth.users (id)
values ('10000000-0000-4000-8000-000000000001'::uuid);

insert into public.admin_users (id)
values ('10000000-0000-4000-8000-000000000001'::uuid);

insert into public.prospects (
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region
) values (
  '원자적복구51', decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 16), 'hex'),
  decode(repeat('a3', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
);

insert into public.student_credentials (prospect_id, password_hash, password_salt)
select id, decode(repeat('a4', 32), 'hex'), decode(repeat('a5', 16), 'hex')
from public.prospects where nickname = '원자적복구51';

insert into public.credential_recovery_requests (prospect_id, status, expires_at)
select id, 'requested', pg_catalog.clock_timestamp() + interval '1 hour'
from public.prospects where nickname = '원자적복구51';

create temporary table approval_target as
select id as request_id
from public.credential_recovery_requests
where prospect_id = (select id from public.prospects where nickname = '원자적복구51');

select is(
  (select count(*)::integer
   from public.approve_credential_recovery_request(
     (select request_id from approval_target),
     '10000000-0000-4000-8000-000000000001'::uuid,
     null
   )),
  0,
  'missing required audit input returns no recovery code'
);

select is(
  (select status from public.credential_recovery_requests where id = (select request_id from approval_target)),
  'requested',
  'missing audit input leaves the recovery state unchanged'
);

select is(
  (select code_hash is null from public.credential_recovery_requests where id = (select request_id from approval_target)),
  true,
  'missing audit input never stores a code hash'
);

select is(
  (select count(*)::integer from public.audit_events),
  0,
  'missing audit input creates no audit row'
);

create temporary table approved_recovery as
select *
from public.approve_credential_recovery_request(
  (select request_id from approval_target),
  '10000000-0000-4000-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000002'::uuid
);

select is(
  (select count(*)::integer from approved_recovery),
  1,
  'valid approval returns exactly one code after the audit succeeds'
);

select is(
  (select pg_catalog.char_length(code) from approved_recovery),
  22,
  'valid approval returns exactly 128 random bits as base64url'
);

select is(
  (
    select request.status = 'verified'
      and request.code_hash = extensions.digest(pg_catalog.convert_to(approval.code, 'UTF8'), 'sha256')
    from public.credential_recovery_requests as request
    cross join approved_recovery as approval
    where request.id = (select request_id from approval_target)
  ),
  true,
  'approval atomically stores the hash of the exact returned code'
);

select is(
  (select count(*)::integer from public.audit_events where action = 'credential_recovery_approved'),
  1,
  'approval creates exactly one audit row'
);

select is(
  (select metadata from public.audit_events where action = 'credential_recovery_approved'),
  '{}'::jsonb,
  'approval audit metadata is sanitized and empty'
);

select is(
  (select request_id from public.audit_events where action = 'credential_recovery_approved'),
  '20000000-0000-4000-8000-000000000002'::uuid,
  'approval audit stores the required trace UUID'
);

select is(
  (
    select action || ':' || target_type || ':' || target_id
    from public.audit_events
    where action = 'credential_recovery_approved'
  ),
  'credential_recovery_approved:credential_recovery_request:' || (select request_id::text from approval_target),
  'approval audit identifies only the sanitized recovery target'
);

insert into public.credential_recovery_requests (
  prospect_id, status, code_hash, verified_at, expires_at
)
select id, 'verified', decode(repeat('b1', 32), 'hex'), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '15 minutes'
from public.prospects where nickname = '원자적복구51';

create temporary table completion_target as
select id as request_id
from public.credential_recovery_requests
where code_hash = decode(repeat('b1', 32), 'hex');

insert into public.credential_recovery_requests (prospect_id, status, expires_at)
select id, 'requested', pg_catalog.clock_timestamp() + interval '1 hour'
from public.prospects where nickname = '원자적복구51';

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('b2', 32), 'hex'), pg_catalog.clock_timestamp() + interval '12 hours', pg_catalog.clock_timestamp() + interval '30 minutes'
from public.prospects where nickname = '원자적복구51';

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('b3', 32), 'hex'), pg_catalog.clock_timestamp() + interval '12 hours', pg_catalog.clock_timestamp() + interval '30 minutes'
from public.prospects where nickname = '원자적복구51';

select is(
  (select count(*)::integer from public.credential_recovery_requests where status in ('requested', 'verified')),
  3,
  'two valid codes and one pending request coexist before completion'
);

select is(
  public.complete_credential_recovery(
    decode(repeat('b1', 32), 'hex'), decode(repeat('c1', 32), 'hex'), decode(repeat('c2', 16), 'hex')
  ),
  true,
  'either simultaneously valid code can complete recovery once'
);

select is(
  (select password_hash from public.student_credentials) = decode(repeat('c1', 32), 'hex'),
  true,
  'completion writes the new credential hash'
);

select is(
  (select password_salt from public.student_credentials) = decode(repeat('c2', 16), 'hex'),
  true,
  'completion writes the new credential salt'
);

select is(
  (select status from public.credential_recovery_requests where id = (select request_id from completion_target)),
  'consumed',
  'completion consumes the matched recovery request'
);

select is(
  (
    select code_hash is null
    from public.credential_recovery_requests
    where status = 'consumed'
    order by consumed_at desc nulls last, id desc
    limit 1
  ),
  true,
  'completion clears the consumed code hash'
);

select is(
  (select count(*)::integer from public.credential_recovery_requests where status = 'expired'),
  2,
  'completion expires every other requested or verified recovery row'
);

select is(
  (select count(*)::integer from public.credential_recovery_requests where status = 'expired' and code_hash is null),
  2,
  'completion clears every other active code hash'
);

select is(
  (select count(*)::integer from public.student_sessions where revoked_at is null),
  0,
  'completion revokes every active student session in the transaction'
);

select is(
  (
    select public.complete_credential_recovery(
      extensions.digest(pg_catalog.convert_to(code, 'UTF8'), 'sha256'),
      decode(repeat('d1', 32), 'hex'),
      decode(repeat('d2', 16), 'hex')
    )
    from approved_recovery
  ),
  false,
  'the other formerly valid code is rejected after completion'
);

select is(
  (select count(*)::integer from public.audit_events where action = 'credential_recovery_approved'),
  1,
  'completion does not duplicate the approval audit'
);

select * from finish();

rollback;
