begin;
select plan(33);

select has_function('public', 'activate_verified_print_lab_facility', array[]::text[], 'print lab activation function exists');
select function_privs_are('public', 'activate_verified_print_lab_facility', array[]::text[], 'service_role', array['EXECUTE'], 'service role can activate print lab');
select function_privs_are('public', 'activate_verified_print_lab_facility', array[]::text[], 'public', array[]::text[], 'PUBLIC cannot activate print lab');
select function_privs_are('public', 'activate_verified_print_lab_facility', array[]::text[], 'anon', array[]::text[], 'anonymous users cannot activate print lab');
select function_privs_are('public', 'activate_verified_print_lab_facility', array[]::text[], 'authenticated', array[]::text[], 'ordinary users cannot activate print lab');
select ok(
  (select procedure.prosecdef
   from pg_catalog.pg_proc procedure
   where procedure.oid = 'public.activate_verified_print_lab_facility()'::pg_catalog.regprocedure),
  'print lab activation is security definer'
);
select is(
  (select procedure.proconfig
   from pg_catalog.pg_proc procedure
   where procedure.oid = 'public.activate_verified_print_lab_facility()'::pg_catalog.regprocedure),
  array['search_path=""']::text[],
  'print lab activation has an empty search path'
);
select ok(
  (select pg_catalog.strpos(pg_catalog.lower(definition.body), 'for update') > 0
     and (
       pg_catalog.char_length(definition.body)
       - pg_catalog.char_length(pg_catalog.replace(
           pg_catalog.lower(definition.body), 'resource.id = v_resource.id', ''
         ))
     ) / pg_catalog.char_length('resource.id = v_resource.id') = 2
   from (
     select pg_catalog.pg_get_functiondef(
       'public.activate_verified_print_lab_facility()'::pg_catalog.regprocedure
     ) as body
   ) definition),
  'activation locks the exact row and scopes later writes and reads to its id'
);

create temporary table print_lab_fixture on commit drop as
select resource.*
from public.resources resource
where resource.metadata ->> 'seedKey' = 'archive:facility:print_lab';

insert into auth.users(id) values ('36000000-0000-4000-8000-000000000036');
insert into public.admin_users(id, role, is_active)
values ('36000000-0000-4000-8000-000000000036', 'admin', true);

update public.resources resource
set metadata = pg_catalog.jsonb_set(resource.metadata, '{seedKey}', '"archive:facility:print_lab:missing"'::jsonb)
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_SEED_INVALID',
  'activation rejects a missing print lab target'
);
update public.resources resource
set metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture
where resource.id = fixture.id;

insert into public.resources (
  type, title, summary, connection_template, status, visibility, priority,
  source_date, metadata, image_path, created_at, updated_at
)
select resource.type, resource.title, resource.summary, resource.connection_template,
  resource.status, resource.visibility, resource.priority, resource.source_date,
  resource.metadata, resource.image_path, resource.created_at, resource.updated_at
from public.resources resource
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_SEED_INVALID',
  'activation rejects duplicate print lab targets'
);
delete from public.resources resource
where resource.metadata ->> 'seedKey' = 'archive:facility:print_lab'
  and resource.id <> (select fixture.id from pg_temp.print_lab_fixture fixture);

update public.resources resource
set metadata = pg_catalog.jsonb_set(resource.metadata, '{supportingEvidence}', 'false'::jsonb)
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_EVIDENCE_INVALID',
  'activation requires exact supporting evidence'
);
update public.resources resource set metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.resources resource
set metadata = pg_catalog.jsonb_set(resource.metadata, '{archive}', '[]'::jsonb)
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_ARCHIVE_INVALID',
  'activation rejects a malformed archive object'
);
update public.resources resource set metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.resources resource
set metadata = pg_catalog.jsonb_set(resource.metadata, '{archive,evidenceStatus}', '"historical"'::jsonb)
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_ARCHIVE_INVALID',
  'first activation rejects an archive state other than verify_required'
);
update public.resources resource set metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.resources resource
set metadata = pg_catalog.jsonb_set(resource.metadata, '{archive,sourceUrl}', '"http://example.com/facilities"'::jsonb)
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_ARCHIVE_INVALID',
  'activation requires a non-empty HTTPS archive source URL'
);
update public.resources resource set metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.resources resource
set metadata = pg_catalog.jsonb_set(resource.metadata, '{archive,sourcePageTitle}', '""'::jsonb)
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_ARCHIVE_INVALID',
  'activation requires a non-empty archive source page title'
);
update public.resources resource set metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.resources resource
set metadata = pg_catalog.jsonb_set(resource.metadata, '{archive,sourceLastEditedDate}', '"2025-02-31"'::jsonb)
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_ARCHIVE_INVALID',
  'activation requires a real strict YYYY-MM-DD archive edit date'
);
update public.resources resource set metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.resources resource
set metadata = pg_catalog.jsonb_set(resource.metadata, '{archive,trackEvidence}', '[]'::jsonb)
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_ARCHIVE_INVALID',
  'activation requires non-empty archive track evidence'
);
update public.resources resource set metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.resources resource set type = 'equipment'
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_SEED_INVALID',
  'activation rejects an invalid print lab type'
);
update public.resources resource set type = fixture.type, metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.resources resource set visibility = 'hidden'
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_SEED_INVALID',
  'activation rejects a non-public print lab'
);
update public.resources resource set visibility = fixture.visibility, metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.resources resource set status = 'next_year_confirmed'
where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture);
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_STATUS_INVALID',
  'activation rejects an invalid print lab status'
);
update public.resources resource set status = fixture.status, metadata = fixture.metadata, updated_at = fixture.updated_at
from pg_temp.print_lab_fixture fixture where resource.id = fixture.id;

update public.admin_users set is_active = false
where id = '36000000-0000-4000-8000-000000000036';
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'ADMIN_REQUIRED',
  'activation requires an active admin'
);
update public.admin_users set is_active = true
where id = '36000000-0000-4000-8000-000000000036';

update public.resource_tags tag set is_primary = false
where tag.resource_id = (select fixture.id from pg_temp.print_lab_fixture fixture)
  and tag.is_primary;
select throws_ok(
  $$select public.activate_verified_print_lab_facility()$$,
  'P0001', 'PRINT_LAB_ACTIVATION_FAILED',
  'activation fails closed when the transition RPC rejects publication'
);
select is(
  (select resource.metadata from public.resources resource
   where resource.id = (select fixture.id from pg_temp.print_lab_fixture fixture)),
  (select fixture.metadata from pg_temp.print_lab_fixture fixture),
  'transition rejection rolls back the metadata write'
);
update public.resource_tags tag set is_primary = true
where tag.resource_id = (select fixture.id from pg_temp.print_lab_fixture fixture)
  and tag.tag_key = 'art_photo';

select is(
  public.activate_verified_print_lab_facility() ->> 'status',
  'updated',
  'verified print lab is activated'
);
select is(
  (select count(*)::integer from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'
     and type = 'facility' and visibility = 'public' and status = 'active'),
  1,
  'exactly one print lab is public and active'
);
select is(
  (select metadata ->> 'location_label' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  '사진영상미디어학과 프린트랩',
  'print lab has a precise department location label'
);
select ok(
  (select metadata ->> 'operationNote' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab') like '%출력%'
  and (select metadata ->> 'operationNote' from public.resources
       where metadata ->> 'seedKey' = 'archive:facility:print_lab') like '%학과에 문의%',
  'print lab operation note explains output and inquiry access'
);
select matches(
  (select metadata ->> 'lastVerifiedAt' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+][0-9]{2}:[0-9]{2}$',
  'print lab verification retains an offset timestamp'
);
select is(
  (select metadata -> 'archive' ->> 'evidenceStatus' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  'snapshot',
  'print lab archive evidence is promoted to a verified snapshot'
);
select is(
  (select (metadata -> 'archive') - 'evidenceStatus' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  (select (fixture.metadata -> 'archive') - 'evidenceStatus' from pg_temp.print_lab_fixture fixture),
  'archive source and provenance fields are preserved exactly'
);
select is(
  (select metadata -> 'supportingEvidence' from public.resources
   where metadata ->> 'seedKey' = 'archive:facility:print_lab'),
  'true'::jsonb,
  'supporting evidence remains exactly true'
);
select is(
  (select array_agg(tag.tag_key order by tag.tag_key)
   from public.resource_tags tag
   join public.resources resource on resource.id = tag.resource_id
   where resource.metadata ->> 'seedKey' = 'archive:facility:print_lab'
     and tag.tag_key = any (array['art_photo', 'commercial', 'documentary']::text[])),
  array['art_photo', 'commercial', 'documentary']::text[],
  'print lab retains all three supported track tags'
);
select is(
  public.activate_verified_print_lab_facility() ->> 'status',
  'already_activated',
  'snapshot print lab activation is idempotent'
);

select * from finish();
rollback;
