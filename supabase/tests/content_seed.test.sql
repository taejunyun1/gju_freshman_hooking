begin;

select plan(37);

select is((select count(*)::integer from public.resources), 128, 'content seed has 128 resources');
select is((select count(*)::integer from public.resources where type = 'course'), 41, '41 courses are seeded');
select is((select count(*)::integer from public.resources where type = 'equipment'), 83, '83 equipment groups are seeded');
select is((select count(*)::integer from public.resources where type = 'facility'), 4, 'four facilities are seeded');
select is((select count(*)::integer from public.resources where status = 'draft'), 128, 'all resources remain draft');
select is((select count(*)::integer from public.resources where type = 'course' and visibility = 'public'), 41, 'all draft courses have public display metadata');
select is((select count(*)::integer from public.resources where type = 'equipment' and visibility = 'public'), 72, '72 verified equipment groups have public display metadata');
select is((select count(*)::integer from public.resources where type = 'equipment' and visibility = 'admin_only'), 11, '11 zero-verified equipment groups remain admin only');
select is((select count(*)::integer from public.resources where source_date = date '2026-07-14'), 128, 'all resource source dates are retained');
select is((select count(*)::integer from public.resources where type = 'course' and metadata ->> 'academic_year' = '2026'), 41, 'all courses retain academic year 2026');

select is((select count(*)::integer from public.equipment_inventory_items), 144, 'all 144 inventory rows are retained');
select is((select count(*)::integer from public.equipment_inventory_items where location_key = 'department_equipment_room'), 83, 'department equipment room count is exact');
select is((select count(*)::integer from public.equipment_inventory_items where location_key = 'fantasy_lab'), 61, 'fantasy lab count is exact');
select is((select count(*)::integer from public.equipment_inventory_items where access_mode = 'reservation'), 81, 'reservation count is exact');
select is((select count(*)::integer from public.equipment_inventory_items where access_mode = 'inquiry'), 63, 'inquiry count is exact');
select is((select count(*)::integer from public.equipment_inventory_items where data_quality_status = 'verified'), 128, 'verified inventory count is exact');
select is((select count(*)::integer from public.equipment_inventory_items where data_quality_status = 'duplicate_code'), 10, 'all rows affected by duplicate codes are flagged');
select is((select count(*)::integer from public.equipment_inventory_items where data_quality_status = 'unidentified'), 2, 'unidentified inventory count is exact');
select is((select count(*)::integer from public.equipment_inventory_items where data_quality_status = 'quantity_check'), 4, 'quantity-check inventory count is exact');
select is(
  (select sum((metadata ->> 'confirmedQuantity')::integer)::integer
   from public.resources where type = 'equipment' and visibility = 'public'),
  128,
  'public equipment quantities count verified inventory only'
);
select ok(
  not exists (
    select 1
    from public.resources resource
    cross join public.equipment_inventory_items inventory
    where resource.type = 'equipment'
      and resource.visibility = 'public'
      and resource.metadata::text like '%' || inventory.inventory_code || '%'
  ),
  'public equipment metadata contains no individual inventory code'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'equipment' and visibility = 'public'
     and metadata ->> 'reservationUrl' = 'https://gjureserve.co.kr'),
  72,
  'every public equipment group uses the canonical reservation URL'
);
select is(
  (select array_agg(metadata ->> 'facilityKey' order by id)
   from public.resources where type = 'facility'),
  array['studio_a_horizon', 'studio_b', 'darkroom', 'computer_lab']::text[],
  'facilities retain the exact approved order and keys'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'facility' and metadata ->> 'operationNote' like '%필요%'),
  4,
  'all facility operation notes preserve verification needs'
);

select is((select count(*)::integer from public.faculty), 6, 'six faculty profiles are seeded');
select is((select count(*)::integer from public.faculty where employment_type = 'full_time' and consultation_role = 'primary'), 3, 'three full-time primary faculty are seeded');
select is((select count(*)::integer from public.faculty where employment_type = 'adjunct' and consultation_role = 'specialist'), 3, 'three adjunct specialists are seeded');
select is((select count(*)::integer from public.faculty where status = 'draft'), 6, 'all faculty remain draft');
select is(
  (select count(*)::integer from public.faculty
   where contact_visibility = '{"office":"admin_only","phone":"admin_only","email":"admin_only","website":"admin_only"}'::jsonb),
  6,
  'every faculty contact field remains admin only'
);
select ok(
  not exists (select 1 from public.faculty_tags where weight not between 0 and 3),
  'all derived faculty tag weights remain in the schema range'
);
select is((select count(*)::integer from public.faculty_specialist_links), 14, '14 specialist tag links are seeded');
select is(
  (select count(*)::integer
   from public.faculty_specialist_links link
   join public.faculty primary_faculty on primary_faculty.id = link.primary_faculty_id
   join public.faculty specialist on specialist.id = link.specialist_faculty_id
   where primary_faculty.name = '윤태준' and specialist.name = '박재웅'),
  4,
  '윤태준–박재웅 link has four specialist tags'
);
select is(
  (select count(*)::integer
   from public.faculty_specialist_links link
   join public.faculty primary_faculty on primary_faculty.id = link.primary_faculty_id
   join public.faculty specialist on specialist.id = link.specialist_faculty_id
   where primary_faculty.name = '윤태준' and specialist.name = '정철호'),
  3,
  '윤태준–정철호 link has three specialist tags'
);
select is(
  (select count(*)::integer
   from public.faculty_specialist_links link
   join public.faculty specialist on specialist.id = link.specialist_faculty_id
   where link.primary_faculty_id is null and specialist.name = '곽동욱'),
  7,
  '곽동욱 common specialist link has seven tags and no asserted primary faculty'
);
select is(
  (select count(*)::integer
   from public.equipment_inventory_items inventory
   join public.resources resource on resource.id = inventory.equipment_resource_id
   where resource.type = 'equipment'),
  144,
  'every inventory row references an equipment resource'
);
select is(
  (select count(*)::integer from public.faculty
   where jsonb_typeof(profile_sections -> 'education') = 'array'
     and jsonb_typeof(profile_sections -> 'teachingFields') = 'array'
     and jsonb_typeof(profile_sections -> 'studentProjects') = 'array'),
  6,
  'all faculty retain structured education, teaching, and project sections'
);
select is((select count(*)::integer from public.faculty where last_verified_at is null), 6, 'unverified faculty dates are not fabricated');

select * from finish();
rollback;
