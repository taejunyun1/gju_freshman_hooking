begin;

select plan(10);

select has_function(
  'public', 'activate_verified_department_facilities', array[]::text[],
  'verified department facility activation function exists'
);
select function_privs_are(
  'public', 'activate_verified_department_facilities', array[]::text[],
  'service_role', array['EXECUTE'],
  'service role can activate verified department facilities'
);
select function_privs_are(
  'public', 'activate_verified_department_facilities', array[]::text[],
  'authenticated', array[]::text[],
  'ordinary users cannot activate department facilities'
);

insert into auth.users(id) values ('27000000-0000-4000-8000-000000000027');
insert into public.admin_users(id, role, is_active)
values ('27000000-0000-4000-8000-000000000027', 'admin', true);

select is(
  public.activate_verified_department_facilities() ->> 'status',
  'updated',
  'the four verified department facilities are activated'
);
select is(
  (select count(*)::integer
   from public.resources
   where metadata ->> 'seedKey' = any (array[
     'facility:studio_a_horizon', 'facility:studio_b',
     'facility:darkroom', 'facility:computer_lab'
     ]::text[])
     and type = 'facility' and visibility = 'public' and status = 'active'
     and metadata ->> 'location_label' = '사진영상미디어학과'),
  4,
  'exactly four confirmed department facilities are public and active'
);
select ok(
  not exists (
    select 1
    from public.resources
    where metadata ->> 'seedKey' = any (array[
      'facility:studio_a_horizon', 'facility:studio_b',
      'facility:darkroom', 'facility:computer_lab'
    ]::text[])
      and coalesce(metadata ->> 'lastVerifiedAt', '')
        !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$'
  ),
  'all four confirmed facilities retain ISO timestamps with offsets'
);
select ok(
  (select metadata ->> 'operationNote'
   from public.resources where metadata ->> 'seedKey' = 'facility:computer_lab')
    like '%2020년형 iMac%'
  and (select metadata ->> 'operationNote'
       from public.resources where metadata ->> 'seedKey' = 'facility:computer_lab')
    like '%RTX 4080급%',
  'the computer lab note includes both confirmed equipment details'
);
select is(
  (select count(*)::integer
   from public.resources
   where metadata ->> 'seedKey' like 'archive:facility:%'
     and status = 'draft'),
  3,
  'unverified archive facilities remain draft'
);
select is(
  public.activate_verified_department_facilities() ->> 'status',
  'already_activated',
  'facility activation is idempotent'
);
select is(
  (select count(*)::integer
   from public.resources
   where type = 'facility' and status = 'active'),
  4,
  'idempotent activation never publishes another facility candidate'
);

select * from finish();
rollback;
