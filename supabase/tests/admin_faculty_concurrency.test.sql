begin;

select no_plan();

create extension if not exists dblink with schema extensions;

select is(
  extensions.dblink_connect(
    'faculty_concurrency_setup',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'a dedicated setup session connects to the local PostgreSQL instance'
);

select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.audit_events
    where admin_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.faculty_specialist_links
    where specialist_faculty_id in (select id from public.faculty where name = 'DB Concurrency Faculty')
       or primary_faculty_id in (select id from public.faculty where name = 'DB Concurrency Faculty')$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.faculty_tags
    where faculty_id in (select id from public.faculty where name = 'DB Concurrency Faculty')$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.faculty where name = 'DB Concurrency Faculty'$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.admin_users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from auth.users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$
);

select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$insert into auth.users(id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc')$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$insert into public.admin_users(id, role, is_active)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin', true)$$
);

create temp table faculty_concurrency_fixture as
select *
from extensions.dblink(
  'faculty_concurrency_setup',
  $$insert into public.faculty(
      name, title, employment_type, consultation_role,
      contact_visibility, expertise_summary, bio, profile_sections,
      status, weekly_capacity, priority, source_date
    ) values (
      'DB Concurrency Faculty', 'Adjunct', 'adjunct', 'specialist',
      '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}',
      'Concurrent specialist', 'Concurrent original bio',
      '{"recommendationRole":"Concurrent specialist","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
      'draft', 0, 0, '2026-07-14'
    )
    returning id, updated_at$$
) as fixture(id bigint, updated_at timestamptz);

select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$insert into public.faculty_tags(
      faculty_id, tag_key, tag_label, category, weight, is_primary
    )
    select id, 'drone', 'Drone', 'specialist', 3, true
    from public.faculty where name = 'DB Concurrency Faculty'$$
);

create temp table faculty_concurrency_input as
select
  pg_catalog.jsonb_build_object(
    'name', faculty.name,
    'title', faculty.title,
    'employmentType', faculty.employment_type,
    'consultationRole', faculty.consultation_role,
    'office', faculty.office,
    'phone', faculty.phone,
    'email', faculty.email,
    'website', faculty.website,
    'contactVisibility', faculty.contact_visibility,
    'expertiseSummary', faculty.expertise_summary,
    'bio', faculty.bio,
    'profileSections', faculty.profile_sections,
    'weeklyCapacity', faculty.weekly_capacity,
    'priority', faculty.priority,
    'sourceDate', faculty.source_date,
    'lastVerifiedAt', faculty.last_verified_at,
    'imagePath', faculty.image_path
  ) as faculty,
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'key', 'drone',
    'label', 'Drone',
    'category', 'specialist',
    'weight', 3,
    'isPrimary', true
  )) as tags
from public.faculty faculty
join faculty_concurrency_fixture fixture on fixture.id = faculty.id;

select is(
  extensions.dblink_connect(
    'faculty_concurrency_a',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the first concurrent service session connects'
);
select is(
  extensions.dblink_connect(
    'faculty_concurrency_b',
    'host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'
  ),
  'OK',
  'the second concurrent service session connects'
);
select extensions.dblink_exec('faculty_concurrency_a', 'set role service_role');
select extensions.dblink_exec('faculty_concurrency_b', 'set role service_role');

create temp table faculty_concurrency_queries as
select
  pg_catalog.format(
    $query$with barrier as materialized (select pg_catalog.pg_sleep(0.3))
      select public.update_admin_faculty(
        %L::uuid, %L::timestamptz, %s::bigint, %L::uuid,
        %L::jsonb, %L::jsonb, '[]'::jsonb
      ) from barrier$query$,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    fixture.updated_at,
    fixture.id,
    'cccccccc-0000-4000-8000-000000000001',
    pg_catalog.jsonb_set(input.faculty, '{bio}', '"Concurrent writer A"'::jsonb),
    input.tags
  ) as query_a,
  pg_catalog.format(
    $query$with barrier as materialized (select pg_catalog.pg_sleep(0.3))
      select public.update_admin_faculty(
        %L::uuid, %L::timestamptz, %s::bigint, %L::uuid,
        %L::jsonb, %L::jsonb, '[]'::jsonb
      ) from barrier$query$,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    fixture.updated_at,
    fixture.id,
    'cccccccc-0000-4000-8000-000000000002',
    pg_catalog.jsonb_set(input.faculty, '{bio}', '"Concurrent writer B"'::jsonb),
    input.tags
  ) as query_b
from faculty_concurrency_fixture fixture
cross join faculty_concurrency_input input;

select is(
  extensions.dblink_send_query('faculty_concurrency_a', (select query_a from faculty_concurrency_queries)),
  1,
  'the first optimistic update is dispatched asynchronously'
);
select is(
  extensions.dblink_send_query('faculty_concurrency_b', (select query_b from faculty_concurrency_queries)),
  1,
  'the second optimistic update is dispatched before the shared barrier opens'
);

create temp table faculty_concurrency_results(worker text, result jsonb);
insert into faculty_concurrency_results(worker, result)
select 'a', result
from extensions.dblink_get_result('faculty_concurrency_a') as response(result jsonb);
insert into faculty_concurrency_results(worker, result)
select 'b', result
from extensions.dblink_get_result('faculty_concurrency_b') as response(result jsonb);

select is(
  (select pg_catalog.count(*)::integer from faculty_concurrency_results where result ->> 'status' = 'updated'),
  1,
  'exactly one concurrent writer commits'
);
select is(
  (select pg_catalog.count(*)::integer from faculty_concurrency_results where result ->> 'status' = 'conflict'),
  1,
  'the other concurrent writer receives an optimistic conflict'
);
select is(
  (select pg_catalog.count(*)::integer
   from public.audit_events audit
   join faculty_concurrency_fixture fixture on audit.target_id = fixture.id::text
   where audit.action = 'faculty_updated'),
  1,
  'the two concurrent requests create exactly one audit event'
);
select is(
  (select pg_catalog.count(*)::integer
   from faculty_concurrency_results result
   join public.faculty faculty on faculty.id = (select id from faculty_concurrency_fixture)
   where result.result ->> 'status' = 'updated'
     and (result.result ->> 'facultyUpdatedAt')::timestamptz = faculty.updated_at),
  1,
  'the committed RPC version matches the stored faculty version'
);

select extensions.dblink_disconnect('faculty_concurrency_a');
select extensions.dblink_disconnect('faculty_concurrency_b');

select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.audit_events
    where admin_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.faculty_specialist_links
    where specialist_faculty_id in (select id from public.faculty where name = 'DB Concurrency Faculty')
       or primary_faculty_id in (select id from public.faculty where name = 'DB Concurrency Faculty')$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.faculty_tags
    where faculty_id in (select id from public.faculty where name = 'DB Concurrency Faculty')$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.faculty where name = 'DB Concurrency Faculty'$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from public.admin_users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$
);
select extensions.dblink_exec(
  'faculty_concurrency_setup',
  $$delete from auth.users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$
);
select extensions.dblink_disconnect('faculty_concurrency_setup');

select * from finish();
rollback;
