begin;
select plan(11);

select has_function('public', 'activate_verified_print_lab_facility', array[]::text[], 'print lab activation function exists');
select function_privs_are('public', 'activate_verified_print_lab_facility', array[]::text[], 'service_role', array['EXECUTE'], 'service role can activate print lab');
select function_privs_are('public', 'activate_verified_print_lab_facility', array[]::text[], 'authenticated', array[]::text[], 'ordinary users cannot activate print lab');

insert into auth.users(id) values ('36000000-0000-4000-8000-000000000036');
insert into public.admin_users(id, role, is_active)
values ('36000000-0000-4000-8000-000000000036', 'admin', true);

select is(
  public.activate_verified_print_lab_facility() ->> 'status',
  'updated',
  'verified print lab is activated'
);
select is(
  (select count(*)::integer from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'
     and type = 'facility' and visibility = 'public' and status = 'active'),
  1,
  'exactly one print lab is public and active'
);
select is(
  (select metadata ->> 'location_label' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  '사진영상미디어학과 프린트랩',
  'print lab has a precise department location label'
);
select ok(
  (select metadata ->> 'operationNote' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab') like '%출력%'
  and (select metadata ->> 'operationNote' from public.resources
       where metadata ->> 'seedKey' = 'archive:facility:print_lab') like '%학과에 문의%',
  'print lab operation note explains output and inquiry access'
);
select matches(
  (select metadata ->> 'lastVerifiedAt' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+][0-9]{2}:[0-9]{2}$',
  'print lab verification retains an offset timestamp'
);
select is(
  (select metadata -> 'archive' ->> 'evidenceStatus' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  'snapshot',
  'print lab archive evidence is promoted to a verified snapshot'
);
select is(
  (select array_agg(tag.tag_key order by tag.tag_key)
   from public.resource_tags tag
   join public.resources resource on resource.id = tag.resource_id
   where resource.metadata ->> 'seedKey' = 'archive:facility:print_lab'
     and tag.tag_key = any (array['art_photo', 'commercial', 'documentary']::text[])),
  array['art_photo', 'commercial', 'documentary']::text[],
  'print lab retains all three supported track tags'
);
select is(
  public.activate_verified_print_lab_facility() ->> 'status',
  'already_activated',
  'print lab activation is idempotent'
);

select * from finish();
rollback;
