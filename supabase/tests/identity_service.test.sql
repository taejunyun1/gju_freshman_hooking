begin;

select plan(10);

select has_function(
  'public',
  'register_student',
  array['bytea', 'bytea', 'bytea', 'text', 'text', 'text', 'text', 'bytea', 'bytea'],
  'register_student accepts only protected identity and credential material'
);

select ok(
  coalesce((
    select p.prosecdef
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(
      'public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'
    )
  ), false),
  'register_student is security definer'
);

select ok(
  exists(
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as setting(value)
    where p.oid = pg_catalog.to_regprocedure(
      'public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'
    )
      and setting.value = 'search_path=""'
  ),
  'register_student has an empty search path'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'anon',
    pg_catalog.to_regprocedure('public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'),
    'execute'
  ), false),
  false,
  'anon cannot execute register_student'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    pg_catalog.to_regprocedure('public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'),
    'execute'
  ), false),
  false,
  'authenticated cannot execute register_student'
);

select is(
  coalesce(pg_catalog.has_function_privilege(
    'service_role',
    pg_catalog.to_regprocedure('public.register_student(bytea,bytea,bytea,text,text,text,text,bytea,bytea)'),
    'execute'
  ), false),
  true,
  'service_role can execute register_student'
);

select is(
  (
    select kind
    from public.register_student(
      decode(repeat('11', 32), 'hex'),
      decode(repeat('22', 16), 'hex'),
      decode(repeat('33', 12), 'hex'),
      '선명한프레임01',
      '광주고등학교',
      'high3',
      'gwangju',
      decode(repeat('44', 32), 'hex'),
      decode(repeat('55', 16), 'hex')
    )
  ),
  'created',
  'register_student creates the prospect and credential together'
);

select is(
  (select count(*)::integer from public.prospects where phone_hmac = decode(repeat('11', 32), 'hex')),
  1,
  'the protected phone has one prospect'
);

select is(
  (select count(*)::integer from public.student_credentials),
  1,
  'created prospects always have one credential'
);

select is(
  (
    select kind
    from public.register_student(
      decode(repeat('11', 32), 'hex'),
      decode(repeat('66', 16), 'hex'),
      decode(repeat('77', 12), 'hex'),
      '고요한프레임02',
      '다른학교',
      'graduate',
      'capital',
      decode(repeat('88', 32), 'hex'),
      decode(repeat('99', 16), 'hex')
    )
  ),
  'existing',
  'a duplicate phone returns existing without exposing a prospect'
);

select * from finish();

rollback;
