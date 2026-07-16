begin;

select no_plan();

create extension if not exists dblink with schema extensions;

select has_function(
  'public',
  'resolve_career_narrative_report',
  array['uuid','bigint','timestamp with time zone','text','uuid'],
  'the exact narrative report resolution RPC exists'
);
select is(
  pg_catalog.to_regprocedure(
    'public.resolve_career_narrative_report(uuid,bigint,timestamp with time zone,text,uuid)'
  ) is not null,
  true,
  'migration 021 installs the exact five-argument signature'
);
select is(
  (
    select routine.prosecdef
    from pg_catalog.pg_proc routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.resolve_career_narrative_report(uuid,bigint,timestamp with time zone,text,uuid)'
    )
  ),
  true,
  'resolution RPC is security definer'
);
select is(
  (
    select routine.proconfig
    from pg_catalog.pg_proc routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.resolve_career_narrative_report(uuid,bigint,timestamp with time zone,text,uuid)'
    )
  ),
  array['search_path=""']::text[],
  'resolution RPC fixes an empty search path'
);
select function_privs_are(
  'public',
  'resolve_career_narrative_report',
  array['uuid','bigint','timestamp with time zone','text','uuid'],
  'service_role',
  array['EXECUTE'],
  'only the server service role can execute report resolution'
);
select function_privs_are(
  'public',
  'resolve_career_narrative_report',
  array['uuid','bigint','timestamp with time zone','text','uuid'],
  'anon',
  array[]::text[],
  'anonymous clients cannot resolve reports'
);
select function_privs_are(
  'public',
  'resolve_career_narrative_report',
  array['uuid','bigint','timestamp with time zone','text','uuid'],
  'authenticated',
  array[]::text[],
  'ordinary authenticated clients cannot resolve reports'
);
select table_privs_are(
  'public',
  'career_narrative_reports',
  'service_role',
  array['SELECT', 'INSERT'],
  'service role still cannot update or delete report rows directly'
);
select is(
  (
    select attribute.attgenerated
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.career_narrative_reports'::regclass
      and attribute.attname = 'priority'
      and not attribute.attisdropped
  ),
  's',
  'queue priority is a stored generated column'
);
select has_index(
  'public',
  'career_narrative_reports',
  'career_narrative_reports_priority_queue_idx',
  'open reports have a priority and oldest-first keyset index'
);
select hasnt_index(
  'public',
  'career_narrative_reports',
  'career_narrative_reports_open_queue_idx',
  'migration 021 removes the superseded expression queue index'
);

insert into auth.users(id) values
  ('a1000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002');
insert into public.admin_users(id, role, is_active) values
  ('a1000000-0000-4000-8000-000000000001', 'admin', true),
  ('a1000000-0000-4000-8000-000000000002', 'admin', false);

insert into public.prospects(
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region
) values (
  '서사해결검증학생',
  decode(repeat('91', 32), 'hex'),
  decode(repeat('92', 16), 'hex'),
  decode(repeat('93', 12), 'hex'),
  '광주고등학교',
  'high3',
  'gwangju'
);

insert into public.assessments(
  prospect_id, idempotency_key, track_scores, environment_score,
  result_snapshot, completed_at, created_at
)
select id,
  'a2000000-0000-4000-8000-000000000001',
  '{"documentary":20,"art_photo":80,"commercial":30,"video":60}',
  70,
  '{"marker":"report-resolution"}',
  '2026-07-16T01:00:00.000001Z',
  '2026-07-16T01:00:00.000001Z'
from public.prospects where nickname = '서사해결검증학생';

insert into public.career_narrative_reports(
  assessment_id, prospect_id, category, created_at, updated_at
)
select assessment.id, assessment.prospect_id, fixture.category,
  fixture.created_at, fixture.created_at
from public.assessments assessment
cross join (values
  ('unsafe', '2026-07-16T01:10:00.000001Z'::timestamptz),
  ('inaccurate', '2026-07-16T01:05:00.000001Z'::timestamptz)
) fixture(category, created_at)
where assessment.idempotency_key = 'a2000000-0000-4000-8000-000000000001'
on conflict (assessment_id, prospect_id) do nothing;

select is(
  (
    select priority
    from public.career_narrative_reports
    where category = 'unsafe'
  ),
  0::smallint,
  'unsafe reports receive first priority'
);

create temporary table report_target as
select report.id, report.updated_at, report.category
from public.career_narrative_reports report
where report.category = 'unsafe';
grant select on table report_target to service_role;

set local role service_role;

select throws_ok(
  $$select public.resolve_career_narrative_report(
      'a1000000-0000-4000-8000-000000000002',
      (select id from report_target),
      (select updated_at from report_target),
      'resolved_unsafe',
      'a3000000-0000-4000-8000-000000000001')$$,
  '22023',
  'NARRATIVE_REPORT_ACTIVE_ADMIN_REQUIRED',
  'inactive administrators cannot resolve a report'
);

create temporary table resolved_response as
select public.resolve_career_narrative_report(
  'a1000000-0000-4000-8000-000000000001',
  (select id from report_target),
  (select updated_at from report_target),
  'resolved_unsafe',
  'a3000000-0000-4000-8000-000000000002'
) as payload;

reset role;

select is(
  (select payload ->> 'kind' from resolved_response),
  'resolved',
  'the current open version resolves'
);
select is(
  (select payload #>> '{current,status}' from resolved_response),
  'resolved_unsafe',
  'resolved response returns the terminal status'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.audit_events
    where request_id = 'a3000000-0000-4000-8000-000000000002'
      and action = 'career_narrative_report_resolved'
  ),
  1,
  'successful resolution inserts one audit event atomically'
);
select is(
  (
    select metadata
    from public.audit_events
    where request_id = 'a3000000-0000-4000-8000-000000000002'
  ),
  pg_catalog.jsonb_build_object(
    'reportId', (select id from report_target),
    'category', 'unsafe',
    'resolution', 'resolved_unsafe'
  ),
  'audit metadata contains only report id, category and resolution'
);
select is(
  (
    select request_id
    from public.audit_events
    where request_id = 'a3000000-0000-4000-8000-000000000002'
  ),
  'a3000000-0000-4000-8000-000000000002'::uuid,
  'the server UUID is stored unchanged'
);
select ok(
  not (
    select metadata::text
    from public.audit_events
    where request_id = 'a3000000-0000-4000-8000-000000000002'
  ) like '%phone%',
  'audit metadata contains no phone field'
);
select ok(
  not (
    select metadata::text
    from public.audit_events
    where request_id = 'a3000000-0000-4000-8000-000000000002'
  ) like '%narrative%',
  'audit metadata contains no narrative text'
);

set local role service_role;

create temporary table repeated_response as
select public.resolve_career_narrative_report(
  'a1000000-0000-4000-8000-000000000001',
  (select id from report_target),
  (select updated_at from report_target),
  'resolved_unsafe',
  'a3000000-0000-4000-8000-000000000003'
) as payload;

reset role;

select is(
  (select payload ->> 'kind' from repeated_response),
  'conflict',
  'repeated resolution returns a stable conflict'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.audit_events
    where target_type = 'career_narrative_report'
      and target_id = (select id::text from report_target)
  ),
  1,
  'repeated resolution creates no second audit row'
);

select is(
  extensions.dblink_connect(
    'narrative_report_setup',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'concurrency setup connects'
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$delete from public.audit_events
    where admin_user_id = 'c1000000-0000-4000-8000-000000000001'$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$delete from public.career_narrative_reports
    where prospect_id in (
      select id from public.prospects where nickname = '서사해결동시학생'
    )$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$delete from public.assessments
    where prospect_id in (
      select id from public.prospects where nickname = '서사해결동시학생'
    )$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$delete from public.prospects where nickname = '서사해결동시학생'$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$delete from auth.users where id = 'c1000000-0000-4000-8000-000000000001'$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$insert into auth.users(id) values ('c1000000-0000-4000-8000-000000000001')$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$insert into public.admin_users(id, role, is_active)
    values ('c1000000-0000-4000-8000-000000000001', 'admin', true)$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region
    ) values (
      '서사해결동시학생',
      decode(repeat('a1', 32), 'hex'),
      decode(repeat('a2', 16), 'hex'),
      decode(repeat('a3', 12), 'hex'),
      '동시성고등학교', 'high3', 'gwangju'
    )$$
);
create temporary table concurrent_target as
select *
from extensions.dblink(
  'narrative_report_setup',
  $$with inserted_assessment as (
      insert into public.assessments(
        prospect_id, idempotency_key, track_scores, environment_score,
        result_snapshot, completed_at, created_at
      )
      select id, 'c2000000-0000-4000-8000-000000000001',
        '{"documentary":20,"art_photo":80,"commercial":30,"video":60}', 70,
        '{"marker":"report-concurrency"}',
        pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
      from public.prospects where nickname = '서사해결동시학생'
      returning id, prospect_id
    )
    insert into public.career_narrative_reports(
      assessment_id, prospect_id, category
    )
    select id, prospect_id, 'confusing'
    from inserted_assessment
    returning id, updated_at$$
) as fixture(id bigint, updated_at timestamptz);

select extensions.dblink_connect(
  'narrative_report_a',
  'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'narrative_report_b',
  'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_exec('narrative_report_a', 'set role service_role');
select extensions.dblink_exec('narrative_report_b', 'set role service_role');

select is(
  extensions.dblink_send_query(
    'narrative_report_a',
    pg_catalog.format(
      $$select public.resolve_career_narrative_report(
          'c1000000-0000-4000-8000-000000000001',
          %s, %L::timestamptz, 'resolved_copy',
          'a3000000-0000-4000-8000-000000000010')$$,
      (select id from concurrent_target),
      (select updated_at from concurrent_target)
    )
  ),
  1,
  'first concurrent resolver is dispatched'
);
select is(
  extensions.dblink_send_query(
    'narrative_report_b',
    pg_catalog.format(
      $$select public.resolve_career_narrative_report(
          'c1000000-0000-4000-8000-000000000001',
          %s, %L::timestamptz, 'dismissed',
          'a3000000-0000-4000-8000-000000000011')$$,
      (select id from concurrent_target),
      (select updated_at from concurrent_target)
    )
  ),
  1,
  'second concurrent resolver is dispatched'
);

create temporary table concurrent_results(worker text, payload jsonb);
insert into concurrent_results
select 'a', payload
from extensions.dblink_get_result('narrative_report_a') as response(payload jsonb);
insert into concurrent_results
select 'b', payload
from extensions.dblink_get_result('narrative_report_b') as response(payload jsonb);

select is(
  (select pg_catalog.count(*)::integer from concurrent_results where payload ->> 'kind' = 'resolved'),
  1,
  'exactly one concurrent resolver wins'
);
select is(
  (select pg_catalog.count(*)::integer from concurrent_results where payload ->> 'kind' = 'conflict'),
  1,
  'the losing concurrent resolver receives conflict'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.audit_events
    where target_type = 'career_narrative_report'
      and target_id = (select id::text from concurrent_target)
  ),
  1,
  'concurrent resolution inserts exactly one audit event'
);

select extensions.dblink_disconnect('narrative_report_a');
select extensions.dblink_disconnect('narrative_report_b');
select extensions.dblink_exec(
  'narrative_report_setup',
  pg_catalog.format(
    $$delete from public.audit_events
      where target_type = 'career_narrative_report' and target_id = %L$$,
    (select id::text from concurrent_target)
  )
);
select extensions.dblink_exec(
  'narrative_report_setup',
  pg_catalog.format(
    $$delete from public.career_narrative_reports where id = %s$$,
    (select id from concurrent_target)
  )
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$delete from public.assessments
    where idempotency_key = 'c2000000-0000-4000-8000-000000000001'$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$delete from public.prospects where nickname = '서사해결동시학생'$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$delete from public.admin_users
    where id = 'c1000000-0000-4000-8000-000000000001'$$
);
select extensions.dblink_exec(
  'narrative_report_setup',
  $$delete from auth.users
    where id = 'c1000000-0000-4000-8000-000000000001'$$
);
select extensions.dblink_disconnect('narrative_report_setup');

select * from finish();
rollback;
