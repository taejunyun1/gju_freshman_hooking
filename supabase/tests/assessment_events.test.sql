begin;

select plan(24);

select has_table('public'::name, 'events'::name);
select col_type_is('public', 'events', 'prospect_id', 'bigint', 'events can reference a prospect');
select col_type_is('public', 'events', 'anonymous_id', 'uuid', 'events use a UUID anonymous subject');
select col_type_is('public', 'events', 'campaign_id', 'bigint', 'events reserve a validated campaign reference');
select col_type_is('public', 'events', 'event_name', 'text', 'event names are text constrained by the database');
select col_type_is('public', 'events', 'path', 'text', 'events store a server-derived canonical path');
select col_type_is('public', 'events', 'properties', 'jsonb', 'event properties are sanitized JSON');
select col_not_null('public', 'events', 'anonymous_id', 'every event requires an anonymous subject');
select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'events' and column_name = 'prospect_id'),
  'YES',
  'prospect attribution remains optional'
);
select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'events' and column_name = 'campaign_id'),
  'YES',
  'campaign attribution remains optional'
);
select policies_are('public', 'events', array[]::text[], 'browser roles have no events policies');
select table_privs_are('public', 'events', 'public', array[]::text[], 'the public role cannot access events');
select table_privs_are('public', 'events', 'anon', array[]::text[], 'anonymous clients cannot access events');
select table_privs_are('public', 'events', 'authenticated', array[]::text[], 'authenticated clients cannot access events');
select table_privs_are(
  'public',
  'events',
  'service_role',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'only the server service role can manage events'
);
select sequence_privs_are('public', 'events_id_seq', 'public', array[]::text[], 'the public role cannot use event identities');
select sequence_privs_are('public', 'events_id_seq', 'anon', array[]::text[], 'anonymous clients cannot use event identities');
select sequence_privs_are('public', 'events_id_seq', 'authenticated', array[]::text[], 'authenticated clients cannot use event identities');
select sequence_privs_are(
  'public',
  'events_id_seq',
  'service_role',
  array['SELECT', 'USAGE'],
  'the server retains only the existing event identity privileges'
);

select lives_ok(
  $$insert into public.events (anonymous_id, event_name, path, properties)
    values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'landing_viewed', '/api/events', '{"request_id":"11111111-1111-4111-8111-111111111111","scalar_values":[null,true,1,"ok"]}'::jsonb),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'assessment_started', '/api/events', '{"request_id":"22222222-2222-4222-8222-222222222222","catalog_revision":"sha256:test"}'::jsonb),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'assessment_step_completed', '/api/events', '{"request_id":"33333333-3333-4333-8333-333333333333","group":"work","selected_count":1}'::jsonb)$$,
  'the allow-listed S2 browser event names remain available'
);

select throws_ok(
  $$insert into public.events (anonymous_id, event_name, path)
    values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'client_defined', '/api/events')$$,
  '23514',
  null,
  'client-defined event names are rejected'
);

select throws_ok(
  $$insert into public.events (anonymous_id, event_name, path, properties)
    values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'landing_viewed', '/api/events', '{"phone":"01012345678"}'::jsonb)$$,
  '23514',
  null,
  'sensitive property keys are rejected'
);

select throws_ok(
  $$insert into public.events (anonymous_id, event_name, path, properties)
    values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef', 'landing_viewed', '/api/events', '{"nested":{"items":[{"authorization":"private"}]}}'::jsonb)$$,
  '23514',
  null,
  'nested sensitive property keys are rejected recursively'
);

select throws_ok(
  $$insert into public.events (anonymous_id, event_name, path, properties)
    values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'landing_viewed', '/api/events', jsonb_build_object('note', repeat('x', 4100)))$$,
  '23514',
  null,
  'event properties stay within the 4096-byte database limit'
);

select * from finish();

rollback;
