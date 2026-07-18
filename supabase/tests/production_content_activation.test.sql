begin;

select plan(16);

select has_function(
  'public', 'activate_verified_2026_content', array[]::text[],
  'production content activation function exists after migrations'
);
select function_privs_are(
  'public', 'activate_verified_2026_content', array[]::text[],
  'service_role', array['EXECUTE'],
  'service role can run verified production activation'
);
select function_privs_are(
  'public', 'activate_verified_2026_content', array[]::text[],
  'authenticated', array[]::text[],
  'ordinary users cannot run verified production activation'
);

insert into auth.users(id) values ('26000000-0000-4000-8000-000000000026');
insert into public.admin_users(id, role, is_active)
values ('26000000-0000-4000-8000-000000000026', 'admin', true);

select is(
  public.activate_verified_2026_content() ->> 'status',
  'updated',
  'activation publishes the verified 2026 content when an active administrator exists'
);
select is(
  (select count(*)::integer from public.faculty
   where name = any (array['조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱']::text[])
     and status = 'active'),
  6,
  'all six approved faculty are active'
);
select is(
  (select count(*)::integer from public.faculty
   where name = any (array['조대연', '윤태준', '김사라']::text[])
     and employment_type = 'full_time'
     and consultation_role = 'primary'
     and weekly_capacity = 4),
  3,
  'all three approved primary faculty receive explicit positive weekly capacity'
);
select is(
  (select array_agg(priority order by name) from public.faculty
   where name = any (array['조대연', '윤태준', '김사라']::text[])),
  array[100, 200, 300]::smallint[],
  'primary faculty receive explicit deterministic priorities'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'course' and status = 'active' and visibility = 'public'),
  41,
  'validated public 2026 courses are active'
);
select ok(
  (select count(*)::integer from public.resources resource
   where resource.type = 'course' and resource.status = 'active' and resource.visibility = 'public'
     and exists (
       select 1 from public.resource_tags tag
       where tag.resource_id = resource.id and tag.tag_key = 'documentary'
     )) > 0,
  'the documentary track has an active public course'
);
select ok(
  (select count(*)::integer from public.resources resource
   where resource.type = 'course' and resource.status = 'active' and resource.visibility = 'public'
     and exists (
       select 1 from public.resource_tags tag
       where tag.resource_id = resource.id and tag.tag_key = 'art_photo'
     )) > 0,
  'the art-photo track has an active public course'
);
select ok(
  (select count(*)::integer from public.resources resource
   where resource.type = 'course' and resource.status = 'active' and resource.visibility = 'public'
     and exists (
       select 1 from public.resource_tags tag
       where tag.resource_id = resource.id and tag.tag_key = 'commercial'
     )) > 0,
  'the commercial track has an active public course'
);
select ok(
  (select count(*)::integer from public.resources resource
   where resource.type = 'course' and resource.status = 'active' and resource.visibility = 'public'
     and exists (
       select 1 from public.resource_tags tag
       where tag.resource_id = resource.id and tag.tag_key = 'video'
     )) > 0,
  'the video track has an active public course'
);
select ok(
  exists (select 1 from public.resources where type = 'equipment' and status = 'active' and visibility = 'public'),
  'verified public equipment is activated through the existing validator'
);
select ok(
  exists (select 1 from public.resources where type = 'equipment' and status = 'draft' and visibility = 'admin_only'),
  'unverified equipment remains draft'
);
select ok(
  exists (
    select 1 from public.resources
    where status = 'draft'
      and metadata -> 'archive' ->> 'evidenceStatus' = 'verify_required'
  ),
  'records rejected by archive validation remain draft'
);
select is(
  public.activate_verified_2026_content() ->> 'status',
  'already_activated',
  'activation is idempotent after the verified records are published'
);

select * from finish();
rollback;
