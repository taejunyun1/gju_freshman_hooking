begin;

select plan(8);

select is(
  (select count(*)::integer from public.resources where metadata ->> 'seedKey' like 'project_catalog:%'),
  43,
  'the project catalog stores the 43 non-cancelled records'
);
select is(
  (select count(*)::integer from public.resources
   where metadata ->> 'seedKey' like 'project_catalog:%'
     and metadata ->> 'displayTier' = 'current'
     and metadata ->> 'projectYear' = '2026'),
  13,
  'all thirteen 2026 programmes are current-priority projects'
);
select is(
  (select count(*)::integer from public.resources
   where metadata ->> 'seedKey' like 'project_catalog:%'
     and metadata ->> 'displayTier' = 'experience'),
  30,
  '2025 and earlier records remain accumulated experience'
);
select is(
  (select count(*)::integer from public.resources
   where metadata ->> 'seedKey' like 'project_catalog:%'
     and type = 'project' and status = 'active' and visibility = 'public'),
  43,
  'the catalog is available to the student result matcher'
);
select is(
  (select count(*)::integer from public.resources
   where metadata ->> 'seedKey' like 'project_catalog:%'
     and title like '%사진단오제%'),
  0,
  'the cancelled photo festival is not retained in the service catalog'
);
select ok(
  not exists (
    select 1
    from public.resources resource
    where resource.metadata ->> 'seedKey' like 'project_catalog:%'
      and (select count(*) from public.resource_tags tag
           where tag.resource_id = resource.id and tag.is_primary) <> 1
  ),
  'every catalog record has exactly one primary matching tag'
);
select ok(
  not exists (
    select 1
    from public.resources
    where metadata ->> 'seedKey' like 'project_catalog:%'
      and (metadata ->> 'displayTier' = 'current') is distinct from (metadata ->> 'projectYear' = '2026')
  ),
  'the display tier and project year remain aligned'
);
select is(
  (select count(*)::integer from public.resources
   where metadata ->> 'seedKey' like 'project_catalog:%'
     and coalesce(metadata ->> 'periodLabel', '') <> ''
     and coalesce(metadata ->> 'statusLabel', '') <> ''),
  43,
  'every project has compact period and operating-status labels'
);

select * from finish();
rollback;
