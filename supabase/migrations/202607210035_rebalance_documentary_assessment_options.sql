begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('photo_next.assessment_options.v1', 0)
);

lock table public.assessment_options in share row exclusive mode;

do $migration$
declare
  v_changed integer;
  v_non_target_fingerprint text;
begin
  -- A pristine database is populated by the canonical seed after migrations.
  -- Existing deployments must have the complete approved catalog below.
  if not exists (select 1 from public.assessment_options) then
    return;
  end if;

  if (
    select pg_catalog.count(*)
    from public.assessment_options
    where status = 'active'
  ) <> 28 then
    raise exception using
      errcode = 'P0001',
      message = 'assessment rebalance aborted: expected 28 active options';
  end if;

  if exists (
    select 1
    from (
      values
        ('work'::text, 10::bigint),
        ('result'::text, 8::bigint),
        ('style'::text, 6::bigint),
        ('career'::text, 4::bigint)
    ) as expected(question_group, option_count)
    full outer join (
      select question_group, pg_catalog.count(*) as option_count
      from public.assessment_options
      where status = 'active'
      group by question_group
    ) as actual using (question_group)
    where expected.question_group is null
      or actual.question_group is null
      or expected.option_count is distinct from actual.option_count
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'assessment rebalance aborted: active option groups do not match the approved catalog';
  end if;

  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'question_group', question_group,
              'option_key', option_key,
              'label', label,
              'description', description,
              'visual_key', visual_key,
              'track_weights', track_weights,
              'interest_tags', interest_tags,
              'status', status,
              'sort_order', sort_order
            )
            order by pg_catalog.array_position(
              array['work', 'result', 'style', 'career'],
              question_group
            ), sort_order
          ),
          '[]'::jsonb
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  into v_non_target_fingerprint
  from public.assessment_options
  where option_key not in ('work.photo_everyday', 'work.brand_region');

  if v_non_target_fingerprint is distinct from
    '2436467a58414325724d9673051ec705515ec5dcb3305177b79d45efae86b112'
  then
    raise exception using
      errcode = 'P0001',
      message = 'assessment rebalance aborted: non-target options drifted from the approved catalog';
  end if;

  if (
    select pg_catalog.count(*)
    from public.assessment_options
    where question_group = 'work'
      and option_key in ('work.photo_everyday', 'work.brand_region')
      and status = 'active'
  ) <> 2 then
    raise exception using
      errcode = 'P0001',
      message = 'assessment rebalance aborted: target options are unavailable';
  end if;

  if exists (
    select 1
    from public.assessment_options
    where option_key = 'work.photo_everyday'
      and (
        question_group is distinct from 'work'
        or label is distinct from '인물·풍경·일상을 사진으로 촬영하기'
        or description is not null
        or visual_key is distinct from 'photo_frame'
        or interest_tags is distinct from '["photography","portrait","landscape","daily_life","field"]'::jsonb
        or status is distinct from 'active'
        or sort_order is distinct from 1
        or track_weights not in (
          '{"documentary":2,"art_photo":3,"commercial":1,"video":0}'::jsonb,
          '{"documentary":3,"art_photo":2,"commercial":1,"video":0}'::jsonb
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'assessment rebalance aborted: work.photo_everyday drifted from the approved catalog';
  end if;

  if exists (
    select 1
    from public.assessment_options
    where option_key = 'work.brand_region'
      and (
        question_group is distinct from 'work'
        or label is distinct from '브랜드·지역을 위한 콘텐츠 만들기'
        or description is not null
        or visual_key is distinct from 'location_board'
        or interest_tags is distinct from '["brand","local_culture","content","planning","public_content"]'::jsonb
        or status is distinct from 'active'
        or sort_order is distinct from 6
        or track_weights not in (
          '{"documentary":2,"art_photo":1,"commercial":3,"video":2}'::jsonb,
          '{"documentary":3,"art_photo":1,"commercial":2,"video":2}'::jsonb
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'assessment rebalance aborted: work.brand_region drifted from the approved catalog';
  end if;

  update public.assessment_options
  set
    track_weights = case option_key
      when 'work.photo_everyday'
        then '{"documentary":3,"art_photo":2,"commercial":1,"video":0}'::jsonb
      when 'work.brand_region'
        then '{"documentary":3,"art_photo":1,"commercial":2,"video":2}'::jsonb
    end,
    updated_at = pg_catalog.statement_timestamp()
  where (
    option_key = 'work.photo_everyday'
    and track_weights = '{"documentary":2,"art_photo":3,"commercial":1,"video":0}'::jsonb
  ) or (
    option_key = 'work.brand_region'
    and track_weights = '{"documentary":2,"art_photo":1,"commercial":3,"video":2}'::jsonb
  );

  get diagnostics v_changed = row_count;

  if v_changed not between 0 and 2 then
    raise exception using
      errcode = 'P0001',
      message = 'assessment rebalance aborted: unexpected update count';
  end if;

  if exists (
    select 1
    from public.assessment_options
    where option_key = 'work.photo_everyday'
      and track_weights is distinct from '{"documentary":3,"art_photo":2,"commercial":1,"video":0}'::jsonb
  ) or exists (
    select 1
    from public.assessment_options
    where option_key = 'work.brand_region'
      and track_weights is distinct from '{"documentary":3,"art_photo":1,"commercial":2,"video":2}'::jsonb
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'assessment rebalance aborted: target verification failed';
  end if;
end
$migration$;

commit;
