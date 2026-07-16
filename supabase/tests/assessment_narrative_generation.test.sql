begin;

select no_plan();

create extension if not exists dblink with schema extensions;

select has_table('public', 'assessment_narrative_generations', 'the private generation ledger exists');
select has_table('public', 'career_narrative_reports', 'the bounded narrative report queue exists');
select policies_are('public', 'assessment_narrative_generations', array[]::text[]);
select policies_are('public', 'career_narrative_reports', array[]::text[]);

select function_returns(
  'public',
  'claim_assessment_narrative_generation',
  array['bigint','uuid','text','jsonb','text','integer','integer'],
  'jsonb'
);
select function_returns(
  'public',
  'mark_assessment_narrative_attempted',
  array['bigint','uuid'],
  'boolean'
);
select function_returns(
  'public',
  'finish_assessment_narrative_generation',
  array['bigint','uuid','jsonb','text','text','text','text','integer','integer'],
  'jsonb'
);
select function_returns(
  'public',
  'read_assessment_narrative_generation',
  array['bigint','uuid','text'],
  'jsonb'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'
  ) is not null,
  'the seven-argument compatibility wrapper remains exact'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb,bigint)'
  ) is null,
  'complete_assessment has no ambiguous eight-argument overload'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.complete_assessment_with_narrative(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb,bigint)'
  ) is not null,
  'the narrative-aware completion function has one exact signature'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.complete_assessment_internal_v2(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb,bigint,boolean)'
  ) is not null,
  'the wrappers share one exact internal transaction body'
);

select function_privs_are(
  'public',
  'complete_assessment_internal_v2',
  array['bigint','uuid','bigint','jsonb','numeric','jsonb','jsonb','bigint','boolean'],
  'service_role',
  array[]::text[]
);

select ok(
  coalesce((
    select function_row.prosecdef
      and function_row.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc function_row
    where function_row.oid = pg_catalog.to_regprocedure(
      'public.complete_assessment_internal_v2(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb,bigint,boolean)'
    )
  ), false),
  'the shared completion body is security definer with an empty search path'
);

select function_privs_are(
  'public',
  'claim_assessment_narrative_generation',
  array['bigint','uuid','text','jsonb','text','integer','integer'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'claim_assessment_narrative_generation',
  array['bigint','uuid','text','jsonb','text','integer','integer'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'claim_assessment_narrative_generation',
  array['bigint','uuid','text','jsonb','text','integer','integer'],
  'authenticated',
  array[]::text[]
);
select function_privs_are(
  'public',
  'complete_assessment_with_narrative',
  array['bigint','uuid','bigint','jsonb','numeric','jsonb','jsonb','bigint'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'complete_assessment_with_narrative',
  array['bigint','uuid','bigint','jsonb','numeric','jsonb','jsonb','bigint'],
  'authenticated',
  array[]::text[]
);

select is(
  (
    select pg_catalog.count(*)::integer
    from information_schema.role_table_grants privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = any(array[
        'assessment_narrative_generations',
        'career_narrative_reports'
      ])
      and privilege.grantee = any(array['PUBLIC', 'anon', 'authenticated'])
  ),
  0,
  'browser roles have no direct narrative table privileges'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from (values
      ('claim_assessment_narrative_generation(bigint,uuid,text,jsonb,text,integer,integer)'),
      ('mark_assessment_narrative_attempted(bigint,uuid)'),
      ('finish_assessment_narrative_generation(bigint,uuid,jsonb,text,text,text,text,integer,integer)'),
      ('read_assessment_narrative_generation(bigint,uuid,text)'),
      ('complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'),
      ('complete_assessment_with_narrative(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb,bigint)'),
      ('complete_assessment_internal_v2(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb,bigint,boolean)')
    ) signature(name)
    join pg_catalog.pg_proc function_row
      on function_row.oid = pg_catalog.to_regprocedure('public.' || signature.name)
    where not function_row.prosecdef
      or not coalesce(function_row.proconfig, array[]::text[]) @> array['search_path=""']
  ),
  0,
  'every narrative and completion RPC is security definer with an empty search path'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from (values
      ('anon', 'claim_assessment_narrative_generation(bigint,uuid,text,jsonb,text,integer,integer)'),
      ('anon', 'mark_assessment_narrative_attempted(bigint,uuid)'),
      ('anon', 'finish_assessment_narrative_generation(bigint,uuid,jsonb,text,text,text,text,integer,integer)'),
      ('anon', 'read_assessment_narrative_generation(bigint,uuid,text)'),
      ('anon', 'complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'),
      ('anon', 'complete_assessment_with_narrative(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb,bigint)'),
      ('authenticated', 'claim_assessment_narrative_generation(bigint,uuid,text,jsonb,text,integer,integer)'),
      ('authenticated', 'mark_assessment_narrative_attempted(bigint,uuid)'),
      ('authenticated', 'finish_assessment_narrative_generation(bigint,uuid,jsonb,text,text,text,text,integer,integer)'),
      ('authenticated', 'read_assessment_narrative_generation(bigint,uuid,text)'),
      ('authenticated', 'complete_assessment(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb)'),
      ('authenticated', 'complete_assessment_with_narrative(bigint,uuid,bigint,jsonb,numeric,jsonb,jsonb,bigint)')
    ) privilege(role_name, signature)
    where pg_catalog.has_function_privilege(
      privilege.role_name,
      pg_catalog.to_regprocedure('public.' || privilege.signature),
      'execute'
    )
  ),
  0,
  'no browser role can execute any narrative or completion RPC'
);

select ok(
  pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.claim_assessment_narrative_generation(bigint,uuid,text,jsonb,text,integer,integer)'
  )) like '%v_utc_day := (v_now at time zone %UTC%)::date%',
  'the claim derives its budget day from UTC'
);
select ok(
  pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.claim_assessment_narrative_generation(bigint,uuid,text,jsonb,text,integer,integer)'
  )) like '%career-narrative:%v_utc_day%',
  'the UTC date participates in the advisory lock key'
);
select isnt(
  pg_catalog.hashtextextended(
    'career-narrative:' || ((pg_catalog.clock_timestamp() at time zone 'UTC')::date)::text,
    0
  ),
  pg_catalog.hashtextextended(
    'career-narrative:' || (((pg_catalog.clock_timestamp() at time zone 'UTC')::date + 1))::text,
    0
  ),
  'adjacent UTC days use different advisory-lock keys'
);

select is(
  extensions.dblink_connect(
    'narrative_concurrency_setup',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the narrative concurrency setup session connects'
);
select extensions.dblink_exec(
  'narrative_concurrency_setup',
  $$delete from public.prospects where nickname like '서사경합학생%'$$
);
select extensions.dblink_exec(
  'narrative_concurrency_setup',
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region
    ) values (
      '서사경합학생1', decode(repeat('f1', 32), 'hex'), decode(repeat('f2', 16), 'hex'),
      decode(repeat('f3', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
    )$$
);
select is(
  extensions.dblink_connect(
    'narrative_concurrency_a',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the first narrative concurrency session connects'
);
select is(
  extensions.dblink_connect(
    'narrative_concurrency_b',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the second narrative concurrency session connects'
);
select extensions.dblink_exec('narrative_concurrency_a', 'set role service_role');
select extensions.dblink_exec('narrative_concurrency_b', 'set role service_role');

create temporary table narrative_concurrency_queries as
select pg_catalog.format(
  $query$with barrier as materialized (select pg_catalog.pg_sleep(0.2))
    select public.claim_assessment_narrative_generation(
      %s, '50000000-0000-4000-8000-000000000001',
      %L, %L::jsonb, 'enabled', 5000, 50
    ) from barrier$query$,
  prospect.id,
  'sha256:' || repeat('a', 64),
  '{"source":"deterministic","sentences":[{"slot":"direction","text":"경합 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb
) as query
from public.prospects prospect
where prospect.nickname = '서사경합학생1';

select is(
  extensions.dblink_send_query(
    'narrative_concurrency_a',
    (select query from narrative_concurrency_queries)
  ),
  1,
  'the first duplicate claim is dispatched'
);
select is(
  extensions.dblink_send_query(
    'narrative_concurrency_b',
    (select query from narrative_concurrency_queries)
  ),
  1,
  'the second duplicate claim is dispatched before the first completes'
);

create temporary table narrative_concurrency_results(result jsonb);
insert into narrative_concurrency_results
select result
from extensions.dblink_get_result('narrative_concurrency_a') response(result jsonb);
insert into narrative_concurrency_results
select result
from extensions.dblink_get_result('narrative_concurrency_b') response(result jsonb);

select is(
  (select pg_catalog.count(*)::integer from narrative_concurrency_results where result ->> 'kind' = 'owner'),
  1,
  'exactly one concurrent duplicate owns the provider call'
);
select is(
  (select pg_catalog.count(*)::integer from narrative_concurrency_results where result ->> 'kind' = 'waiting'),
  1,
  'the other concurrent duplicate waits without a lease takeover'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessment_narrative_generations generation
    join public.prospects prospect on prospect.id = generation.prospect_id
    where prospect.nickname = '서사경합학생1'
      and generation.model_budget_reserved
  ),
  1,
  'concurrent duplicate claims reserve one budget unit'
);

select extensions.dblink_disconnect('narrative_concurrency_a');
select extensions.dblink_disconnect('narrative_concurrency_b');
select extensions.dblink_exec(
  'narrative_concurrency_setup',
  $$delete from public.prospects where nickname = '서사경합학생1'$$
);
select extensions.dblink_disconnect('narrative_concurrency_setup');

create function pg_temp.narrative(p_marker text)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'source', 'deterministic',
    'sentences', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('slot', 'direction', 'text', p_marker || ' 방향입니다.', 'evidenceIds', '["track:art_photo"]'::jsonb),
      pg_catalog.jsonb_build_object('slot', 'learning_path', 'text', p_marker || ' 학습입니다.', 'evidenceIds', '["track:art_photo"]'::jsonb),
      pg_catalog.jsonb_build_object('slot', 'career_direction', 'text', p_marker || ' 진로입니다.', 'evidenceIds', '["track:art_photo"]'::jsonb),
      pg_catalog.jsonb_build_object('slot', 'faculty_connection', 'text', p_marker || ' 상담입니다.', 'evidenceIds', '["faculty:primary:1:name"]'::jsonb)
    )
  );
$function$;

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

insert into public.prospects (
  nickname, phone_hmac, phone_ciphertext, phone_iv,
  school_name, applicant_stage, region
)
select
  fixture.nickname,
  decode(fixture.hmac_hex, 'hex'),
  decode(repeat(fixture.cipher_hex, 16), 'hex'),
  decode(repeat(fixture.iv_hex, 12), 'hex'),
  '광주고등학교',
  'high3',
  'gwangju'
from (values
  ('서사원장학생', repeat('a1', 32), 'a2', 'a3'),
  ('서사예산학생', repeat('b1', 32), 'b2', 'b3'),
  ('서사전역학생', repeat('c1', 32), 'c2', 'c3'),
  ('서사완료학생', repeat('d1', 32), 'd2', 'd3'),
  ('서사보존학생', repeat('e1', 32), 'e2', 'e3')
) as fixture(nickname, hmac_hex, cipher_hex, iv_hex);

set local role service_role;

select throws_ok(
  pg_catalog.format(
    $query$select public.claim_assessment_narrative_generation(
      %s,
      '09000000-0000-4000-8000-000000000001',
      'sha256:%s',
      %L::jsonb,
      null::text,
      500,
      5
    )$query$,
    (select id from public.prospects where nickname = '서사원장학생'),
    repeat('1', 64),
    pg_temp.narrative('NULL게이트')
  ),
  '22023',
  'invalid narrative generation claim',
  'a null model gate fails closed'
);
select throws_ok(
  pg_catalog.format(
    $query$select public.claim_assessment_narrative_generation(
      %s,
      '09000000-0000-4000-8000-000000000002',
      'sha256:%s',
      %L::jsonb,
      'enabled',
      null::integer,
      5
    )$query$,
    (select id from public.prospects where nickname = '서사원장학생'),
    repeat('2', 64),
    pg_temp.narrative('NULL일일예산')
  ),
  '22023',
  'invalid narrative generation claim',
  'a null daily cap fails closed'
);
select throws_ok(
  pg_catalog.format(
    $query$select public.claim_assessment_narrative_generation(
      %s,
      '09000000-0000-4000-8000-000000000003',
      'sha256:%s',
      %L::jsonb,
      'enabled',
      500,
      null::integer
    )$query$,
    (select id from public.prospects where nickname = '서사원장학생'),
    repeat('3', 64),
    pg_temp.narrative('NULL개인예산')
  ),
  '22023',
  'invalid narrative generation claim',
  'a null rolling prospect cap fails closed'
);

create temporary table narrative_claims (
  label text primary key,
  result jsonb not null
);

insert into narrative_claims(label, result)
select 'owner', public.claim_assessment_narrative_generation(
  (select id from public.prospects where nickname = '서사원장학생'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'sha256:' || repeat('a', 64),
  pg_temp.narrative('원장'),
  'enabled',
  500,
  5
);

select is(
  (select result ->> 'kind' from narrative_claims where label = 'owner'),
  'owner',
  'first logical attempt owns the only provider call'
);

insert into narrative_claims(label, result)
select 'waiting', public.claim_assessment_narrative_generation(
  (select id from public.prospects where nickname = '서사원장학생'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'sha256:' || repeat('a', 64),
  pg_temp.narrative('원장'),
  'enabled',
  500,
  5
);

select is(
  (select result ->> 'kind' from narrative_claims where label = 'waiting'),
  'waiting',
  'a duplicate never receives a second provider-call lease'
);
select is(
  (select result ->> 'claimToken' from narrative_claims where label = 'waiting'),
  null,
  'a waiting duplicate cannot read the owner claim token'
);

insert into narrative_claims(label, result)
select 'conflict', public.claim_assessment_narrative_generation(
  (select id from public.prospects where nickname = '서사원장학생'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'sha256:' || repeat('b', 64),
  pg_temp.narrative('다른입력'),
  'enabled',
  500,
  5
);
select is(
  (select result ->> 'kind' from narrative_claims where label = 'conflict'),
  'conflict',
  'the same idempotency key rejects a different input hash'
);

reset role;

select is(
  (
    select expires_at = created_at + interval '12 seconds'
    from public.assessment_narrative_generations
    where id = (select (result ->> 'id')::bigint from narrative_claims where label = 'owner')
  ),
  true,
  'the provider-call lease is exactly twelve seconds'
);

set local role service_role;

select is(
  public.mark_assessment_narrative_attempted(
    (select (result ->> 'id')::bigint from narrative_claims where label = 'owner'),
    'ffffffff-ffff-4fff-8fff-ffffffffffff'
  ),
  false,
  'a non-owner token cannot mark a provider attempt'
);
select is(
  public.mark_assessment_narrative_attempted(
    (select (result ->> 'id')::bigint from narrative_claims where label = 'owner'),
    (select (result ->> 'claimToken')::uuid from narrative_claims where label = 'owner')
  ),
  true,
  'the live owner marks exactly one external attempt'
);
select is(
  public.mark_assessment_narrative_attempted(
    (select (result ->> 'id')::bigint from narrative_claims where label = 'owner'),
    (select (result ->> 'claimToken')::uuid from narrative_claims where label = 'owner')
  ),
  false,
  'the external attempt marker is compare-and-set'
);

insert into narrative_claims(label, result)
select 'invalid-finish', public.claim_assessment_narrative_generation(
  (select id from public.prospects where nickname = '서사원장학생'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  'sha256:' || repeat('b', 64),
  pg_temp.narrative('잘못된종료'),
  'enabled',
  500,
  5
);
select is(
  public.mark_assessment_narrative_attempted(
    (select (result ->> 'id')::bigint from narrative_claims where label = 'invalid-finish'),
    (select (result ->> 'claimToken')::uuid from narrative_claims where label = 'invalid-finish')
  ),
  true,
  'the invalid-finish fixture owns a marked provider attempt'
);
select throws_ok(
  pg_catalog.format(
    $query$select public.finish_assessment_narrative_generation(
      %s,
      %L::uuid,
      %L::jsonb,
      null::text,
      null::text,
      null::text,
      null::text,
      null::integer,
      null::integer
    )$query$,
    (select (result ->> 'id')::bigint from narrative_claims where label = 'invalid-finish'),
    (select result ->> 'claimToken' from narrative_claims where label = 'invalid-finish'),
    pg_temp.narrative('잘못된출처')
  ),
  '22023',
  'invalid narrative generation result',
  'a null terminal source fails with the stable private validation error'
);
select throws_ok(
  pg_catalog.format(
    $query$select public.finish_assessment_narrative_generation(
      %s,
      %L::uuid,
      %L::jsonb,
      'deterministic',
      null::text,
      null::text,
      null::text,
      null::integer,
      null::integer
    )$query$,
    (select (result ->> 'id')::bigint from narrative_claims where label = 'invalid-finish'),
    (select result ->> 'claimToken' from narrative_claims where label = 'invalid-finish'),
    pg_temp.narrative('잘못된종료')
  ),
  '22023',
  'invalid narrative generation result',
  'a deterministic provider fallback requires one bounded failure category'
);

select is(
  public.finish_assessment_narrative_generation(
    (select (result ->> 'id')::bigint from narrative_claims where label = 'owner'),
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    pg_temp.narrative('탈취'),
    'openai',
    null,
    'gpt-test',
    'resp_wrong',
    10,
    20
  ) ->> 'kind',
  'conflict',
  'a non-owner token cannot finalize a live claim'
);

insert into narrative_claims(label, result)
select 'terminal', public.finish_assessment_narrative_generation(
  (select (result ->> 'id')::bigint from narrative_claims where label = 'owner'),
  (select (result ->> 'claimToken')::uuid from narrative_claims where label = 'owner'),
  pg_catalog.jsonb_set(pg_temp.narrative('모델'), '{source}', '"openai"'),
  'openai',
  null,
  'gpt-test',
  'resp_model_1',
  10,
  20
);
select is(
  (select result ->> 'kind' from narrative_claims where label = 'terminal'),
  'terminal',
  'the live owner can finalize one validated model narrative'
);
select is(
  (select result ->> 'source' from narrative_claims where label = 'terminal'),
  'openai',
  'the terminal row exposes its authoritative source'
);

select is(
  public.finish_assessment_narrative_generation(
    (select (result ->> 'id')::bigint from narrative_claims where label = 'owner'),
    (select (result ->> 'claimToken')::uuid from narrative_claims where label = 'owner'),
    pg_temp.narrative('덮어쓰기'),
    'deterministic',
    'provider_error',
    null,
    null,
    null,
    null
  ) -> 'narrative',
  (select result -> 'narrative' from narrative_claims where label = 'terminal'),
  'a second finalizer receives the first terminal narrative without overwriting it'
);

reset role;

insert into public.assessment_narrative_generations (
  prospect_id, idempotency_key, input_hash, state, fallback_narrative,
  model_budget_reserved, created_at, expires_at
)
select
  id,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'sha256:' || repeat('c', 64),
  'claimed',
  pg_temp.narrative('만료'),
  true,
  clock.now_at - interval '20 seconds',
  clock.now_at - interval '8 seconds'
from public.prospects
cross join lateral (select pg_catalog.clock_timestamp() as now_at) clock
where nickname = '서사원장학생';

set local role service_role;

select is(
  public.read_assessment_narrative_generation(
    (select id from public.prospects where nickname = '서사원장학생'),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'sha256:' || repeat('c', 64)
  ) ->> 'failureCode',
  'stale_claim',
  'an expired claim atomically settles the stored fallback'
);
select is(
  public.read_assessment_narrative_generation(
    (select id from public.prospects where nickname = '서사원장학생'),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'sha256:' || repeat('d', 64)
  ) ->> 'kind',
  'conflict',
  'polling rejects a different input hash'
);

insert into narrative_claims(label, result)
select gate, public.claim_assessment_narrative_generation(
  (select id from public.prospects where nickname = '서사예산학생'),
  idempotency_key,
  input_hash,
  pg_temp.narrative(gate),
  gate,
  500,
  5
)
from (values
  ('missing_config', '10000000-0000-4000-8000-000000000001'::uuid, 'sha256:' || repeat('1', 64)),
  ('minor_policy', '10000000-0000-4000-8000-000000000002'::uuid, 'sha256:' || repeat('2', 64)),
  ('input_ineligible:unsafe_fact', '10000000-0000-4000-8000-000000000003'::uuid, 'sha256:' || repeat('3', 64)),
  ('input_ineligible:insufficient_facts', '10000000-0000-4000-8000-000000000004'::uuid, 'sha256:' || repeat('4', 64))
) as gates(gate, idempotency_key, input_hash);

reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessment_narrative_generations
    where prospect_id = (select id from public.prospects where nickname = '서사예산학생')
      and state = 'terminal'
      and source = 'deterministic'
      and not model_budget_reserved
  ),
  4,
  'policy and input gates settle fallback without reserving model budget'
);
select results_eq(
  $$select failure_code, ineligibility_reason
    from public.assessment_narrative_generations
    where prospect_id = (select id from public.prospects where nickname = '서사예산학생')
      and failure_code = 'input_ineligible'
    order by ineligibility_reason$$,
  $$values
    ('input_ineligible'::text, 'insufficient_facts'::text),
    ('input_ineligible'::text, 'unsafe_fact'::text)$$,
  'input-ineligible rows persist only the exact private reason'
);

insert into public.assessment_narrative_generations (
  prospect_id, idempotency_key, input_hash, state, fallback_narrative,
  model_budget_reserved, created_at, expires_at
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
  'sha256:' || repeat('e', 64),
  'claimed',
  pg_temp.narrative('전역예산'),
  true,
  clock.now_at,
  clock.now_at + interval '12 seconds'
from public.prospects prospect
cross join lateral (select pg_catalog.clock_timestamp() as now_at) clock
cross join lateral (
  select pg_catalog.md5('global-budget-' || position::text) as key_hash
  from pg_catalog.generate_series(1, 500) position
) fixture
where prospect.nickname = '서사전역학생';

set local role service_role;

select is(
  public.claim_assessment_narrative_generation(
    (select id from public.prospects where nickname = '서사보존학생'),
    '20000000-0000-4000-8000-000000000001',
    'sha256:' || repeat('5', 64),
    pg_temp.narrative('전역초과'),
    'enabled',
    500,
    50
  ) ->> 'failureCode',
  'budget_exhausted',
  'the 501st UTC-day reservation settles fallback'
);

reset role;

delete from public.assessment_narrative_generations
where prospect_id = (select id from public.prospects where nickname = '서사전역학생');

insert into public.assessment_narrative_generations (
  prospect_id, idempotency_key, input_hash, state, fallback_narrative,
  model_budget_reserved, created_at, expires_at
)
select
  prospect.id,
  ('30000000-0000-4000-8000-' || pg_catalog.lpad(position::text, 12, '0'))::uuid,
  'sha256:' || repeat('f', 64),
  'claimed',
  pg_temp.narrative('개인예산'),
  true,
  clock.now_at - interval '1 hour',
  clock.now_at - interval '1 hour' + interval '12 seconds'
from public.prospects prospect
cross join lateral (select pg_catalog.clock_timestamp() as now_at) clock
cross join pg_catalog.generate_series(1, 5) position
where prospect.nickname = '서사예산학생';

set local role service_role;

select is(
  public.claim_assessment_narrative_generation(
    (select id from public.prospects where nickname = '서사예산학생'),
    '30000000-0000-4000-8000-000000000006',
    'sha256:' || repeat('6', 64),
    pg_temp.narrative('개인초과'),
    'enabled',
    5000,
    5
  ) ->> 'failureCode',
  'budget_exhausted',
  'the sixth rolling-24-hour reservation settles fallback'
);

reset role;

delete from public.assessment_narrative_generations
where model_budget_reserved;

insert into public.assessment_narrative_generations (
  prospect_id, idempotency_key, input_hash, state, fallback_narrative,
  model_budget_reserved, created_at, expires_at
)
select
  id,
  '40000000-0000-4000-8000-000000000001',
  'sha256:' || repeat('7', 64),
  'claimed',
  pg_temp.narrative('UTC이전'),
  true,
  ((pg_catalog.clock_timestamp() at time zone 'UTC')::date::timestamp at time zone 'UTC') - interval '1 microsecond',
  ((pg_catalog.clock_timestamp() at time zone 'UTC')::date::timestamp at time zone 'UTC') - interval '1 microsecond' + interval '12 seconds'
from public.prospects
where nickname = '서사전역학생';

set local timezone to 'Pacific/Auckland';
set local role service_role;

select is(
  public.claim_assessment_narrative_generation(
    (select id from public.prospects where nickname = '서사보존학생'),
    '40000000-0000-4000-8000-000000000002',
    'sha256:' || repeat('8', 64),
    pg_temp.narrative('UTC신규'),
    'enabled',
    1,
    50
  ) ->> 'kind',
  'owner',
  'a prior UTC-day row is outside the current day even in another session timezone'
);

reset role;
set local timezone to 'UTC';

delete from public.assessment_narrative_generations
where model_budget_reserved;

insert into public.assessment_narrative_generations (
  prospect_id, idempotency_key, input_hash, state, fallback_narrative,
  model_budget_reserved, created_at, expires_at
)
select
  id,
  '40000000-0000-4000-8000-000000000003',
  'sha256:' || repeat('9', 64),
  'claimed',
  pg_temp.narrative('UTC현재'),
  true,
  ((pg_catalog.clock_timestamp() at time zone 'UTC')::date::timestamp at time zone 'UTC'),
  ((pg_catalog.clock_timestamp() at time zone 'UTC')::date::timestamp at time zone 'UTC') + interval '12 seconds'
from public.prospects
where nickname = '서사전역학생';

set local timezone to 'America/Los_Angeles';
set local role service_role;

select is(
  public.claim_assessment_narrative_generation(
    (select id from public.prospects where nickname = '서사보존학생'),
    '40000000-0000-4000-8000-000000000004',
    'sha256:' || repeat('0', 64),
    pg_temp.narrative('UTC초과'),
    'enabled',
    1,
    50
  ) ->> 'failureCode',
  'budget_exhausted',
  'the UTC-day boundary row counts independently of the session timezone'
);

reset role;
set local timezone to 'UTC';

create temporary table completion_generation_results (
  label text primary key,
  result jsonb not null
);
grant select, insert, update, delete on table pg_temp.completion_generation_results to service_role;

set local role service_role;

insert into completion_generation_results(label, result)
select 'linked', public.claim_assessment_narrative_generation(
  (select id from public.prospects where nickname = '서사완료학생'),
  '60000000-0000-4000-8000-000000000001',
  'sha256:' || repeat('1', 64),
  pg_temp.narrative('완료연결'),
  'missing_config',
  500,
  5
);

create temporary table completion_results (
  label text primary key,
  assessment_id bigint not null,
  public_id uuid not null,
  created boolean not null
);
grant select, insert, update, delete on table pg_temp.completion_results to service_role;

insert into completion_results
select
  'linked',
  completion.assessment_id,
  completion.public_id,
  completion.created
from public.complete_assessment_with_narrative(
  (select id from public.prospects where nickname = '서사완료학생'),
  '60000000-0000-4000-8000-000000000001',
  null,
  '{"documentary":25,"art_photo":50,"commercial":15,"video":10}',
  50,
  pg_catalog.jsonb_build_object(
    'marker', 'linked',
    'careerNarrative', (
      select result -> 'narrative'
      from completion_generation_results
      where label = 'linked'
    )
  ),
  pg_temp.valid_responses('완료연결'),
  (
    select (result ->> 'id')::bigint
    from completion_generation_results
    where label = 'linked'
  )
) completion;

reset role;

select is(
  (select created from completion_results where label = 'linked'),
  true,
  'a terminal narrative creates one narrative-aware assessment'
);
select is(
  (
    select generation.assessment_id
    from public.assessment_narrative_generations generation
    where generation.id = (
      select (result ->> 'id')::bigint
      from completion_generation_results
      where label = 'linked'
    )
  ),
  (select assessment_id from completion_results where label = 'linked'),
  'completion links the terminal generation only after snapshot equality'
);
select is(
  (
    select assessment.result_snapshot -> 'careerNarrative'
    from public.assessments assessment
    where assessment.id = (select assessment_id from completion_results where label = 'linked')
  ),
  (
    select result -> 'narrative'
    from completion_generation_results
    where label = 'linked'
  ),
  'the persisted snapshot narrative is exactly the terminal ledger narrative'
);

set local role service_role;

insert into completion_generation_results(label, result)
select 'mismatch', public.claim_assessment_narrative_generation(
  (select id from public.prospects where nickname = '서사완료학생'),
  '60000000-0000-4000-8000-000000000002',
  'sha256:' || repeat('2', 64),
  pg_temp.narrative('불일치원장'),
  'missing_config',
  500,
  5
);

select throws_ok(
  pg_catalog.format(
    $query$select * from public.complete_assessment_with_narrative(
      %s,
      '60000000-0000-4000-8000-000000000002',
      null,
      '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
      50,
      %L::jsonb,
      %L::jsonb,
      %s
    )$query$,
    (select id from public.prospects where nickname = '서사완료학생'),
    pg_catalog.jsonb_build_object(
      'marker', 'mismatch',
      'careerNarrative', pg_temp.narrative('다른스냅샷')
    ),
    pg_temp.valid_responses('불일치'),
    (
      select (result ->> 'id')::bigint
      from completion_generation_results
      where label = 'mismatch'
    )
  ),
  '23505',
  'narrative generation conflict',
  'a mismatched snapshot cannot consume or link a terminal generation'
);

reset role;

select is(
  (
    select assessment_id
    from public.assessment_narrative_generations
    where id = (
      select (result ->> 'id')::bigint
      from completion_generation_results
      where label = 'mismatch'
    )
  ),
  null,
  'a failed snapshot equality check leaves the generation unlinked'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessments
    where prospect_id = (select id from public.prospects where nickname = '서사완료학생')
      and idempotency_key = '60000000-0000-4000-8000-000000000002'
  ),
  0,
  'a failed snapshot equality check leaves no assessment'
);

set local role service_role;

insert into completion_results
select
  'legacy',
  completion.assessment_id,
  completion.public_id,
  completion.created
from public.complete_assessment(
  (select id from public.prospects where nickname = '서사완료학생'),
  '60000000-0000-4000-8000-000000000003',
  null,
  '{"documentary":25,"art_photo":50,"commercial":15,"video":10}',
  50,
  '{"marker":"legacy"}',
  pg_temp.valid_responses('레거시')
) completion;

insert into completion_generation_results(label, result)
select 'legacy', public.claim_assessment_narrative_generation(
  (select id from public.prospects where nickname = '서사완료학생'),
  '60000000-0000-4000-8000-000000000003',
  'sha256:' || repeat('3', 64),
  pg_temp.narrative('레거시후속'),
  'missing_config',
  500,
  5
);

insert into completion_results
select
  'legacy-new-retry',
  completion.assessment_id,
  completion.public_id,
  completion.created
from public.complete_assessment_with_narrative(
  (select id from public.prospects where nickname = '서사완료학생'),
  '60000000-0000-4000-8000-000000000003',
  null,
  '{"documentary":25,"art_photo":50,"commercial":15,"video":10}',
  50,
  pg_catalog.jsonb_build_object(
    'marker', 'new-retry',
    'careerNarrative', (
      select result -> 'narrative'
      from completion_generation_results
      where label = 'legacy'
    )
  ),
  pg_temp.valid_responses('신규재시도'),
  (
    select (result ->> 'id')::bigint
    from completion_generation_results
    where label = 'legacy'
  )
) completion;

reset role;

select results_eq(
  $$select assessment_id, public_id, created
    from completion_results
    where label = 'legacy-new-retry'$$,
  $$select assessment_id, public_id, false
    from completion_results
    where label = 'legacy'$$,
  'a new Worker racing behind a legacy snapshot receives the existing identity'
);
select is(
  (
    select result_snapshot
    from public.assessments
    where id = (select assessment_id from completion_results where label = 'legacy')
  ),
  '{"marker":"legacy"}'::jsonb,
  'the new Worker never overwrites an existing legacy snapshot'
);
select is(
  (
    select assessment_id
    from public.assessment_narrative_generations
    where id = (
      select (result ->> 'id')::bigint
      from completion_generation_results
      where label = 'legacy'
    )
  ),
  null,
  'a generation is never linked to a legacy snapshot'
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
  '{"documentary":25,"art_photo":50,"commercial":15,"video":10}',
  50,
  pg_catalog.jsonb_build_object(
    'marker', fixture.marker,
    'careerNarrative', pg_temp.narrative(fixture.marker)
  ),
  fixture.completed_at,
  fixture.completed_at
from public.prospects prospect
cross join (values
  ('70000000-0000-4000-8000-000000000001'::uuid, '보존1', '2026-01-01 00:00:01+00'::timestamptz),
  ('70000000-0000-4000-8000-000000000002'::uuid, '보존2', '2026-01-01 00:00:02+00'::timestamptz),
  ('70000000-0000-4000-8000-000000000003'::uuid, '보존3', '2026-01-01 00:00:03+00'::timestamptz)
) fixture(idempotency_key, marker, completed_at)
where prospect.nickname = '서사보존학생';

insert into public.assessment_narrative_generations (
  prospect_id,
  assessment_id,
  idempotency_key,
  input_hash,
  state,
  source,
  fallback_narrative,
  narrative,
  model_budget_reserved,
  expires_at,
  failure_code,
  created_at,
  finished_at
)
select
  assessment.prospect_id,
  assessment.id,
  assessment.idempotency_key,
  'sha256:' || repeat(pg_catalog.right(assessment.idempotency_key::text, 1), 64),
  'terminal',
  'deterministic',
  assessment.result_snapshot -> 'careerNarrative',
  assessment.result_snapshot -> 'careerNarrative',
  false,
  clock.now_at + interval '12 seconds',
  'missing_config',
  clock.now_at,
  clock.now_at
from public.assessments assessment
cross join lateral (select pg_catalog.clock_timestamp() as now_at) clock
where assessment.prospect_id = (select id from public.prospects where nickname = '서사보존학생');

set local role service_role;

insert into completion_generation_results(label, result)
select 'retention-fourth', public.claim_assessment_narrative_generation(
  (select id from public.prospects where nickname = '서사보존학생'),
  '70000000-0000-4000-8000-000000000004',
  'sha256:' || repeat('4', 64),
  pg_temp.narrative('보존4'),
  'missing_config',
  500,
  5
);

insert into completion_results
select
  'retention-fourth',
  completion.assessment_id,
  completion.public_id,
  completion.created
from public.complete_assessment_with_narrative(
  (select id from public.prospects where nickname = '서사보존학생'),
  '70000000-0000-4000-8000-000000000004',
  null,
  '{"documentary":25,"art_photo":50,"commercial":15,"video":10}',
  50,
  pg_catalog.jsonb_build_object(
    'marker', '보존4',
    'careerNarrative', (
      select result -> 'narrative'
      from completion_generation_results
      where label = 'retention-fourth'
    )
  ),
  pg_temp.valid_responses('보존4'),
  (
    select (result ->> 'id')::bigint
    from completion_generation_results
    where label = 'retention-fourth'
  )
) completion;

reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessments
    where prospect_id = (select id from public.prospects where nickname = '서사보존학생')
  ),
  3,
  'narrative-aware completion preserves the recent-three assessment policy'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessment_narrative_generations
    where prospect_id = (select id from public.prospects where nickname = '서사보존학생')
      and assessment_id is not null
  ),
  3,
  'deleting the fourth-oldest assessment cascades its linked generation row'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.assessment_narrative_generations
    where prospect_id = (select id from public.prospects where nickname = '서사보존학생')
      and idempotency_key = '70000000-0000-4000-8000-000000000001'
  ),
  0,
  'the oldest linked generation is deleted with its assessment'
);

select is(
  extensions.dblink_connect(
    'narrative_completion_setup',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the rolling-deploy completion setup session connects'
);
select extensions.dblink_exec(
  'narrative_completion_setup',
  $$delete from public.prospects where nickname like '서사완료경합학생%'$$
);
select extensions.dblink_exec(
  'narrative_completion_setup',
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region
    ) values
      (
        '서사완료경합학생1', decode(repeat('91', 32), 'hex'), decode(repeat('92', 16), 'hex'),
        decode(repeat('93', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      ),
      (
        '서사완료경합학생2', decode(repeat('94', 32), 'hex'), decode(repeat('95', 16), 'hex'),
        decode(repeat('96', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      )$$
);
select extensions.dblink_exec(
  'narrative_completion_setup',
  $$with fixture as (
      select
        prospect.id,
        prospect.nickname,
        pg_catalog.clock_timestamp() as now_at
      from public.prospects prospect
      where prospect.nickname like '서사완료경합학생%'
    )
    insert into public.assessment_narrative_generations(
      prospect_id, idempotency_key, input_hash, state, source,
      fallback_narrative, narrative, model_budget_reserved,
      expires_at, failure_code, created_at, finished_at
    )
    select
      fixture.id,
      case fixture.nickname
        when '서사완료경합학생1' then '80000000-0000-4000-8000-000000000001'::uuid
        else '80000000-0000-4000-8000-000000000002'::uuid
      end,
      case fixture.nickname
        when '서사완료경합학생1' then 'sha256:' || repeat('1', 64)
        else 'sha256:' || repeat('2', 64)
      end,
      'terminal',
      'deterministic',
      case fixture.nickname
        when '서사완료경합학생1'
          then '{"source":"deterministic","sentences":[{"slot":"direction","text":"구버전 우선 경합 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb
        else '{"source":"deterministic","sentences":[{"slot":"direction","text":"신버전 우선 경합 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb
      end,
      case fixture.nickname
        when '서사완료경합학생1'
          then '{"source":"deterministic","sentences":[{"slot":"direction","text":"구버전 우선 경합 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb
        else '{"source":"deterministic","sentences":[{"slot":"direction","text":"신버전 우선 경합 방향입니다.","evidenceIds":["track:art_photo"]}]}'::jsonb
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
    'narrative_completion_a',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the first rolling-deploy completion session connects'
);
select is(
  extensions.dblink_connect(
    'narrative_completion_b',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the second rolling-deploy completion session connects'
);

create temporary table narrative_completion_race_results (
  label text primary key,
  assessment_id bigint not null,
  public_id uuid not null,
  created boolean not null
);

select extensions.dblink_exec('narrative_completion_a', 'begin');
select extensions.dblink_exec(
  'narrative_completion_a',
  $query$do $lock$
    begin
      perform prospect.id
      from public.prospects prospect
      where prospect.nickname = '서사완료경합학생1'
      for update;
    end
    $lock$;$query$
);
select extensions.dblink_exec('narrative_completion_a', 'set role service_role');
select extensions.dblink_exec('narrative_completion_b', 'set role service_role');

select is(
  extensions.dblink_send_query(
    'narrative_completion_b',
    pg_catalog.format(
      $query$select * from public.complete_assessment_with_narrative(
        %s,
        '80000000-0000-4000-8000-000000000001',
        null,
        '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
        50,
        %L::jsonb,
        %L::jsonb,
        %s
      )$query$,
      (select id from public.prospects where nickname = '서사완료경합학생1'),
      '{
        "marker":"new-behind-old",
        "careerNarrative":{
          "source":"deterministic",
          "sentences":[{
            "slot":"direction",
            "text":"구버전 우선 경합 방향입니다.",
            "evidenceIds":["track:art_photo"]
          }]
        }
      }'::jsonb,
      pg_temp.valid_responses('구버전우선신규'),
      (
        select generation.id
        from public.assessment_narrative_generations generation
        join public.prospects prospect on prospect.id = generation.prospect_id
        where prospect.nickname = '서사완료경합학생1'
      )
    )
  ),
  1,
  'the new Worker waits behind the old Worker prospect lock'
);

insert into narrative_completion_race_results
select 'old-first-old', response.*
from extensions.dblink(
  'narrative_completion_a',
  pg_catalog.format(
    $query$select * from public.complete_assessment(
      %s,
      '80000000-0000-4000-8000-000000000001',
      null,
      '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
      50,
      '{"marker":"old-first-legacy"}'::jsonb,
      %L::jsonb
    )$query$,
    (select id from public.prospects where nickname = '서사완료경합학생1'),
    pg_temp.valid_responses('구버전우선레거시')
  )
) response(assessment_id bigint, public_id uuid, created boolean);
select extensions.dblink_exec('narrative_completion_a', 'commit');

insert into narrative_completion_race_results
select 'old-first-new', response.*
from extensions.dblink_get_result(
  'narrative_completion_b'
) response(assessment_id bigint, public_id uuid, created boolean);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result(
      'narrative_completion_b'
    ) response(assessment_id bigint, public_id uuid, created boolean)
  ),
  0,
  'the old-first async result stream is fully drained'
);

select results_eq(
  $$select assessment_id, public_id
    from narrative_completion_race_results
    where label = 'old-first-new'$$,
  $$select assessment_id, public_id
    from narrative_completion_race_results
    where label = 'old-first-old'$$,
  'old-first and new-second calls converge on one assessment identity'
);
select is(
  (
    select assessment.result_snapshot
    from public.assessments assessment
    join public.prospects prospect on prospect.id = assessment.prospect_id
    where prospect.nickname = '서사완료경합학생1'
  ),
  '{"marker":"old-first-legacy"}'::jsonb,
  'the old-first race never overwrites the legacy snapshot'
);
select is(
  (
    select generation.assessment_id
    from public.assessment_narrative_generations generation
    join public.prospects prospect on prospect.id = generation.prospect_id
    where prospect.nickname = '서사완료경합학생1'
  ),
  null,
  'the old-first race never links a generation to the legacy snapshot'
);

select extensions.dblink_exec('narrative_completion_a', 'reset role');
select extensions.dblink_exec('narrative_completion_b', 'reset role');
select extensions.dblink_exec('narrative_completion_a', 'begin');
select extensions.dblink_exec(
  'narrative_completion_a',
  $query$do $lock$
    begin
      perform prospect.id
      from public.prospects prospect
      where prospect.nickname = '서사완료경합학생2'
      for update;
    end
    $lock$;$query$
);
select extensions.dblink_exec('narrative_completion_a', 'set role service_role');
select extensions.dblink_exec('narrative_completion_b', 'set role service_role');

select is(
  extensions.dblink_send_query(
    'narrative_completion_b',
    pg_catalog.format(
      $query$select * from public.complete_assessment(
        %s,
        '80000000-0000-4000-8000-000000000002',
        null,
        '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
        50,
        '{"marker":"old-behind-new"}'::jsonb,
        %L::jsonb
      )$query$,
      (select id from public.prospects where nickname = '서사완료경합학생2'),
      pg_temp.valid_responses('신버전우선레거시')
    )
  ),
  1,
  'the old Worker waits behind the new Worker prospect lock'
);

insert into narrative_completion_race_results
select 'new-first-new', response.*
from extensions.dblink(
  'narrative_completion_a',
  pg_catalog.format(
    $query$select * from public.complete_assessment_with_narrative(
      %s,
      '80000000-0000-4000-8000-000000000002',
      null,
      '{"documentary":25,"art_photo":50,"commercial":15,"video":10}'::jsonb,
      50,
      %L::jsonb,
      %L::jsonb,
      %s
    )$query$,
    (select id from public.prospects where nickname = '서사완료경합학생2'),
    '{
      "marker":"new-first-current",
      "careerNarrative":{
        "source":"deterministic",
        "sentences":[{
          "slot":"direction",
          "text":"신버전 우선 경합 방향입니다.",
          "evidenceIds":["track:art_photo"]
        }]
      }
    }'::jsonb,
    pg_temp.valid_responses('신버전우선신규'),
    (
      select generation.id
      from public.assessment_narrative_generations generation
      join public.prospects prospect on prospect.id = generation.prospect_id
      where prospect.nickname = '서사완료경합학생2'
    )
  )
) response(assessment_id bigint, public_id uuid, created boolean);
select extensions.dblink_exec('narrative_completion_a', 'commit');

insert into narrative_completion_race_results
select 'new-first-old', response.*
from extensions.dblink_get_result(
  'narrative_completion_b'
) response(assessment_id bigint, public_id uuid, created boolean);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result(
      'narrative_completion_b'
    ) response(assessment_id bigint, public_id uuid, created boolean)
  ),
  0,
  'the new-first async result stream is fully drained'
);

select results_eq(
  $$select assessment_id, public_id
    from narrative_completion_race_results
    where label = 'new-first-old'$$,
  $$select assessment_id, public_id
    from narrative_completion_race_results
    where label = 'new-first-new'$$,
  'new-first and old-second calls converge on one assessment identity'
);
select is(
  (
    select assessment.result_snapshot ->> 'marker'
    from public.assessments assessment
    join public.prospects prospect on prospect.id = assessment.prospect_id
    where prospect.nickname = '서사완료경합학생2'
  ),
  'new-first-current',
  'the old Worker never overwrites the new-first current snapshot'
);
select is(
  (
    select generation.assessment_id = assessment.id
    from public.assessment_narrative_generations generation
    join public.prospects prospect on prospect.id = generation.prospect_id
    join public.assessments assessment
      on assessment.prospect_id = generation.prospect_id
      and assessment.idempotency_key = generation.idempotency_key
    where prospect.nickname = '서사완료경합학생2'
  ),
  true,
  'the new-first race keeps the generation linked to its current snapshot'
);

select extensions.dblink_disconnect('narrative_completion_a');
select extensions.dblink_disconnect('narrative_completion_b');
select extensions.dblink_exec(
  'narrative_completion_setup',
  $$delete from public.prospects where nickname like '서사완료경합학생%'$$
);
select extensions.dblink_disconnect('narrative_completion_setup');

select * from finish();

rollback;
