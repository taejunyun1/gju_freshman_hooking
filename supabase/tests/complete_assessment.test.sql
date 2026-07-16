begin;

select plan(40);

select has_function(
  'public',
  'complete_assessment',
  array['bigint', 'uuid', 'bigint', 'jsonb', 'numeric', 'jsonb', 'jsonb'],
  'complete_assessment has the locked completion signature'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb,bigint)'
  ) is null,
  'complete_assessment has no ambiguous eight-argument overload'
);

select has_function(
  'public',
  'complete_assessment_with_narrative',
  array['bigint', 'uuid', 'bigint', 'jsonb', 'numeric', 'jsonb', 'jsonb', 'bigint'],
  'the narrative-aware completion signature is distinct'
);

select has_function(
  'public',
  'complete_assessment_internal_v2',
  array['bigint', 'uuid', 'bigint', 'jsonb', 'numeric', 'jsonb', 'jsonb', 'bigint', 'boolean'],
  'both completion wrappers share one internal transaction body'
);

select function_privs_are(
  'public',
  'complete_assessment_internal_v2',
  array['bigint', 'uuid', 'bigint', 'jsonb', 'numeric', 'jsonb', 'jsonb', 'bigint', 'boolean'],
  'service_role',
  array[]::text[],
  'service_role cannot bypass the completion wrappers'
);

select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', procedure.proargnames[subscript.position],
        'type', procedure.proallargtypes[subscript.position]::pg_catalog.regtype::text
      )
      order by subscript.position
    )
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.generate_subscripts(
      procedure.proallargtypes,
      1
    ) as subscript(position)
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'
    )
      and procedure.proargmodes[subscript.position] = 't'
  ),
  '[
    {"name":"assessment_id","type":"bigint"},
    {"name":"public_id","type":"uuid"},
    {"name":"created","type":"boolean"}
  ]'::jsonb,
  'complete_assessment returns the stable assessment ID, public ID, and creation flag columns'
);

select ok(
  coalesce((
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'
    )
  ), false),
  'complete_assessment is security definer'
);

select ok(
  exists(
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.unnest(
      coalesce(procedure.proconfig, array[]::text[])
    ) as setting(value)
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'
    )
      and setting.value = 'search_path=""'
  ),
  'complete_assessment has an empty search path'
);

select is(
  coalesce((
    select not exists(
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )
      ) privilege
      where privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    )
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'
    )
  ), false),
  true,
  'the public role cannot execute complete_assessment'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'anon',
    pg_catalog.to_regprocedure(
      'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'
    ),
    'execute'
  ), false),
  false,
  'anon cannot execute complete_assessment'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    pg_catalog.to_regprocedure(
      'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'
    ),
    'execute'
  ), false),
  false,
  'authenticated cannot execute complete_assessment'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure(
      'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'
    ),
    'execute'
  ), false),
  true,
  'service_role can execute complete_assessment'
);

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

create function pg_temp.too_many_responses()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'question_group', 'work',
      'option_key', 'work.option_' || item.position,
      'option_label_snapshot', '촬영 선택 ' || item.position,
      'weight_snapshot', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}'::jsonb,
      'free_text', null
    )
    order by item.position
  )
  from pg_catalog.generate_series(1, 12) as item(position);
$function$;

create temporary table rpc_results (
  call_name text primary key,
  assessment_id bigint not null,
  public_id uuid not null,
  created boolean not null
);

create temporary table old_detail (
  assessment_id bigint not null,
  response_id bigint not null
);

create temporary table atomic_state (
  assessment_count bigint not null,
  response_count bigint not null,
  last_active_at timestamptz not null
);

grant select, insert, update, delete on table pg_temp.rpc_results to service_role;

insert into public.prospects (
  nickname,
  phone_hmac,
  phone_ciphertext,
  phone_iv,
  school_name,
  applicant_stage,
  region,
  last_active_at
) values (
  '완료원자성51',
  decode(repeat('a1', 32), 'hex'),
  decode(repeat('b2', 16), 'hex'),
  decode(repeat('c3', 12), 'hex'),
  '광주고등학교',
  'high3',
  'gwangju',
  '2020-01-01 00:00:00+00'
);

insert into public.events (
  prospect_id,
  anonymous_id,
  event_name,
  path,
  properties,
  created_at
)
select
  id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'assessment_started',
  '/assessment',
  '{"request_id":"aaaaaaaa-0000-4000-8000-000000000001"}'::jsonb,
  '2020-01-01 00:00:00+00'
from public.prospects
where nickname = '완료원자성51';

set local role service_role;

insert into pg_temp.rpc_results
select
  'first',
  completion.assessment_id,
  completion.public_id,
  completion.created
from public.complete_assessment(
  (select id from public.prospects where nickname = '완료원자성51'),
  '11111111-1111-4111-8111-111111111111',
  null,
  '{"documentary":80,"art_photo":70,"commercial":60,"video":50}'::jsonb,
  72.5,
  '{"marker":"original"}'::jsonb,
  pg_temp.valid_responses('원본')
) completion;

reset role;

select is(
  (select created from pg_temp.rpc_results where call_name = 'first'),
  true,
  'the first idempotency key creates an assessment'
);

select ok(
  coalesce((
    select result.assessment_id > 0
      and result.public_id = assessment.public_id
    from pg_temp.rpc_results result
    join public.assessments assessment on assessment.id = result.assessment_id
    where result.call_name = 'first'
  ), false),
  'the insert returns the persisted assessment and public identities'
);

select is(
  (select pg_catalog.count(*) from public.assessments where prospect_id = (
    select id from public.prospects where nickname = '완료원자성51'
  )),
  1::bigint,
  'the first call stores one completed assessment'
);

select is(
  (select pg_catalog.count(*) from public.assessment_responses where assessment_id = (
    select assessment_id from pg_temp.rpc_results where call_name = 'first'
  )),
  4::bigint,
  'the first call stores every response after its assessment'
);

select ok(
  (select last_active_at > '2020-01-01 00:00:00+00'::timestamptz
   from public.prospects where nickname = '완료원자성51'),
  'a newly completed assessment advances prospect activity'
);

select ok(
  coalesce((
    select assessment.status = 'completed'
      and assessment.track_scores = '{"documentary":80,"art_photo":70,"commercial":60,"video":50}'::jsonb
      and assessment.environment_score = 72.5
      and assessment.result_snapshot = '{"marker":"original"}'::jsonb
    from public.assessments assessment
    where assessment.id = (
      select assessment_id from pg_temp.rpc_results where call_name = 'first'
    )
  ), false),
  'the first call persists the supplied score and result snapshots exactly'
);

insert into pg_temp.old_detail
select
  result.assessment_id,
  min(response.id)
from pg_temp.rpc_results result
join public.assessment_responses response on response.assessment_id = result.assessment_id
where result.call_name = 'first'
group by result.assessment_id;

insert into pg_temp.rpc_results
select
  'same-key',
  completion.assessment_id,
  completion.public_id,
  completion.created
from public.complete_assessment(
  (select id from public.prospects where nickname = '완료원자성51'),
  '11111111-1111-4111-8111-111111111111',
  null,
  '{"documentary":1,"art_photo":2,"commercial":3,"video":4}'::jsonb,
  1,
  '{"marker":"retry-must-not-overwrite"}'::jsonb,
  pg_temp.valid_responses('재시도')
) completion;

select results_eq(
  $$select assessment_id, public_id, created
    from pg_temp.rpc_results where call_name = 'same-key'$$,
  $$select assessment_id, public_id, false
    from pg_temp.rpc_results where call_name = 'first'$$,
  'a sequential same-key call returns the same identities with created false'
);

select is(
  (select pg_catalog.count(*) from public.assessments where prospect_id = (
    select id from public.prospects where nickname = '완료원자성51'
  )),
  1::bigint,
  'same-key serialization cannot create a second assessment'
);

select is(
  (select result_snapshot from public.assessments where id = (
    select assessment_id from pg_temp.rpc_results where call_name = 'first'
  )),
  '{"marker":"original"}'::jsonb,
  'a same-key retry cannot overwrite the original result snapshot'
);

select ok(
  (select pg_catalog.count(*) = 4
      and pg_catalog.bool_and(option_label_snapshot like '%원본')
   from public.assessment_responses where assessment_id = (
     select assessment_id from pg_temp.rpc_results where call_name = 'first'
   )),
  'a same-key retry cannot overwrite or append response snapshots'
);

insert into pg_temp.rpc_results
select 'second', completion.*
from public.complete_assessment(
  (select id from public.prospects where nickname = '완료원자성51'),
  '22222222-2222-4222-8222-222222222222', null,
  '{"documentary":70,"art_photo":80,"commercial":60,"video":50}', 73,
  '{"marker":"second"}', pg_temp.valid_responses('두번째')
) completion;

insert into pg_temp.rpc_results
select 'third', completion.*
from public.complete_assessment(
  (select id from public.prospects where nickname = '완료원자성51'),
  '33333333-3333-4333-8333-333333333333', null,
  '{"documentary":60,"art_photo":70,"commercial":80,"video":50}', 74,
  '{"marker":"third"}', pg_temp.valid_responses('세번째')
) completion;

insert into pg_temp.rpc_results
select 'fourth', completion.*
from public.complete_assessment(
  (select id from public.prospects where nickname = '완료원자성51'),
  '44444444-4444-4444-8444-444444444444', null,
  '{"documentary":50,"art_photo":60,"commercial":70,"video":80}', 75,
  '{"marker":"fourth"}', pg_temp.valid_responses('네번째')
) completion;

select ok(
  (select pg_catalog.bool_and(created)
   from pg_temp.rpc_results
   where call_name in ('second', 'third', 'fourth')),
  'every different idempotency key reports a new assessment'
);

select is(
  (select pg_catalog.count(*) from public.assessments where prospect_id = (
    select id from public.prospects where nickname = '완료원자성51'
  )),
  3::bigint,
  'four successful submissions retain exactly three assessments'
);

select results_eq(
  $$select idempotency_key
    from public.assessments
    where prospect_id = (select id from public.prospects where nickname = '완료원자성51')
    order by idempotency_key$$,
  $$values
    ('22222222-2222-4222-8222-222222222222'::uuid),
    ('33333333-3333-4333-8333-333333333333'::uuid),
    ('44444444-4444-4444-8444-444444444444'::uuid)$$,
  'rotation keeps the newest three using completed time and identity order'
);

select is(
  (select pg_catalog.count(*) from public.assessments where id = (
    select assessment_id from pg_temp.old_detail
  )),
  0::bigint,
  'rotation deletes the oldest assessment detail'
);

select is(
  (select pg_catalog.count(*) from public.assessment_responses where id = (
    select response_id from pg_temp.old_detail
  )),
  0::bigint,
  'deleting the oldest assessment cascades to its responses'
);

select is(
  (select pg_catalog.count(*)
   from public.assessment_responses response
   join public.assessments assessment on assessment.id = response.assessment_id
   where assessment.prospect_id = (
     select id from public.prospects where nickname = '완료원자성51'
   )),
  12::bigint,
  'the three retained assessments keep all twelve response snapshots'
);

select ok(
  coalesce((
    select event.prospect_id = prospect.id
    from public.events event
    join public.prospects prospect on prospect.id = event.prospect_id
    where event.anonymous_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and prospect.nickname = '완료원자성51'
  ), false),
  'assessment rotation retains old events and their prospect reference'
);

insert into pg_temp.rpc_results
select 'retained-retry', completion.*
from public.complete_assessment(
  (select id from public.prospects where nickname = '완료원자성51'),
  '22222222-2222-4222-8222-222222222222', null,
  '{"documentary":1,"art_photo":1,"commercial":1,"video":1}', 1,
  '{"marker":"retained-retry"}', pg_temp.valid_responses('보존재시도')
) completion;

select results_eq(
  $$select retry.assessment_id, retry.public_id, retry.created
    from pg_temp.rpc_results retry where retry.call_name = 'retained-retry'$$,
  $$select original.assessment_id, original.public_id, false
    from pg_temp.rpc_results original where original.call_name = 'second'$$,
  'a retry of a retained identity remains idempotent after rotation'
);

select results_eq(
  $$select idempotency_key
    from public.assessments
    where prospect_id = (select id from public.prospects where nickname = '완료원자성51')
    order by idempotency_key$$,
  $$values
    ('22222222-2222-4222-8222-222222222222'::uuid),
    ('33333333-3333-4333-8333-333333333333'::uuid),
    ('44444444-4444-4444-8444-444444444444'::uuid)$$,
  'an idempotent retry does not rotate another retained assessment'
);

insert into public.prospects (
  nickname,
  phone_hmac,
  phone_ciphertext,
  phone_iv,
  school_name,
  applicant_stage,
  region
) values (
  '긴트랜잭션52',
  decode(repeat('d4', 32), 'hex'),
  decode(repeat('e5', 16), 'hex'),
  decode(repeat('f6', 12), 'hex'),
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
  '{"documentary":25,"art_photo":25,"commercial":25,"video":25}'::jsonb,
  25,
  pg_catalog.jsonb_build_object('marker', fixture.marker),
  fixture.boundary_time,
  fixture.boundary_time
from public.prospects prospect
cross join (
  select
    keys.idempotency_key,
    keys.marker,
    pg_catalog.clock_timestamp() as boundary_time
  from (values
    ('a1111111-1111-4111-8111-111111111111'::uuid, 'boundary-first'),
    ('a2222222-2222-4222-8222-222222222222'::uuid, 'boundary-second'),
    ('a3333333-3333-4333-8333-333333333333'::uuid, 'boundary-third')
  ) as keys(idempotency_key, marker)
) fixture
where prospect.nickname = '긴트랜잭션52';

select pg_catalog.pg_sleep(0.01);

insert into pg_temp.rpc_results
select 'long-transaction', completion.*
from public.complete_assessment(
  (select id from public.prospects where nickname = '긴트랜잭션52'),
  'b4444444-4444-4444-8444-444444444444', null,
  '{"documentary":80,"art_photo":70,"commercial":60,"video":50}', 76,
  '{"marker":"long-transaction-new"}', pg_temp.valid_responses('긴트랜잭션신규')
) completion;

select ok(
  coalesce((
    select result.created and exists (
      select 1
      from public.assessments assessment
      where assessment.id = result.assessment_id
        and assessment.public_id = result.public_id
    )
    from pg_temp.rpc_results result
    where result.call_name = 'long-transaction'
  ), false),
  'rotation cannot delete the newly returned assessment in a long transaction'
);

select results_eq(
  $$select idempotency_key
    from public.assessments
    where prospect_id = (select id from public.prospects where nickname = '긴트랜잭션52')
    order by completed_at desc, id desc$$,
  $$values
    ('b4444444-4444-4444-8444-444444444444'::uuid),
    ('a3333333-3333-4333-8333-333333333333'::uuid),
    ('a2222222-2222-4222-8222-222222222222'::uuid)$$,
  'a long-transaction completion remains the newest key in the retained three'
);

insert into pg_temp.atomic_state
select
  (select pg_catalog.count(*) from public.assessments where prospect_id = prospect.id),
  (select pg_catalog.count(*)
   from public.assessment_responses response
   join public.assessments assessment on assessment.id = response.assessment_id
   where assessment.prospect_id = prospect.id),
  prospect.last_active_at
from public.prospects prospect
where prospect.nickname = '완료원자성51';

select throws_ok(
  $$select * from public.complete_assessment(
    (select id from public.prospects where nickname = '완료원자성51'),
    '55555555-5555-4555-8555-555555555555', null,
    '{"documentary":80,"art_photo":70,"commercial":60,"video":50}', 76,
    '{"marker":"strict-invalid"}',
    pg_catalog.jsonb_set(pg_temp.valid_responses('엄격오류'), '{0,unexpected}', 'true')
  )$$,
  null,
  null,
  'strict response objects reject unexpected fields'
);

select throws_ok(
  $$select * from public.complete_assessment(
    (select id from public.prospects where nickname = '완료원자성51'),
    '66666666-6666-4666-8666-666666666666', null,
    '{"documentary":80,"art_photo":70,"commercial":60,"video":50}', 76,
    '{"marker":"duplicate-invalid"}',
    pg_temp.valid_responses('중복오류') || pg_catalog.jsonb_build_array(
      pg_temp.valid_responses('중복오류') -> 0
    )
  )$$,
  null,
  null,
  'duplicate group and option identities are rejected before insertion'
);

select throws_ok(
  $$select * from public.complete_assessment(
    (select id from public.prospects where nickname = '완료원자성51'),
    '77777777-7777-4777-8777-777777777777', null,
    '{"documentary":80,"art_photo":70,"commercial":60,"video":50}', 76,
    '{"marker":"too-few"}', pg_temp.valid_responses('부족') - 3
  )$$,
  null,
  null,
  'response arrays reject fewer than four entries'
);

select throws_ok(
  $$select * from public.complete_assessment(
    (select id from public.prospects where nickname = '완료원자성51'),
    '88888888-8888-4888-8888-888888888888', null,
    '{"documentary":80,"art_photo":70,"commercial":60,"video":50}', 76,
    '{"marker":"too-many"}', pg_temp.too_many_responses()
  )$$,
  null,
  null,
  'response arrays reject more than eleven entries'
);

select ok(
  coalesce((
    select state.assessment_count = (
        select pg_catalog.count(*) from public.assessments where prospect_id = prospect.id
      )
      and state.response_count = (
        select pg_catalog.count(*)
        from public.assessment_responses response
        join public.assessments assessment on assessment.id = response.assessment_id
        where assessment.prospect_id = prospect.id
      )
      and state.last_active_at = prospect.last_active_at
      and not exists (
        select 1 from public.assessments
        where idempotency_key in (
          '55555555-5555-4555-8555-555555555555',
          '66666666-6666-4666-8666-666666666666',
          '77777777-7777-4777-8777-777777777777',
          '88888888-8888-4888-8888-888888888888'
        )
      )
    from pg_temp.atomic_state state
    cross join public.prospects prospect
    where prospect.nickname = '완료원자성51'
  ), false),
  'every invalid response attempt rolls back assessment, responses, and prospect activity atomically'
);

select throws_ok(
  $$select * from public.complete_assessment(
    9223372036854775807,
    '99999999-9999-4999-8999-999999999999', null,
    '{"documentary":80,"art_photo":70,"commercial":60,"video":50}', 76,
    '{"marker":"missing-prospect"}', pg_temp.valid_responses('없는학생')
  )$$,
  null,
  null,
  'a missing prospect fails closed before assessment insertion'
);

select is(
  (select pg_catalog.count(*) from public.assessments
   where idempotency_key = '99999999-9999-4999-8999-999999999999'),
  0::bigint,
  'a missing prospect cannot leave assessment detail behind'
);

select * from finish();

rollback;
