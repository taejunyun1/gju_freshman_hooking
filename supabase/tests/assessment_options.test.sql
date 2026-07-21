begin;

select plan(22);

select has_table('public'::name, 'assessment_options'::name);
select col_type_is('public', 'assessment_options', 'id', 'bigint', 'catalog uses a bigint identity');
select is(
  (select is_identity from information_schema.columns
    where table_schema = 'public' and table_name = 'assessment_options' and column_name = 'id'),
  'YES',
  'catalog ID is generated as an identity'
);
select col_is_unique('public', 'assessment_options', array['question_group', 'option_key']);
select col_is_unique('public', 'assessment_options', array['question_group', 'sort_order']);
select policies_are('public', 'assessment_options', array[]::text[], 'browser roles have no catalog policy');
select table_privs_are('public', 'assessment_options', 'anon', array[]::text[], 'anonymous clients have no catalog privileges');
select table_privs_are('public', 'assessment_options', 'authenticated', array[]::text[], 'authenticated clients have no catalog privileges');
select table_privs_are('public', 'assessment_options', 'service_role', array['SELECT'], 'service role can only read the catalog');
select sequence_privs_are('public', 'assessment_options_id_seq', 'service_role', array[]::text[], 'service role cannot advance the catalog identity');

select is(
  (select count(*)::integer from public.assessment_options where status = 'active'),
  28,
  'seed contains exactly 28 active options'
);

select results_eq(
  $$select question_group, count(*)::integer
    from public.assessment_options
    where status = 'active'
    group by question_group
    order by array_position(array['work','result','style','career'], question_group)$$,
  $$values ('work', 10), ('result', 8), ('style', 6), ('career', 4)$$,
  'seed preserves the exact 10/8/6/4 group manifest'
);

select is(
  (
    select track_weights
    from public.assessment_options
    where status = 'active'
      and question_group = 'work'
      and option_key = 'work.photo_everyday'
  ),
  '{"documentary":3,"art_photo":2,"commercial":1,"video":0}'::jsonb,
  'everyday photography uses the approved documentary rebalance'
);

select is(
  (
    select track_weights
    from public.assessment_options
    where status = 'active'
      and question_group = 'work'
      and option_key = 'work.brand_region'
  ),
  '{"documentary":3,"art_photo":1,"commercial":2,"video":2}'::jsonb,
  'brand and region content uses the approved documentary rebalance'
);

select is(
  (
    select pg_catalog.md5(pg_catalog.string_agg(
      option_key || ':' || track_weights::text,
      '|' order by option_key
    ))
    from public.assessment_options
    where option_key not in ('work.photo_everyday', 'work.brand_region')
  ),
  '29d2809267aa8331d6b034e2752b782b',
  'the rebalance leaves every other option weight unchanged'
);

select throws_ok(
  $$insert into public.assessment_options(question_group, option_key, label, visual_key, track_weights, interest_tags, status, sort_order)
    values ('work', 'bad', 'bad', 'contact_sheet', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}'::jsonb, '["tag"]'::jsonb, 'active', 99)$$,
  '23514',
  null,
  'invalid option prefixes are rejected'
);

select throws_ok(
  $$insert into public.assessment_options(question_group, option_key, label, visual_key, track_weights, interest_tags, status, sort_order)
    values ('work', 'work.bad_weight', 'bad', 'contact_sheet', '{"documentary":1,"art_photo":1,"commercial":1,"video":4}'::jsonb, '["tag"]'::jsonb, 'active', 99)$$,
  '23514',
  null,
  'out-of-range track weights are rejected'
);

select throws_ok(
  $$insert into public.assessment_options(question_group, option_key, label, visual_key, track_weights, interest_tags, status, sort_order)
    values ('work', 'work.missing_weight', 'bad', 'contact_sheet', '{"documentary":1,"art_photo":1,"commercial":1}'::jsonb, '["tag"]'::jsonb, 'active', 99)$$,
  '23514',
  null,
  'track weights require the exact four-key manifest'
);

select throws_ok(
  $$insert into public.assessment_options(question_group, option_key, label, visual_key, track_weights, interest_tags, status, sort_order)
    values ('work', 'work.bad', 'bad', 'contact_sheet', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}'::jsonb, '["bad tag"]'::jsonb, 'active', 99)$$,
  '23514',
  null,
  'invalid interest tags are rejected'
);

select throws_ok(
  $$insert into public.assessment_options(question_group, option_key, label, visual_key, track_weights, interest_tags, status, sort_order)
    values ('work', 'work.duplicate_tag', 'bad', 'contact_sheet', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}'::jsonb, '["tag","tag"]'::jsonb, 'active', 99)$$,
  '23514',
  null,
  'interest tags must be unique'
);

select throws_ok(
  $$insert into public.assessment_options(question_group, option_key, label, visual_key, track_weights, interest_tags, status, sort_order)
    values ('work', 'work.bad', 'bad', 'remote_url', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}'::jsonb, '["tag"]'::jsonb, 'active', 99)$$,
  '23514',
  null,
  'visual keys are allow-listed'
);

select throws_ok(
  $$set local role service_role;
    insert into public.assessment_options(question_group, option_key, label, visual_key, track_weights, interest_tags, status, sort_order)
    values ('work', 'work.service_write', 'bad', 'contact_sheet', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}'::jsonb, '["tag"]'::jsonb, 'draft', 99)$$,
  '42501',
  null,
  'service role cannot write catalog rows'
);

select * from finish();

rollback;
