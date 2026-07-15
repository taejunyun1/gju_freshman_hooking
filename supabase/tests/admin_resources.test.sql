begin;

select plan(99);

create function pg_temp.capture_json(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  execute p_sql into v_result;
  return v_result;
exception when others then
  return pg_catalog.jsonb_build_object('threw', sqlstate || ':' || sqlerrm);
end;
$$;

create function pg_temp.transition_admin_resource_current(
  p_admin_user_id uuid,
  p_request_id uuid,
  p_resource_id bigint,
  p_status text
)
returns jsonb
language sql
as $$
  select public.transition_admin_resource(
    p_admin_user_id,
    coalesce(
      (select updated_at from public.resources where id = p_resource_id),
      pg_catalog.now()
    ),
    p_request_id,
    p_resource_id,
    p_status
  )
$$;

select ok(coalesce((select relrowsecurity from pg_catalog.pg_class where oid = 'public.resources'::regclass), false), 'resources keep RLS enabled');
select ok(coalesce((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.resources'::regclass), false), 'resources keep RLS forced');
select policies_are('public', 'resources', array[]::text[], 'resources remain default deny');
select policies_are('public', 'resource_tags', array[]::text[], 'resource tags remain default deny');
select policies_are('public', 'equipment_inventory_items', array[]::text[], 'inventory remains default deny');
select table_privs_are('public', 'resources', 'anon', array[]::text[], 'anonymous clients cannot access resources');
select table_privs_are('public', 'resources', 'authenticated', array[]::text[], 'authenticated clients cannot access resources directly');
select table_privs_are('public', 'resources', 'service_role', array['SELECT'], 'service role remains SELECT-only on resources');
select table_privs_are('public', 'resource_tags', 'service_role', array['SELECT'], 'service role remains SELECT-only on tags');
select table_privs_are('public', 'equipment_inventory_items', 'service_role', array['SELECT'], 'service role remains SELECT-only on inventory');

select has_function('public', 'create_admin_resource', array['uuid', 'uuid', 'jsonb', 'jsonb']);
select has_function('public', 'update_admin_resource', array['uuid', 'timestamptz', 'uuid', 'bigint', 'jsonb', 'jsonb']);
select has_function('public', 'transition_admin_resource', array['uuid', 'timestamptz', 'uuid', 'bigint', 'text']);
select hasnt_function('public', 'transition_admin_resource', array['uuid', 'uuid', 'bigint', 'text']);
select has_function('public', 'attach_admin_resource_image', array['uuid', 'timestamptz', 'text', 'uuid', 'bigint']);
select function_privs_are('public', 'create_admin_resource', array['uuid', 'uuid', 'jsonb', 'jsonb'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'update_admin_resource', array['uuid', 'timestamptz', 'uuid', 'bigint', 'jsonb', 'jsonb'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'transition_admin_resource', array['uuid', 'timestamptz', 'uuid', 'bigint', 'text'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'transition_admin_resource', array['uuid', 'timestamptz', 'uuid', 'bigint', 'text'], 'authenticated', array[]::text[]);
select function_privs_are('public', 'attach_admin_resource_image', array['uuid', 'timestamptz', 'text', 'uuid', 'bigint'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'create_admin_resource', array['uuid', 'uuid', 'jsonb', 'jsonb'], 'authenticated', array[]::text[]);

select lives_ok(
  $$insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    insert into public.admin_users(id, is_active) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false)$$,
  'administrator fixtures exist'
);

select throws_ok(
  $$select public.create_admin_resource(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '77777777-7777-4777-8777-777777777777',
      '{"type":"course","title":"무권한","summary":"설명","connectionTemplate":"연결","sourceDate":"2026-07-14","visibility":"public","priority":0,"metadata":{},"imagePath":null}',
      '[{"key":"photo","weight":3,"isPrimary":true}]'
    )$$,
  'P0001', 'ADMIN_REQUIRED', 'inactive administrators cannot mutate resources'
);

select lives_ok(
  $$select public.create_admin_resource(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '77777777-7777-4777-8777-777777777777',
      '{"type":"course","title":"관리 API 검증 교과","summary":"사진과 영상의 기초","connectionTemplate":"선택 관심을 교과와 연결합니다.","sourceDate":"2026-07-14","visibility":"public","priority":1,"metadata":{"academic_year":2026,"grade_year":1,"term":"1학기","credits":3,"goal":"기초 익히기"},"imagePath":null}',
      '[{"key":"photography","weight":3,"isPrimary":true}]'
    )$$,
  'active administrator can atomically create a draft and tags'
);

select is((select count(*)::integer from public.resources where title = '관리 API 검증 교과'), 1, 'resource was created once');
select is((select count(*)::integer from public.resource_tags where tag_key = 'photography' and resource_id = (select id from public.resources where title = '관리 API 검증 교과')), 1, 'tag was created in the same transaction');

select is(
  public.update_admin_resource(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.resources where title = '관리 API 검증 교과'),
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과'),
    '{"type":"course","title":"관리 API 검증 교과 수정","summary":"사진과 영상의 기초","connectionTemplate":"선택 관심을 교과와 연결합니다.","sourceDate":"2026-07-14","visibility":"public","priority":1,"metadata":{"academic_year":2026,"grade_year":1,"term":"1학기","credits":3,"goal":"기초 익히기"},"imagePath":null}',
    '[{"key":"photography","weight":3,"isPrimary":true}]'
  ) ->> 'status',
  'updated',
  'matching optimistic version updates resource and tags'
);

select is(
  public.update_admin_resource(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '2020-01-01T00:00:00Z',
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과 수정'),
    '{"type":"course","title":"오래된 쓰기","summary":"설명","connectionTemplate":"연결","sourceDate":"2026-07-14","visibility":"public","priority":0,"metadata":{},"imagePath":null}',
    '[{"key":"photo","weight":3,"isPrimary":true}]'
  ) ->> 'status',
  'conflict',
  'stale optimistic update returns a conflict signal without writing'
);

create temp table transition_stale_before as
select
  r.status,
  r.updated_at,
  (select count(*) from public.audit_events) as audit_count
from public.resources r
where r.title = '관리 API 검증 교과 수정';

select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.transition_admin_resource(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '2020-01-01T00:00:00Z',
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과 수정'),
    'active'
  ))$capture$) ->> 'status',
  'conflict',
  'stale publish returns a closed conflict outcome'
);
select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.transition_admin_resource(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '2020-01-01T00:00:00Z',
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과 수정'),
    'archived'
  ))$capture$) ->> 'status',
  'conflict',
  'stale archive returns a closed conflict outcome'
);
select is(
  (select pg_catalog.jsonb_build_object('status', status, 'updatedAt', updated_at)
   from public.resources where title = '관리 API 검증 교과 수정'),
  (select pg_catalog.jsonb_build_object('status', status, 'updatedAt', updated_at)
   from transition_stale_before),
  'stale transitions do not mutate the resource row'
);
select is(
  (select count(*) from public.audit_events),
  (select audit_count from transition_stale_before),
  'stale transitions do not write audit events'
);
select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.transition_admin_resource(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.resources where title = '관리 API 검증 교과 수정'),
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과 수정'),
    null::text
  ))$capture$) ->> 'code',
  'RESOURCE_INVALID',
  'null transition status returns a closed invalid outcome'
);
select is(
  (select pg_catalog.jsonb_build_object('status', status, 'updatedAt', updated_at)
   from public.resources where title = '관리 API 검증 교과 수정'),
  (select pg_catalog.jsonb_build_object('status', status, 'updatedAt', updated_at)
   from transition_stale_before),
  'null transition status does not mutate the resource row'
);
select is(
  (select count(*) from public.audit_events),
  (select audit_count from transition_stale_before),
  'null transition status does not write audit events'
);
select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.transition_admin_resource(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '2020-01-01T00:00:00Z',
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과 수정'),
    'active'
  ))$capture$) ->> 'resourceUpdatedAt',
  (select pg_catalog.to_jsonb(updated_at) #>> '{}' from public.resources where title = '관리 API 검증 교과 수정'),
  'conflict transition outcome includes the locked row version'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.transition_admin_resource(uuid,timestamptz,uuid,bigint,text)')),
    'for update'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.transition_admin_resource(uuid,timestamptz,uuid,bigint,text)')),
    'for update'
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.transition_admin_resource(uuid,timestamptz,uuid,bigint,text)')),
    'v_current.updated_at <> p_expected_updated_at'
  )
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.transition_admin_resource(uuid,timestamptz,uuid,bigint,text)')),
    'v_current.updated_at <> p_expected_updated_at'
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.transition_admin_resource(uuid,timestamptz,uuid,bigint,text)')),
    'if p_status = ''active'''
  ),
  'transition locks the parent then checks the optimistic version before publish validation'
);

create temp table transition_publish_outcome as
select pg_temp.transition_admin_resource_current(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과 수정'),
    'active'
  ) as outcome;

select is(
  (select outcome ->> 'status' from transition_publish_outcome),
  'updated',
  'validated resource can be published'
);
select is(
  (select outcome ->> 'resourceUpdatedAt' from transition_publish_outcome),
  (select pg_catalog.to_jsonb(updated_at) #>> '{}' from public.resources where title = '관리 API 검증 교과 수정'),
  'updated transition outcome includes the locked committed version'
);

select is((select status from public.resources where title = '관리 API 검증 교과 수정'), 'active', 'publish moves the row to active');
select is(
  (select metadata from public.audit_events where action = 'resource_published' order by id desc limit 1),
  '{"changedFields":["status"]}'::jsonb,
  'publish audit contains changed field names only'
);

select is(
  pg_temp.transition_admin_resource_current(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과 수정'),
    'archived'
  ) ->> 'status',
  'updated',
  'resource can be archived without deletion'
);
select is((select count(*)::integer from public.resources where title = '관리 API 검증 교과 수정'), 1, 'archive preserves the resource row');

select has_column('public', 'equipment_inventory_items', 'updated_at', 'inventory has an optimistic version column');
select has_function('public', 'update_admin_resource_inventory', array['uuid', 'timestamptz', 'bigint', 'bigint', 'uuid', 'jsonb']);
select function_privs_are(
  'public', 'update_admin_resource_inventory',
  array['uuid', 'timestamptz', 'bigint', 'bigint', 'uuid', 'jsonb'],
  'service_role', array['EXECUTE']
);
select function_privs_are(
  'public', 'update_admin_resource_inventory',
  array['uuid', 'timestamptz', 'bigint', 'bigint', 'uuid', 'jsonb'],
  'authenticated', array[]::text[]
);

select is(
  (select pg_catalog.jsonb_build_object(
    'name', name,
    'public', public,
    'fileSizeLimit', file_size_limit,
    'allowedMimeTypes', pg_catalog.to_jsonb(allowed_mime_types)
  ) from storage.buckets where id = 'resource-images'),
  '{"name":"resource-images","public":false,"fileSizeLimit":8388608,"allowedMimeTypes":["image/jpeg","image/png","image/webp"]}'::jsonb,
  'resource image bucket converges to the private bounded configuration'
);

select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_catalog.now(),
    '77777777-7777-4777-8777-777777777777', 9223372036854775807,
    '{"type":"course"}'::jsonb, '[]'::jsonb
  ))$capture$) ->> 'status',
  'not_found',
  'resource update returns a stable not-found outcome'
);
select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '77777777-7777-4777-8777-777777777777', 9223372036854775807, 'active'
  ))$capture$) ->> 'status',
  'not_found',
  'resource transition returns a stable not-found outcome'
);
select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.attach_admin_resource_image(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_catalog.now(), 'resources/42/image.webp',
    '77777777-7777-4777-8777-777777777777', 9223372036854775807
  ))$capture$) ->> 'status',
  'not_found',
  'image attach returns a stable not-found outcome'
);
select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2020-01-01T00:00:00Z',
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과 수정'),
    '{"type":"course"}'::jsonb, '[]'::jsonb
  ))$capture$) ->> 'status',
  'conflict',
  'resource update returns a stable optimistic conflict outcome'
);
select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.attach_admin_resource_image(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2020-01-01T00:00:00Z', 'resources/42/image.webp',
    '77777777-7777-4777-8777-777777777777',
    (select id from public.resources where title = '관리 API 검증 교과 수정')
  ))$capture$) ->> 'status',
  'conflict',
  'image attach returns a stable optimistic conflict outcome'
);

insert into public.resources(
  type, title, summary, connection_template, status, visibility, priority,
  source_date, metadata, image_path
) values
  ('course', 'SQL 엄격 교과', '설명', '연결', 'draft', 'public', 0, '2026-07-14',
    '{"academic_year":2026,"grade_year":1,"term":"1학기","credits":3,"goal":"기초 익히기"}', null),
  ('student_work', 'SQL 엄격 작품', '설명', '연결', 'draft', 'public', 0, '2026-07-14',
    '{"consent_at":"2026-07-14T01:00:00Z","image_alt":"작품 이미지","related_course":"기초사진","related_year":1,"related_track":"art_photo"}', 'resources/work.webp'),
  ('facility', 'SQL 엄격 시설', '설명', '연결', 'draft', 'public', 0, '2026-07-14',
    '{"location_label":"본관","operation_note":"예약 운영","activities":["촬영"],"last_verified_at":"2026-07-14T01:00:00Z"}', null),
  ('equipment', 'SQL 재고 기자재', '설명', '연결', 'draft', 'public', 0, '2026-07-14',
    '{"category":"camera","confirmedQuantity":999}', null);

insert into public.resource_tags(resource_id, tag_key, weight, is_primary)
select id, 'photography', 3, true
from public.resources where title in ('SQL 엄격 교과', 'SQL 엄격 작품', 'SQL 엄격 시설', 'SQL 재고 기자재');

insert into public.equipment_inventory_items(
  equipment_resource_id, inventory_code, source_row, location_key, access_mode,
  availability_state, note, data_quality_status, source_date
)
select id, 'CAM-001', 1, 'department_equipment_room', 'reservation',
  'available', null, 'verified', '2026-07-14'
from public.resources where title = 'SQL 재고 기자재';

update public.resources set metadata = metadata || '{"academic_year":2026.5}'::jsonb where title = 'SQL 엄격 교과';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 교과'), 'active'))$capture$) ->> 'code',
  'COURSE_METADATA_REQUIRED', 'course academic year must be an integer');
update public.resources set status = 'draft', metadata = metadata || '{"academic_year":2101}'::jsonb where title = 'SQL 엄격 교과';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 교과'), 'active'))$capture$) ->> 'code',
  'COURSE_METADATA_REQUIRED', 'course academic year stays in range');
update public.resources set status = 'draft', metadata = metadata || '{"academic_year":2026,"grade_year":1.5}'::jsonb where title = 'SQL 엄격 교과';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 교과'), 'active'))$capture$) ->> 'code',
  'COURSE_METADATA_REQUIRED', 'course grade must be an integer');
update public.resources set status = 'draft', metadata = metadata || '{"grade_year":5}'::jsonb where title = 'SQL 엄격 교과';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 교과'), 'active'))$capture$) ->> 'code',
  'COURSE_METADATA_REQUIRED', 'course grade stays in range');
update public.resources set status = 'draft', metadata = metadata || '{"grade_year":1,"credits":3.5}'::jsonb where title = 'SQL 엄격 교과';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 교과'), 'active'))$capture$) ->> 'code',
  'COURSE_METADATA_REQUIRED', 'course credits must be an integer');
update public.resources set status = 'draft', metadata = metadata || '{"credits":31}'::jsonb where title = 'SQL 엄격 교과';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 교과'), 'active'))$capture$) ->> 'code',
  'COURSE_METADATA_REQUIRED', 'course credits stay in range');
update public.resources set status = 'draft', metadata = metadata || '{"credits":3,"term":" 1학기"}'::jsonb where title = 'SQL 엄격 교과';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 교과'), 'active'))$capture$) ->> 'code',
  'COURSE_METADATA_REQUIRED', 'course term must already be trimmed');
update public.resources set status = 'draft', metadata = metadata || '{"term":"1학기","goal":"기초 익히기 "}'::jsonb where title = 'SQL 엄격 교과';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 교과'), 'active'))$capture$) ->> 'code',
  'COURSE_METADATA_REQUIRED', 'course goal must already be trimmed');

update public.resources set metadata = metadata || '{"consent_at":"2026-07-14"}'::jsonb where title = 'SQL 엄격 작품';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 작품'), 'active'))$capture$) ->> 'code',
  'WORK_CONSENT_REQUIRED', 'work consent requires a strict offset timestamp');
update public.resources set status = 'draft', metadata = metadata || '{"consent_at":"infinity"}'::jsonb where title = 'SQL 엄격 작품';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 작품'), 'active'))$capture$) ->> 'code',
  'WORK_CONSENT_REQUIRED', 'work consent rejects infinite timestamps');
update public.resources set status = 'draft', metadata = metadata || '{"consent_at":"2999-01-01T00:00:00Z"}'::jsonb where title = 'SQL 엄격 작품';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 작품'), 'active'))$capture$) ->> 'code',
  'WORK_CONSENT_REQUIRED', 'work consent cannot be in the future');
update public.resources set status = 'draft', metadata = metadata || '{"consent_at":"2026-07-14T01:00:00Z","image_alt":" 작품"}'::jsonb where title = 'SQL 엄격 작품';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 작품'), 'active'))$capture$) ->> 'code',
  'WORK_MEDIA_REQUIRED', 'work image alt must already be trimmed');
update public.resources set status = 'draft', metadata = metadata || '{"image_alt":"작품","related_course":"기초사진 "}'::jsonb where title = 'SQL 엄격 작품';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 작품'), 'active'))$capture$) ->> 'code',
  'WORK_RELATION_REQUIRED', 'work related course must already be trimmed');
update public.resources set status = 'draft', metadata = metadata || '{"related_course":"기초사진","related_year":1.5}'::jsonb where title = 'SQL 엄격 작품';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 작품'), 'active'))$capture$) ->> 'code',
  'WORK_RELATION_REQUIRED', 'work related year must be an integer');
update public.resources set status = 'draft', metadata = metadata || '{"related_year":1,"related_track":"Photo Track"}'::jsonb where title = 'SQL 엄격 작품';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 작품'), 'active'))$capture$) ->> 'code',
  'WORK_RELATION_REQUIRED', 'work track uses the stable key format');

update public.resources set metadata = metadata || '{"location_label":" 본관"}'::jsonb where title = 'SQL 엄격 시설';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 시설'), 'active'))$capture$) ->> 'code',
  'FACILITY_OPERATION_UNVERIFIED', 'facility location must already be trimmed');
update public.resources set status = 'draft', metadata = metadata || '{"location_label":"본관","operation_note":"예약 운영 "}'::jsonb where title = 'SQL 엄격 시설';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 시설'), 'active'))$capture$) ->> 'code',
  'FACILITY_OPERATION_UNVERIFIED', 'facility operation note must already be trimmed');
update public.resources set status = 'draft', metadata = metadata || '{"operation_note":"예약 운영","activities":[]}'::jsonb where title = 'SQL 엄격 시설';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 시설'), 'active'))$capture$) ->> 'code',
  'FACILITY_OPERATION_UNVERIFIED', 'facility requires at least one activity');
update public.resources set status = 'draft', metadata = metadata || '{"activities":[" 촬영"]}'::jsonb where title = 'SQL 엄격 시설';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 시설'), 'active'))$capture$) ->> 'code',
  'FACILITY_OPERATION_UNVERIFIED', 'facility activities must already be trimmed');
update public.resources set status = 'draft', metadata = metadata || '{"activities":["촬영"],"last_verified_at":"2026-07-14"}'::jsonb where title = 'SQL 엄격 시설';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 시설'), 'active'))$capture$) ->> 'code',
  'FACILITY_OPERATION_UNVERIFIED', 'facility verification requires a strict offset timestamp');
update public.resources set status = 'draft', metadata = metadata || '{"last_verified_at":"infinity"}'::jsonb where title = 'SQL 엄격 시설';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 시설'), 'active'))$capture$) ->> 'code',
  'FACILITY_OPERATION_UNVERIFIED', 'facility verification rejects infinite timestamps');
update public.resources set status = 'draft', metadata = metadata || '{"last_verified_at":"2999-01-01T00:00:00Z"}'::jsonb where title = 'SQL 엄격 시설';
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 엄격 시설'), 'active'))$capture$) ->> 'code',
  'FACILITY_OPERATION_UNVERIFIED', 'facility verification cannot be in the future');

select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(pg_temp.transition_admin_resource_current(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777',
  (select id from public.resources where title = 'SQL 재고 기자재'), 'active'))$capture$) ->> 'status',
  'updated', 'equipment publish returns the closed updated outcome');
select is((select metadata -> 'confirmedQuantity' from public.resources where title = 'SQL 재고 기자재'), '1'::jsonb,
  'equipment publish persists the canonical verified inventory count');
select ok(not (select metadata ? 'confirmed_quantity' from public.resources where title = 'SQL 재고 기자재'),
  'equipment publish removes the legacy snake-case quantity');

select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select updated_at from public.equipment_inventory_items where inventory_code = 'CAM-001'),
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-001'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-002","locationKey":"fantasy_lab","accessMode":"inquiry","availabilityState":"available","note":"점검 완료","dataQualityStatus":"verified"}'::jsonb
  ))$capture$) ->> 'status', 'updated', 'inventory update returns the closed updated outcome');
select is(
  (select pg_catalog.concat_ws(':', inventory_code, location_key, access_mode, availability_state, note, data_quality_status)
   from public.equipment_inventory_items where inventory_code = 'CAM-002'),
  'CAM-002:fantasy_lab:inquiry:available:점검 완료:verified',
  'inventory update writes every reviewed field'
);
select is(
  (select metadata from public.audit_events where action = 'equipment_inventory_code_changed' order by id desc limit 1),
  pg_catalog.jsonb_build_object(
    'previousCode', 'CAM-001', 'newCode', 'CAM-002',
    'itemId', (select id from public.equipment_inventory_items where inventory_code = 'CAM-002'),
    'resourceId', (select id from public.resources where title = 'SQL 재고 기자재')
  ),
  'inventory code audit includes only identifiers and the previous/new code'
);
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2020-01-01T00:00:00Z',
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-002'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-003","locationKey":"fantasy_lab","accessMode":"inquiry","availabilityState":"available","note":null,"dataQualityStatus":"verified"}'::jsonb
  ))$capture$) ->> 'status', 'conflict', 'stale inventory update returns a stable conflict outcome');
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2020-01-01T00:00:00Z',
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-002'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-003","locationKey":"fantasy_lab","accessMode":"inquiry","availabilityState":"available","note":null,"dataQualityStatus":"verified"}'::jsonb
  ))$capture$) -> 'current' ->> 'inventory_code', 'CAM-002', 'inventory conflict includes the strict current row');
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_catalog.now(),
  (select id from public.resources where title = 'SQL 재고 기자재'), 9223372036854775807,
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-003","locationKey":"fantasy_lab","accessMode":"inquiry","availabilityState":"available","note":null,"dataQualityStatus":"verified"}'::jsonb
  ))$capture$) ->> 'status', 'not_found', 'missing inventory update returns a stable not-found outcome');

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.update_admin_resource_inventory(uuid,timestamptz,bigint,bigint,uuid,jsonb)'::regprocedure),
    'from public.resources'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.update_admin_resource_inventory(uuid,timestamptz,bigint,bigint,uuid,jsonb)'::regprocedure),
    'from public.resources'
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.update_admin_resource_inventory(uuid,timestamptz,bigint,bigint,uuid,jsonb)'::regprocedure),
    'from public.equipment_inventory_items'
  ),
  'inventory mutation locks the parent resource before the inventory item'
);

create temp table inventory_invariant_before as
select
  r.updated_at as resource_updated_at,
  r.metadata as resource_metadata,
  i.updated_at as item_updated_at,
  (select count(*) from public.audit_events) as audit_count
from public.resources r
join public.equipment_inventory_items i on i.equipment_resource_id = r.id
where r.title = 'SQL 재고 기자재' and i.inventory_code = 'CAM-002';

select is(
  pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select updated_at from public.equipment_inventory_items where inventory_code = 'CAM-002'),
    (select id from public.resources where title = 'SQL 재고 기자재'),
    (select id from public.equipment_inventory_items where inventory_code = 'CAM-002'),
    '77777777-7777-4777-8777-777777777777',
    '{"inventoryCode":"CAM-REJECTED","locationKey":"fantasy_lab","accessMode":"inquiry","availabilityState":"available","note":null,"dataQualityStatus":"unidentified"}'::jsonb
  ))$capture$) ->> 'code',
  'EQUIPMENT_INVENTORY_UNVERIFIED',
  'active equipment rejects downgrading its last verified inventory item'
);
select is(
  (select pg_catalog.concat_ws(':', inventory_code, data_quality_status) from public.equipment_inventory_items
   where equipment_resource_id = (select id from public.resources where title = 'SQL 재고 기자재')),
  'CAM-002:verified',
  'last-verified rejection rolls back the inventory item mutation'
);
select is(
  (select pg_catalog.jsonb_build_object('updatedAt', updated_at, 'metadata', metadata)
   from public.resources where title = 'SQL 재고 기자재'),
  (select pg_catalog.jsonb_build_object('updatedAt', resource_updated_at, 'metadata', resource_metadata)
   from inventory_invariant_before),
  'last-verified rejection leaves parent quantity and version unchanged'
);
select is(
  (select count(*) from public.audit_events),
  (select audit_count from inventory_invariant_before),
  'last-verified rejection writes no audit event'
);

insert into public.equipment_inventory_items(
  equipment_resource_id, inventory_code, source_row, location_key, access_mode,
  availability_state, note, data_quality_status, source_date
)
select id, 'CAM-SECOND', 2, 'department_equipment_room', 'reservation',
  'available', null, 'unidentified', '2026-07-14'
from public.resources where title = 'SQL 재고 기자재';
create temp table inventory_success_before as
select updated_at from public.resources where title = 'SQL 재고 기자재';
create temp table inventory_success_outcome(value jsonb);
insert into inventory_success_outcome
select public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select updated_at from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-SECOND","locationKey":"department_equipment_room","accessMode":"reservation","availabilityState":"available","note":null,"dataQualityStatus":"verified"}'::jsonb
);
select is((select value ->> 'status' from inventory_success_outcome), 'updated',
  'active equipment can add another verified inventory item');
select is((select metadata -> 'confirmedQuantity' from public.resources where title = 'SQL 재고 기자재'), '2'::jsonb,
  'inventory mutation recomputes canonical verified quantity in the parent row');
select ok(
  (select updated_at from public.resources where title = 'SQL 재고 기자재')
    > (select updated_at from inventory_success_before)
  and (select value ->> 'resourceUpdatedAt' from inventory_success_outcome)::timestamptz
    = (select updated_at from public.resources where title = 'SQL 재고 기자재'),
  'inventory mutation advances and returns the committed parent version'
);

select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select updated_at from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":null,"locationKey":"department_equipment_room","accessMode":"reservation","availabilityState":"available","note":null,"dataQualityStatus":"verified"}'::jsonb
))$capture$) ->> 'code', 'RESOURCE_INVALID', 'inventory code requires a JSON string');
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select updated_at from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-SECOND","locationKey":null,"accessMode":"reservation","availabilityState":"available","note":null,"dataQualityStatus":"verified"}'::jsonb
))$capture$) ->> 'code', 'RESOURCE_INVALID', 'inventory location requires a JSON string');
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select updated_at from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-SECOND","locationKey":"department_equipment_room","accessMode":null,"availabilityState":"available","note":null,"dataQualityStatus":"verified"}'::jsonb
))$capture$) ->> 'code', 'RESOURCE_INVALID', 'inventory access requires a JSON string');
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select updated_at from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-SECOND","locationKey":"department_equipment_room","accessMode":"reservation","availabilityState":null,"note":null,"dataQualityStatus":"verified"}'::jsonb
))$capture$) ->> 'code', 'RESOURCE_INVALID', 'inventory availability requires a JSON string');
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select updated_at from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-SECOND","locationKey":"department_equipment_room","accessMode":"reservation","availabilityState":"available","note":null,"dataQualityStatus":null}'::jsonb
))$capture$) ->> 'code', 'RESOURCE_INVALID', 'inventory quality requires a JSON string');
select is(pg_temp.capture_json($capture$select pg_catalog.to_jsonb(public.update_admin_resource_inventory(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  (select updated_at from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  (select id from public.resources where title = 'SQL 재고 기자재'),
  (select id from public.equipment_inventory_items where inventory_code = 'CAM-SECOND'),
  '77777777-7777-4777-8777-777777777777',
  '{"inventoryCode":"CAM-SECOND","locationKey":"department_equipment_room","accessMode":"reservation","availabilityState":"available","note":42,"dataQualityStatus":"verified"}'::jsonb
))$capture$) ->> 'code', 'RESOURCE_INVALID', 'inventory note allows only a JSON string or null');

select throws_ok(
  $$set local role service_role;
    insert into public.resources(type, title, summary, connection_template, source_date)
    values ('course', '직접 쓰기', '설명', '연결', '2026-07-14')$$,
  '42501', null, 'service role still cannot bypass the RPC boundary with direct writes'
);

select * from finish();
rollback;
