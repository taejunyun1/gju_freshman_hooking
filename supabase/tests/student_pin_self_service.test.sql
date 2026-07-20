begin;

select plan(20);

select isnt(
  pg_catalog.to_regprocedure('public.change_roster_student_pin_self_v1(bytea,bytea,integer,bytea,bytea,timestamptz)'),
  null,
  'signed-in student PIN-change RPC exists'
);

select ok(
  position(
    'roster-pin-reset' in pg_get_functiondef(
      'public.reset_roster_student_pin_and_assessment_v1(bytea,bytea,integer,bytea,timestamptz)'::regprocedure
    )
  ) > 0,
  'reset applies a narrow per-phone abuse limit inside its one database RPC'
);

select isnt(
  pg_catalog.to_regprocedure('public.reset_roster_student_pin_and_assessment_v1(bytea,bytea,integer,bytea,timestamptz)'),
  null,
  'forgot-PIN reset RPC exists'
);

insert into public.admission_cycles (id, year, status, roster_version, password_key_version)
values ('29000000-0000-4000-8000-000000000001', 2026, 'current', 0, 1);

insert into public.prospects (
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region,
  status, admission_cycle_id, name_hmac, name_ciphertext, name_iv
) values (
  'student-pin-self-service', decode(repeat('11', 32), 'hex'), decode(repeat('12', 16), 'hex'), decode(repeat('13', 12), 'hex'),
  '광주고등학교', 'high3', 'gwangju', 'active', '29000000-0000-4000-8000-000000000001',
  decode(repeat('14', 32), 'hex'), decode(repeat('15', 16), 'hex'), decode(repeat('16', 12), 'hex')
);

insert into public.student_credentials (prospect_id, password_hash, password_salt, password_bcrypt, password_generation)
select id, decode(repeat('00', 32), 'hex'), decode(repeat('00', 16), 'hex'),
  extensions.crypt(encode(decode(repeat('21', 32), 'hex'), 'hex'), extensions.gen_salt('bf', 10)), 1
from public.prospects where nickname = 'student-pin-self-service';

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('31', 32), 'hex'), now() + interval '1 hour', now() + interval '1 hour'
from public.prospects where nickname = 'student-pin-self-service';

insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
select id, decode(repeat('32', 32), 'hex'), now() + interval '1 hour', now() + interval '1 hour'
from public.prospects where nickname = 'student-pin-self-service';

insert into public.assessments (prospect_id, idempotency_key, track_scores, environment_score, result_snapshot)
select id, '29000000-0000-4000-8000-000000000002',
  '{"documentary":25,"art_photo":25,"commercial":25,"video":25}'::jsonb, 80,
  pg_catalog.jsonb_build_object(
    'marker', 'student-pin-reset',
    'rankedTracks', pg_catalog.jsonb_build_array('commercial', 'art_photo', 'video', 'documentary'),
    'selectedInterests', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('group', 'work', 'key', 'work.commercial_image', 'label', '광고 이미지 만들기'),
      pg_catalog.jsonb_build_object('group', 'result', 'key', 'result.commercial_fashion', 'label', '광고·패션 이미지'),
      pg_catalog.jsonb_build_object('group', 'style', 'key', 'style.studio', 'label', '스튜디오에서 촬영'),
      pg_catalog.jsonb_build_object('group', 'career', 'key', 'career.photo', 'label', '사진 직접 촬영·보정')
    )
  )
from public.prospects where nickname = 'student-pin-self-service';

insert into public.counseling_requests (prospect_id, assessment_id, contact_method, availability, inquiry, consent_given)
select prospect.id, assessment.id, 'text', 'weekday_afternoon', '상담을 유지해야 합니다.', true
from public.prospects prospect
join public.assessments assessment on assessment.prospect_id = prospect.id
where prospect.nickname = 'student-pin-self-service';

insert into public.events (prospect_id, event_name, path)
select id, 'login_succeeded', '/api/student/login' from public.prospects where nickname = 'student-pin-self-service';

insert into public.events (prospect_id, event_name, path)
select id, 'assessment_completed', '/assessment' from public.prospects where nickname = 'student-pin-self-service';

insert into public.events (prospect_id, event_name, path)
select id, 'result_viewed', '/result/29000000-0000-4000-8000-000000000003' from public.prospects where nickname = 'student-pin-self-service';

create temporary table reset_result as
select public.reset_roster_student_pin_and_assessment_v1(
  decode(repeat('11', 32), 'hex'), decode(repeat('41', 32), 'hex'), 1,
  decode(repeat('42', 32), 'hex'), clock_timestamp() + interval '1 hour'
) result;

select is((select result ->> 'kind' from reset_result), 'authenticated', 'reset re-authenticates the current roster student');
select is((select count(*) from public.assessments where prospect_id = (select id from public.prospects where nickname = 'student-pin-self-service')), 0::bigint, 'reset deletes the student assessment history');
select is((select count(*) from public.counseling_requests where prospect_id = (select id from public.prospects where nickname = 'student-pin-self-service')), 1::bigint, 'reset preserves the counseling request');
select is((select assessment_id from public.counseling_requests where prospect_id = (select id from public.prospects where nickname = 'student-pin-self-service')), null, 'reset detaches counseling from the deleted assessment');
select is((select inquiry from public.counseling_requests where prospect_id = (select id from public.prospects where nickname = 'student-pin-self-service')), '상담을 유지해야 합니다.', 'reset preserves counseling content');
select is((select count(*) from public.events where prospect_id = (select id from public.prospects where nickname = 'student-pin-self-service') and event_name in ('assessment_started', 'assessment_step_completed', 'assessment_completed', 'result_viewed', 'resource_opened')), 0::bigint, 'reset removes only interest and result events');
select is((select count(*) from public.events where prospect_id = (select id from public.prospects where nickname = 'student-pin-self-service') and event_name = 'login_succeeded'), 1::bigint, 'reset keeps login audit events');
select is((select extensions.crypt(encode(decode(repeat('41', 32), 'hex'), 'hex'), password_bcrypt) = password_bcrypt from public.student_credentials where prospect_id = (select id from public.prospects where nickname = 'student-pin-self-service')), true, 'reset stores only bcrypt of the new Worker digest');
select is((select count(*) from public.student_sessions where prospect_id = (select id from public.prospects where nickname = 'student-pin-self-service') and token_hash in (decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex')) and revoked_at is not null), 2::bigint, 'reset revokes all prior sessions');
select is((select count(*) from public.student_sessions where token_hash = decode(repeat('42', 32), 'hex') and revoked_at is null), 1::bigint, 'reset creates exactly one replacement session');

create temporary table change_result as
select public.change_roster_student_pin_self_v1(
  decode(repeat('42', 32), 'hex'), decode(repeat('41', 32), 'hex'), 1,
  decode(repeat('51', 32), 'hex'), decode(repeat('52', 32), 'hex'), clock_timestamp() + interval '1 hour'
) result;

select is((select result ->> 'kind' from change_result), 'authenticated', 'current PIN change re-authenticates the signed-in student');
select is((select extensions.crypt(encode(decode(repeat('51', 32), 'hex'), 'hex'), password_bcrypt) = password_bcrypt from public.student_credentials where prospect_id = (select id from public.prospects where nickname = 'student-pin-self-service')), true, 'PIN change bcrypts only the replacement digest');
select is((select revoked_at is not null from public.student_sessions where token_hash = decode(repeat('42', 32), 'hex')), true, 'PIN change revokes the initiating old session');
select is((select count(*) from public.student_sessions where token_hash = decode(repeat('52', 32), 'hex') and revoked_at is null), 1::bigint, 'PIN change creates the replacement session');
select is((select public.change_roster_student_pin_self_v1(decode(repeat('52', 32), 'hex'), decode(repeat('61', 32), 'hex'), 1, decode(repeat('62', 32), 'hex'), decode(repeat('63', 32), 'hex'), clock_timestamp() + interval '1 hour') ->> 'kind'), 'failed', 'wrong current PIN does not change credentials');

select is(
  (
    select count(*) from (values ('public'::name), ('anon'::name), ('authenticated'::name)) roles(role)
    cross join (values
      ('change_roster_student_pin_self_v1(bytea,bytea,integer,bytea,bytea,timestamptz)'::text),
      ('reset_roster_student_pin_and_assessment_v1(bytea,bytea,integer,bytea,timestamptz)'::text)
    ) procedures(signature)
    where has_function_privilege(roles.role, ('public.' || procedures.signature)::regprocedure, 'execute')
  ), 0::bigint, 'browser roles cannot execute self-service PIN RPCs directly'
);

select is(
  (
    select count(*) from (values
      ('change_roster_student_pin_self_v1(bytea,bytea,integer,bytea,bytea,timestamptz)'::text),
      ('reset_roster_student_pin_and_assessment_v1(bytea,bytea,integer,bytea,timestamptz)'::text)
    ) procedures(signature)
    where has_function_privilege('service_role', ('public.' || procedures.signature)::regprocedure, 'execute')
  ), 2::bigint, 'only service_role can execute self-service PIN RPCs'
);

select * from finish();

rollback;
