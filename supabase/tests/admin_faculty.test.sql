begin;

select no_plan();

create function pg_temp.capture_json(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  execute p_sql into v_result;
  return v_result;
exception when others then
  return pg_catalog.jsonb_build_object('threw', sqlstate || ':' || sqlerrm);
end;
$$;

select ok(coalesce((select relrowsecurity from pg_catalog.pg_class where oid = 'public.faculty'::regclass), false), 'faculty keeps RLS enabled');
select ok(coalesce((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.faculty'::regclass), false), 'faculty uses forced RLS');
select ok(coalesce((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.faculty_tags'::regclass), false), 'faculty tags use forced RLS');
select ok(coalesce((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.faculty_specialist_links'::regclass), false), 'faculty links use forced RLS');
select policies_are('public', 'faculty', array[]::text[], 'faculty remains default deny');
select policies_are('public', 'faculty_tags', array[]::text[], 'faculty tags remain default deny');
select policies_are('public', 'faculty_specialist_links', array[]::text[], 'faculty links remain default deny');
select table_privs_are('public', 'faculty', 'service_role', array['SELECT'], 'service role remains SELECT-only on faculty');
select table_privs_are('public', 'faculty_tags', 'service_role', array['SELECT'], 'service role remains SELECT-only on faculty tags');
select table_privs_are('public', 'faculty_specialist_links', 'service_role', array['SELECT'], 'service role remains SELECT-only on faculty links');
select sequence_privs_are('public', 'faculty_id_seq', 'service_role', array[]::text[], 'service role cannot allocate faculty identities');
select sequence_privs_are('public', 'faculty_tags_id_seq', 'service_role', array[]::text[], 'service role cannot allocate faculty tag identities');
select sequence_privs_are('public', 'faculty_specialist_links_id_seq', 'service_role', array[]::text[], 'service role cannot allocate faculty link identities');

select has_function('public', 'update_admin_faculty', array['uuid', 'timestamptz', 'bigint', 'uuid', 'jsonb', 'jsonb', 'jsonb']);
select has_function('public', 'publish_admin_faculty', array['uuid', 'timestamptz', 'bigint', 'uuid']);
select function_privs_are(
  'public', 'update_admin_faculty',
  array['uuid', 'timestamptz', 'bigint', 'uuid', 'jsonb', 'jsonb', 'jsonb'],
  'service_role', array['EXECUTE'], 'service role alone can invoke faculty update'
);
select function_privs_are(
  'public', 'publish_admin_faculty',
  array['uuid', 'timestamptz', 'bigint', 'uuid'],
  'service_role', array['EXECUTE'], 'service role alone can invoke faculty publish'
);
select function_privs_are(
  'public', 'update_admin_faculty',
  array['uuid', 'timestamptz', 'bigint', 'uuid', 'jsonb', 'jsonb', 'jsonb'],
  'authenticated', array[]::text[], 'authenticated cannot invoke faculty update'
);
select function_privs_are(
  'public', 'publish_admin_faculty',
  array['uuid', 'timestamptz', 'bigint', 'uuid'],
  'authenticated', array[]::text[], 'authenticated cannot invoke faculty publish'
);
select function_privs_are(
  'public', 'update_admin_faculty',
  array['uuid', 'timestamptz', 'bigint', 'uuid', 'jsonb', 'jsonb', 'jsonb'],
  'public', array[]::text[], 'PUBLIC cannot invoke faculty update'
);
select function_privs_are(
  'public', 'publish_admin_faculty',
  array['uuid', 'timestamptz', 'bigint', 'uuid'],
  'anon', array[]::text[], 'anonymous clients cannot invoke faculty publish'
);
select function_privs_are(
  'public', 'admin_faculty_payload_error',
  array['jsonb', 'jsonb', 'jsonb'],
  'service_role', array[]::text[], 'payload validator is not a service-role API'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.update_admin_faculty(uuid,timestamptz,bigint,uuid,jsonb,jsonb,jsonb)')),
    'SECURITY DEFINER'
  ) > 0,
  'faculty update is security definer'
);
select is(
  (select proconfig from pg_catalog.pg_proc where oid = 'public.update_admin_faculty(uuid,timestamptz,bigint,uuid,jsonb,jsonb,jsonb)'::regprocedure),
  array['search_path=""'],
  'faculty update has an empty search path'
);
select is(
  (select proconfig from pg_catalog.pg_proc where oid = 'public.publish_admin_faculty(uuid,timestamptz,bigint,uuid)'::regprocedure),
  array['search_path=""'],
  'faculty publish has an empty search path'
);
select isnt(
  (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc where oid = 'public.update_admin_faculty(uuid,timestamptz,bigint,uuid,jsonb,jsonb,jsonb)'::regprocedure),
  'service_role',
  'faculty mutation function is not owned by the application service role'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.update_admin_faculty(uuid,timestamptz,bigint,uuid,jsonb,jsonb,jsonb)')),
    'FOR UPDATE'
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.update_admin_faculty(uuid,timestamptz,bigint,uuid,jsonb,jsonb,jsonb)')),
    'IS DISTINCT FROM p_expected_updated_at'
  ),
  'faculty update locks before optimistic comparison'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.publish_admin_faculty(uuid,timestamptz,bigint,uuid)')),
    'FOR UPDATE'
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.publish_admin_faculty(uuid,timestamptz,bigint,uuid)')),
    'IS DISTINCT FROM p_expected_updated_at'
  ),
  'faculty publish locks before optimistic comparison'
);

set local role service_role;
select throws_ok(
  $$update public.faculty set priority = priority where false$$,
  '42501', 'permission denied for table faculty',
  'service role cannot mutate faculty directly'
);
reset role;

select lives_ok(
  $$insert into auth.users(id) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    insert into public.admin_users(id, is_active) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false)$$,
  'faculty administrator fixtures exist'
);

insert into public.faculty(
  name, title, employment_type, consultation_role, office, phone, email, website,
  contact_visibility, expertise_summary, bio, profile_sections, status,
  weekly_capacity, priority, source_date, last_verified_at
) values
  ('DB 총괄 A', '교수', 'full_time', 'primary', 'A 연구실', null, null, null,
    '{"office":"admin_only","phone":"hidden","email":"hidden","website":"hidden"}',
    '다큐멘터리 사진', '총괄 A 소개', '{"recommendationRole":"사회 기록 총괄","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'active', 10, 10, '2026-07-14', null),
  ('DB 총괄 B', '교수', 'full_time', 'primary', 'B 연구실', null, null, null,
    '{"office":"admin_only","phone":"hidden","email":"hidden","website":"hidden"}',
    '예술사진', '총괄 B 소개', '{"recommendationRole":"예술 총괄","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'active', 10, 9, '2026-07-14', null),
  ('DB 전문', '겸임교수', 'adjunct', 'specialist', '전문 연구실', null, 'specialist@example.com', null,
    '{"office":"admin_only","phone":"hidden","email":"admin_only","website":"hidden"}',
    '드론·영상', '전문 소개', '{"recommendationRole":"영상 전문 연계","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'draft', 0, 5, '2026-07-14', null),
  ('DB 용량 없음', '교수', 'full_time', 'primary', null, null, null, null,
    '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}',
    '다큐멘터리 사진', '용량 검증 소개', '{"recommendationRole":"검증 총괄","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'draft', 0, 0, '2026-07-14', null),
  ('윤태준', '교수', 'full_time', 'primary', null, null, null, null,
    '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}',
    '예술사진과 영상', '범위 검증 소개', '{"recommendationRole":"예술 총괄","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'draft', 10, 0, '2026-07-14', null);

insert into public.faculty_tags(faculty_id, tag_key, tag_label, category, weight, is_primary)
select id, 'documentary', '다큐멘터리 사진', 'track', 3, true from public.faculty where name = 'DB 총괄 A'
union all
select id, 'art_photo', '예술사진', 'track', 3, true from public.faculty where name = 'DB 총괄 B'
union all
select id, 'documentary', '다큐멘터리 사진', 'track', 3, true from public.faculty where name = 'DB 용량 없음'
union all
select id, 'art_photo', '예술사진', 'track', 3, true from public.faculty where name = '윤태준' and bio = '범위 검증 소개'
union all
select id, 'video', '영상과 기술(AI·편집·드론)', 'activity', 3, true from public.faculty where name = '윤태준' and bio = '범위 검증 소개'
union all
select id, 'ai', 'AI', 'result', 3, true from public.faculty where name = '윤태준' and bio = '범위 검증 소개';

insert into public.faculty(
  name, title, employment_type, consultation_role, office, phone, email, website,
  contact_visibility, expertise_summary, bio, profile_sections, status,
  weekly_capacity, priority, source_date, last_verified_at
) values
  ('DB Boundary', 'Adjunct', 'adjunct', 'specialist', null, null, null, null,
    '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}',
    'Boundary expertise', 'Boundary bio', '{"recommendationRole":"Boundary specialist","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'draft', 0, 0, '2026-07-14', null),
  ('DB Active Primary Boundary', 'Professor', 'full_time', 'primary', null, null, null, null,
    '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}',
    'Documentary photography', 'Active primary boundary bio', '{"recommendationRole":"Active primary","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'active', 10, 0, '2026-07-14', null),
  ('DB Active Specialist Boundary', 'Adjunct', 'adjunct', 'specialist', null, null, null, null,
    '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}',
    'Drone video', 'Active specialist boundary bio', '{"recommendationRole":"Active specialist","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'active', 0, 0, '2026-07-14', null),
  ('DB Link Specialist Boundary', 'Adjunct', 'adjunct', 'specialist', null, null, null, null,
    '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}',
    'Drone video', 'Link boundary bio', '{"recommendationRole":"Drone specialist","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'draft', 0, 0, '2026-07-14', null),
  ('DB Time Boundary', 'Adjunct', 'adjunct', 'specialist', null, null, null, null,
    '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}',
    'Time boundary', 'Time boundary bio', '{"recommendationRole":"Time specialist","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
    'draft', 0, 0, '2026-07-14', null);

insert into public.faculty(
  name, title, employment_type, consultation_role, office, phone, email, website,
  contact_visibility, expertise_summary, bio, profile_sections, status,
  weekly_capacity, priority, source_date, last_verified_at
) values (
  'DB Public Contact Boundary', 'Professor', 'full_time', 'primary', null,
  '062-000-0000', 'old@example.com', null,
  '{"office":"hidden","phone":"hidden","email":"public","website":"hidden"}',
  'Public contact boundary', 'Public contact boundary bio',
  '{"recommendationRole":"Public contact primary","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
  'active', 10, 0, '2026-07-14', '2026-07-14T00:00:00Z'
);

insert into public.faculty(
  name, title, employment_type, consultation_role,
  contact_visibility, expertise_summary, bio, profile_sections, status,
  weekly_capacity, priority, source_date
) values (
  'DB Multiline Bio Boundary', 'Adjunct', 'adjunct', 'specialist',
  '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}',
  'Multiline bio boundary', E'First line\nSecond line',
  '{"recommendationRole":"Multiline specialist","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]}',
  'draft', 0, 0, '2026-07-14'
);

insert into public.faculty_tags(faculty_id, tag_key, tag_label, category, weight, is_primary)
select id, 'drone', 'Drone', 'specialist', 3, true
from public.faculty where name in ('DB Boundary', 'DB Active Specialist Boundary', 'DB Link Specialist Boundary', 'DB Time Boundary', 'DB Multiline Bio Boundary')
union all
select id, 'documentary', '다큐멘터리 사진', 'track', 3, true
from public.faculty where name in ('DB Active Primary Boundary', 'DB Public Contact Boundary');

create function pg_temp.faculty_payload(p_name text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
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
  )
  from public.faculty
  where faculty.id = (
    select pg_catalog.max(candidate.id)
    from public.faculty candidate
    where candidate.name = p_name
  );
$$;

create function pg_temp.faculty_tags_payload(p_name text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'key', tag.tag_key,
        'label', tag.tag_label,
        'category', tag.category,
        'weight', tag.weight,
        'isPrimary', tag.is_primary
      ) order by tag.category, tag.tag_key
    ),
    '[]'::jsonb
  )
  from public.faculty faculty
  join public.faculty_tags tag on tag.faculty_id = faculty.id
  where faculty.id = (
    select pg_catalog.max(candidate.id)
    from public.faculty candidate
    where candidate.name = p_name
  );
$$;

create temp table faculty_update_before as
select id, updated_at
from public.faculty where name = 'DB 전문';

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from faculty_update_before),
    (select id from faculty_update_before),
    '77777777-7777-4777-8777-777777777777',
    '{"name":"DB 전문","title":"겸임교수","employmentType":"adjunct","consultationRole":"specialist","office":"전문 연구실","phone":null,"email":"specialist@example.com","website":null,"contactVisibility":{"office":"admin_only","phone":"hidden","email":"admin_only","website":"hidden"},"expertiseSummary":"드론·영상","bio":"전문 소개 수정","profileSections":{"recommendationRole":"영상 전문 연계","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]},"weeklyCapacity":0,"priority":5,"sourceDate":"2026-07-14","lastVerifiedAt":null,"imagePath":null}',
    '[{"key":"drone","label":"드론","category":"specialist","weight":3,"isPrimary":true},{"key":"drone","label":"드론 프로젝트","category":"result","weight":2,"isPrimary":false}]',
    '[{"primaryFacultyId":null,"tagKey":"drone","priority":100,"explanationTemplate":"전임 총괄 아래 드론 전문 연계를 제공합니다."}]'
  ) ->> 'status',
  'updated',
  'valid specialist profile, tags, and NULL-primary link update atomically'
);
select is((select status from public.faculty where name = 'DB 전문'), 'draft', 'update preserves workflow status');
select is((select count(*)::integer from public.faculty_tags t join public.faculty f on f.id = t.faculty_id where f.name = 'DB 전문'), 2, 'update replaces tags atomically');
select is((select count(*)::integer from public.faculty_specialist_links l join public.faculty f on f.id = l.specialist_faculty_id where f.name = 'DB 전문' and l.primary_faculty_id is null), 1, 'NULL-primary common link is stored');
select is((select count(*)::integer from public.audit_events where action = 'faculty_updated' and target_id = (select id::text from public.faculty where name = 'DB 전문')), 1, 'successful update writes one audit event');
select is(
  (select metadata ? 'changedFields' and not (metadata::text ~* 'specialist@example.com|전문 소개') from public.audit_events where action = 'faculty_updated' and target_id = (select id::text from public.faculty where name = 'DB 전문')),
  true,
  'faculty update audit stores field names without raw contacts or profile content'
);

create temp table stale_snapshot as
select f.updated_at, f.bio,
  (select count(*) from public.faculty_tags where faculty_id = f.id) tag_count,
  (select count(*) from public.faculty_specialist_links where specialist_faculty_id = f.id) link_count,
  (select count(*) from public.audit_events) audit_count
from public.faculty f where f.name = 'DB 전문';

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2020-01-01T00:00:00Z',
    (select id from public.faculty where name = 'DB 전문'),
    '77777777-7777-4777-8777-777777777777', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb
  ) ->> 'status',
  'conflict',
  'stale update returns a closed conflict before payload validation'
);
select is(
  (select pg_catalog.jsonb_build_object('updatedAt', updated_at, 'bio', bio,
    'tagCount', (select count(*) from public.faculty_tags where faculty_id = faculty.id),
    'linkCount', (select count(*) from public.faculty_specialist_links where specialist_faculty_id = faculty.id),
    'auditCount', (select count(*) from public.audit_events)) from public.faculty where name = 'DB 전문'),
  (select pg_catalog.jsonb_build_object('updatedAt', updated_at, 'bio', bio, 'tagCount', tag_count, 'linkCount', link_count, 'auditCount', audit_count) from stale_snapshot),
  'stale update mutates no profile, tags, links, or audit rows'
);

select is(
  pg_temp.capture_json($capture$select public.update_admin_faculty(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_catalog.now(),
    (select id from public.faculty where name = 'DB 전문'),
    '77777777-7777-4777-8777-777777777777', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb
  )$capture$) ->> 'threw',
  'P0001:ADMIN_REQUIRED',
  'inactive or unknown administrators cannot invoke the mutation boundary'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB 전문'),
    (select id from public.faculty where name = 'DB 전문'),
    '77777777-7777-4777-8777-777777777777',
    '{"name":"DB 전문","title":"겸임교수","employmentType":"full_time","consultationRole":"specialist","office":"전문 연구실","phone":null,"email":"specialist@example.com","website":null,"contactVisibility":{"office":"admin_only","phone":"hidden","email":"admin_only","website":"hidden"},"expertiseSummary":"드론·영상","bio":"전문 소개","profileSections":{"recommendationRole":"영상 전문 연계","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]},"weeklyCapacity":0,"priority":5,"sourceDate":"2026-07-14","lastVerifiedAt":null,"imagePath":null}',
    '[{"key":"drone","label":"드론","category":"specialist","weight":3,"isPrimary":true}]', '[]'
  ) ->> 'code',
  'FACULTY_ROLE_INVALID',
  'wrong employment and consultation role combinations fail closed'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB 전문'),
    (select id from public.faculty where name = 'DB 전문'),
    '77777777-7777-4777-8777-777777777777',
    '{"name":"DB 전문","title":"겸임교수","employmentType":"adjunct","consultationRole":"specialist","office":"전문 연구실","phone":null,"email":"specialist@example.com","website":null,"contactVisibility":{"office":"admin_only","phone":"hidden","email":"admin_only","website":"hidden"},"expertiseSummary":"드론·영상","bio":"전문 소개","profileSections":{"recommendationRole":"영상 전문 연계","education":[],"careers":[],"teachingFields":[],"studentProjects":[],"careerPaths":[],"institutionProjects":[],"majorWorks":[]},"weeklyCapacity":0,"priority":5,"sourceDate":"2026-07-14","lastVerifiedAt":null,"imagePath":null}',
    '[{"key":"drone","label":"드론","category":"specialist","weight":2.5,"isPrimary":true}]', '[]'
  ) ->> 'code',
  'FACULTY_TAG_INVALID',
  'fractional tag weights fail closed'
);

select is(
  public.publish_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB 용량 없음'),
    (select id from public.faculty where name = 'DB 용량 없음'),
    '77777777-7777-4777-8777-777777777777'
  ) ->> 'code',
  'FACULTY_CAPACITY_REQUIRED',
  'full-time primary publication requires capacity above zero'
);

update public.faculty
set contact_visibility = '{"office":"hidden","phone":"hidden","email":"public","website":"hidden"}',
    last_verified_at = null
where name = 'DB 전문';
select is(
  public.publish_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB 전문'),
    (select id from public.faculty where name = 'DB 전문'),
    '77777777-7777-4777-8777-777777777777'
  ) ->> 'code',
  'CONTACT_VERIFICATION_REQUIRED',
  'public contact publication requires a verification timestamp'
);
update public.faculty
set last_verified_at = '2026-07-14T10:00:00+09:00'
where name = 'DB 전문';
select is(
  public.publish_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB 전문'),
    (select id from public.faculty where name = 'DB 전문'),
    '77777777-7777-4777-8777-777777777777'
  ) ->> 'status',
  'updated',
  'valid offset verification and NULL-primary specialist link publish successfully'
);
select is((select status from public.faculty where name = 'DB 전문'), 'active', 'successful publication activates the specialist');
select is((select count(*)::integer from public.audit_events where action = 'faculty_published' and target_id = (select id::text from public.faculty where name = 'DB 전문')), 1, 'successful publish writes one audit event');

select is(
  public.publish_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = '윤태준' and bio = '범위 검증 소개'),
    (select id from public.faculty where name = '윤태준' and bio = '범위 검증 소개'),
    '77777777-7777-4777-8777-777777777777'
  ) ->> 'code',
  'FACULTY_YOON_SCOPE_REQUIRED',
  'Yoon Tae-jun publication preserves art photo, video, AI, and technical imagery scope'
);

select is(
  public.publish_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2020-01-01T00:00:00Z',
    (select id from public.faculty where name = 'DB 총괄 A'),
    '77777777-7777-4777-8777-777777777777'
  ) ->> 'status',
  'conflict',
  'stale publish returns a closed conflict'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Boundary'),
    (select id from public.faculty where name = 'DB Boundary'),
    '10000000-0000-4000-8000-000000000001',
    pg_temp.faculty_payload('DB Boundary') || '{"unexpected":true}'::jsonb,
    pg_temp.faculty_tags_payload('DB Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_INVALID',
  'faculty payload rejects unknown keys at the DB boundary'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Boundary'),
    (select id from public.faculty where name = 'DB Boundary'),
    '10000000-0000-4000-8000-000000000002',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Boundary'),
      '{profileSections,recommendationRole}',
      pg_catalog.to_jsonb(pg_catalog.repeat('x', 1001))
    ),
    pg_temp.faculty_tags_payload('DB Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_INVALID',
  'profile recommendation role is individually bounded'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Multiline Bio Boundary'),
    (select id from public.faculty where name = 'DB Multiline Bio Boundary'),
    '30000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Multiline Bio Boundary'),
      '{priority}',
      '1'::jsonb
    ),
    pg_temp.faculty_tags_payload('DB Multiline Bio Boundary'),
    '[]'::jsonb
  ) ->> 'status',
  'updated',
  'an unchanged LF-only multiline bio roundtrips while another field changes'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Multiline Bio Boundary'),
    (select id from public.faculty where name = 'DB Multiline Bio Boundary'),
    '30000000-0000-4000-8000-000000000002',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Multiline Bio Boundary'),
      '{bio}',
      pg_catalog.to_jsonb(E'First line\nSecond line\nThird line'::text)
    ),
    pg_temp.faculty_tags_payload('DB Multiline Bio Boundary'),
    '[]'::jsonb
  ) ->> 'status',
  'updated',
  'editing a bio preserves LF-only multiline content'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Boundary'),
    (select id from public.faculty where name = 'DB Boundary'),
    '10000000-0000-4000-8000-000000000003',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Boundary'),
      '{bio}',
      pg_catalog.to_jsonb(E'Boundary\rbio'::text)
    ),
    pg_temp.faculty_tags_payload('DB Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_INVALID',
  'bio rejects carriage returns'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Multiline Bio Boundary'),
    (select id from public.faculty where name = 'DB Multiline Bio Boundary'),
    '30000000-0000-4000-8000-000000000003',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Multiline Bio Boundary'),
      '{bio}',
      pg_catalog.to_jsonb(E'First line\tSecond line'::text)
    ),
    pg_temp.faculty_tags_payload('DB Multiline Bio Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_INVALID',
  'bio rejects tab characters'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Multiline Bio Boundary'),
    (select id from public.faculty where name = 'DB Multiline Bio Boundary'),
    '30000000-0000-4000-8000-000000000004',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Multiline Bio Boundary'),
      '{bio}',
      pg_catalog.to_jsonb(('First line' || pg_catalog.chr(127) || 'Second line')::text)
    ),
    pg_temp.faculty_tags_payload('DB Multiline Bio Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_INVALID',
  'bio rejects the DEL control character'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Multiline Bio Boundary'),
    (select id from public.faculty where name = 'DB Multiline Bio Boundary'),
    '30000000-0000-4000-8000-000000000005',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Multiline Bio Boundary'),
      '{bio}',
      pg_catalog.to_jsonb(('First line' || pg_catalog.chr(133) || 'Second line')::text)
    ),
    pg_temp.faculty_tags_payload('DB Multiline Bio Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_INVALID',
  'bio rejects a C1 control character'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Boundary'),
    (select id from public.faculty where name = 'DB Boundary'),
    '10000000-0000-4000-8000-000000000004',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Boundary'),
      '{website}',
      '"https://user@example.com/path#private"'::jsonb
    ),
    pg_temp.faculty_tags_payload('DB Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_INVALID',
  'website rejects userinfo and fragments before storage'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Active Primary Boundary'),
    (select id from public.faculty where name = 'DB Active Primary Boundary'),
    '10000000-0000-4000-8000-000000000005',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Active Primary Boundary'),
      '{weeklyCapacity}',
      '0'::jsonb
    ),
    pg_temp.faculty_tags_payload('DB Active Primary Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_CAPACITY_REQUIRED',
  'an update cannot leave an active primary without capacity'
);
update public.faculty set weekly_capacity = 10 where name = 'DB Active Primary Boundary';

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Active Primary Boundary'),
    (select id from public.faculty where name = 'DB Active Primary Boundary'),
    '10000000-0000-4000-8000-000000000006',
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_temp.faculty_payload('DB Active Primary Boundary'),
        '{contactVisibility,email}',
        '"public"'::jsonb
      ),
      '{lastVerifiedAt}',
      'null'::jsonb
    ),
    pg_temp.faculty_tags_payload('DB Active Primary Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'CONTACT_VERIFICATION_REQUIRED',
  'an update cannot expose a missing unverified contact on an active profile'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Public Contact Boundary'),
    (select id from public.faculty where name = 'DB Public Contact Boundary'),
    '20000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Public Contact Boundary'),
      '{email}',
      '"changed@example.com"'::jsonb
    ),
    pg_temp.faculty_tags_payload('DB Public Contact Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'CONTACT_VERIFICATION_REQUIRED',
  'changing a public contact requires a strictly newer verification timestamp'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Public Contact Boundary'),
    (select id from public.faculty where name = 'DB Public Contact Boundary'),
    '20000000-0000-4000-8000-000000000002',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Public Contact Boundary'),
      '{contactVisibility,phone}',
      '"public"'::jsonb
    ),
    pg_temp.faculty_tags_payload('DB Public Contact Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'CONTACT_VERIFICATION_REQUIRED',
  'making an existing contact public requires a strictly newer verification timestamp'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Public Contact Boundary'),
    (select id from public.faculty where name = 'DB Public Contact Boundary'),
    '20000000-0000-4000-8000-000000000003',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Public Contact Boundary'),
      '{bio}',
      '"Unchanged public contact bio edit"'::jsonb
    ),
    pg_temp.faculty_tags_payload('DB Public Contact Boundary'),
    '[]'::jsonb
  ) ->> 'status',
  'updated',
  'unchanged public contacts may retain their existing verification timestamp'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Public Contact Boundary'),
    (select id from public.faculty where name = 'DB Public Contact Boundary'),
    '20000000-0000-4000-8000-000000000004',
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_temp.faculty_payload('DB Public Contact Boundary'),
        '{email}',
        '"verified-change@example.com"'::jsonb
      ),
      '{lastVerifiedAt}',
      '"2026-07-15T00:00:00Z"'::jsonb
    ),
    pg_temp.faculty_tags_payload('DB Public Contact Boundary'),
    '[]'::jsonb
  ) ->> 'status',
  'updated',
  'a changed public contact succeeds with a strictly newer nonfuture verification timestamp'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Public Contact Boundary'),
    (select id from public.faculty where name = 'DB Public Contact Boundary'),
    '20000000-0000-4000-8000-000000000007',
    pg_catalog.jsonb_set(
      pg_temp.faculty_payload('DB Public Contact Boundary'),
      '{lastVerifiedAt}',
      '"2026-07-14T00:00:00Z"'::jsonb
    ),
    pg_temp.faculty_tags_payload('DB Public Contact Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'CONTACT_VERIFICATION_REQUIRED',
  'unchanged public contacts may retain but cannot regress their verification timestamp'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Active Specialist Boundary'),
    (select id from public.faculty where name = 'DB Active Specialist Boundary'),
    '10000000-0000-4000-8000-000000000007',
    pg_temp.faculty_payload('DB Active Specialist Boundary'),
    '[{"key":"drone_result","label":"Drone result","category":"result","weight":3,"isPrimary":true}]'::jsonb,
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_SPECIALIST_TAG_REQUIRED',
  'an update cannot remove the final specialist tag from an active specialist'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Active Specialist Boundary'),
    (select id from public.faculty where name = 'DB Active Specialist Boundary'),
    '10000000-0000-4000-8000-000000000019',
    pg_temp.faculty_payload('DB Active Specialist Boundary'),
    '[{"key":"drone","label":"Drone","category":"specialist","weight":0,"isPrimary":true}]'::jsonb,
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_SPECIALIST_TAG_REQUIRED',
  'an active specialist requires a positive-weight specialist tag'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Boundary'),
    (select id from public.faculty where name = 'DB Boundary'),
    '10000000-0000-4000-8000-000000000008',
    pg_temp.faculty_payload('DB Boundary'),
    '[{"key":"one","label":"One","category":"result","weight":3,"isPrimary":true},{"key":"two","label":"Two","category":"result","weight":2,"isPrimary":true}]'::jsonb,
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_TAG_INVALID',
  'two primary tags in one category fail closed'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Boundary'),
    (select id from public.faculty where name = 'DB Boundary'),
    '10000000-0000-4000-8000-000000000009',
    pg_temp.faculty_payload('DB Boundary'),
    '[{"key":"documentary","label":"Wrong label","category":"track","weight":3,"isPrimary":true}]'::jsonb,
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_TAXONOMY_INVALID',
  'canonical track keys require the authoritative Korean label'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Link Specialist Boundary'),
    (select id from public.faculty where name = 'DB Link Specialist Boundary'),
    '10000000-0000-4000-8000-000000000010',
    pg_temp.faculty_payload('DB Link Specialist Boundary'),
    pg_temp.faculty_tags_payload('DB Link Specialist Boundary'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'primaryFacultyId', (select id from public.faculty where name = 'DB 용량 없음'),
      'tagKey', 'drone',
      'priority', 10,
      'explanationTemplate', 'Supports drone practice under the primary adviser.'
    ))
  ) ->> 'code',
  'FACULTY_LINK_INVALID',
  'specialist links cannot target a draft primary faculty row'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Link Specialist Boundary'),
    (select id from public.faculty where name = 'DB Link Specialist Boundary'),
    '10000000-0000-4000-8000-000000000011',
    pg_temp.faculty_payload('DB Link Specialist Boundary'),
    pg_temp.faculty_tags_payload('DB Link Specialist Boundary'),
    '[{"primaryFacultyId":null,"tagKey":"drone","priority":10,"explanationTemplate":"고정 배정 완료"}]'::jsonb
  ) ->> 'code',
  'FACULTY_LINK_INVALID',
  'specialist link copy cannot claim a fixed or completed assignment'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Link Specialist Boundary'),
    (select id from public.faculty where name = 'DB Link Specialist Boundary'),
    '20000000-0000-4000-8000-000000000005',
    pg_temp.faculty_payload('DB Link Specialist Boundary'),
    pg_temp.faculty_tags_payload('DB Link Specialist Boundary'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'primaryFacultyId', (select id from public.faculty where name = 'DB 총괄 A'),
      'tagKey', 'drone',
      'priority', 10,
      'explanationTemplate', 'Prepares a draft specialist connection for publication review.'
    ))
  ) ->> 'status',
  'updated',
  'a draft specialist may author a valid link atomically before publication'
);
select is(
  (select status from public.faculty where name = 'DB Link Specialist Boundary'),
  'draft',
  'draft link authoring preserves the non-recommendable draft status'
);
select is(
  (select pg_catalog.count(*)::integer
   from public.faculty
   where name = 'DB Link Specialist Boundary' and status = 'active'),
  0,
  'draft link authoring does not activate the specialist recommendation candidate'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = '윤태준' and bio = '범위 검증 소개'),
    (select id from public.faculty where name = '윤태준' and bio = '범위 검증 소개'),
    '10000000-0000-4000-8000-000000000012',
    pg_temp.faculty_payload('윤태준'),
    pg_temp.faculty_tags_payload('윤태준'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_YOON_SCOPE_REQUIRED',
  'Yoon Tae-jun scope is enforced on update as well as publish'
);

update public.faculty
set updated_at = '2026-07-15T00:00:00.123456Z'
where name = 'DB Time Boundary';
select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '2026-07-15T00:00:00.123457Z',
    (select id from public.faculty where name = 'DB Time Boundary'),
    '10000000-0000-4000-8000-000000000013',
    pg_temp.faculty_payload('DB Time Boundary'),
    pg_temp.faculty_tags_payload('DB Time Boundary'),
    '[]'::jsonb
  ) ->> 'status',
  'conflict',
  'microsecond differences remain distinct optimistic versions'
);
select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '2026-07-15T09:00:00.123456+09:00',
    (select id from public.faculty where name = 'DB Time Boundary'),
    '10000000-0000-4000-8000-000000000014',
    pg_temp.faculty_payload('DB Time Boundary'),
    pg_temp.faculty_tags_payload('DB Time Boundary'),
    '[]'::jsonb
  ) ->> 'status',
  'updated',
  'equivalent timestamp offsets address the same optimistic version'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Time Boundary'),
    (select id from public.faculty where name = 'DB Time Boundary'),
    '10000000-0000-4000-8000-000000000020',
    pg_catalog.jsonb_set(pg_temp.faculty_payload('DB Time Boundary'), '{weeklyCapacity}', '5'::jsonb),
    pg_temp.faculty_tags_payload('DB Time Boundary'),
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_CAPACITY_REQUIRED',
  'specialist profiles keep weekly primary-consultation capacity at zero'
);

select is(
  public.publish_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB 총괄 A'),
    (select id from public.faculty where name = 'DB 총괄 A'),
    '10000000-0000-4000-8000-000000000015'
  ) ->> 'code',
  'FACULTY_STATUS_INVALID',
  'publishing an already active profile is rejected explicitly'
);

select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Boundary'),
    (select id from public.faculty where name = 'DB Boundary'),
    '10000000-0000-4000-8000-000000000016',
    pg_catalog.jsonb_set(pg_temp.faculty_payload('DB Boundary'), '{bio}', '"Boundary bio changed"'::jsonb),
    pg_temp.faculty_tags_payload('DB Boundary'),
    '[]'::jsonb
  ) ->> 'status',
  'updated',
  'a valid single-field profile update succeeds'
);
select is(
  (select metadata -> 'changedFields' from public.audit_events where request_id = '10000000-0000-4000-8000-000000000016'),
  '["bio"]'::jsonb,
  'faculty audit records only fields that actually changed'
);

create temp table faculty_self_link_before as
select faculty.employment_type, faculty.consultation_role, faculty.updated_at,
  (select pg_catalog.count(*) from public.faculty_tags where faculty_id = faculty.id) as tag_count,
  (select pg_catalog.count(*) from public.faculty_specialist_links where specialist_faculty_id = faculty.id) as link_count,
  (select pg_catalog.count(*) from public.audit_events) as audit_count
from public.faculty faculty
where faculty.name = 'DB Active Primary Boundary';
select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Active Primary Boundary'),
    (select id from public.faculty where name = 'DB Active Primary Boundary'),
    '20000000-0000-4000-8000-000000000006',
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_temp.faculty_payload('DB Active Primary Boundary'),
          '{employmentType}',
          '"adjunct"'::jsonb
        ),
        '{consultationRole}',
        '"specialist"'::jsonb
      ),
      '{weeklyCapacity}',
      '0'::jsonb
    ),
    '[{"key":"drone","label":"Drone","category":"specialist","weight":3,"isPrimary":true}]'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'primaryFacultyId', (select id from public.faculty where name = 'DB Active Primary Boundary'),
      'tagKey', 'drone',
      'priority', 10,
      'explanationTemplate', 'Invalid self connection.'
    ))
  ) ->> 'code',
  'FACULTY_LINK_INVALID',
  'a self-link fails with the exact link validation code before mutation'
);
select is(
  (select pg_catalog.jsonb_build_object(
    'employmentType', faculty.employment_type,
    'consultationRole', faculty.consultation_role,
    'updatedAt', faculty.updated_at,
    'tagCount', (select pg_catalog.count(*) from public.faculty_tags where faculty_id = faculty.id),
    'linkCount', (select pg_catalog.count(*) from public.faculty_specialist_links where specialist_faculty_id = faculty.id),
    'auditCount', (select pg_catalog.count(*) from public.audit_events)
  ) from public.faculty faculty where faculty.name = 'DB Active Primary Boundary'),
  (select pg_catalog.jsonb_build_object(
    'employmentType', employment_type,
    'consultationRole', consultation_role,
    'updatedAt', updated_at,
    'tagCount', tag_count,
    'linkCount', link_count,
    'auditCount', audit_count
  ) from faculty_self_link_before),
  'self-link rejection changes no faculty, tags, links, timestamp, or audit rows'
);

insert into public.faculty_specialist_links(
  primary_faculty_id, specialist_faculty_id, tag_key, priority, explanation_template
)
select primary_faculty.id, specialist_faculty.id, 'drone', 10,
  'Provides a specialist connection under the primary adviser.'
from public.faculty primary_faculty
cross join public.faculty specialist_faculty
where primary_faculty.name = 'DB Active Primary Boundary'
  and specialist_faculty.name = 'DB Link Specialist Boundary';
select is(
  public.update_admin_faculty(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.faculty where name = 'DB Active Primary Boundary'),
    (select id from public.faculty where name = 'DB Active Primary Boundary'),
    '10000000-0000-4000-8000-000000000018',
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_temp.faculty_payload('DB Active Primary Boundary'),
          '{employmentType}',
          '"adjunct"'::jsonb
        ),
        '{consultationRole}',
        '"specialist"'::jsonb
      ),
      '{weeklyCapacity}',
      '0'::jsonb
    ),
    '[{"key":"drone","label":"Drone","category":"specialist","weight":3,"isPrimary":true}]'::jsonb,
    '[]'::jsonb
  ) ->> 'code',
  'FACULTY_LINK_INVALID',
  'a linked active primary cannot be converted into a specialist'
);

create function pg_temp.reject_faculty_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_id = '10000000-0000-4000-8000-000000000017' then
    raise exception using errcode = 'P0001', message = 'AUDIT_TEST_FAILURE';
  end if;
  return new;
end;
$$;
create trigger reject_faculty_audit_test
before insert on public.audit_events
for each row execute function pg_temp.reject_faculty_audit();
create temp table faculty_atomic_before as
select faculty.bio, faculty.updated_at,
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(tag) - 'id' order by tag.category, tag.tag_key)
   from public.faculty_tags tag where tag.faculty_id = faculty.id) as tags,
  (select pg_catalog.count(*) from public.audit_events) as audit_count
from public.faculty faculty
where faculty.name = 'DB Boundary';
select is(
  pg_temp.capture_json($capture$
    select public.update_admin_faculty(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      (select updated_at from public.faculty where name = 'DB Boundary'),
      (select id from public.faculty where name = 'DB Boundary'),
      '10000000-0000-4000-8000-000000000017',
      pg_catalog.jsonb_set(pg_temp.faculty_payload('DB Boundary'), '{bio}', '"Must roll back"'::jsonb),
      pg_temp.faculty_tags_payload('DB Boundary'),
      '[]'::jsonb
    )
  $capture$) ->> 'threw',
  'P0001:AUDIT_TEST_FAILURE',
  'an audit insert failure aborts the faculty mutation'
);
select is(
  (select pg_catalog.jsonb_build_object(
    'bio', faculty.bio,
    'updatedAt', faculty.updated_at,
    'tags', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(tag) - 'id' order by tag.category, tag.tag_key)
      from public.faculty_tags tag where tag.faculty_id = faculty.id),
    'auditCount', (select pg_catalog.count(*) from public.audit_events)
  ) from public.faculty faculty where faculty.name = 'DB Boundary'),
  (select pg_catalog.jsonb_build_object('bio', bio, 'updatedAt', updated_at, 'tags', tags, 'auditCount', audit_count)
   from faculty_atomic_before),
  'faculty row, tags, links, timestamp, and audit stay atomic on audit failure'
);
drop trigger reject_faculty_audit_test on public.audit_events;

select * from finish();
rollback;
