begin;

select plan(83);

select has_table('public'::name, 'counseling_requests'::name);
select has_table('public'::name, 'counseling_faculty_recommendations'::name);
select has_function(
  'public',
  'create_counseling_request',
  array['bigint', 'bigint', 'text', 'text', 'text', 'boolean'],
  'create counseling is an owned-assessment RPC'
);
select has_function(
  'public',
  'transition_counseling_request',
  array['bigint', 'integer', 'text', 'bigint', 'text'],
  'normal transitions use an optimistic version'
);
select has_function(
  'public',
  'reopen_counseling_request',
  array['bigint', 'integer', 'text', 'uuid', 'uuid'],
  'reopen is a separate audited administrator RPC'
);
select has_function(
  'public',
  'admin_transition_counseling_request',
  array['bigint', 'integer', 'text', 'bigint', 'uuid', 'uuid'],
  'administrator transitions are audited atomically'
);
select has_function(
  'public',
  'record_counseling_sensitive_access',
  array['bigint', 'text', 'uuid', 'uuid'],
  'sensitive counseling reads are audited through a constrained RPC'
);
select has_column('public'::name, 'counseling_requests'::name, 'assessment_public_id_snapshot'::name, 'durable assessment public ID exists');
select has_column('public'::name, 'counseling_requests'::name, 'campaign_id_snapshot'::name, 'durable campaign exists');
select has_column('public'::name, 'counseling_requests'::name, 'primary_track_snapshot'::name, 'durable primary track exists');
select has_column('public'::name, 'counseling_requests'::name, 'secondary_track_snapshot'::name, 'durable secondary track exists');
select has_column('public'::name, 'counseling_requests'::name, 'selected_work_labels_snapshot'::name, 'durable work labels exist');
select has_column('public'::name, 'counseling_requests'::name, 'selected_career_labels_snapshot'::name, 'durable career labels exist');
select has_index('public'::name, 'counseling_requests'::name, 'counseling_requests_primary_track_idx'::name, 'primary track queue index exists');
select has_index('public'::name, 'counseling_requests'::name, 'counseling_requests_campaign_idx'::name, 'campaign queue index exists');
select ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.transition_counseling_request(bigint,integer,text,bigint,text)'::regprocedure,
    'EXECUTE'
  ),
  'the service role cannot bypass administrator transition auditing'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.admin_transition_counseling_request(bigint,integer,text,bigint,uuid,uuid)'::regprocedure,
    'EXECUTE'
  ),
  'the service role can execute the audited administrator transition wrapper'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.record_counseling_sensitive_access(bigint,text,uuid,uuid)'::regprocedure,
    'EXECUTE'
  ),
  'the service role can record constrained sensitive-access audits'
);

select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.counseling_requests'::regclass), 'request RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.counseling_faculty_recommendations'::regclass), 'recommendation RLS is enabled');
select policies_are('public', 'counseling_requests', array[]::text[], 'requests are default deny');
select policies_are('public', 'counseling_faculty_recommendations', array[]::text[], 'recommendations are default deny');

select ok(
  exists (
    select 1
    from pg_catalog.pg_index
    where indexrelid = 'public.counseling_requests_one_open_per_prospect_idx'::regclass
      and indisunique
      and pg_catalog.pg_get_expr(indpred, indrelid) = '(status = ANY (ARRAY[''new''::text, ''assigned''::text, ''contacted''::text]))'
  ),
  'one open request per prospect is enforced by a partial unique index'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = index_row.indrelid
     and attribute.attname = 'prospect_id'
    where index_row.indexrelid = pg_catalog.to_regclass('public.counseling_requests_prospect_idx')
      and index_row.indrelid = 'public.counseling_requests'::regclass
      and not index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indpred is null
      and index_row.indkey[0] = attribute.attnum
  ),
  'a full nonunique prospect-leading index supports the FK for active and terminal rows'
);

select is(
  (select count(*)::integer
   from pg_catalog.pg_constraint
   where contype = 'f'
     and conrelid = any(array[
       'public.counseling_requests'::regclass,
       'public.counseling_faculty_recommendations'::regclass
     ])),
  5,
  'counseling relationships use five declared foreign keys'
);

select is(
  (select count(*)::integer
   from unnest(array[
     'public.create_counseling_request(bigint,bigint,text,text,text,boolean)'::regprocedure,
     'public.admin_transition_counseling_request(bigint,integer,text,bigint,uuid,uuid)'::regprocedure,
     'public.reopen_counseling_request(bigint,integer,text,uuid,uuid)'::regprocedure
   ]) procedure_oid
   join pg_catalog.pg_proc procedure on procedure.oid = procedure_oid
   where procedure.prosecdef),
  3,
  'all counseling mutation RPCs are security definer'
);

select is(
  (select count(*)::integer
   from unnest(array[
     'public.create_counseling_request(bigint,bigint,text,text,text,boolean)'::regprocedure,
     'public.admin_transition_counseling_request(bigint,integer,text,bigint,uuid,uuid)'::regprocedure,
     'public.reopen_counseling_request(bigint,integer,text,uuid,uuid)'::regprocedure
   ]) procedure_oid
   join pg_catalog.pg_proc procedure on procedure.oid = procedure_oid
   where 'search_path=""' = any(coalesce(procedure.proconfig, array[]::text[]))),
  3,
  'all counseling RPCs pin an empty search path'
);

select is(
  (select count(*)::integer
   from unnest(array[
     'public.create_counseling_request(bigint,bigint,text,text,text,boolean)'::regprocedure,
     'public.transition_counseling_request(bigint,integer,text,bigint,text)'::regprocedure,
     'public.admin_transition_counseling_request(bigint,integer,text,bigint,uuid,uuid)'::regprocedure,
     'public.reopen_counseling_request(bigint,integer,text,uuid,uuid)'::regprocedure,
     'public.record_counseling_sensitive_access(bigint,text,uuid,uuid)'::regprocedure
   ]) procedure_oid
   cross join unnest(array['anon', 'authenticated']) role_name
   where pg_catalog.has_function_privilege(role_name, procedure_oid, 'EXECUTE')),
  0,
  'client roles cannot execute counseling mutations'
);

select is(
  (select count(*)::integer
   from unnest(array[
     'public.create_counseling_request(bigint,bigint,text,text,text,boolean)'::regprocedure,
     'public.admin_transition_counseling_request(bigint,integer,text,bigint,uuid,uuid)'::regprocedure,
     'public.reopen_counseling_request(bigint,integer,text,uuid,uuid)'::regprocedure
   ]) procedure_oid
   where pg_catalog.has_function_privilege('service_role', procedure_oid, 'EXECUTE')),
  3,
  'the service role can execute every counseling mutation'
);

insert into public.prospects (
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region
) values
  ('상담학생11', decode(repeat('11', 32), 'hex'), decode(repeat('12', 16), 'hex'), decode(repeat('13', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'),
  ('상담학생22', decode(repeat('21', 32), 'hex'), decode(repeat('22', 16), 'hex'), decode(repeat('23', 12), 'hex'), '전남고등학교', 'high2', 'jeonbuk');

insert into public.faculty (
  name, title, employment_type, consultation_role, expertise_summary, bio,
  contact_visibility, source_date, status, weekly_capacity
) values
  ('상담 총괄', '교수', 'full_time', 'primary', '예술사진·영상촬영', '총괄 교수 소개', '{"office":"admin_only","phone":"admin_only","email":"admin_only","website":"admin_only"}', '2026-07-14', 'active', 4),
  ('상담 예비', '교수', 'full_time', 'primary', '다큐멘터리·기록', '예비 교수 소개', '{"office":"admin_only","phone":"admin_only","email":"admin_only","website":"admin_only"}', '2026-07-14', 'active', 4),
  ('상담 전문1', '겸임교수', 'adjunct', 'specialist', '전시기획·큐레이팅', '전문 교수 소개', '{"office":"admin_only","phone":"admin_only","email":"admin_only","website":"admin_only"}', '2026-07-14', 'active', 0),
  ('비활성 교수', '교수', 'full_time', 'primary', '사진', '비활성 교수 소개', '{"office":"admin_only","phone":"admin_only","email":"admin_only","website":"admin_only"}', '2026-07-14', 'archived', 4);

insert into public.assessments (
  prospect_id, idempotency_key, track_scores, environment_score, result_snapshot
)
select
  prospect.id,
  case prospect.nickname
    when '상담학생11' then '11111111-1111-4111-8111-111111111111'::uuid
    else '22222222-2222-4222-8222-222222222222'::uuid
  end,
  '{"documentary":70,"art_photo":80,"commercial":60,"video":50}'::jsonb,
  75,
  pg_catalog.jsonb_build_object(
    'rankedTracks', pg_catalog.jsonb_build_array('commercial', 'art_photo', 'video', 'documentary'),
    'selectedInterests', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('group', 'work', 'key', 'work.commercial_image', 'label', '제품·패션·광고 이미지 만들기'),
      pg_catalog.jsonb_build_object('group', 'result', 'key', 'result.commercial_fashion', 'label', '광고·패션 이미지'),
      pg_catalog.jsonb_build_object('group', 'style', 'key', 'style.studio', 'label', '스튜디오에서 촬영'),
      pg_catalog.jsonb_build_object('group', 'career', 'key', 'career.photo', 'label', '사진 직접 촬영·보정')
    ),
    'faculty', pg_catalog.jsonb_build_object(
      'primary', pg_catalog.jsonb_build_object(
        'role', 'primary', 'id', (select id from public.faculty where name = '상담 총괄'),
        'name', '상담 총괄', 'title', '교수', 'expertise', '예술사진·영상촬영',
        'reason', '선택한 예술사진 관심과 연결된 총괄 교수입니다.', 'publicContacts', '{}'::jsonb
      ),
      'backup', pg_catalog.jsonb_build_object(
        'role', 'backup', 'id', (select id from public.faculty where name = '상담 예비'),
        'name', '상담 예비', 'title', '교수', 'expertise', '다큐멘터리·기록',
        'reason', '선택한 기록 관심과 연결된 예비 교수입니다.', 'publicContacts', '{}'::jsonb
      ),
      'specialists', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'role', 'specialist', 'id', (select id from public.faculty where name = '상담 전문1'),
          'name', '상담 전문1', 'title', '겸임교수', 'expertise', '전시기획·큐레이팅',
          'reason', '선택한 전시 관심과 연결된 전문 연계입니다.', 'publicContacts', '{}'::jsonb
        )
      )
    )
  )
from public.prospects prospect;

update public.faculty
set
  name = '현재 상담 총괄',
  title = '학과장',
  expertise_summary = '현재 수정된 전문분야'
where name = '상담 총괄';

create temporary table counseling_rpc_results (
  call_name text primary key,
  counseling_request_id bigint not null,
  public_id uuid not null,
  created boolean not null
);
grant select, insert, update, delete on table pg_temp.counseling_rpc_results to service_role;

set local role service_role;

insert into pg_temp.counseling_rpc_results
select 'first', result.*
from public.create_counseling_request(
  (select id from public.prospects where nickname = '상담학생11'),
  (select assessment.id from public.assessments assessment join public.prospects prospect on prospect.id = assessment.prospect_id where prospect.nickname = '상담학생11'),
  'phone', 'weekday_morning', '전공 상담을 받고 싶어요.', true
) result;

reset role;

select is((select created from pg_temp.counseling_rpc_results where call_name = 'first'), true, 'the first request is created');
select is((select status from public.counseling_requests), 'new', 'new is the initial status');
select is((select version from public.counseling_requests), 0, 'new requests start at version zero');
select is(
  (select assessment_public_id_snapshot from public.counseling_requests),
  (select assessment.public_id from public.assessments assessment join public.prospects prospect on prospect.id = assessment.prospect_id where prospect.nickname = '상담학생11'),
  'the durable assessment public ID is copied at counseling time'
);
select is((select campaign_id_snapshot from public.counseling_requests), null::bigint, 'a missing campaign remains a durable null');
select is((select primary_track_snapshot from public.counseling_requests), 'commercial', 'the primary track is copied exactly');
select is((select secondary_track_snapshot from public.counseling_requests), 'art_photo', 'the secondary track is copied exactly');
select is(
  (select selected_work_labels_snapshot from public.counseling_requests),
  array['제품·패션·광고 이미지 만들기']::text[],
  'selected work labels are copied exactly in canonical order'
);
select is(
  (select selected_career_labels_snapshot from public.counseling_requests),
  array['사진 직접 촬영·보정']::text[],
  'selected career labels are copied exactly in canonical order'
);
select throws_ok(
  $$update public.counseling_requests set primary_track_snapshot = 'video'$$,
  '23514', 'counseling context snapshot is immutable',
  'durable counseling context cannot be rewritten after creation'
);
select ok((select consent_given and consented_at is not null from public.counseling_requests), 'required transfer consent is timestamped');
select is((select count(*)::integer from public.counseling_faculty_recommendations), 3, 'primary, backup, and specialist snapshots persist');
select ok(
  exists (
    select 1
    from public.faculty
    where name = '현재 상담 총괄'
      and title = '학과장'
      and expertise_summary = '현재 수정된 전문분야'
  ),
  'live faculty content differs after the assessment snapshot is created'
);
select results_eq(
  $$select faculty_name_snapshot, faculty_title_snapshot, expertise_snapshot, reason_snapshot
    from public.counseling_faculty_recommendations where role = 'primary'$$,
  $$values (
    '상담 총괄'::text,
    '교수'::text,
    '예술사진·영상촬영'::text,
    '선택한 예술사진 관심과 연결된 총괄 교수입니다.'::text
  )$$,
  'persisted faculty fields come from the assessment snapshot rather than changed live content'
);
select results_eq(
  $$select role, rank from public.counseling_faculty_recommendations order by case role when 'primary' then 1 when 'backup' then 2 else 3 end, rank$$,
  $$values ('primary'::text, 1::smallint), ('backup'::text, 1::smallint), ('specialist'::text, 1::smallint)$$,
  'recommendation roles keep their canonical ranks'
);
select is(
  (select reason_snapshot from public.counseling_faculty_recommendations where role = 'primary'),
  '선택한 예술사진 관심과 연결된 총괄 교수입니다.',
  'recommendation reason is copied exactly from the assessment snapshot'
);
select is(
  (select score_snapshot from public.counseling_faculty_recommendations where role = 'primary'),
  null::numeric,
  'score remains null because the canonical result snapshot contains no faculty score'
);

set local role service_role;

insert into pg_temp.counseling_rpc_results
select 'duplicate', result.*
from public.create_counseling_request(
  (select id from public.prospects where nickname = '상담학생11'),
  (select assessment.id from public.assessments assessment join public.prospects prospect on prospect.id = assessment.prospect_id where prospect.nickname = '상담학생11'),
  'text', 'weekend', '재요청은 기존 건을 반환해야 합니다.', true
) result;

reset role;

select results_eq(
  $$select counseling_request_id, public_id, created from pg_temp.counseling_rpc_results where call_name = 'duplicate'$$,
  $$select counseling_request_id, public_id, false from pg_temp.counseling_rpc_results where call_name = 'first'$$,
  'duplicate submission returns the existing open request'
);
select is((select count(*)::integer from public.counseling_requests), 1, 'duplicate submission creates no second row');
select is((select contact_method from public.counseling_requests), 'phone', 'duplicate submission cannot overwrite the original request');

select throws_ok(
  format(
    'select * from public.create_counseling_request(%s,%s,%L,%L,%L,%L)',
    (select id from public.prospects where nickname = '상담학생22'),
    (select assessment.id from public.assessments assessment join public.prospects prospect on prospect.id = assessment.prospect_id where prospect.nickname = '상담학생11'),
    'phone', 'weekday_morning', null, true
  ),
  'P0002', 'assessment not found', 'a prospect cannot apply with another student assessment'
);
select throws_ok(
  format(
    'select * from public.create_counseling_request(%s,%s,%L,%L,%L,%L)',
    (select id from public.prospects where nickname = '상담학생22'),
    (select assessment.id from public.assessments assessment join public.prospects prospect on prospect.id = assessment.prospect_id where prospect.nickname = '상담학생22'),
    'phone', 'weekday_morning', null, false
  ),
  '23514', 'counseling consent is required', 'consent cannot be bypassed through the RPC'
);
select throws_ok(
  format(
    'select * from public.create_counseling_request(%s,%s,%L,%L,%L,%L)',
    (select id from public.prospects where nickname = '상담학생22'),
    (select assessment.id from public.assessments assessment join public.prospects prospect on prospect.id = assessment.prospect_id where prospect.nickname = '상담학생22'),
    'email', 'weekday_morning', null, true
  ),
  '22023', 'invalid counseling contact method', 'contact methods are allow-listed by the RPC'
);
select throws_ok(
  format(
    'select * from public.create_counseling_request(%s,%s,%L,%L,%L,%L)',
    (select id from public.prospects where nickname = '상담학생22'),
    (select assessment.id from public.assessments assessment join public.prospects prospect on prospect.id = assessment.prospect_id where prospect.nickname = '상담학생22'),
    'phone', 'anytime', null, true
  ),
  '22023', 'invalid counseling availability', 'availability is allow-listed by the RPC'
);

select throws_ok(
  $$insert into public.counseling_requests(prospect_id, assessment_id, contact_method, availability, consent_given)
    select prospect.id, assessment.id, 'phone', 'weekday_morning', true
    from public.prospects prospect join public.assessments assessment on assessment.prospect_id = prospect.id
    where prospect.nickname = '상담학생11'$$,
  '23505', null, 'the partial unique index rejects a second directly inserted open request'
);
select throws_ok(
  $$insert into public.counseling_requests(prospect_id, assessment_id, contact_method, availability, inquiry, consent_given)
    select prospect.id, assessment.id, 'phone', 'weekday_morning', repeat('가', 201), true
    from public.prospects prospect join public.assessments assessment on assessment.prospect_id = prospect.id
    where prospect.nickname = '상담학생22'$$,
  '23514', null, 'inquiry text cannot exceed 200 characters'
);

insert into auth.users (id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.admin_users (id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select throws_ok(
  format(
    'select * from public.admin_transition_counseling_request(%s,0,%L,%s,%L,%L)',
    (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
    'assigned',
    (select id from public.faculty where name = '비활성 교수'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-0000-4000-8000-000000000009'
  ),
  '22023', 'active assigned faculty is required',
  'assignment rejects an archived faculty member inside the atomic RPC'
);
select ok(
  not exists (
    select 1 from public.audit_events
    where request_id = 'aaaaaaaa-0000-4000-8000-000000000009'
  ),
  'a rejected assignment leaves no orphan audit event'
);

set local role service_role;

select * from public.admin_transition_counseling_request(
  (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
  0,
  'assigned',
  (select faculty_id from public.counseling_faculty_recommendations
   where counseling_request_id = (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first')
     and role = 'primary'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-0000-4000-8000-000000000010'
);

reset role;

select ok(
  (select status = 'assigned' and version = 1 and assigned_at is not null and assigned_faculty_id is not null from public.counseling_requests),
  'assignment records faculty, timestamp, and next version'
);
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'counseling_assigned'
      and metadata = pg_catalog.jsonb_build_object(
        'from', 'new',
        'to', 'assigned',
        'assigned_faculty_id', (select assigned_faculty_id from public.counseling_requests limit 1)
      )
      and request_id = 'aaaaaaaa-0000-4000-8000-000000000010'
  ),
  'assignment and its sanitized audit event commit atomically'
);
select throws_ok(
  format(
    'select * from public.transition_counseling_request(%s,%s,%L,%s,%L)',
    (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
    0, 'contacted', 'null', null
  ),
  '40001', 'COUNSELING_VERSION_CONFLICT', 'a stale optimistic version is rejected'
);
select throws_ok(
  format(
    'select * from public.transition_counseling_request(%s,%s,%L,%s,%L)',
    (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
    1, 'completed', 'null', null
  ),
  'P0001', 'COUNSELING_TRANSITION_INVALID', 'assigned cannot skip directly to completed'
);
select throws_ok(
  format(
    'select * from public.transition_counseling_request(%s,%s,NULL,%s,%L)',
    (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
    1, 'null', null
  ),
  'P0001', 'COUNSELING_TRANSITION_INVALID', 'a null destination cannot bypass the transition allow-list'
);

set local role service_role;
select * from public.admin_transition_counseling_request(
  (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'), 1, 'contacted', null,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000011'
);
select * from public.admin_transition_counseling_request(
  (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'), 2, 'completed', null,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000012'
);
reset role;

select ok(
  (select status = 'completed' and version = 3 and contacted_at is not null and completed_at is not null from public.counseling_requests),
  'the normal path records contacted and completed timestamps'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'counseling_transitioned'),
  2,
  'contacted and completed transitions each record one sanitized audit event'
);

set local role service_role;
select public.record_counseling_sensitive_access(
  (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
  'phone_reveal',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-0000-4000-8000-000000000020'
);
select public.record_counseling_sensitive_access(
  (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
  'summary',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-0000-4000-8000-000000000021'
);
reset role;

select ok(
  exists (
    select 1 from public.audit_events
    where action = 'admin_phone_revealed'
      and metadata = '{}'::jsonb
      and request_id = 'aaaaaaaa-0000-4000-8000-000000000020'
  ),
  'phone reveal records a metadata-free administrator audit'
);
select ok(
  exists (
    select 1 from public.events
    where event_name = 'admin_phone_revealed'
      and properties = pg_catalog.jsonb_build_object(
        'request_id', 'aaaaaaaa-0000-4000-8000-000000000020'::uuid,
        'counseling_request_id', (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first')
      )
  ),
  'phone reveal emits only a sanitized product event'
);
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'counseling_summary_created'
      and metadata = '{}'::jsonb
      and request_id = 'aaaaaaaa-0000-4000-8000-000000000021'
  ),
  'summary creation is audited without persisting its plaintext'
);

select throws_ok(
  format(
    'select * from public.reopen_counseling_request(%s,%s,%L,%L,%L)',
    (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
    3, '   ', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001'
  ),
  '22023', 'COUNSELING_REOPEN_REASON_REQUIRED', 'reopen rejects a blank administrator reason'
);

set local role service_role;
select * from public.reopen_counseling_request(
  (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
  3,
  '학생 재요청',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-0000-4000-8000-000000000002'
);
reset role;

select ok(
  (select status = 'new' and version = 4 and assigned_faculty_id is null
      and assigned_at is null and contacted_at is null and completed_at is null and closed_at is null
   from public.counseling_requests),
  'reopen returns a terminal request to a clean new state'
);
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'counseling_reopened'
      and target_type = 'counseling_request'
      and metadata = '{"reason":"학생 재요청"}'::jsonb
      and request_id = 'aaaaaaaa-0000-4000-8000-000000000002'
  ),
  'reopen writes the nonblank reason to an administrator audit event'
);
select throws_ok(
  format(
    'select * from public.reopen_counseling_request(%s,%s,%L,%L,%L)',
    (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
    4, '다시 열기', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000003'
  ),
  'P0001', 'COUNSELING_TRANSITION_INVALID', 'an active request cannot use the terminal reopen path'
);

set local role service_role;
select * from public.admin_transition_counseling_request(
  (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'), 4, 'closed', null,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000013'
);
reset role;

select ok((select status = 'closed' and closed_at is not null and version = 5 from public.counseling_requests), 'an active request can close with a timestamp');

set local role service_role;
select * from public.reopen_counseling_request(
  (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
  5,
  '종료 후 학생 재요청',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-0000-4000-8000-000000000004'
);
reset role;

select ok(
  (select status = 'new' and version = 6 and closed_at is null
   from public.counseling_requests
   where id = (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first')),
  'a closed request reopens to a clean new state'
);
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'counseling_reopened'
      and target_type = 'counseling_request'
      and metadata = '{"reason":"종료 후 학생 재요청"}'::jsonb
      and request_id = 'aaaaaaaa-0000-4000-8000-000000000004'
  ),
  'closed-to-new reopen records its administrator reason'
);

set local role service_role;
select * from public.admin_transition_counseling_request(
  (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
  6,
  'closed',
  null,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-0000-4000-8000-000000000014'
);

insert into pg_temp.counseling_rpc_results
select 'second-open', result.*
from public.create_counseling_request(
  (select id from public.prospects where nickname = '상담학생11'),
  (select assessment.id from public.assessments assessment join public.prospects prospect on prospect.id = assessment.prospect_id where prospect.nickname = '상담학생11'),
  'visit', 'weekday_afternoon', null, true
) result;
reset role;

select is(
  (select created from pg_temp.counseling_rpc_results where call_name = 'second-open'),
  true,
  'a new request can open after the earlier request closes'
);
select throws_ok(
  format(
    'select * from public.reopen_counseling_request(%s,%s,%L,%L,%L)',
    (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'),
    7,
    '기존 종료 건 재오픈',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-0000-4000-8000-000000000005'
  ),
  'P0001', 'COUNSELING_OPEN_REQUEST_EXISTS', 'reopen reports a stable conflict when a different request is already open'
);
select ok(
  (select status = 'closed'
   from public.counseling_requests
   where id = (select counseling_request_id from pg_temp.counseling_rpc_results where call_name = 'first'))
  and (select count(*) = 1
       from public.counseling_requests
       where prospect_id = (select id from public.prospects where nickname = '상담학생11')
         and status in ('new', 'assigned', 'contacted'))
  and not exists (
    select 1 from public.audit_events
    where request_id = 'aaaaaaaa-0000-4000-8000-000000000005'
  ),
  'a reopen conflict leaves both request state and audit history unchanged'
);

select throws_ok(
  $$set local role service_role;
    insert into public.counseling_requests(prospect_id, assessment_id, contact_method, availability, consent_given)
    select prospect.id, assessment.id, 'phone', 'weekday_morning', true
    from public.prospects prospect join public.assessments assessment on assessment.prospect_id = prospect.id
    where prospect.nickname = '상담학생22'$$,
  '42501', null, 'the service role cannot bypass the create RPC'
);
select throws_ok(
  $$set local role service_role;
    update public.counseling_requests set status = 'completed'$$,
  '42501', null, 'the service role cannot bypass transition RPCs'
);

select is(
  (select count(*)::integer
   from unnest(array['anon', 'authenticated']) role_name
   cross join unnest(array[
     'public.counseling_requests'::regclass,
     'public.counseling_faculty_recommendations'::regclass
   ]) relation_oid
   where pg_catalog.has_table_privilege(role_name, relation_oid, 'SELECT')),
  0,
  'client roles cannot read counseling tables directly'
);

select is(
  (select count(*)::integer
   from unnest(array[
     'public.counseling_requests'::regclass,
     'public.counseling_faculty_recommendations'::regclass
   ]) relation_oid
   where pg_catalog.has_table_privilege('service_role', relation_oid, 'SELECT')),
  2,
  'the service role can read counseling data for authorized server APIs'
);

delete from public.assessments assessment
where assessment.prospect_id = (select id from public.prospects where nickname = '상담학생11');

select ok(
  not exists (
    select 1 from public.counseling_requests request
    where request.prospect_id = (select id from public.prospects where nickname = '상담학생11')
      and request.assessment_id is not null
  ),
  'assessment retention can clear the live foreign key'
);
select ok(
  not exists (
    select 1 from public.counseling_requests request
    where request.prospect_id = (select id from public.prospects where nickname = '상담학생11')
      and (
        request.assessment_public_id_snapshot is null
        or request.primary_track_snapshot <> 'commercial'
        or request.secondary_track_snapshot <> 'art_photo'
        or request.selected_work_labels_snapshot <> array['제품·패션·광고 이미지 만들기']::text[]
        or request.selected_career_labels_snapshot <> array['사진 직접 촬영·보정']::text[]
      )
  ),
  'retention leaves every immutable administrator summary field intact'
);

select * from finish();

rollback;
