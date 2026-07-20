begin;

select plan(61);

select is((select count(*)::integer from public.resources), 201, 'content seed and current project catalog have 201 resources');
select is((select count(*)::integer from public.resources where type = 'course'), 41, '41 courses are seeded');
select is((select count(*)::integer from public.resources where type = 'equipment'), 83, '83 equipment groups are seeded');
select is((select count(*)::integer from public.resources where type = 'facility'), 7, 'seven facilities are seeded');
select is((select count(*)::integer from public.resources where type = 'career'), 17, '17 bounded alumni career records are seeded');
select is((select count(*)::integer from public.resources where type = 'extracurricular'), 5, 'five bounded extracurricular records are seeded');
select is((select count(*)::integer from public.resources where type = 'project'), 48, 'five archive and 43 project-catalog records are seeded');
select is((select count(*)::integer from public.resources where status = 'draft'), 158, 'all resources remain draft');
select is((select count(*)::integer from public.resources where type = 'course' and visibility = 'public'), 41, 'all draft courses have public display metadata');
select is((select count(*)::integer from public.resources where type = 'equipment' and visibility = 'public'), 72, '72 verified equipment groups have public display metadata');
select is((select count(*)::integer from public.resources where type = 'equipment' and visibility = 'admin_only'), 11, '11 zero-verified equipment groups remain admin only');
select is((select count(*)::integer from public.resources where source_date = date '2026-07-14'), 128, 'the 128 internal-source resource dates are retained');
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
   from public.resources
   where type = 'facility' and metadata ->> 'seedKey' not like 'archive:%'),
  array['studio_a_horizon', 'studio_b', 'darkroom', 'computer_lab']::text[],
  'facilities retain the exact approved order and keys'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'facility'
     and metadata ->> 'seedKey' not like 'archive:%'
     and metadata ->> 'lastVerifiedAt' = '2026-07-18T16:28:30+09:00'
     and metadata ->> 'operationNote' like '%실제 이용은 학과에 문의해야 합니다.%'),
  4,
  'all four department facilities preserve the confirmed timestamp and inquiry note'
);

select is((select count(*)::integer from public.faculty), 10, 'ten faculty profiles are seeded');
select is((select count(*)::integer from public.faculty where employment_type = 'full_time' and consultation_role = 'primary'), 3, 'three full-time primary faculty are seeded');
select is((select count(*)::integer from public.faculty where employment_type = 'adjunct' and consultation_role = 'specialist'), 3, 'three adjunct specialists are seeded');
select is((select count(*)::integer from public.faculty where employment_type = 'practitioner' and consultation_role = 'specialist' and title = '시간강사'), 4, 'four time instructors are practitioner specialists');
select is((select count(*)::integer from public.faculty where status = 'draft'), 10, 'all faculty remain draft');
select is(
  (select count(*)::integer from public.faculty
   where contact_visibility = '{"office":"admin_only","phone":"admin_only","email":"admin_only","website":"admin_only"}'::jsonb),
  6,
  'six pre-existing faculty contact profiles remain admin only'
);
select ok(
  not exists (select 1 from public.faculty_tags where weight not between 0 and 3),
  'all derived faculty tag weights remain in the schema range'
);
select is((select count(*)::integer from public.resource_tags), 1250, 'all derived resource and project-catalog tags are linked without silent row loss');
select is((select count(*)::integer from public.faculty_tags), 224, 'all deduplicated faculty tags are linked without silent row loss');
select is((select count(*)::integer from public.faculty_specialist_links), 30, '30 specialist tag links are seeded');
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
  10,
  'all faculty retain structured education, teaching, and project sections'
);
select is((select count(*)::integer from public.faculty where last_verified_at is null), 10, 'unverified faculty dates are not fabricated');

select is(
  (select count(*)::integer from public.resources where metadata ->> 'seedKey' like 'archive:%'),
  30,
  'the bounded department archive adds exactly 30 draft records'
);
select ok(
  not exists (
    select 1 from public.resources
    where metadata ->> 'seedKey' like 'archive:%'
      and metadata -> 'archive' ->> 'sourceUrl' not like 'https://%'
  ),
  'every archive record retains an HTTPS source URL'
);
select ok(
  not exists (
    select 1 from public.resources
    where metadata ->> 'seedKey' like 'archive:%'
      and (metadata -> 'archive' ->> 'sourceLastEditedDate')::date is distinct from source_date
  ),
  'archive source edit dates remain aligned with resource source dates'
);
select is(
  (select count(*)::integer from public.resources
   where metadata -> 'archive' ->> 'evidenceStatus' = 'snapshot'),
  15,
  '15 alumni records remain source snapshots'
);
select is(
  (select count(*)::integer from public.resources
   where metadata -> 'archive' ->> 'evidenceStatus' = 'historical'),
  6,
  'six concluded activities remain historical evidence'
);
select is(
  (select count(*)::integer from public.resources
   where metadata -> 'archive' ->> 'evidenceStatus' = 'verify_required'),
  8,
  'eight conflicted or operational records require verification'
);
select is(
  (select count(*)::integer from public.resources
   where metadata -> 'archive' ->> 'evidenceStatus' = 'recurring'),
  1,
  'one repeated education type is marked recurring without asserting a current schedule'
);
select is(
  (select count(*)::integer from public.resources
   where metadata -> 'archive' ->> 'evidenceStatus' = 'historical'
     and summary like '%과거 운영 사례%'),
  6,
  'every historical record is explicitly labelled as a past operation example'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'career' and metadata ->> 'roleStatus' = 'title_confirmed'),
  10,
  'ten alumni roles are confirmed in page titles'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'career' and metadata ->> 'roleStatus' = 'body_only'),
  6,
  'six alumni roles remain body-only evidence'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'career' and metadata ->> 'roleStatus' = 'conflicted'),
  1,
  'one alumni role remains conflicted'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'career' and metadata ->> 'publicName' = '윤동규'
     and visibility = 'admin_only'
     and metadata ->> 'graduationYearStatus' = 'conflicted'
     and metadata -> 'graduationYear' = 'null'::jsonb
     and jsonb_array_length(metadata -> 'graduationYearCandidates') = 2),
  1,
  '윤동규 졸업연도 충돌은 후보 출처와 함께 관리자 검수 상태로 보존된다'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'career' and metadata ->> 'publicName' = '김병준'
     and visibility = 'admin_only'
     and metadata ->> 'roleStatus' = 'conflicted'
     and metadata -> 'roleAtSource' = 'null'::jsonb
     and jsonb_array_length(metadata -> 'roleCandidates') = 2),
  1,
  '김병준 직무 충돌은 후보 표현과 함께 관리자 검수 상태로 보존된다'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'career' and visibility = 'admin_only'
     and metadata -> 'archive' ->> 'evidenceStatus' = 'verify_required'
     and (metadata ->> 'roleStatus' = 'conflicted'
       or metadata ->> 'graduationYearStatus' = 'conflicted')),
  2,
  'both alumni conflicts are protected from public result use'
);
select is(
  (select count(*)::integer from public.resources
   where type = 'facility' and metadata ->> 'seedKey' like 'archive:%'
     and metadata ? 'operation_note' and metadata ->> 'operation_note' is null
     and metadata ? 'last_verified_at' and metadata ->> 'last_verified_at' is null
     and metadata ->> 'supportingEvidence' = 'true'
     and metadata -> 'archive' ->> 'evidenceStatus' = 'verify_required'),
  3,
  'three web facility candidates remain publish-gated supporting evidence'
);
select ok(
  not exists (
    select 1
    from public.resources resource
    where resource.metadata ->> 'seedKey' like 'archive:%'
      and (
        (select count(*) from public.resource_tags tag
         where tag.resource_id = resource.id and tag.is_primary) <> 1
        or not exists (
          select 1 from public.resource_tags tag
          where tag.resource_id = resource.id
            and tag.tag_key not in ('documentary', 'art_photo', 'commercial', 'video')
        )
      )
  ),
  'every archive record has one primary track and at least one interest tag'
);
select ok(
  not exists (
    select 1 from public.resources
    where metadata ->> 'seedKey' like 'archive:%'
      and (
        type = 'student_work'
      or title ~ '(동아리|학생회|학생자치)'
      or summary ~ '(동아리|학생회|학생자치)'
      )
  ),
  'archive enrichment contains no student work or unverified club claims'
);
select is(
  (select count(*)::integer from public.resources
   where type in ('equipment', 'facility') and metadata ->> 'supportingEvidence' = 'true'),
  90,
  'all equipment and facilities remain supporting evidence rather than career proof'
);

select * from finish();
rollback;
