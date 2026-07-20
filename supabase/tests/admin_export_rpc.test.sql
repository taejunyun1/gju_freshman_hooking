begin;

select plan(42);

select has_function('public', 'admin_export_counts', array['bigint','uuid'], 'export counts RPC exists');
select has_function('public', 'admin_export_student_rows', array['bigint','uuid','timestamp with time zone','bigint','integer'], 'student export RPC exists');
select has_function('public', 'admin_export_assessment_rows', array['bigint','uuid','timestamp with time zone','bigint','integer'], 'assessment export RPC exists');
select has_function('public', 'admin_export_counseling_rows', array['bigint','uuid','timestamp with time zone','bigint','integer'], 'counseling export RPC exists');
select has_function('public', 'record_admin_export_created', array['bigint','uuid','uuid'], 'export audit RPC exists');
select has_function('public', 'record_admin_export_downloaded', array['bigint','uuid'], 'download acknowledgement RPC exists');
select has_index('public', 'audit_events', 'audit_events_admin_export_job_once_idx', 'each export job has one audit row under concurrency');

select function_privs_are('public', 'admin_export_counts', array['bigint','uuid'], 'anon', array[]::text[], 'anonymous cannot count export rows');
select function_privs_are('public', 'admin_export_student_rows', array['bigint','uuid','timestamp with time zone','bigint','integer'], 'authenticated', array[]::text[], 'ordinary authenticated users cannot export students');
select function_privs_are('public', 'record_admin_export_created', array['bigint','uuid','uuid'], 'service_role', array['EXECUTE'], 'server can atomically audit export creation');
select function_privs_are('public', 'record_admin_export_downloaded', array['bigint','uuid'], 'service_role', array['EXECUTE'], 'server can atomically acknowledge a browser download');

insert into auth.users(id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
insert into public.admin_users(id, is_active) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
insert into auth.users(id) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.admin_users(id, is_active) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
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

update public.export_jobs
set status = 'completed',
    student_row_count = 2,
    participation_row_count = 2,
    counseling_row_count = 2,
    completed_at = pg_catalog.clock_timestamp()
where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  and status = 'fetching';

select lives_ok(
  $$select public.record_admin_export_downloaded(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  'creator can acknowledge a completed browser download'
);
select ok(
  (select downloaded_at is not null
   from public.export_jobs
   where id = (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')),
  'download acknowledgement records downloaded_at'
);
select lives_ok(
  $$select public.record_admin_export_downloaded(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  'download acknowledgement is idempotent'
);
select is(
  (select count(*)::integer
   from public.export_jobs
   where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and downloaded_at is not null),
  1,
  'idempotent acknowledgement does not create a second audit fact'
);
select throws_ok(
  $$select public.record_admin_export_downloaded(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'ffffffff-ffff-4fff-8fff-ffffffffffff')$$,
  '22023', 'EXPORT_ACTIVE_ADMIN_REQUIRED', 'unknown administrators cannot acknowledge downloads'
);
select throws_ok(
  $$select public.record_admin_export_downloaded(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd')$$,
  'P0002', 'EXPORT_JOB_NOT_FOUND', 'another active administrator cannot acknowledge the creator download'
);
select is(
  (select count(*)::integer
   from public.export_jobs
   where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and downloaded_at is not null),
  1,
  'rejected cross-owner acknowledgement does not add a download fact'
);

insert into public.export_jobs(created_by_admin_id, filter_snapshot)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '{"region":"gwangju"}'::jsonb);
update public.export_jobs set status = 'fetching'
where id = (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select throws_ok(
  $$select public.record_admin_export_downloaded(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  'P0001', 'EXPORT_JOB_STATUS_INVALID', 'fetching jobs cannot be acknowledged as downloaded'
);
select is(
  (select downloaded_at
   from public.export_jobs
   where id = (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')),
  null::timestamptz,
  'rejected acknowledgement leaves downloaded_at empty'
);

insert into public.prospects(
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name,
  applicant_stage, region, created_at, last_active_at, updated_at
) values
  ('운영분류완료만', decode(repeat('71', 32), 'hex'), decode(repeat('72', 16), 'hex'), decode(repeat('73', 12), 'hex'),
    '광주고등학교', 'high3', 'gwangju', '2026-07-16T01:00:00Z', '2026-07-16T01:00:00Z', '2026-07-16T01:00:00Z'),
  ('운영분류상담', decode(repeat('74', 32), 'hex'), decode(repeat('75', 16), 'hex'), decode(repeat('76', 12), 'hex'),
    '광주고등학교', 'high3', 'gwangju', '2026-07-16T01:00:01Z', '2026-07-16T01:00:01Z', '2026-07-16T01:00:01Z'),
  ('운영분류미완료', decode(repeat('77', 32), 'hex'), decode(repeat('78', 16), 'hex'), decode(repeat('79', 12), 'hex'),
    '광주고등학교', 'high3', 'gwangju', '2026-07-16T01:00:02Z', '2026-07-16T01:00:02Z', '2026-07-16T01:00:02Z'),
  ('운영분류교수이력', decode(repeat('81', 32), 'hex'), decode(repeat('82', 16), 'hex'), decode(repeat('83', 12), 'hex'),
    '광주고등학교', 'high3', 'gwangju', '2026-07-16T01:00:03Z', '2026-07-16T01:00:03Z', '2026-07-16T01:00:03Z'),
  ('운영분류미배정', decode(repeat('84', 32), 'hex'), decode(repeat('85', 16), 'hex'), decode(repeat('86', 12), 'hex'),
    '광주고등학교', 'high3', 'gwangju', '2026-07-16T01:00:04Z', '2026-07-16T01:00:04Z', '2026-07-16T01:00:04Z');

insert into public.assessments(
  prospect_id, idempotency_key, track_scores, environment_score, result_snapshot, completed_at, created_at
)
select prospect.id, pg_catalog.gen_random_uuid(),
  '{"documentary":25,"art_photo":25,"commercial":25,"video":25}'::jsonb,
  90,
  '{"rankedTracks":["video","documentary","art_photo","commercial"],"selectedInterests":[{"group":"work","key":"work.video","label":"영상"},{"group":"result","key":"result.film","label":"영상 결과물"},{"group":"style","key":"style.cinematic","label":"시네마틱"},{"group":"career","key":"career.video","label":"영상 제작자"}]}'::jsonb,
  '2026-07-16T02:00:00Z', '2026-07-16T02:00:00Z'
from public.prospects prospect
where prospect.nickname in ('운영분류완료만', '운영분류상담', '운영분류교수이력', '운영분류미배정');

insert into public.counseling_requests(
  prospect_id, assessment_id, status, contact_method, availability, consent_given,
  assigned_faculty_id, assigned_at, contacted_at, closed_at, created_at, updated_at
)
select prospect.id,
  (select assessment.id from public.assessments assessment where assessment.prospect_id = prospect.id limit 1),
  'closed', 'text', 'weekday_evening', true,
  (select id from public.faculty order by id limit 1),
  '2026-07-16T03:00:00Z', null, '2026-07-16T03:30:00Z',
  '2026-07-16T03:00:00Z', '2026-07-16T03:30:00Z'
from public.prospects prospect
where prospect.nickname = '운영분류교수이력';

insert into public.counseling_requests(
  prospect_id, assessment_id, status, contact_method, availability, consent_given,
  assigned_faculty_id, assigned_at, created_at, updated_at
)
select prospect.id,
  (select assessment.id from public.assessments assessment where assessment.prospect_id = prospect.id limit 1),
  'assigned', 'text', 'weekday_evening', true,
  (select id from public.faculty order by id offset 1 limit 1),
  '2026-07-16T04:00:00Z', '2026-07-16T04:00:00Z', '2026-07-16T04:00:00Z'
from public.prospects prospect
where prospect.nickname = '운영분류교수이력';

insert into public.counseling_requests(
  prospect_id, assessment_id, status, contact_method, availability, consent_given,
  assigned_faculty_id, assigned_at, created_at, updated_at
)
select prospect.id,
  (select assessment.id from public.assessments assessment where assessment.prospect_id = prospect.id limit 1),
  'assigned', 'text', 'weekday_evening', true,
  (select id from public.faculty order by id limit 1),
  '2026-07-16T04:10:00Z', '2026-07-16T04:10:00Z', '2026-07-16T04:10:00Z'
from public.prospects prospect
where prospect.nickname = '운영분류상담';

insert into public.counseling_requests(
  prospect_id, assessment_id, status, contact_method, availability, consent_given,
  created_at, updated_at
)
select prospect.id,
  (select assessment.id from public.assessments assessment where assessment.prospect_id = prospect.id limit 1),
  'new', 'text', 'weekday_evening', true,
  '2026-07-16T04:20:00Z', '2026-07-16T04:20:00Z'
from public.prospects prospect
where prospect.nickname = '운영분류미배정';

insert into public.export_jobs(created_by_admin_id, filter_snapshot)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '{"query":"운영분류","exportSegment":"completed_without_counseling"}'::jsonb);
select results_eq(
  $$select student_count, assessment_count, counseling_count
    from public.admin_export_counts(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  $$values (1, 1, 0)$$,
  'completed-without-counseling target is exclusive across all sheet counts'
);
update public.export_jobs set status = 'fetching'
where id = (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select results_eq(
  $$select payload ->> 'nickname'
    from public.admin_export_student_rows(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)$$,
  $$values ('운영분류완료만')$$,
  'completed-without-counseling student rows match the count predicate'
);

insert into public.export_jobs(created_by_admin_id, filter_snapshot)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '{"query":"운영분류","exportSegment":"not_completed"}'::jsonb);
select results_eq(
  $$select student_count, assessment_count, counseling_count
    from public.admin_export_counts(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  $$values (1, 0, 0)$$,
  'not-completed target excludes every completed assessment and counseling row'
);
update public.export_jobs set status = 'fetching'
where id = (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select results_eq(
  $$select payload ->> 'nickname'
    from public.admin_export_student_rows(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)$$,
  $$values ('운영분류미완료')$$,
  'not-completed student rows match the count predicate'
);

insert into public.export_jobs(created_by_admin_id, filter_snapshot)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '{"query":"운영분류","exportSegment":"counseling_requested","counselingStatus":"assigned"}'::jsonb);
select results_eq(
  $$select student_count, assessment_count, counseling_count
    from public.admin_export_counts(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  $$values (2, 2, 2)$$,
  'counseling target ANDs with counseling status across every sheet count'
);
update public.export_jobs set status = 'fetching'
where id = (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select results_eq(
  $$select payload ->> 'nickname'
    from public.admin_export_student_rows(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)
    order by payload ->> 'nickname'$$,
  $$values ('운영분류교수이력'), ('운영분류상담')$$,
  'counseling student rows use the same status-composed target predicate'
);

insert into public.export_jobs(created_by_admin_id, filter_snapshot)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  jsonb_build_object('query', '운영분류', 'assignedFaculty', (select id from public.faculty order by id offset 1 limit 1)));
select results_eq(
  $$select student_count, assessment_count, counseling_count
    from public.admin_export_counts(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  $$values (1, 1, 2)$$,
  'assigned faculty filter follows the current request while retaining that student history'
);
update public.export_jobs set status = 'fetching'
where id = (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select results_eq(
  $$select payload ->> 'nickname'
    from public.admin_export_student_rows(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)$$,
  $$values ('운영분류교수이력')$$,
  'historic faculty A does not override current faculty B for student rows'
);
select results_eq(
  $$select payload #>> '{prospect,nickname}'
    from public.admin_export_counseling_rows(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)
    order by payload ->> 'created_at'$$,
  $$values ('운영분류교수이력'), ('운영분류교수이력')$$,
  'assigned faculty export retains counseling history for its latest-assigned student'
);

insert into public.export_jobs(created_by_admin_id, filter_snapshot)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '{"query":"운영분류","assignedFaculty":"unassigned"}'::jsonb);
select results_eq(
  $$select student_count, assessment_count, counseling_count
    from public.admin_export_counts(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  $$values (1, 1, 1)$$,
  'unassigned faculty filter matches only the latest unassigned counseling request'
);
update public.export_jobs set status = 'fetching'
where id = (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select results_eq(
  $$select payload ->> 'nickname'
    from public.admin_export_student_rows(
      (select max(id) from public.export_jobs where created_by_admin_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, null, 1000)$$,
  $$values ('운영분류미배정')$$,
  'unassigned faculty student rows match the count predicate'
);

select * from finish();
rollback;
