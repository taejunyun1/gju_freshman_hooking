begin;

select plan(11);

insert into public.prospects(
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name,
  applicant_stage, region, created_at, last_active_at, updated_at
) values
  ('운영분류완료전용', decode(repeat('81', 32), 'hex'), decode(repeat('82', 16), 'hex'), decode(repeat('83', 12), 'hex'),
    '광주고등학교', 'high3', 'gwangju', '2026-07-20T01:00:00Z', '2026-07-20T01:00:00Z', '2026-07-20T01:00:00Z'),
  ('운영분류미완료', decode(repeat('84', 32), 'hex'), decode(repeat('85', 16), 'hex'), decode(repeat('86', 12), 'hex'),
    '전남고등학교', 'high3', 'jeonbuk', '2026-07-20T01:00:01Z', '2026-07-20T01:00:01Z', '2026-07-20T01:00:01Z'),
  ('운영상담최신배정', decode(repeat('87', 32), 'hex'), decode(repeat('88', 16), 'hex'), decode(repeat('89', 12), 'hex'),
    '광주고등학교', 'high3', 'gwangju', '2026-07-20T01:00:02Z', '2026-07-20T01:00:02Z', '2026-07-20T01:00:02Z'),
  ('운영상담미배정', decode(repeat('8a', 32), 'hex'), decode(repeat('8b', 16), 'hex'), decode(repeat('8c', 12), 'hex'),
    '광주고등학교', 'high3', 'gwangju', '2026-07-20T01:00:03Z', '2026-07-20T01:00:03Z', '2026-07-20T01:00:03Z');

insert into public.assessments(
  prospect_id, idempotency_key, track_scores, environment_score, result_snapshot, completed_at, created_at
)
select prospect.id, pg_catalog.gen_random_uuid(),
  '{"documentary":20,"art_photo":90,"commercial":30,"video":40}'::jsonb,
  80,
  '{"rankedTracks":["art_photo","video","commercial","documentary"],"selectedInterests":[{"group":"work","key":"work.art","label":"예술사진"},{"group":"result","key":"result.exhibition","label":"전시"},{"group":"style","key":"style.gallery","label":"전시장"},{"group":"career","key":"career.artist","label":"작가"}]}'::jsonb,
  prospect.created_at + interval '1 minute', prospect.created_at + interval '1 minute'
from public.prospects prospect
where prospect.nickname in ('운영분류완료전용', '운영상담최신배정', '운영상담미배정');

with faculty_fixture as (
  select
    (select id from public.faculty order by id limit 1) as historic_faculty_id,
    (select id from public.faculty order by id offset 1 limit 1) as current_faculty_id
), latest_prospect as (
  select id from public.prospects where nickname = '운영상담최신배정'
)
insert into public.counseling_requests(
  prospect_id, assessment_id, status, contact_method, availability, consent_given,
  assigned_faculty_id, assigned_at, closed_at, created_at, updated_at
)
select latest_prospect.id,
  (select id from public.assessments where prospect_id = latest_prospect.id),
  'closed', 'text', 'weekday_evening', true,
  faculty_fixture.historic_faculty_id, '2026-07-20T01:02:00Z', '2026-07-20T01:03:00Z',
  '2026-07-20T01:02:00Z', '2026-07-20T01:03:00Z'
from latest_prospect cross join faculty_fixture;

with faculty_fixture as (
  select (select id from public.faculty order by id offset 1 limit 1) as current_faculty_id
), latest_prospect as (
  select id from public.prospects where nickname = '운영상담최신배정'
)
insert into public.counseling_requests(
  prospect_id, assessment_id, status, contact_method, availability, consent_given,
  assigned_faculty_id, assigned_at, created_at, updated_at
)
select latest_prospect.id,
  (select id from public.assessments where prospect_id = latest_prospect.id),
  'assigned', 'text', 'weekday_evening', true,
  faculty_fixture.current_faculty_id, '2026-07-20T01:04:00Z', '2026-07-20T01:04:00Z', '2026-07-20T01:04:00Z'
from latest_prospect cross join faculty_fixture;

insert into public.counseling_requests(
  prospect_id, assessment_id, status, contact_method, availability, consent_given, created_at, updated_at
)
select prospect.id, (select id from public.assessments where prospect_id = prospect.id),
  'new', 'text', 'weekday_evening', true, '2026-07-20T01:05:00Z', '2026-07-20T01:05:00Z'
from public.prospects prospect
where prospect.nickname = '운영상담미배정';

select results_eq(
  $$select nickname from public.prospects
    where public.is_admin_export_student_match(id, '{"exportSegment":"completed_without_counseling"}'::jsonb, '2026-07-21T00:00:00Z')
      and nickname like '운영%'
    order by nickname$$,
  $$values ('운영분류완료전용'::text)$$,
  'completed-without-counseling selects only completed students without counseling requests'
);
select results_eq(
  $$select nickname from public.prospects
    where public.is_admin_export_student_match(id, '{"exportSegment":"not_completed"}'::jsonb, '2026-07-21T00:00:00Z')
      and nickname like '운영%'
    order by nickname$$,
  $$values ('운영분류미완료'::text)$$,
  'not-completed selects only students without a completed assessment'
);
select results_eq(
  $$select nickname from public.prospects
    where public.is_admin_export_student_match(id, '{"exportSegment":"counseling_requested"}'::jsonb, '2026-07-21T00:00:00Z')
      and nickname like '운영%'
    order by nickname$$,
  $$values ('운영상담미배정'::text), ('운영상담최신배정'::text)$$,
  'counseling target selects every student with a counseling request'
);
select is(
  (select count(*)::integer from public.assessments assessment
   where public.is_admin_export_assessment_match(assessment.id, '{"exportSegment":"not_completed"}'::jsonb, '2026-07-21T00:00:00Z')),
  0,
  'not-completed target has no participation rows'
);
select is(
  (select count(*)::integer from public.assessments assessment
   where public.is_admin_export_assessment_match(assessment.id, '{"exportSegment":"completed_without_counseling"}'::jsonb, '2026-07-21T00:00:00Z')),
  1,
  'completed-without-counseling target retains its participation row'
);
select results_eq(
  $$select nickname from public.prospects
    where public.is_admin_export_student_match(
      id,
      jsonb_build_object('assignedFaculty', (select id from public.faculty order by id offset 1 limit 1)),
      '2026-07-21T00:00:00Z'
    ) and nickname like '운영%'
    order by nickname$$,
  $$values ('운영상담최신배정'::text)$$,
  'current faculty selection uses the latest counseling assignment'
);
select is(
  (select count(*)::integer from public.prospects
   where public.is_admin_export_student_match(
     id,
     jsonb_build_object('assignedFaculty', (select id from public.faculty order by id limit 1)),
     '2026-07-21T00:00:00Z'
   ) and nickname = '운영상담최신배정'),
  0,
  'historic faculty assignment does not retain the student after reassignment'
);
select results_eq(
  $$select nickname from public.prospects
    where public.is_admin_export_student_match(id, '{"assignedFaculty":"unassigned"}'::jsonb, '2026-07-21T00:00:00Z')
      and nickname like '운영%'
    order by nickname$$,
  $$values ('운영상담미배정'::text)$$,
  'unassigned faculty selection requires a latest unassigned counseling request'
);
select results_eq(
  $$select nickname from public.prospects
    where public.is_admin_export_student_match(
      id,
      jsonb_build_object(
        'exportSegment', 'counseling_requested',
        'assignedFaculty', (select id from public.faculty order by id offset 1 limit 1),
        'counselingStatus', 'assigned'
      ),
      '2026-07-21T00:00:00Z'
    ) and nickname like '운영%'
    order by nickname$$,
  $$values ('운영상담최신배정'::text)$$,
  'target, faculty, and counseling status combine with AND semantics'
);
select is(
  (select count(*)::integer from public.counseling_requests request
   where public.is_admin_export_counseling_match(
     request.id,
     jsonb_build_object('assignedFaculty', (select id from public.faculty order by id offset 1 limit 1)),
     '2026-07-21T00:00:00Z'
   )),
  2,
  'faculty-selected student keeps both counseling history rows in the counseling export'
);
select is(
  (select count(*)::integer from public.assessments assessment
   where public.is_admin_export_assessment_match(
     assessment.id,
     jsonb_build_object('assignedFaculty', (select id from public.faculty order by id offset 1 limit 1)),
     '2026-07-21T00:00:00Z'
   )),
  1,
  'faculty-selected student keeps the matching participation row'
);

select * from finish();
rollback;
