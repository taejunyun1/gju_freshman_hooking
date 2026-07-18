create function public.activate_verified_2026_content()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_user_id uuid;
  v_faculty public.faculty%rowtype;
  v_resource public.resources%rowtype;
  v_outcome jsonb;
  v_track text;
  v_faculty_published integer := 0;
  v_resources_published integer := 0;
  v_validation_errors integer := 0;
begin
  select admin_user.id into v_admin_user_id
  from public.admin_users admin_user
  where admin_user.role = 'admin' and admin_user.is_active
  order by admin_user.created_at, admin_user.id
  limit 1;
  if v_admin_user_id is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  if (select count(*) from public.faculty where name = any (array[
    '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
  ]::text[])) <> 6
    or exists (
      select 1 from public.faculty
      where name = any (array['조대연', '윤태준', '김사라']::text[])
        and (employment_type <> 'full_time' or consultation_role <> 'primary')
    )
    or exists (
      select 1 from public.faculty
      where name = any (array['박재웅', '정철호', '곽동욱']::text[])
        and (employment_type <> 'adjunct' or consultation_role <> 'specialist')
    )
  then
    raise exception using errcode = 'P0001', message = 'CONTENT_SEED_FACULTY_INVALID';
  end if;

  update public.faculty faculty
  set weekly_capacity = case faculty.name
        when '조대연' then 4
        when '윤태준' then 4
        when '김사라' then 4
        else 0
      end,
      priority = case faculty.name
        when '조대연' then 300
        when '윤태준' then 200
        when '김사라' then 100
        when '박재웅' then 90
        when '정철호' then 80
        when '곽동욱' then 70
        else faculty.priority
      end,
      updated_at = pg_catalog.clock_timestamp()
  where faculty.name = any (array[
    '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
  ]::text[])
    and (
      faculty.weekly_capacity is distinct from case faculty.name
        when '조대연' then 4 when '윤태준' then 4 when '김사라' then 4 else 0 end
      or faculty.priority is distinct from case faculty.name
        when '조대연' then 300 when '윤태준' then 200 when '김사라' then 100
        when '박재웅' then 90 when '정철호' then 80 when '곽동욱' then 70 else faculty.priority end
    );

  with ranked_tags as (
    select tag.id,
      pg_catalog.row_number() over (
        partition by tag.faculty_id, tag.category
        order by tag.weight desc, tag.tag_key
      ) = 1 as is_primary
    from public.faculty_tags tag
    join public.faculty faculty on faculty.id = tag.faculty_id
    where faculty.name = any (array[
      '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
    ]::text[])
  )
  update public.faculty_tags tag
  set is_primary = ranked_tags.is_primary
  from ranked_tags
  where tag.id = ranked_tags.id
    and tag.is_primary is distinct from ranked_tags.is_primary;

  update public.faculty_tags tag
  set category = case
        when tag.category = 'track' and tag.tag_key = 'contemporary_art' then 'activity'
        else tag.category
      end,
      tag_label = case tag.tag_key
        when 'documentary' then '다큐멘터리 사진'
        when 'video' then '영상과 기술(AI·편집·드론)'
        else tag.tag_label
      end
  from public.faculty faculty
  where faculty.id = tag.faculty_id
    and faculty.name = any (array[
      '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
    ]::text[])
    and (
      (tag.category = 'track' and tag.tag_key = 'contemporary_art')
      or (tag.tag_key = 'documentary' and tag.tag_label <> '다큐멘터리 사진')
      or (tag.tag_key = 'video' and tag.tag_label <> '영상과 기술(AI·편집·드론)')
    );

  for v_faculty in
    select * from public.faculty
    where name = any (array[
      '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
    ]::text[])
    order by case when consultation_role = 'primary' then 0 else 1 end, name
  loop
    if v_faculty.status = 'active' then
      continue;
    end if;
    if v_faculty.status <> 'draft' then
      raise exception using errcode = 'P0001', message = 'CONTENT_SEED_FACULTY_STATUS_INVALID';
    end if;

    v_outcome := public.publish_admin_faculty(
      v_admin_user_id, v_faculty.updated_at, v_faculty.id, pg_catalog.gen_random_uuid()
    );
    if v_outcome ->> 'status' <> 'updated' then
      raise exception using errcode = 'P0001', message = 'CONTENT_SEED_FACULTY_PUBLISH_FAILED';
    end if;
    v_faculty_published := v_faculty_published + 1;
  end loop;

  update public.resources resource
  set metadata = resource.metadata || pg_catalog.jsonb_build_object('goal', resource.metadata ->> 'source_goal'),
      updated_at = pg_catalog.clock_timestamp()
  where resource.status = 'draft'
    and resource.visibility = 'public'
    and resource.type = 'course'
    and resource.metadata ->> 'seedKey' like 'course:%'
    and pg_catalog.jsonb_typeof(resource.metadata -> 'goal') is distinct from 'string'
    and pg_catalog.jsonb_typeof(resource.metadata -> 'source_goal') = 'string';

  for v_resource in
    select * from public.resources
    where status = 'draft' and visibility = 'public'
    order by id
  loop
    v_outcome := public.transition_admin_resource(
      v_admin_user_id, v_resource.updated_at, pg_catalog.gen_random_uuid(), v_resource.id, 'active'
    );
    if v_outcome ->> 'status' = 'updated' then
      v_resources_published := v_resources_published + 1;
    elsif v_outcome ->> 'status' = 'validation_error' then
      if (select status from public.resources where id = v_resource.id) <> 'draft' then
        raise exception using errcode = 'P0001', message = 'CONTENT_SEED_RESOURCE_VALIDATION_MUTATED';
      end if;
      v_validation_errors := v_validation_errors + 1;
    else
      raise exception using errcode = 'P0001', message = 'CONTENT_SEED_RESOURCE_PUBLISH_FAILED';
    end if;
  end loop;

  if (select count(*) from public.faculty
      where name = any (array['조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱']::text[])
        and status = 'active') <> 6
    or (select count(*) from public.faculty
        where name = any (array['조대연', '윤태준', '김사라']::text[])
          and status = 'active' and employment_type = 'full_time'
          and consultation_role = 'primary' and weekly_capacity > 0) <> 3
  then
    raise exception using errcode = 'P0001', message = 'CONTENT_SEED_FACULTY_POSTCONDITION_FAILED';
  end if;

  foreach v_track in array array['documentary', 'art_photo', 'commercial', 'video']::text[]
  loop
    if not exists (
      select 1
      from public.resources resource
      join public.resource_tags tag on tag.resource_id = resource.id
      where resource.type = 'course' and resource.status = 'active'
        and resource.visibility = 'public' and tag.tag_key = v_track
    ) then
      raise exception using errcode = 'P0001', message = 'CONTENT_SEED_COURSE_POSTCONDITION_FAILED';
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', case when v_faculty_published + v_resources_published > 0 then 'updated' else 'already_activated' end,
    'facultyPublished', v_faculty_published,
    'resourcesPublished', v_resources_published,
    'validationErrors', v_validation_errors
  );
end;
$$;

revoke all on function public.activate_verified_2026_content()
  from public, anon, authenticated, service_role;
grant execute on function public.activate_verified_2026_content() to service_role;
