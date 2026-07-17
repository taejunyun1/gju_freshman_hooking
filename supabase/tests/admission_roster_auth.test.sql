begin;

select plan(8);

select isnt(
  pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'),
  null,
  'roster login RPC exists with versioned digest candidates'
);

select isnt(
  pg_catalog.to_regprocedure('public.read_roster_student_session_v1(bytea)'),
  null,
  'roster session read RPC exists'
);

select isnt(
  pg_catalog.to_regprocedure('public.revoke_roster_student_session_v1(bytea)'),
  null,
  'roster session revoke RPC exists'
);

select is(
  (
    select count(*)
    from (values
      ('public'::name),
      ('anon'::name),
      ('authenticated'::name)
    ) roles(role)
    cross join (values
      ('login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'::text),
      ('read_roster_student_session_v1(bytea)'::text),
      ('revoke_roster_student_session_v1(bytea)'::text)
    ) functions(signature)
    where pg_catalog.to_regprocedure('public.' || functions.signature) is not null
      and has_function_privilege(roles.role, ('public.' || functions.signature)::regprocedure, 'execute')
  ),
  0::bigint,
  'public anon and authenticated cannot execute roster auth RPCs'
);

select is(
  (
    select count(*)
    from (values
      ('login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'::text),
      ('read_roster_student_session_v1(bytea)'::text),
      ('revoke_roster_student_session_v1(bytea)'::text)
    ) functions(signature)
    where pg_catalog.to_regprocedure('public.' || functions.signature) is not null
      and has_function_privilege('service_role', ('public.' || functions.signature)::regprocedure, 'execute')
  ),
  3::bigint,
  'service_role can execute every roster auth RPC'
);

select ok(
  coalesce(position('touch_student_session' in pg_get_functiondef(pg_catalog.to_regprocedure('public.read_roster_student_session_v1(bytea)'))), 0) = 0,
  'roster session read does not call the legacy touch function'
);

select ok(
  coalesce(position('password_hash' in pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'))), 0) = 0,
  'roster login RPC does not read legacy PBKDF2 hash columns'
);

select ok(
  coalesce(position('password_salt' in pg_get_functiondef(pg_catalog.to_regprocedure('public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz)'))), 0) = 0,
  'roster login RPC does not read legacy PBKDF2 salt columns'
);

select * from finish();
rollback;
