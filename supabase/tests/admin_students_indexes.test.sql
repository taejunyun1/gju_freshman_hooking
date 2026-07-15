begin;

select plan(31);

select is(
  pg_catalog.pg_get_indexdef(
    pg_catalog.to_regclass('public.prospects_active_last_active_idx')
  ),
  'CREATE INDEX prospects_active_last_active_idx ON public.prospects USING btree (last_active_at DESC, id DESC) WHERE (status = ''active''::text)',
  'active prospects use the exact last-active keyset index'
);

select ok(
  coalesce((
    select index_row.indisvalid and index_row.indisready
    from pg_catalog.pg_index index_row
    where index_row.indexrelid = pg_catalog.to_regclass('public.prospects_active_last_active_idx')
  ), false),
  'the active prospect keyset index is valid and ready'
);

select is(
  pg_catalog.pg_get_indexdef(
    pg_catalog.to_regclass('public.assessments_admin_prospect_primary_track_completed_idx')
  ),
  'CREATE INDEX assessments_admin_prospect_primary_track_completed_idx ON public.assessments USING btree (prospect_id, ((result_snapshot #>> ''{rankedTracks,0}''::text[])), completed_at DESC, id DESC) WHERE (status = ''completed''::text)',
  'completed assessments use the exact prospect-leading primary-track index'
);

select ok(
  coalesce((
    select index_row.indisvalid and index_row.indisready
    from pg_catalog.pg_index index_row
    where index_row.indexrelid = pg_catalog.to_regclass('public.assessments_admin_prospect_primary_track_completed_idx')
  ), false),
  'the assessment filter index is valid and ready'
);

select is(
  pg_catalog.pg_get_indexdef(
    pg_catalog.to_regclass('public.counseling_requests_admin_prospect_status_created_idx')
  ),
  'CREATE INDEX counseling_requests_admin_prospect_status_created_idx ON public.counseling_requests USING btree (prospect_id, status, created_at DESC, id DESC)',
  'counseling history uses the exact prospect-leading status and date index'
);

select ok(
  coalesce((
    select index_row.indisvalid and index_row.indisready
    from pg_catalog.pg_index index_row
    where index_row.indexrelid = pg_catalog.to_regclass('public.counseling_requests_admin_prospect_status_created_idx')
  ), false),
  'the counseling filter index is valid and ready'
);

select is(
  (select pg_catalog.count(*)::integer
   from pg_catalog.pg_index index_row
   join pg_catalog.pg_attribute attribute
     on attribute.attrelid = index_row.indrelid
    and attribute.attnum = index_row.indkey[0]
   where index_row.indrelid = 'public.assessments'::regclass
     and attribute.attname = 'campaign_id'),
  1,
  'the existing campaign-leading assessment index is not duplicated'
);

select is(
  pg_catalog.pg_get_indexdef(
    pg_catalog.to_regclass('public.assessments_campaign_created_idx')
  ),
  'CREATE INDEX assessments_campaign_created_idx ON public.assessments USING btree (campaign_id, completed_at DESC, id DESC) WHERE (campaign_id IS NOT NULL)',
  'the existing campaign filter index remains unchanged'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pg_trgm'
  ),
  'student filters do not install pg_trgm'
);

select is(
  (select pg_catalog.count(*)::integer
   from unnest(array[
     'public.prospects'::regclass,
     'public.assessments'::regclass,
     'public.counseling_requests'::regclass
   ]) relation_oid
   join pg_catalog.pg_class relation on relation.oid = relation_oid
   where relation.relrowsecurity),
  3,
  'all indexed student tables retain row level security'
);

select policies_are('public', 'prospects', array[]::text[], 'prospects remain default deny');
select policies_are('public', 'assessments', array[]::text[], 'assessments remain default deny');
select policies_are('public', 'counseling_requests', array[]::text[], 'counseling requests remain default deny');

select is(
  (select pg_catalog.count(*)::integer
   from information_schema.role_table_grants privilege
   where privilege.table_schema = 'public'
     and privilege.table_name = any(array['prospects', 'assessments', 'counseling_requests'])
     and privilege.grantee = any(array['PUBLIC', 'anon', 'authenticated'])),
  0,
  'index migration grants no student table privileges to client roles'
);

select has_function(
  'public',
  'record_student_sensitive_access',
  array['bigint', 'text', 'uuid', 'uuid'],
  'student sensitive access audit function exists'
);

select ok(
  coalesce((
    select function_row.prosecdef
    from pg_catalog.pg_proc function_row
    where function_row.oid = 'public.record_student_sensitive_access(bigint,text,uuid,uuid)'::regprocedure
  ), false),
  'student sensitive access audit is security definer'
);

select function_privs_are(
  'public', 'record_student_sensitive_access', array['bigint', 'text', 'uuid', 'uuid'],
  'public', array[]::text[], 'public cannot execute student sensitive access audit'
);
select function_privs_are(
  'public', 'record_student_sensitive_access', array['bigint', 'text', 'uuid', 'uuid'],
  'anon', array[]::text[], 'anonymous clients cannot execute student sensitive access audit'
);
select function_privs_are(
  'public', 'record_student_sensitive_access', array['bigint', 'text', 'uuid', 'uuid'],
  'authenticated', array[]::text[], 'authenticated clients cannot execute student sensitive access audit'
);
select function_privs_are(
  'public', 'record_student_sensitive_access', array['bigint', 'text', 'uuid', 'uuid'],
  'service_role', array['EXECUTE'], 'server can execute student sensitive access audit'
);

select lives_ok(
  $$insert into auth.users(id) values
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    insert into public.admin_users(id, is_active) values
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', false);
    insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region
    ) values (
      '감사기록학생', decode(repeat('11', 32), 'hex'), decode(repeat('22', 16), 'hex'),
      decode(repeat('33', 12), 'hex'), '광주고등학교', 'high3', 'gwangju'
    )$$,
  'student audit fixtures exist'
);

select is(
  public.record_student_sensitive_access(
    (select id from public.prospects where nickname = '감사기록학생'),
    'admin_phone_revealed',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  ),
  true,
  'active recent administrator audit call succeeds'
);

select is(
  (select count(*)::integer from public.audit_events
   where action = 'admin_phone_revealed'
     and admin_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  1,
  'phone reveal creates exactly one administrator audit event'
);

select is(
  (select target_type || ':' || target_id || ':' || metadata::text || ':' || request_id::text
   from public.audit_events
   where action = 'admin_phone_revealed'
     and admin_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'prospect:' || (select id::text from public.prospects where nickname = '감사기록학생')
    || ':{}:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'audit target and metadata contain no phone material'
);

select is(
  (select count(*)::integer from public.events
   where event_name = 'admin_phone_revealed'
     and prospect_id = (select id from public.prospects where nickname = '감사기록학생')
     and path = '/api/admin/students/' || prospect_id::text || '/reveal-phone'),
  1,
  'phone reveal creates one student-scoped analytics event'
);

select is(
  (select properties
   from public.events
   where event_name = 'admin_phone_revealed'
     and prospect_id = (select id from public.prospects where nickname = '감사기록학생')),
  pg_catalog.jsonb_build_object(
    'student_id', (select id from public.prospects where nickname = '감사기록학생'),
    'request_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
  ),
  'analytics properties contain only bounded identifiers'
);

select throws_ok(
  $$select public.record_student_sensitive_access(
      (select id from public.prospects where nickname = '감사기록학생'),
      'summary',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )$$,
  '22023', 'invalid student sensitive access action',
  'unknown sensitive access actions are rejected'
);

select throws_ok(
  $$select public.record_student_sensitive_access(
      (select id from public.prospects where nickname = '감사기록학생'),
      'admin_phone_revealed',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )$$,
  '22023', 'active student administrator is required',
  'inactive administrators cannot create a sensitive access audit'
);

select throws_ok(
  $$select public.record_student_sensitive_access(
      9007199254740991,
      'admin_phone_revealed',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )$$,
  'P0002', 'active student not found',
  'unknown students cannot create a sensitive access audit'
);

select lives_ok(
  $$update public.prospects set status = 'deleted'
    where nickname = '감사기록학생'$$,
  'student fixture can be marked deleted'
);

select throws_ok(
  $$select public.record_student_sensitive_access(
      (select id from public.prospects where nickname = '감사기록학생'),
      'admin_phone_revealed',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )$$,
  'P0002', 'active student not found',
  'deleted students cannot create a sensitive access audit'
);

select * from finish();

rollback;
