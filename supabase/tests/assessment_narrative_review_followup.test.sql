begin;

select no_plan();

create extension if not exists dblink with schema extensions;

select table_privs_are(
  'public',
  'career_narrative_reports',
  'service_role',
  array['SELECT', 'INSERT'],
  'service_role receives only report creation and listing privileges'
);
select table_privs_are(
  'public',
  'career_narrative_reports',
  'anon',
  array[]::text[],
  'anonymous clients have no report table privileges'
);
select table_privs_are(
  'public',
  'career_narrative_reports',
  'authenticated',
  array[]::text[],
  'authenticated browser clients have no report table privileges'
);

select is(
  pg_catalog.has_sequence_privilege(
    'service_role',
    'public.career_narrative_reports_id_seq',
    'USAGE'
  ),
  true,
  'service_role can allocate a report identity'
);
select is(
  pg_catalog.has_sequence_privilege(
    'service_role',
    'public.career_narrative_reports_id_seq',
    'SELECT'
  ),
  true,
  'service_role can read the allocated report sequence value'
);
select is(
  pg_catalog.has_sequence_privilege(
    'anon',
    'public.career_narrative_reports_id_seq',
    'USAGE'
  ),
  false,
  'anonymous clients cannot allocate report identities'
);
select is(
  pg_catalog.has_sequence_privilege(
    'authenticated',
    'public.career_narrative_reports_id_seq',
    'USAGE'
  ),
  false,
  'authenticated browser clients cannot allocate report identities'
);

select hasnt_column(
  'public',
  'career_narrative_reports',
  'body',
  'reports store no free-form body'
);
select hasnt_column(
  'public',
  'career_narrative_reports',
  'text',
  'reports store no free-form text'
);
select hasnt_column(
  'public',
  'career_narrative_reports',
  'narrative',
  'reports do not duplicate generated narrative text'
);

insert into public.prospects (
  nickname,
  phone_hmac,
  phone_ciphertext,
  phone_iv,
  school_name,
  applicant_stage,
  region
) values
  (
    '서사신고권한학생1',
    decode(repeat('71', 32), 'hex'),
    decode(repeat('72', 16), 'hex'),
    decode(repeat('73', 12), 'hex'),
    '광주고등학교',
    'high3',
    'gwangju'
  ),
  (
    '서사신고권한학생2',
    decode(repeat('74', 32), 'hex'),
    decode(repeat('75', 16), 'hex'),
    decode(repeat('76', 12), 'hex'),
    '전남고등학교',
    'high3',
    'gwangju'
  );

insert into public.assessments (
  prospect_id,
  idempotency_key,
  track_scores,
  environment_score,
  result_snapshot,
  completed_at,
  created_at
)
select
  prospect.id,
  case prospect.nickname
    when '서사신고권한학생1' then '91000000-0000-4000-8000-000000000001'::uuid
    else '91000000-0000-4000-8000-000000000002'::uuid
  end,
  '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
  50,
  pg_catalog.jsonb_build_object('marker', prospect.nickname),
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
from public.prospects prospect
where prospect.nickname in ('서사신고권한학생1', '서사신고권한학생2');

set local role service_role;

select lives_ok(
  $$insert into public.career_narrative_reports(
      assessment_id,
      prospect_id,
      category
    )
    select assessment.id, assessment.prospect_id, 'confusing'
    from public.assessments assessment
    join public.prospects prospect on prospect.id = assessment.prospect_id
    where prospect.nickname = '서사신고권한학생1'$$,
  'service_role can create one bounded report for an owned assessment'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.career_narrative_reports report
    join public.prospects prospect on prospect.id = report.prospect_id
    where prospect.nickname = '서사신고권한학생1'
      and report.category = 'confusing'
      and report.status = 'open'
  ),
  1,
  'service_role can list the report it created'
);

select throws_ok(
  $$insert into public.career_narrative_reports(
      assessment_id,
      prospect_id,
      category
    )
    select
      assessment.id,
      other_prospect.id,
      'unsafe'
    from public.assessments assessment
    join public.prospects owner_prospect on owner_prospect.id = assessment.prospect_id
    cross join public.prospects other_prospect
    where owner_prospect.nickname = '서사신고권한학생1'
      and other_prospect.nickname = '서사신고권한학생2'$$,
  '23503',
  null,
  'a report cannot claim an assessment owned by another prospect'
);

select throws_ok(
  $$insert into public.career_narrative_reports(
      assessment_id,
      prospect_id,
      category
    )
    select assessment.id, assessment.prospect_id, 'inaccurate'
    from public.assessments assessment
    join public.prospects prospect on prospect.id = assessment.prospect_id
    where prospect.nickname = '서사신고권한학생1'$$,
  '23505',
  null,
  'one assessment and owner pair cannot create duplicate reports'
);

select throws_ok(
  $$update public.career_narrative_reports
    set category = 'unsafe'
    where prospect_id = (
      select id from public.prospects where nickname = '서사신고권한학생1'
    )$$,
  '42501',
  null,
  'service_role cannot update reports directly'
);
select throws_ok(
  $$delete from public.career_narrative_reports
    where prospect_id = (
      select id from public.prospects where nickname = '서사신고권한학생1'
    )$$,
  '42501',
  null,
  'service_role cannot delete reports directly'
);

reset role;

create function pg_temp.valid_responses(p_marker text)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'question_group', 'work',
      'option_key', 'work.photo',
      'option_label_snapshot', '사진 촬영 ' || p_marker,
      'weight_snapshot', '{"documentary":2,"art_photo":3,"commercial":1,"video":0}'::jsonb,
      'free_text', null
    ),
    pg_catalog.jsonb_build_object(
      'question_group', 'result',
      'option_key', 'result.portfolio',
      'option_label_snapshot', '사진 포트폴리오 ' || p_marker,
      'weight_snapshot', '{"documentary":1,"art_photo":3,"commercial":2,"video":0}'::jsonb,
      'free_text', null
    ),
    pg_catalog.jsonb_build_object(
      'question_group', 'style',
      'option_key', 'style.solo',
      'option_label_snapshot', '혼자 집중해서 작업 ' || p_marker,
      'weight_snapshot', '{"documentary":1,"art_photo":3,"commercial":1,"video":1}'::jsonb,
      'free_text', null
    ),
    pg_catalog.jsonb_build_object(
      'question_group', 'career',
      'option_key', 'career.photo',
      'option_label_snapshot', '사진 진로 ' || p_marker,
      'weight_snapshot', '{"documentary":1,"art_photo":3,"commercial":3,"video":0}'::jsonb,
      'free_text', null
    )
  );
$function$;

insert into auth.users(id)
values ('99999999-9999-4999-8999-999999999999');

insert into public.admin_users(id, role, is_active)
values ('99999999-9999-4999-8999-999999999999', 'admin', true);

insert into public.prospects (
  nickname,
  phone_hmac,
  phone_ciphertext,
  phone_iv,
  school_name,
  applicant_stage,
  region
) values
  (
    '서사신고보존학생',
    decode(repeat('81', 32), 'hex'),
    decode(repeat('82', 16), 'hex'),
    decode(repeat('83', 12), 'hex'),
    '광주고등학교',
    'high3',
    'gwangju'
  ),
  (
    '서사신고삭제학생',
    decode(repeat('84', 32), 'hex'),
    decode(repeat('85', 16), 'hex'),
    decode(repeat('86', 12), 'hex'),
    '전남고등학교',
    'high3',
    'gwangju'
  );

insert into public.assessments (
  prospect_id,
  idempotency_key,
  track_scores,
  environment_score,
  result_snapshot,
  completed_at,
  created_at
)
select
  prospect.id,
  fixture.idempotency_key,
  '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
  50,
  pg_catalog.jsonb_build_object('marker', fixture.marker),
  fixture.completed_at,
  fixture.completed_at
from public.prospects prospect
cross join (values
  ('92000000-0000-4000-8000-000000000001'::uuid, 'report-oldest-open', '2026-01-01 00:00:01+00'::timestamptz),
  ('92000000-0000-4000-8000-000000000002'::uuid, 'report-second-resolved', '2026-01-01 00:00:02+00'::timestamptz),
  ('92000000-0000-4000-8000-000000000003'::uuid, 'ordinary-third', '2026-01-01 00:00:03+00'::timestamptz),
  ('92000000-0000-4000-8000-000000000004'::uuid, 'ordinary-fourth', '2026-01-01 00:00:04+00'::timestamptz)
) fixture(idempotency_key, marker, completed_at)
where prospect.nickname = '서사신고보존학생';

create temporary table report_retention_ids (
  label text primary key,
  assessment_id bigint not null,
  report_id bigint not null
);

with inserted as (
  insert into public.career_narrative_reports (
    assessment_id,
    prospect_id,
    category
  )
  select assessment.id, assessment.prospect_id, 'confusing'
  from public.assessments assessment
  where assessment.idempotency_key = '92000000-0000-4000-8000-000000000001'
  returning id, assessment_id
)
insert into report_retention_ids(label, assessment_id, report_id)
select 'open', inserted.assessment_id, inserted.id
from inserted;

with inserted as (
  insert into public.career_narrative_reports (
    assessment_id,
    prospect_id,
    category,
    status,
    resolved_by_admin_id,
    resolved_at
  )
  select
    assessment.id,
    assessment.prospect_id,
    'unsafe',
    'resolved_unsafe',
    '99999999-9999-4999-8999-999999999999',
    pg_catalog.clock_timestamp()
  from public.assessments assessment
  where assessment.idempotency_key = '92000000-0000-4000-8000-000000000002'
  returning id, assessment_id
)
insert into report_retention_ids(label, assessment_id, report_id)
select 'resolved', inserted.assessment_id, inserted.id
from inserted;

set local role service_role;

select lives_ok(
  $$select * from public.complete_assessment(
      (select id from public.prospects where nickname = '서사신고보존학생'),
      '92000000-0000-4000-8000-000000000005',
      null,
      '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
      50,
      '{"marker":"retention-fifth"}'::jsonb,
      pg_temp.valid_responses('신고보존5')
    )$$,
  'a fifth completion runs the retention policy with open and resolved reports'
);

reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessments assessment
    where assessment.prospect_id = (
      select id from public.prospects where nickname = '서사신고보존학생'
    )
  ),
  5,
  'reported assessments survive even when both fall outside the newest three'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.career_narrative_reports report
    join report_retention_ids retained on retained.report_id = report.id
  ),
  2,
  'open and resolved reports both retain their immutable assessment snapshots'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessments assessment
    join report_retention_ids retained on retained.assessment_id = assessment.id
  ),
  2,
  'both reported assessment rows remain available for later review'
);

delete from public.career_narrative_reports
where id = (select report_id from report_retention_ids where label = 'open');

set local role service_role;

select lives_ok(
  $$select * from public.complete_assessment(
      (select id from public.prospects where nickname = '서사신고보존학생'),
      '92000000-0000-4000-8000-000000000006',
      null,
      '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
      50,
      '{"marker":"retention-sixth"}'::jsonb,
      pg_temp.valid_responses('신고보존6')
    )$$,
  'a later completion re-evaluates retention after an open report is removed'
);

reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessments
    where id = (select assessment_id from report_retention_ids where label = 'open')
  ),
  0,
  'an old assessment becomes deletable after its report is removed'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessments
    where id = (select assessment_id from report_retention_ids where label = 'resolved')
  ),
  1,
  'a resolved report continues to protect its immutable assessment'
);

delete from public.career_narrative_reports
where id = (select report_id from report_retention_ids where label = 'resolved');

set local role service_role;

select lives_ok(
  $$select * from public.complete_assessment(
      (select id from public.prospects where nickname = '서사신고보존학생'),
      '92000000-0000-4000-8000-000000000007',
      null,
      '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
      50,
      '{"marker":"retention-seventh"}'::jsonb,
      pg_temp.valid_responses('신고보존7')
    )$$,
  'retention converges after the resolved report is also removed'
);

reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessments
    where prospect_id = (
      select id from public.prospects where nickname = '서사신고보존학생'
    )
  ),
  3,
  'after report removal the prospect converges back to exactly three assessments'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessments
    where id = (select assessment_id from report_retention_ids where label = 'resolved')
  ),
  0,
  'the formerly resolved assessment is removed once it is no longer reported'
);

insert into public.assessments (
  prospect_id,
  idempotency_key,
  track_scores,
  environment_score,
  result_snapshot,
  completed_at,
  created_at
)
select
  prospect.id,
  '93000000-0000-4000-8000-000000000001',
  '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
  50,
  '{"marker":"prospect-delete-cascade"}',
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
from public.prospects prospect
where prospect.nickname = '서사신고삭제학생';

create temporary table report_delete_cascade_ids as
select prospect.id as prospect_id, assessment.id as assessment_id
from public.prospects prospect
join public.assessments assessment on assessment.prospect_id = prospect.id
where prospect.nickname = '서사신고삭제학생';

insert into public.career_narrative_reports (
  assessment_id,
  prospect_id,
  category
)
select assessment_id, prospect_id, 'inaccurate'
from report_delete_cascade_ids;

delete from public.prospects
where id = (select prospect_id from report_delete_cascade_ids);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessments
    where id = (select assessment_id from report_delete_cascade_ids)
  ),
  0,
  'explicit prospect deletion still cascades through the protected assessment'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.career_narrative_reports
    where assessment_id = (select assessment_id from report_delete_cascade_ids)
  ),
  0,
  'explicit prospect deletion still cascades through the report row'
);

select is(
  extensions.dblink_connect(
    'review_budget_setup',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the concurrent budget setup session connects'
);
select extensions.dblink_exec(
  'review_budget_setup',
  $$delete from public.prospects where nickname like '서사예산경합학생%'$$
);
select extensions.dblink_exec(
  'review_budget_setup',
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region
    ) values
      (
        '서사예산경합학생채움',
        decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 16), 'hex'),
        decode(repeat('a3', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      ),
      (
        '서사예산경합학생전역A',
        decode(repeat('a4', 32), 'hex'), decode(repeat('a5', 16), 'hex'),
        decode(repeat('a6', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      ),
      (
        '서사예산경합학생전역B',
        decode(repeat('a7', 32), 'hex'), decode(repeat('a8', 16), 'hex'),
        decode(repeat('a9', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      ),
      (
        '서사예산경합학생개인',
        decode(repeat('aa', 32), 'hex'), decode(repeat('ab', 16), 'hex'),
        decode(repeat('ac', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      )$$
);
select extensions.dblink_exec(
  'review_budget_setup',
  $$with clock as (
      select pg_catalog.clock_timestamp() as now_at
    )
    insert into public.assessment_narrative_generations(
      prospect_id, idempotency_key, input_hash, state,
      fallback_narrative, model_budget_reserved, expires_at, created_at
    )
    select
      prospect.id,
      (
        pg_catalog.substr(key_hash, 1, 8) || '-' ||
        pg_catalog.substr(key_hash, 9, 4) || '-4' ||
        pg_catalog.substr(key_hash, 14, 3) || '-8' ||
        pg_catalog.substr(key_hash, 18, 3) || '-' ||
        pg_catalog.substr(key_hash, 21, 12)
      )::uuid,
      'sha256:' || repeat('d', 64),
      'claimed',
      '{"source":"deterministic","sentences":[{"slot":"direction","text":"전역 마지막 슬롯 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb,
      true,
      clock.now_at + interval '12 seconds',
      clock.now_at
    from public.prospects prospect
    cross join pg_catalog.generate_series(1, 499) position
    cross join lateral (
      select pg_catalog.md5('review-global-' || position::text) as key_hash
    ) key
    cross join clock
    where prospect.nickname = '서사예산경합학생채움'$$
);
select is(
  extensions.dblink_connect(
    'review_budget_a',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the first concurrent budget service session connects'
);
select is(
  extensions.dblink_connect(
    'review_budget_b',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the second concurrent budget service session connects'
);
select extensions.dblink_exec('review_budget_a', 'set role service_role');
select extensions.dblink_exec('review_budget_b', 'set role service_role');

create temporary table review_global_budget_queries as
select
  pg_catalog.format(
    $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
      select public.claim_assessment_narrative_generation(
        %s,
        '95000000-0000-4000-8000-000000000001',
        'sha256:%s',
        %L::jsonb,
        'enabled',
        500,
        50
      ) from barrier$query$,
    (select id from public.prospects where nickname = '서사예산경합학생전역A'),
    repeat('1', 64),
    '{"source":"deterministic","sentences":[{"slot":"direction","text":"전역 A 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb
  ) as query_a,
  pg_catalog.format(
    $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
      select public.claim_assessment_narrative_generation(
        %s,
        '95000000-0000-4000-8000-000000000002',
        'sha256:%s',
        %L::jsonb,
        'enabled',
        500,
        50
      ) from barrier$query$,
    (select id from public.prospects where nickname = '서사예산경합학생전역B'),
    repeat('2', 64),
    '{"source":"deterministic","sentences":[{"slot":"direction","text":"전역 B 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb
  ) as query_b;

select is(
  extensions.dblink_send_query(
    'review_budget_a',
    (select query_a from review_global_budget_queries)
  ),
  1,
  'the first global last-slot claim is dispatched'
);
select is(
  extensions.dblink_send_query(
    'review_budget_b',
    (select query_b from review_global_budget_queries)
  ),
  1,
  'the second global last-slot claim is dispatched concurrently'
);

create temporary table review_global_budget_results(result jsonb);
insert into review_global_budget_results
select result
from extensions.dblink_get_result('review_budget_a') response(result jsonb);
insert into review_global_budget_results
select result
from extensions.dblink_get_result('review_budget_b') response(result jsonb);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_budget_a') response(result jsonb)
  ),
  0,
  'the first global async stream is drained'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_budget_b') response(result jsonb)
  ),
  0,
  'the second global async stream is drained'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from review_global_budget_results
    where result ->> 'kind' = 'owner'
  ),
  1,
  'exactly one concurrent claim receives the 500th global budget slot'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from review_global_budget_results
    where result ->> 'failureCode' = 'budget_exhausted'
  ),
  1,
  'the concurrent 501st global claim settles deterministic fallback'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessment_narrative_generations
    where model_budget_reserved
      and created_at >= (
        (pg_catalog.clock_timestamp() at time zone 'UTC')::date::timestamp at time zone 'UTC'
      )
      and created_at < (
        (pg_catalog.clock_timestamp() at time zone 'UTC')::date::timestamp at time zone 'UTC'
      ) + interval '1 day'
  ),
  500,
  'the concurrent global boundary stores exactly 500 reserved rows'
);

select extensions.dblink_exec(
  'review_budget_setup',
  $$with clock as (
      select pg_catalog.clock_timestamp() as now_at
    )
    insert into public.assessment_narrative_generations(
      prospect_id, idempotency_key, input_hash, state,
      fallback_narrative, model_budget_reserved, expires_at, created_at
    )
    select
      prospect.id,
      ('94000000-0000-4000-8000-' || pg_catalog.lpad(position::text, 12, '0'))::uuid,
      'sha256:' || repeat('e', 64),
      'claimed',
      '{"source":"deterministic","sentences":[{"slot":"direction","text":"개인 마지막 슬롯 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb,
      true,
      clock.now_at + interval '12 seconds',
      clock.now_at
    from public.prospects prospect
    cross join pg_catalog.generate_series(1, 4) position
    cross join clock
    where prospect.nickname = '서사예산경합학생개인'$$
);

create temporary table review_prospect_budget_queries as
select
  pg_catalog.format(
    $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
      select public.claim_assessment_narrative_generation(
        %s,
        '96000000-0000-4000-8000-000000000001',
        'sha256:%s',
        %L::jsonb,
        'enabled',
        5000,
        5
      ) from barrier$query$,
    (select id from public.prospects where nickname = '서사예산경합학생개인'),
    repeat('3', 64),
    '{"source":"deterministic","sentences":[{"slot":"direction","text":"개인 A 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb
  ) as query_a,
  pg_catalog.format(
    $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
      select public.claim_assessment_narrative_generation(
        %s,
        '96000000-0000-4000-8000-000000000002',
        'sha256:%s',
        %L::jsonb,
        'enabled',
        5000,
        5
      ) from barrier$query$,
    (select id from public.prospects where nickname = '서사예산경합학생개인'),
    repeat('4', 64),
    '{"source":"deterministic","sentences":[{"slot":"direction","text":"개인 B 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb
  ) as query_b;

select is(
  extensions.dblink_send_query(
    'review_budget_a',
    (select query_a from review_prospect_budget_queries)
  ),
  1,
  'the first prospect last-slot claim is dispatched'
);
select is(
  extensions.dblink_send_query(
    'review_budget_b',
    (select query_b from review_prospect_budget_queries)
  ),
  1,
  'the second prospect last-slot claim is dispatched concurrently'
);

create temporary table review_prospect_budget_results(result jsonb);
insert into review_prospect_budget_results
select result
from extensions.dblink_get_result('review_budget_a') response(result jsonb);
insert into review_prospect_budget_results
select result
from extensions.dblink_get_result('review_budget_b') response(result jsonb);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_budget_a') response(result jsonb)
  ),
  0,
  'the first prospect async stream is drained'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_budget_b') response(result jsonb)
  ),
  0,
  'the second prospect async stream is drained'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from review_prospect_budget_results
    where result ->> 'kind' = 'owner'
  ),
  1,
  'exactly one concurrent claim receives the fifth prospect budget slot'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from review_prospect_budget_results
    where result ->> 'failureCode' = 'budget_exhausted'
  ),
  1,
  'the concurrent sixth prospect claim settles deterministic fallback'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessment_narrative_generations generation
    join public.prospects prospect on prospect.id = generation.prospect_id
    where prospect.nickname = '서사예산경합학생개인'
      and generation.model_budget_reserved
      and generation.created_at >= pg_catalog.clock_timestamp() - interval '24 hours'
  ),
  5,
  'the concurrent prospect boundary stores exactly five reserved rows'
);

select extensions.dblink_exec('review_budget_a', 'reset role');
select extensions.dblink_exec('review_budget_b', 'reset role');
select extensions.dblink_exec('review_budget_a', 'begin');
select extensions.dblink_exec('review_budget_b', 'begin');

create temporary table review_utc_lock_results(label text primary key, acquired boolean);
insert into review_utc_lock_results
select 'current-day', acquired
from extensions.dblink(
  'review_budget_a',
  $$select pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'career-narrative:' ||
        ((pg_catalog.clock_timestamp() at time zone 'UTC')::date)::text,
        0
      )
    )$$
) response(acquired boolean);
insert into review_utc_lock_results
select 'next-day', acquired
from extensions.dblink(
  'review_budget_b',
  $$select pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'career-narrative:' ||
        (((pg_catalog.clock_timestamp() at time zone 'UTC')::date + 1))::text,
        0
      )
    )$$
) response(acquired boolean);
insert into review_utc_lock_results
select 'current-day-conflict', acquired
from extensions.dblink(
  'review_budget_b',
  $$select pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'career-narrative:' ||
        ((pg_catalog.clock_timestamp() at time zone 'UTC')::date)::text,
        0
      )
    )$$
) response(acquired boolean);

select is(
  (select acquired from review_utc_lock_results where label = 'current-day'),
  true,
  'one transaction acquires the current UTC-day budget lock'
);
select is(
  (select acquired from review_utc_lock_results where label = 'next-day'),
  true,
  'another transaction independently acquires the next UTC-day budget lock'
);
select is(
  (select acquired from review_utc_lock_results where label = 'current-day-conflict'),
  false,
  'the next-day transaction still cannot acquire the occupied current-day lock'
);

select extensions.dblink_exec('review_budget_a', 'commit');
select extensions.dblink_exec('review_budget_b', 'commit');
select extensions.dblink_disconnect('review_budget_a');
select extensions.dblink_disconnect('review_budget_b');
select extensions.dblink_exec(
  'review_budget_setup',
  $$delete from public.prospects where nickname like '서사예산경합학생%'$$
);
select extensions.dblink_disconnect('review_budget_setup');

select is(
  extensions.dblink_connect(
    'review_existing_setup',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the pre-existing completion race setup session connects'
);
select extensions.dblink_exec(
  'review_existing_setup',
  $$delete from public.prospects where nickname like '서사기존경합학생%'$$
);
select extensions.dblink_exec(
  'review_existing_setup',
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region
    ) values
      (
        '서사기존경합학생현재',
        decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 16), 'hex'),
        decode(repeat('b3', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      ),
      (
        '서사기존경합학생레거시',
        decode(repeat('b4', 32), 'hex'), decode(repeat('b5', 16), 'hex'),
        decode(repeat('b6', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      ),
      (
        '서사기존경합학생불일치',
        decode(repeat('b7', 32), 'hex'), decode(repeat('b8', 16), 'hex'),
        decode(repeat('b9', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      )$$
);
select extensions.dblink_exec(
  'review_existing_setup',
  $$insert into public.assessments(
      prospect_id, idempotency_key, track_scores, environment_score,
      result_snapshot, completed_at, created_at
    )
    select
      prospect.id,
      case prospect.nickname
        when '서사기존경합학생현재'
          then '97000000-0000-4000-8000-000000000001'::uuid
        when '서사기존경합학생레거시'
          then '97000000-0000-4000-8000-000000000002'::uuid
        else '97000000-0000-4000-8000-000000000003'::uuid
      end,
      '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
      50,
      case prospect.nickname
        when '서사기존경합학생현재' then '{
          "marker":"pre-existing-current",
          "careerNarrative":{
            "source":"deterministic",
            "sentences":[{
              "slot":"direction",
              "text":"기존 현재 방향입니다.",
              "evidenceIds":["track:art_photo"]
            }]
          }
        }'::jsonb
        when '서사기존경합학생레거시'
          then '{"marker":"pre-existing-legacy"}'::jsonb
        else '{
          "marker":"pre-existing-mismatch-a",
          "careerNarrative":{
            "source":"deterministic",
            "sentences":[{
              "slot":"direction",
              "text":"기존 불일치 A 방향입니다.",
              "evidenceIds":["track:art_photo"]
            }]
          }
        }'::jsonb
      end,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    from public.prospects prospect
    where prospect.nickname like '서사기존경합학생%'$$
);
select extensions.dblink_exec(
  'review_existing_setup',
  $$with fixture as (
      select
        prospect.id as prospect_id,
        prospect.nickname,
        assessment.id as assessment_id,
        assessment.idempotency_key,
        pg_catalog.clock_timestamp() as now_at
      from public.prospects prospect
      join public.assessments assessment on assessment.prospect_id = prospect.id
      where prospect.nickname like '서사기존경합학생%'
    )
    insert into public.assessment_narrative_generations(
      prospect_id, idempotency_key, input_hash, state, source,
      fallback_narrative, narrative, model_budget_reserved,
      expires_at, failure_code, created_at, finished_at
    )
    select
      fixture.prospect_id,
      fixture.idempotency_key,
      case fixture.nickname
        when '서사기존경합학생현재' then 'sha256:' || repeat('5', 64)
        when '서사기존경합학생레거시' then 'sha256:' || repeat('6', 64)
        else 'sha256:' || repeat('7', 64)
      end,
      'terminal',
      'deterministic',
      case fixture.nickname
        when '서사기존경합학생현재' then '{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 현재 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }'::jsonb
        when '서사기존경합학생레거시' then '{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 레거시 후속 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }'::jsonb
        else '{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 불일치 B 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }'::jsonb
      end,
      case fixture.nickname
        when '서사기존경합학생현재' then '{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 현재 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }'::jsonb
        when '서사기존경합학생레거시' then '{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 레거시 후속 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }'::jsonb
        else '{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 불일치 B 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }'::jsonb
      end,
      false,
      fixture.now_at + interval '12 seconds',
      'missing_config',
      fixture.now_at,
      fixture.now_at
    from fixture$$
);

select is(
  extensions.dblink_connect(
    'review_existing_a',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the first pre-existing completion race session connects'
);
select is(
  extensions.dblink_connect(
    'review_existing_b',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the second pre-existing completion race session connects'
);
select extensions.dblink_exec(
  'review_existing_b',
  $outer$create function pg_temp.try_mismatched_completion(
    p_prospect_id bigint,
    p_generation_id bigint,
    p_snapshot jsonb,
    p_responses jsonb
  )
  returns text
  language plpgsql
  set search_path = ''
  as $function$
  begin
    perform completion.assessment_id
    from public.complete_assessment_with_narrative(
      p_prospect_id,
      '97000000-0000-4000-8000-000000000003',
      null,
      '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
      50,
      p_snapshot,
      p_responses,
      p_generation_id
    ) completion;
    return 'completed';
  exception
    when unique_violation then
      return sqlstate || ':' || sqlerrm;
  end;
  $function$;$outer$
);
select extensions.dblink_exec('review_existing_a', 'set role service_role');
select extensions.dblink_exec('review_existing_b', 'set role service_role');

create temporary table review_existing_results (
  scenario text not null,
  worker text not null,
  assessment_id bigint not null,
  public_id uuid not null,
  created boolean not null,
  primary key (scenario, worker)
);

select is(
  extensions.dblink_send_query(
    'review_existing_a',
    pg_catalog.format(
      $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
        select completion.*
        from barrier
        cross join lateral public.complete_assessment(
          %s,
          '97000000-0000-4000-8000-000000000001',
          null,
          '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
          50,
          %L::jsonb,
          %L::jsonb
        ) completion$query$,
      (select id from public.prospects where nickname = '서사기존경합학생현재'),
      '{
        "marker":"pre-existing-current",
        "careerNarrative":{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 현재 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }
      }'::jsonb,
      pg_temp.valid_responses('기존현재구버전')
    )
  ),
  1,
  'the old Worker is dispatched against a pre-existing current snapshot'
);
select is(
  extensions.dblink_send_query(
    'review_existing_b',
    pg_catalog.format(
      $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
        select completion.*
        from barrier
        cross join lateral public.complete_assessment_with_narrative(
          %s,
          '97000000-0000-4000-8000-000000000001',
          null,
          '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
          50,
          %L::jsonb,
          %L::jsonb,
          %s
        ) completion$query$,
      (select id from public.prospects where nickname = '서사기존경합학생현재'),
      '{
        "marker":"pre-existing-current",
        "careerNarrative":{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 현재 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }
      }'::jsonb,
      pg_temp.valid_responses('기존현재신버전'),
      (
        select generation.id
        from public.assessment_narrative_generations generation
        join public.prospects prospect on prospect.id = generation.prospect_id
        where prospect.nickname = '서사기존경합학생현재'
      )
    )
  ),
  1,
  'the new Worker is dispatched against the same pre-existing current snapshot'
);
insert into review_existing_results
select 'current', 'old', response.*
from extensions.dblink_get_result('review_existing_a')
  response(assessment_id bigint, public_id uuid, created boolean);
insert into review_existing_results
select 'current', 'new', response.*
from extensions.dblink_get_result('review_existing_b')
  response(assessment_id bigint, public_id uuid, created boolean);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_existing_a')
      response(assessment_id bigint, public_id uuid, created boolean)
  ),
  0,
  'the pre-existing current old stream is drained'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_existing_b')
      response(assessment_id bigint, public_id uuid, created boolean)
  ),
  0,
  'the pre-existing current new stream is drained'
);

select results_eq(
  $$select assessment_id, public_id, created
    from review_existing_results where scenario = 'current' and worker = 'old'$$,
  $$select assessment_id, public_id, created
    from review_existing_results where scenario = 'current' and worker = 'new'$$,
  'pre-existing current old/new calls return one immutable assessment identity'
);
select is(
  (
    select generation.assessment_id = assessment.id
    from public.assessment_narrative_generations generation
    join public.assessments assessment
      on assessment.prospect_id = generation.prospect_id
      and assessment.idempotency_key = generation.idempotency_key
    join public.prospects prospect on prospect.id = generation.prospect_id
    where prospect.nickname = '서사기존경합학생현재'
  ),
  true,
  'the new Worker links an equal pre-existing current snapshot'
);

select is(
  extensions.dblink_send_query(
    'review_existing_a',
    pg_catalog.format(
      $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
        select completion.*
        from barrier
        cross join lateral public.complete_assessment_with_narrative(
          %s,
          '97000000-0000-4000-8000-000000000002',
          null,
          '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
          50,
          %L::jsonb,
          %L::jsonb,
          %s
        ) completion$query$,
      (select id from public.prospects where nickname = '서사기존경합학생레거시'),
      '{
        "marker":"legacy-new-input",
        "careerNarrative":{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 레거시 후속 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }
      }'::jsonb,
      pg_temp.valid_responses('기존레거시신버전'),
      (
        select generation.id
        from public.assessment_narrative_generations generation
        join public.prospects prospect on prospect.id = generation.prospect_id
        where prospect.nickname = '서사기존경합학생레거시'
      )
    )
  ),
  1,
  'the new Worker is dispatched against a pre-existing legacy snapshot'
);
select is(
  extensions.dblink_send_query(
    'review_existing_b',
    pg_catalog.format(
      $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
        select completion.*
        from barrier
        cross join lateral public.complete_assessment(
          %s,
          '97000000-0000-4000-8000-000000000002',
          null,
          '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
          50,
          '{"marker":"legacy-old-input"}'::jsonb,
          %L::jsonb
        ) completion$query$,
      (select id from public.prospects where nickname = '서사기존경합학생레거시'),
      pg_temp.valid_responses('기존레거시구버전')
    )
  ),
  1,
  'the old Worker is dispatched against the same pre-existing legacy snapshot'
);
insert into review_existing_results
select 'legacy', 'new', response.*
from extensions.dblink_get_result('review_existing_a')
  response(assessment_id bigint, public_id uuid, created boolean);
insert into review_existing_results
select 'legacy', 'old', response.*
from extensions.dblink_get_result('review_existing_b')
  response(assessment_id bigint, public_id uuid, created boolean);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_existing_a')
      response(assessment_id bigint, public_id uuid, created boolean)
  ),
  0,
  'the pre-existing legacy new stream is drained'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_existing_b')
      response(assessment_id bigint, public_id uuid, created boolean)
  ),
  0,
  'the pre-existing legacy old stream is drained'
);

select results_eq(
  $$select assessment_id, public_id, created
    from review_existing_results where scenario = 'legacy' and worker = 'old'$$,
  $$select assessment_id, public_id, created
    from review_existing_results where scenario = 'legacy' and worker = 'new'$$,
  'pre-existing legacy old/new calls return one immutable assessment identity'
);
select is(
  (
    select assessment.result_snapshot
    from public.assessments assessment
    join public.prospects prospect on prospect.id = assessment.prospect_id
    where prospect.nickname = '서사기존경합학생레거시'
  ),
  '{"marker":"pre-existing-legacy"}'::jsonb,
  'the pre-existing legacy snapshot is never overwritten'
);
select is(
  (
    select generation.assessment_id
    from public.assessment_narrative_generations generation
    join public.prospects prospect on prospect.id = generation.prospect_id
    where prospect.nickname = '서사기존경합학생레거시'
  ),
  null,
  'the pre-existing legacy snapshot never receives a generation link'
);

select is(
  extensions.dblink_send_query(
    'review_existing_a',
    pg_catalog.format(
      $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
        select completion.*
        from barrier
        cross join lateral public.complete_assessment(
          %s,
          '97000000-0000-4000-8000-000000000003',
          null,
          '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
          50,
          '{"marker":"mismatch-old-input"}'::jsonb,
          %L::jsonb
        ) completion$query$,
      (select id from public.prospects where nickname = '서사기존경합학생불일치'),
      pg_temp.valid_responses('기존불일치구버전')
    )
  ),
  1,
  'the old Worker is dispatched against a pre-existing mismatched current snapshot'
);
select is(
  extensions.dblink_send_query(
    'review_existing_b',
    pg_catalog.format(
      $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
        select pg_temp.try_mismatched_completion(
          %s,
          %s,
          %L::jsonb,
          %L::jsonb
        )
        from barrier$query$,
      (select id from public.prospects where nickname = '서사기존경합학생불일치'),
      (
        select generation.id
        from public.assessment_narrative_generations generation
        join public.prospects prospect on prospect.id = generation.prospect_id
        where prospect.nickname = '서사기존경합학생불일치'
      ),
      '{
        "marker":"mismatch-new-input-b",
        "careerNarrative":{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"기존 불일치 B 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }
      }'::jsonb,
      pg_temp.valid_responses('기존불일치신버전')
    )
  ),
  1,
  'the new Worker is dispatched against the same mismatched current snapshot'
);
insert into review_existing_results
select 'mismatch', 'old', response.*
from extensions.dblink_get_result('review_existing_a')
  response(assessment_id bigint, public_id uuid, created boolean);
create temporary table review_mismatch_result(result text);
insert into review_mismatch_result
select result
from extensions.dblink_get_result('review_existing_b') response(result text);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_existing_a')
      response(assessment_id bigint, public_id uuid, created boolean)
  ),
  0,
  'the pre-existing mismatch old stream is drained'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('review_existing_b') response(result text)
  ),
  0,
  'the pre-existing mismatch new stream is drained'
);

select is(
  (select result from review_mismatch_result),
  '23505:narrative snapshot conflict',
  'the mismatched new Worker receives the stable snapshot conflict'
);
select is(
  (
    select assessment.result_snapshot ->> 'marker'
    from public.assessments assessment
    join public.prospects prospect on prospect.id = assessment.prospect_id
    where prospect.nickname = '서사기존경합학생불일치'
  ),
  'pre-existing-mismatch-a',
  'the mismatched old/new race never overwrites the current snapshot'
);
select is(
  (
    select generation.assessment_id
    from public.assessment_narrative_generations generation
    join public.prospects prospect on prospect.id = generation.prospect_id
    where prospect.nickname = '서사기존경합학생불일치'
  ),
  null,
  'the mismatched old/new race never links the conflicting generation'
);

select extensions.dblink_disconnect('review_existing_a');
select extensions.dblink_disconnect('review_existing_b');
select extensions.dblink_exec(
  'review_existing_setup',
  $$delete from public.prospects where nickname like '서사기존경합학생%'$$
);
select extensions.dblink_disconnect('review_existing_setup');

select * from finish();

rollback;
