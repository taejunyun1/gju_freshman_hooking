begin;

select plan(7);

select is(
  (select count(*)::integer
   from public.resources
   where type = 'course'
     and metadata @> '{"academic_year": 2026}'::jsonb
     and metadata ->> 'requirement_type' = 'major_required'),
  5,
  '2026 courses contain exactly five major-required records'
);

select is(
  (select count(*)::integer
   from public.resources
   where type = 'course'
     and metadata @> '{"academic_year": 2026}'::jsonb
     and metadata ->> 'requirement_type' = 'major_elective'),
  36,
  'the remaining 2026 courses are major electives'
);

select is(
  (select array_agg(title order by title)
   from public.resources
   where type = 'course'
     and metadata @> '{"academic_year": 2026}'::jsonb
     and metadata ->> 'requirement_type' = 'major_required'),
  array[
    '디지털 이미지 제작과 프린트',
    '라이팅과 스튜디오',
    '영상 컬러와 포스트 프로덕션',
    '커머셜 포토그라피 기초 워크숍',
    '커머셜 포토그라피 심화 워크숍'
  ]::text[],
  'the official major-required titles are exact'
);

select ok(
  not exists (
    select 1 from public.resources
    where type <> 'course' and metadata ? 'requirement_type'
  ),
  'non-course resources do not receive a course requirement classification'
);

select ok(
  not exists (
    select 1 from public.resources
    where type = 'course'
      and not (metadata @> '{"academic_year": 2026}'::jsonb)
      and metadata ? 'requirement_type'
  ),
  'non-2026 courses do not receive a requirement classification'
);

select ok(
  not exists (
    select 1 from public.resources
    where type = 'course'
      and metadata @> '{"academic_year": 2026}'::jsonb
      and metadata ->> 'requirement_type' not in ('major_required', 'major_elective')
  ),
  'every classified 2026 course uses an official requirement type'
);

select is(
  (select count(*)::integer
   from public.resources
   where type = 'course' and metadata @> '{"academic_year": 2026}'::jsonb),
  41,
  'classification remains scoped to the 41-course 2026 curriculum'
);

select * from finish();
rollback;
