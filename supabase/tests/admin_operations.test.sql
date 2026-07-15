begin;

select plan(75);

select has_table('public'::name, 'campaigns'::name, 'campaigns table exists');
select has_table('public'::name, 'export_jobs'::name, 'export audit table exists');
select col_is_pk('public', 'campaigns', array['id'], 'campaigns use an identity primary key');
select col_is_unique('public', 'campaigns', array['code'], 'campaign code is unique');
select col_is_pk('public', 'export_jobs', array['id'], 'export jobs use an identity primary key');
select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'export_jobs'
     and column_name ~* 'phone|workbook|bytes|payload'),
  0,
  'export audit rows never persist phone lists or workbook payloads'
);

select ok(coalesce((select relrowsecurity from pg_catalog.pg_class where oid = pg_catalog.to_regclass('public.campaigns')), false), 'campaign RLS is enabled');
select ok(coalesce((select relrowsecurity from pg_catalog.pg_class where oid = pg_catalog.to_regclass('public.export_jobs')), false), 'export RLS is enabled');
select ok(coalesce((select relforcerowsecurity from pg_catalog.pg_class where oid = pg_catalog.to_regclass('public.campaigns')), false), 'campaign RLS is forced');
select ok(coalesce((select relforcerowsecurity from pg_catalog.pg_class where oid = pg_catalog.to_regclass('public.export_jobs')), false), 'export RLS is forced');
select policies_are('public', 'campaigns', array[]::text[], 'campaigns are default deny');
select policies_are('public', 'export_jobs', array[]::text[], 'export jobs are default deny');
select table_privs_are('public', 'campaigns', 'anon', array[]::text[], 'anonymous clients cannot access campaigns');
select table_privs_are('public', 'campaigns', 'authenticated', array[]::text[], 'authenticated clients cannot access campaigns directly');
select table_privs_are('public', 'campaigns', 'service_role', array['SELECT', 'INSERT', 'UPDATE'], 'server receives campaign CRUD without delete');
select table_privs_are('public', 'export_jobs', 'anon', array[]::text[], 'anonymous clients cannot access export audits');
select table_privs_are('public', 'export_jobs', 'authenticated', array[]::text[], 'authenticated clients cannot access export audits directly');
select table_privs_are('public', 'export_jobs', 'service_role', array['SELECT', 'INSERT', 'UPDATE'], 'server receives export audit writes without delete');
select sequence_privs_are('public', 'campaigns_id_seq', 'service_role', array['SELECT', 'USAGE'], 'server can allocate campaign identities');
select sequence_privs_are('public', 'export_jobs_id_seq', 'service_role', array['SELECT', 'USAGE'], 'server can allocate export identities');

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'assessments_campaign_fk' and convalidated and confdeltype = 'r'
  ),
  'assessment campaign attribution is validated and deletion-restricted'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'events_campaign_fk' and convalidated and confdeltype = 'r'
  ),
  'event campaign attribution is validated and deletion-restricted'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'export_jobs_created_by_admin_fk' and convalidated and confdeltype = 'r'
  ),
  'export creator is a validated deletion-restricted administrator reference'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_constraint constraint_row
   join pg_catalog.pg_attribute attribute
     on attribute.attrelid = constraint_row.conrelid
    and attribute.attnum = any(constraint_row.conkey)
   where constraint_row.conname = any(array[
     'assessments_campaign_fk', 'events_campaign_fk', 'export_jobs_created_by_admin_fk'
   ])
     and not exists (
       select 1 from pg_catalog.pg_index index_row
       where index_row.indrelid = constraint_row.conrelid
         and index_row.indisvalid
         and attribute.attnum = any(index_row.indkey)
     )),
  0,
  'every new foreign-key column is indexed'
);
select has_index('public', 'campaigns', 'campaigns_status_created_idx', 'campaign status/date lookup is indexed');
select has_index('public', 'export_jobs', 'export_jobs_creator_created_idx', 'creator/date lookup is indexed');
select has_index('public', 'export_jobs', 'export_jobs_status_created_idx', 'export status/date lookup is indexed');

select function_privs_are('public', 'enforce_immutable_campaign_code', array[]::text[], 'public', array[]::text[], 'campaign trigger helper is not public API');
select function_privs_are('public', 'guard_export_job', array[]::text[], 'public', array[]::text[], 'export trigger helper is not public API');
select function_privs_are('public', 'is_valid_export_filter_snapshot', array['jsonb'], 'public', array[]::text[], 'filter validator is not public API');

select lives_ok(
  $$insert into auth.users(id) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    insert into public.admin_users(id, is_active) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false)$$,
  'active and inactive administrator fixtures exist'
);
select lives_ok(
  $$insert into public.campaigns(code, name, channel, status, starts_at, ends_at, sent_count)
    values ('open-day-2026', '2026 오픈데이', 'qr', 'active', '2026-07-01T00:00:00+09:00', '2026-07-31T23:59:59+09:00', 120)$$,
  'a normalized campaign is stored'
);
select throws_ok(
  $$update public.campaigns set code = 'changed' where code = 'open-day-2026'$$,
  'P0001', 'CAMPAIGN_CODE_IMMUTABLE', 'campaign codes cannot change after creation'
);
select lives_ok(
  $$update public.campaigns set sent_count = 121, updated_at = pg_catalog.clock_timestamp() where code = 'open-day-2026'$$,
  'mutable campaign operations do not trip code immutability'
);
select throws_ok(
  $$insert into public.campaigns(code, name, channel) values ('UPPER-CODE', '대문자', 'direct')$$,
  '23514', null, 'campaign codes must already be lowercase normalized ASCII kebab-case'
);
select throws_ok(
  $$insert into public.campaigns(code, name, channel) values ('bad-channel', '잘못된 채널', 'email')$$,
  '23514', null, 'campaign channels are allow-listed'
);
select throws_ok(
  $$insert into public.campaigns(code, name, channel, starts_at, ends_at)
    values ('bad-dates', '잘못된 기간', 'social', '2026-08-01', '2026-07-01')$$,
  '23514', null, 'campaign end dates must follow start dates'
);
select throws_ok(
  $$insert into public.campaigns(code, name, channel, sent_count) values ('bad-count', '잘못된 발송 수', 'sms', -1)$$,
  '23514', null, 'campaign sent counts cannot be negative'
);

select lives_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '{"stage":"high3","region":"gwangju","track":"documentary","campaignId":1,"counselingStatus":"new","dateFrom":"2026-07-01","dateTo":"2026-07-15"}'::jsonb)$$,
  'an active administrator can create a bounded export audit'
);
select throws_ok(
  $$update public.export_jobs set filter_snapshot = '{}'::jsonb where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'P0001', 'EXPORT_FILTER_SNAPSHOT_IMMUTABLE', 'export filter snapshots cannot change'
);
select throws_ok(
  $$update public.export_jobs set created_by_admin_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'P0001', 'EXPORT_CREATOR_IMMUTABLE', 'export creators cannot change'
);
select throws_ok(
  $$update public.export_jobs set created_at = created_at + interval '1 second' where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'P0001', 'EXPORT_CREATED_AT_IMMUTABLE', 'export creation time cannot change'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}'::jsonb)$$,
  'P0001', 'EXPORT_ACTIVE_ADMIN_REQUIRED', 'inactive administrators cannot create export audits'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"phoneList":["01012345678"]}'::jsonb)$$,
  '23514', null, 'export snapshots reject phone lists and unknown keys'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"query":"010-1234-5678"}'::jsonb)$$,
  '23514', null, 'export snapshots reject raw phone searches'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"query":"010(1234)5678"}'::jsonb)$$,
  '23514', null, 'export snapshots reject parenthesized raw phones'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"query":"010/1234/5678"}'::jsonb)$$,
  '23514', null, 'export snapshots reject slash-separated raw phones'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"school":"010-1234-5678"}'::jsonb)$$,
  '23514', null, 'export snapshots reject phones disguised as school filters'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"dateFrom":"2026-02-30"}'::jsonb)$$,
  '23514', null, 'export snapshots reject impossible calendar dates'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"campaignId":9007199254740992}'::jsonb)$$,
  '23514', null, 'export snapshots reject campaign IDs outside JavaScript safe integer range'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot, status)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}'::jsonb, 'running')$$,
  'P0001', 'EXPORT_INITIAL_STATUS_INVALID', 'export status must begin at the allow-listed created state'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot, status, completed_at, error_code)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}'::jsonb, 'failed', pg_catalog.clock_timestamp(), 'EXPORT_FETCH_FAILED')$$,
  'P0001', 'EXPORT_INITIAL_STATUS_INVALID', 'export audits must begin in created state'
);
select throws_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot, student_row_count)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}'::jsonb, -1)$$,
  '23514', null, 'export sheet row counts cannot be negative'
);
select lives_ok(
  $$update public.export_jobs set status = 'fetching'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'an export moves from created to fetching'
);
select throws_ok(
  $$update public.export_jobs
    set status = 'failed', completed_at = created_at + interval '1 second', error_code = 'raw upstream message'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '23514', null, 'export failures retain only stable error codes'
);
select throws_ok(
  $$update public.export_jobs
    set status = 'failed', completed_at = created_at + interval '1 second', error_code = 'PHONE_01012345678'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '23514', null, 'export error codes use a finite allow-list without embedded identifiers'
);
select throws_ok(
  $$update public.export_jobs set status = 'completed'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '23514', null, 'completed exports require a completion timestamp'
);
select throws_ok(
  $$update public.export_jobs set status = 'failed', completed_at = created_at + interval '1 second'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '23514', null, 'failed exports require a stable error code'
);
select throws_ok(
  $$update public.export_jobs set status = 'created'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'P0001', 'EXPORT_STATUS_TRANSITION_INVALID', 'export lifecycle cannot regress'
);
select lives_ok(
  $$update public.export_jobs
    set status = 'completed', student_row_count = 3, participation_row_count = 5,
        counseling_row_count = 1, completed_at = created_at + interval '1 second'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'a completed export retains sheet counts and completion time'
);
select throws_ok(
  $$update public.export_jobs set downloaded_at = created_at where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '23514', null, 'download time cannot precede completion'
);
select throws_ok(
  $$update public.export_jobs set student_row_count = 4 where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'P0001', 'EXPORT_TERMINAL_AUDIT_IMMUTABLE', 'terminal export row counts cannot change'
);
select throws_ok(
  $$update public.export_jobs set completed_at = completed_at + interval '1 second' where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'P0001', 'EXPORT_TERMINAL_AUDIT_IMMUTABLE', 'terminal export completion time cannot change'
);
select lives_ok(
  $$update public.export_jobs set downloaded_at = completed_at + interval '1 second'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'a completed export records its first download time'
);
select throws_ok(
  $$update public.export_jobs set downloaded_at = downloaded_at + interval '1 second'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'P0001', 'EXPORT_DOWNLOAD_TIMESTAMP_IMMUTABLE', 'download time is recorded only once'
);

select lives_ok(
  $$insert into public.export_jobs(created_by_admin_id, filter_snapshot)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"region":"gwangju"}'::jsonb)$$,
  'a second export audit begins in created state'
);
select lives_ok(
  $$update public.export_jobs set status = 'fetching'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status = 'created'$$,
  'the second export enters fetching state'
);
select lives_ok(
  $$update public.export_jobs
    set status = 'failed', completed_at = created_at + interval '1 second', error_code = 'EXPORT_FETCH_FAILED'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status = 'fetching'$$,
  'a fetching export can fail with an allow-listed stable code'
);
select throws_ok(
  $$update public.export_jobs set error_code = 'EXPORT_INTERNAL_ERROR'
    where created_by_admin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status = 'failed'$$,
  'P0001', 'EXPORT_TERMINAL_AUDIT_IMMUTABLE', 'failed export facts cannot change'
);

select lives_ok(
  $$insert into public.events(anonymous_id, campaign_id, event_name, path)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select id from public.campaigns where code = 'open-day-2026'), 'landing_viewed', '/')$$,
  'events accept an existing campaign attribution'
);
select throws_ok(
  $$delete from public.campaigns where code = 'open-day-2026'$$,
  '23503', null, 'historical campaign attribution prevents physical deletion'
);
select throws_ok(
  $$insert into public.events(anonymous_id, campaign_id, event_name, path)
    values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 9223372036854775807, 'landing_viewed', '/')$$,
  '23503', null, 'events reject nonexistent campaign attribution'
);
select throws_ok(
  $$with prospect as (
      insert into public.prospects(
        nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region
      ) values (
        '캠페인외래키01', decode(repeat('11', 32), 'hex'), decode(repeat('22', 16), 'hex'),
        decode(repeat('33', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
      ) returning id
    )
    insert into public.assessments(
      prospect_id, campaign_id, idempotency_key, track_scores, environment_score, result_snapshot
    )
    select id, 9223372036854775807, pg_catalog.gen_random_uuid(),
      '{"documentary":0,"art_photo":0,"commercial":0,"video":0}'::jsonb,
      0, '{"fixture":true}'::jsonb
    from prospect$$,
  '23503', null, 'assessments reject nonexistent campaign attribution'
);

select is(
  (select count(*)::integer from public.export_jobs),
  2,
  'rejected export writes leave only the completed and failed audit rows'
);
select is(
  (select count(*)::integer from public.campaigns),
  1,
  'rejected campaign writes leave only the valid campaign'
);

select * from finish();

rollback;
