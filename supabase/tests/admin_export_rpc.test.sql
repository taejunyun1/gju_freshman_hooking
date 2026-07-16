begin;

select plan(20);

select has_function('public', 'admin_export_counts', array['bigint','uuid'], 'export counts RPC exists');
select has_function('public', 'admin_export_student_rows', array['bigint','uuid','timestamp with time zone','bigint','integer'], 'student export RPC exists');
select has_function('public', 'admin_export_assessment_rows', array['bigint','uuid','timestamp with time zone','bigint','integer'], 'assessment export RPC exists');
select has_function('public', 'admin_export_counseling_rows', array['bigint','uuid','timestamp with time zone','bigint','integer'], 'counseling export RPC exists');
select has_function('public', 'record_admin_export_created', array['bigint','uuid','uuid'], 'export audit RPC exists');
select has_index('public', 'audit_events', 'audit_events_admin_export_job_once_idx', 'each export job has one audit row under concurrency');

select function_privs_are('public', 'admin_export_counts', array['bigint','uuid'], 'anon', array[]::text[], 'anonymous cannot count export rows');
select function_privs_are('public', 'admin_export_student_rows', array['bigint','uuid','timestamp with time zone','bigint','integer'], 'authenticated', array[]::text[], 'ordinary authenticated users cannot export students');
select function_privs_are('public', 'record_admin_export_created', array['bigint','uuid','uuid'], 'service_role', array['EXECUTE'], 'server can atomically audit export creation');

insert into auth.users(id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
insert into public.admin_users(id, is_active) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
insert into public.export_jobs(created_by_admin_id, filter_snapshot)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '{}'::jsonb);

select lives_ok(
  $$select public.record_admin_export_created(
      (select id from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'ffffffff-ffff-4fff-8fff-ffffffffffff')$$,
  'creator can atomically record the export audit'
);
select is((select count(*)::integer from public.audit_events where action = 'admin_export_created' and admin_user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), 1, 'one job produces one sensitive audit event');
select is((select count(*)::integer from public.events where event_name = 'admin_export_created' and properties ->> 'job_id' is not null), 1, 'one job produces one analytics event without phone data');
select throws_ok(
  $$select public.record_admin_export_created(
      (select id from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'ffffffff-ffff-4fff-8fff-ffffffffffff')$$,
  'P0001', 'EXPORT_AUDIT_ALREADY_RECORDED', 'a job cannot be audited twice'
);

insert into public.prospects(
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name,
  applicant_stage, region, created_at, last_active_at, updated_at
) values
  ('내보내기프레임01', decode(repeat('11', 32), 'hex'), decode(repeat('22', 16), 'hex'),
   decode(repeat('33', 12), 'hex'), '광주고등학교', 'high3', 'gwangju',
   '2026-07-15T02:00:00.123456Z', '2026-07-15T02:00:00.123456Z', '2026-07-15T02:00:00.123456Z'),
  ('내보내기프레임02', decode(repeat('44', 32), 'hex'), decode(repeat('55', 16), 'hex'),
   decode(repeat('66', 12), 'hex'), '광주고등학교', 'high3', 'gwangju',
   '2026-07-15T02:00:00.123455Z', '2026-07-15T02:00:00.123455Z', '2026-07-15T02:00:00.123455Z');

with fixture as (
  select id, pg_catalog.row_number() over (order by created_at desc)::integer as ordinal
  from public.prospects where nickname like '내보내기프레임%'
)
insert into public.assessments(
  prospect_id, idempotency_key, track_scores, environment_score,
  result_snapshot, completed_at, created_at
)
select fixture.id, pg_catalog.gen_random_uuid(),
  '{"documentary":10,"art_photo":20,"commercial":90,"video":30}'::jsonb, 80,
  '{"rankedTracks":["commercial","art_photo","video","documentary"],"selectedInterests":[{"group":"work","key":"work.commercial","label":"광고 이미지"},{"group":"result","key":"result.commercial","label":"브랜드 결과물"},{"group":"style","key":"style.studio","label":"스튜디오"},{"group":"career","key":"career.photo","label":"상업사진가"}]}'::jsonb,
  ('2026-07-15T03:00:00.10000' || fixture.ordinal::text || 'Z')::timestamptz,
  ('2026-07-15T03:00:00.10000' || fixture.ordinal::text || 'Z')::timestamptz
from fixture;

insert into public.assessments(
  prospect_id, idempotency_key, track_scores, environment_score,
  result_snapshot, completed_at, created_at
)
select prospect.id, pg_catalog.gen_random_uuid(),
  '{"documentary":10,"art_photo":95,"commercial":20,"video":30}'::jsonb, 75,
  '{"rankedTracks":["art_photo","commercial","video","documentary"],"selectedInterests":[{"group":"work","key":"work.art","label":"예술 이미지"},{"group":"result","key":"result.art","label":"전시 결과물"},{"group":"style","key":"style.gallery","label":"전시장"},{"group":"career","key":"career.artist","label":"작가"}]}'::jsonb,
  '2026-07-15T04:00:00.200001Z', '2026-07-15T04:00:00.200001Z'
from public.prospects prospect where prospect.nickname = '내보내기프레임01';

with faculty_fixture as (
  select id from public.faculty order by id limit 1
)
insert into public.counseling_requests(
  prospect_id, assessment_id, status, contact_method, availability,
  consent_given, assigned_faculty_id, assigned_at, contacted_at, created_at, updated_at
)
select prospect.id,
  (select assessment.id from public.assessments assessment
   where assessment.prospect_id = prospect.id
     and assessment.result_snapshot #>> '{rankedTracks,0}' = 'commercial' limit 1),
  'contacted', 'text', 'weekday_evening', true, faculty_fixture.id,
  '2026-07-15T05:00:00Z', '2026-07-15T05:01:00Z',
  '2026-07-15T05:00:00Z', '2026-07-15T05:01:00Z'
from public.prospects prospect cross join faculty_fixture
where prospect.nickname like '내보내기프레임%';

insert into public.counseling_faculty_recommendations(
  counseling_request_id, faculty_id, role, rank,
  faculty_name_snapshot, faculty_title_snapshot, expertise_snapshot, reason_snapshot
)
select request.id, faculty.id, role_fixture.role, 1,
  faculty.name, faculty.title, faculty.expertise_summary, '내보내기 검증용 추천 이유'
from public.counseling_requests request
cross join (values ('primary', 1), ('backup', 2)) role_fixture(role, faculty_ordinal)
join lateral (
  select id, name, title, expertise_summary
  from public.faculty order by id offset (role_fixture.faculty_ordinal - 1) limit 1
) faculty on true
join public.prospects prospect on prospect.id = request.prospect_id
where prospect.nickname like '내보내기프레임%';

insert into public.export_jobs(created_by_admin_id, filter_snapshot)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '{"track":"commercial","counselingStatus":"contacted"}'::jsonb);


select results_eq(
  $$select student_count, assessment_count, counseling_count
    from public.admin_export_counts(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  $$values (2, 2, 2)$$,
  'counts apply track directly to assessments and status directly to counseling rows'
);
update public.export_jobs set status = 'fetching'
where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and status = 'created';
select is(
  (select payload ->> 'phone_ciphertext'
   from public.admin_export_student_rows(
     (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)
   limit 1),
  '\x' || repeat('22', 16),
  'student RPC returns canonical Postgres bytea for server-only decryption'
);
select is(
  (select payload ->> 'created_at'
   from public.admin_export_student_rows(
     (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)
   limit 1),
  '2026-07-15T02:00:00.123456Z',
  'student cursor retains all six microsecond digits'
);
select is(
  (select count(*)::integer
   from public.admin_export_student_rows(
     (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2026-07-15T02:00:00.123456Z',
     (select id from public.prospects where nickname = '내보내기프레임01'), 1000)),
  1,
  'exact timestamp and id cursor continues without duplicate or skipped student'
);
select is(
  (select (payload ->> 'sequence')::integer
   from public.admin_export_assessment_rows(
     (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)
   where payload #>> '{prospect,nickname}' = '내보내기프레임01'),
  1,
  'assessment payload projects an exact database sequence instead of nested history'
);
select is(
  (select count(*)::integer
   from public.admin_export_assessment_rows(
     (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)),
  2,
  'assessment page excludes nonmatching track rows just like its count'
);
select is(
  (select count(*)::integer
   from public.admin_export_counseling_rows(
     (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)),
  2,
  'counseling page applies its direct status filter just like its count'
);

select * from finish();
rollback;
