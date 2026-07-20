begin;

select plan(13);

select has_function(
  'public', 'upsert_verified_2026_supporting_instructors', array[]::text[],
  'the populated-database supporting-instructor delivery function exists'
);
select function_privs_are(
  'public', 'upsert_verified_2026_supporting_instructors', array[]::text[],
  'service_role', array[]::text[],
  'the internal delivery function is not callable by the Worker service role'
);

delete from public.faculty_specialist_links link
using public.faculty specialist
where specialist.id = link.specialist_faculty_id
  and specialist.name = any (array['정한결', '유별남', '김태현', '김명우']::text[]);
delete from public.faculty_tags tag
using public.faculty faculty
where faculty.id = tag.faculty_id
  and faculty.name = any (array['정한결', '유별남', '김태현', '김명우']::text[]);
delete from public.faculty
where name = any (array['정한결', '유별남', '김태현', '김명우']::text[]);

update public.faculty
set status = 'active'
where name = any (array['조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱']::text[]);

select is(
  public.upsert_verified_2026_supporting_instructors() ->> 'status',
  'updated',
  'the forward delivery inserts supporting instructors into a populated database'
);
select is(
  (select count(*)::integer from public.faculty
   where name = any (array['정한결', '유별남', '김태현', '김명우']::text[])
     and status = 'active' and employment_type = 'practitioner'
     and consultation_role = 'specialist' and weekly_capacity = 0),
  4,
  'the populated database receives four active zero-capacity time instructors'
);
select is(
  (select array_agg(priority order by case name
      when '정한결' then 1 when '유별남' then 2 when '김태현' then 3 when '김명우' then 4 end)
   from public.faculty
   where name = any (array['정한결', '유별남', '김태현', '김명우']::text[])),
  array[60, 50, 40, 30]::smallint[],
  'the populated database receives the deterministic supporting-instructor priorities'
);
select is(
  (select count(*)::integer from public.faculty_tags tag
   join public.faculty faculty on faculty.id = tag.faculty_id
   where faculty.name = any (array['정한결', '유별남', '김태현', '김명우']::text[])),
  50,
  'the populated database receives every canonical derived time-instructor tag'
);
select is(
  (select count(*)::integer from public.faculty_specialist_links link
   join public.faculty specialist on specialist.id = link.specialist_faculty_id
   where specialist.name = any (array['정한결', '유별남', '김태현', '김명우']::text[])),
  16,
  'the populated database receives all sixteen time-instructor specialist links'
);
select is(
  (select count(*)::integer from public.faculty
   where name = any (array['유별남', '김태현']::text[])
     and contact_visibility = '{"office":"hidden","phone":"hidden","email":"hidden","website":"public"}'::jsonb
     and website like 'https://%' and last_verified_at is not null),
  2,
  'the two supplied public websites are delivered without other public contacts'
);
select is(
  (select count(*)::integer from public.faculty
   where name = any (array['조대연', '윤태준', '김사라']::text[])
     and employment_type = 'full_time' and consultation_role = 'primary'),
  3,
  'the forward delivery leaves all full-time primary roles unchanged'
);
select is(
  (select count(*)::integer from public.faculty
   where name = any (array['박재웅', '정철호', '곽동욱']::text[])
     and employment_type = 'adjunct' and consultation_role = 'specialist'),
  3,
  'the forward delivery leaves all existing adjunct specialist roles unchanged'
);
select is(
  public.upsert_verified_2026_supporting_instructors() ->> 'status',
  'already_current',
  'the forward delivery is idempotent on a second call'
);
select is(
  (select count(*)::integer from public.faculty where title = '시간강사'),
  4,
  'idempotency does not duplicate supporting instructors'
);
select is(
  (select count(*)::integer from public.faculty_specialist_links link
   join public.faculty specialist on specialist.id = link.specialist_faculty_id
   where specialist.title = '시간강사'),
  16,
  'idempotency does not duplicate supporting-instructor links'
);

select * from finish();
rollback;
