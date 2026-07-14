begin;

select plan(66);

select has_table('public'::name, 'assessments'::name);
select has_table('public'::name, 'assessment_responses'::name);
select has_table('public'::name, 'resources'::name);
select has_table('public'::name, 'resource_tags'::name);
select has_table('public'::name, 'equipment_inventory_items'::name);
select has_table('public'::name, 'faculty'::name);
select has_table('public'::name, 'faculty_tags'::name);
select has_table('public'::name, 'faculty_specialist_links'::name);

select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'public'
     and column_name = 'id'
     and is_identity = 'YES'
     and table_name = any(array[
       'assessments', 'assessment_responses', 'resources', 'resource_tags',
       'equipment_inventory_items', 'faculty', 'faculty_tags', 'faculty_specialist_links'
     ])),
  8,
  'all result and matching tables use generated identity IDs'
);

select col_is_unique('public', 'assessments', array['public_id']);
select col_is_unique('public', 'assessments', array['prospect_id', 'idempotency_key']);
select col_is_unique('public', 'assessment_responses', array['assessment_id', 'question_group', 'option_key']);
select col_is_unique('public', 'resource_tags', array['resource_id', 'tag_key']);
select col_is_unique('public', 'faculty_tags', array['faculty_id', 'tag_key', 'category']);
select ok(
  exists (
    select 1
    from pg_catalog.pg_index
    where indexrelid = 'public.faculty_specialist_links_unique_idx'::regclass
      and indisunique
      and indnullsnotdistinct
  ),
  'specialist links treat null primary faculty IDs as equal for uniqueness'
);

select is(
  (select count(*)::integer
   from pg_catalog.pg_constraint
   where contype = 'f'
     and conrelid = any(array[
       'public.assessments'::regclass,
       'public.assessment_responses'::regclass,
       'public.resource_tags'::regclass,
       'public.equipment_inventory_items'::regclass,
       'public.faculty_tags'::regclass,
       'public.faculty_specialist_links'::regclass
     ])),
  7,
  'all seven declared result and matching relationships are foreign keys'
);

select is(
  (select count(*)::integer
   from pg_catalog.pg_constraint constraint_row
   join pg_catalog.pg_attribute attribute
     on attribute.attrelid = constraint_row.conrelid
    and attribute.attnum = any(constraint_row.conkey)
   where constraint_row.contype = 'f'
     and constraint_row.conrelid = any(array[
       'public.assessments'::regclass,
       'public.assessment_responses'::regclass,
       'public.resource_tags'::regclass,
       'public.equipment_inventory_items'::regclass,
       'public.faculty_tags'::regclass,
       'public.faculty_specialist_links'::regclass
     ])
     and not exists (
       select 1
       from pg_catalog.pg_index index_row
       where index_row.indrelid = constraint_row.conrelid
         and index_row.indisvalid
         and attribute.attnum = any(index_row.indkey)
     )),
  0,
  'every result and matching foreign-key column is indexed'
);

select is(
  (select count(*)::integer
   from pg_catalog.pg_class
   where oid = any(array[
     'public.assessments'::regclass, 'public.assessment_responses'::regclass,
     'public.resources'::regclass, 'public.resource_tags'::regclass,
     'public.equipment_inventory_items'::regclass, 'public.faculty'::regclass,
     'public.faculty_tags'::regclass, 'public.faculty_specialist_links'::regclass
   ]) and relrowsecurity),
  8,
  'RLS is enabled for every result and matching table'
);

select policies_are('public', 'assessments', array[]::text[]);
select policies_are('public', 'assessment_responses', array[]::text[]);
select policies_are('public', 'resources', array[]::text[]);
select policies_are('public', 'resource_tags', array[]::text[]);
select policies_are('public', 'equipment_inventory_items', array[]::text[]);
select policies_are('public', 'faculty', array[]::text[]);
select policies_are('public', 'faculty_tags', array[]::text[]);
select policies_are('public', 'faculty_specialist_links', array[]::text[]);

select is(
  (select count(*)::integer
   from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = any(array[
       'assessments', 'assessment_responses', 'resources', 'resource_tags',
       'equipment_inventory_items', 'faculty', 'faculty_tags', 'faculty_specialist_links'
     ])
     and grantee = any(array['PUBLIC', 'anon', 'authenticated'])),
  0,
  'browser and public roles have no table privileges'
);

select table_privs_are('public', 'assessments', 'service_role', array['SELECT']);
select table_privs_are('public', 'assessment_responses', 'service_role', array['SELECT']);
select table_privs_are('public', 'resources', 'service_role', array['SELECT']);
select table_privs_are('public', 'resource_tags', 'service_role', array['SELECT']);
select table_privs_are('public', 'equipment_inventory_items', 'service_role', array['SELECT']);
select table_privs_are('public', 'faculty', 'service_role', array['SELECT']);
select table_privs_are('public', 'faculty_tags', 'service_role', array['SELECT']);
select table_privs_are('public', 'faculty_specialist_links', 'service_role', array['SELECT']);

select is(
  (select count(*)::integer
   from pg_catalog.pg_class sequence
   cross join unnest(array['anon', 'authenticated', 'service_role']) role_name
   where sequence.relkind = 'S'
     and sequence.relname = any(array[
       'assessments_id_seq', 'assessment_responses_id_seq', 'resources_id_seq', 'resource_tags_id_seq',
       'equipment_inventory_items_id_seq', 'faculty_id_seq', 'faculty_tags_id_seq', 'faculty_specialist_links_id_seq'
     ])
     and (
       pg_catalog.has_sequence_privilege(role_name, sequence.oid, 'USAGE')
       or pg_catalog.has_sequence_privilege(role_name, sequence.oid, 'SELECT')
       or pg_catalog.has_sequence_privilege(role_name, sequence.oid, 'UPDATE')
     ))
   +
   (select count(*)::integer
    from pg_catalog.pg_class sequence
    cross join lateral pg_catalog.aclexplode(coalesce(sequence.relacl, '{}'::aclitem[])) privilege
    where sequence.relkind = 'S'
      and sequence.relname = any(array[
        'assessments_id_seq', 'assessment_responses_id_seq', 'resources_id_seq', 'resource_tags_id_seq',
        'equipment_inventory_items_id_seq', 'faculty_id_seq', 'faculty_tags_id_seq', 'faculty_specialist_links_id_seq'
      ])
      and privilege.grantee = 0),
  0,
  'no client or service role can consume result matching identities'
);

select is(
  (select count(*)::integer from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = any(array[
      'assessments_recent_completed_idx',
      'resources_matching_idx', 'resources_publishable_source_date_idx',
      'resource_tags_lookup_idx', 'equipment_inventory_resource_quality_idx',
      'equipment_inventory_code_idx', 'faculty_matching_idx', 'faculty_tags_lookup_idx',
      'faculty_specialist_links_lookup_idx', 'faculty_specialist_links_specialist_idx'
    ])),
  10,
  'all locked foreign-key and matching lookup indexes exist'
);

select is(
  (select count(*)::integer
   from pg_catalog.pg_index index_row
   join pg_catalog.pg_attribute attribute
     on attribute.attrelid = index_row.indrelid
    and attribute.attnum = any(index_row.indkey)
   where index_row.indrelid = 'public.equipment_inventory_items'::regclass
     and index_row.indisunique
     and attribute.attname = 'inventory_code'),
  0,
  'source inventory codes deliberately remain non-unique'
);

select ok(
  (select column_default::text like '%gen_random_uuid()%'
   from information_schema.columns
   where table_schema = 'public' and table_name = 'assessments' and column_name = 'public_id'),
  'assessment public IDs default to generated UUIDs'
);

insert into public.prospects (
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region
) values (
  'results-schema-fixture', decode(repeat('11', 32), 'hex'), decode(repeat('22', 16), 'hex'),
  decode(repeat('33', 12), 'hex'), '테스트고', 'high3', 'gwangju'
);

select throws_ok(
  $$insert into public.assessments(prospect_id, idempotency_key, track_scores, environment_score, result_snapshot)
    values ((select id from public.prospects where nickname = 'results-schema-fixture'), gen_random_uuid(),
      '{"documentary":10,"art_photo":20,"commercial":30}'::jsonb, 50, '{"version":1}'::jsonb)$$,
  '23514', null, 'track scores require the exact four-track manifest'
);
select throws_ok(
  $$insert into public.assessments(prospect_id, idempotency_key, track_scores, environment_score, result_snapshot)
    values ((select id from public.prospects where nickname = 'results-schema-fixture'), gen_random_uuid(),
      '{"documentary":10,"art_photo":101,"commercial":30,"video":40}'::jsonb, 50, '{"version":1}'::jsonb)$$,
  '23514', null, 'track scores stay in the zero-to-one-hundred range'
);
select throws_ok(
  $$insert into public.assessments(prospect_id, idempotency_key, track_scores, environment_score, result_snapshot)
    values ((select id from public.prospects where nickname = 'results-schema-fixture'), gen_random_uuid(),
      '{"documentary":10,"art_photo":20,"commercial":30,"video":40}'::jsonb, 50, '{}'::jsonb)$$,
  '23514', null, 'result snapshots cannot be empty'
);
select throws_ok(
  $$insert into public.assessments(prospect_id, idempotency_key, track_scores, environment_score, result_snapshot)
    values ((select id from public.prospects where nickname = 'results-schema-fixture'), gen_random_uuid(),
      '{"documentary":10,"art_photo":20,"commercial":30,"video":40}'::jsonb, 50,
      jsonb_build_object('payload', repeat('x', 262145)))$$,
  '23514', null, 'result snapshots have a bounded serialized size'
);
select lives_ok(
  $$insert into public.assessments(prospect_id, idempotency_key, track_scores, environment_score, result_snapshot)
    values ((select id from public.prospects where nickname = 'results-schema-fixture'),
      '11111111-1111-4111-8111-111111111111',
      '{"documentary":10,"art_photo":90,"commercial":30,"video":40}'::jsonb, 75, '{"version":1}'::jsonb)$$,
  'a valid completed assessment is accepted'
);

select throws_ok(
  $$insert into public.assessment_responses(assessment_id, question_group, option_key, option_label_snapshot, weight_snapshot)
    values ((select id from public.assessments where idempotency_key = '11111111-1111-4111-8111-111111111111'),
      'work', 'career.artist', '잘못된 키', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}')$$,
  '23514', null, 'response keys must match their group prefix'
);
select throws_ok(
  $$insert into public.assessment_responses(assessment_id, question_group, option_key, option_label_snapshot, weight_snapshot)
    values ((select id from public.assessments where idempotency_key = '11111111-1111-4111-8111-111111111111'),
      'work', 'work.' || repeat('a', 1000), '과도하게 긴 키', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}')$$,
  '23514', null, 'response option keys have a bounded serialized length'
);
select throws_ok(
  $$insert into public.assessment_responses(assessment_id, question_group, option_key, option_label_snapshot, weight_snapshot, free_text)
    values ((select id from public.assessments where idempotency_key = '11111111-1111-4111-8111-111111111111'),
      'career', 'career.artist', '사진작가', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}', '다른 관심')$$,
  '23514', null, 'free text is reserved for the explore option'
);
select throws_ok(
  $$insert into public.assessment_responses(assessment_id, question_group, option_key, option_label_snapshot, weight_snapshot, free_text)
    values ((select id from public.assessments where idempotency_key = '11111111-1111-4111-8111-111111111111'),
      'career', 'career.explore', '가능성 탐색', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}', '010-1234-5678')$$,
  '23514', null, 'free text rejects phone numbers'
);
select throws_ok(
  $$insert into public.assessment_responses(assessment_id, question_group, option_key, option_label_snapshot, weight_snapshot, free_text)
    values ((select id from public.assessments where idempotency_key = '11111111-1111-4111-8111-111111111111'),
      'career', 'career.explore', '가능성 탐색', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}', 'test@example.com')$$,
  '23514', null, 'free text rejects email addresses'
);
select throws_ok(
  $$insert into public.assessment_responses(assessment_id, question_group, option_key, option_label_snapshot, weight_snapshot, free_text)
    values ((select id from public.assessments where idempotency_key = '11111111-1111-4111-8111-111111111111'),
      'career', 'career.explore', '가능성 탐색', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}', E'관심\n분야')$$,
  '23514', null, 'free text rejects control characters'
);
select lives_ok(
  $$insert into public.assessment_responses(assessment_id, question_group, option_key, option_label_snapshot, weight_snapshot, free_text)
    values ((select id from public.assessments where idempotency_key = '11111111-1111-4111-8111-111111111111'),
      'career', 'career.explore', '가능성 탐색', '{"documentary":1,"art_photo":1,"commercial":1,"video":1}', '미디어 설치')$$,
  'a valid snapshot response is accepted'
);

select throws_ok(
  $$insert into public.resources(type, title, summary, connection_template, source_date) values ('other', '잘못된 자료', '설명', '템플릿', '2026-07-14')$$,
  '23514', null, 'resource types are allow-listed'
);
select throws_ok(
  $$insert into public.resources(type, title, summary, connection_template, status, visibility, source_date) values ('course', '수업', '설명', '템플릿', 'active', 'anonymous', '2026-07-14')$$,
  '23514', null, 'resource visibility is allow-listed'
);
select throws_ok(
  $$insert into public.resources(type, title, summary, connection_template, source_date, metadata) values ('course', '수업', '설명', '템플릿', '2026-07-14', '[]')$$,
  '23514', null, 'resource metadata must be an object'
);
select throws_ok(
  $$insert into public.resources(type, title, summary, connection_template, source_date, image_path) values ('student_work', '작품', '설명', '템플릿', '2026-07-14', '../private.webp')$$,
  '23514', null, 'resource image paths reject traversal'
);
select throws_ok(
  $$insert into public.resources(type, title, summary, connection_template, source_date, metadata) values ('course', '수업', '설명', '템플릿', '2026-07-14', jsonb_build_object('payload', repeat('x', 32769)))$$,
  '23514', null, 'resource metadata has a bounded serialized size'
);

select lives_ok($fixture$
  insert into public.resources(type, title, summary, connection_template, status, visibility, priority, source_date, metadata)
  values ('equipment', '미러리스 카메라', '실습 장비', '선택한 관심사를 촬영으로 연결합니다.', 'active', 'public', 10, '2026-07-14', '{"location":"department_equipment_room"}');
  insert into public.resource_tags(resource_id, tag_key, weight, is_primary)
  values ((select id from public.resources where title = '미러리스 카메라'), 'art_photo', 3, true);
  insert into public.equipment_inventory_items(equipment_resource_id, inventory_code, location_key, access_mode, availability_state, data_quality_status, source_row, source_date)
  values
    ((select id from public.resources where title = '미러리스 카메라'), 'CAM-001', 'department_equipment_room', 'reservation', 'available', 'verified', 1, '2026-07-14'),
    ((select id from public.resources where title = '미러리스 카메라'), 'CAM-001', 'department_equipment_room', 'reservation', 'unknown', 'duplicate_code', 2, '2026-07-14');
  insert into public.faculty(name, title, employment_type, consultation_role, status, expertise_summary, bio, contact_visibility, source_date, priority)
  values
    ('전임 교수', '교수', 'full_time', 'primary', 'active', '예술사진', '학생의 학습경로를 총괄합니다.', '{"office":"public","phone":"hidden","email":"public","website":"public"}', '2026-07-14', 10),
    ('전문 교수', '겸임교수', 'adjunct', 'specialist', 'active', '전시기획', '전시 실무를 연계합니다.', '{"office":"hidden","phone":"hidden","email":"public","website":"hidden"}', '2026-07-14', 5);
  insert into public.faculty_tags(faculty_id, tag_key, tag_label, category, weight)
  values ((select id from public.faculty where name = '전임 교수'), 'art_photo', '예술사진', 'track', 3);
  insert into public.faculty_specialist_links(primary_faculty_id, specialist_faculty_id, tag_key, priority, explanation_template)
  values (null, (select id from public.faculty where name = '전문 교수'), 'curating', 1, '전시기획 실무 연계');
$fixture$, 'valid matching records and duplicate source inventory codes are accepted');

select throws_ok(
  $$insert into public.resource_tags(resource_id, tag_key, weight) values ((select id from public.resources where title = '미러리스 카메라'), 'bad_weight', 4)$$,
  '23514', null, 'resource tag weights stay between zero and three'
);
select throws_ok(
  $$insert into public.equipment_inventory_items(equipment_resource_id, inventory_code, location_key, access_mode, availability_state, data_quality_status, source_row, source_date)
    values ((select id from public.resources where title = '미러리스 카메라'), 'BAD-001', 'fantasy_lab', 'inquiry', 'unknown', 'invented', 3, '2026-07-14')$$,
  '23514', null, 'inventory quality states are allow-listed'
);
select throws_ok(
  $$insert into public.faculty(name, title, employment_type, consultation_role, expertise_summary, bio, contact_visibility, source_date)
    values ('연락처 오류', '교수', 'full_time', 'primary', '사진', '소개', '{"email":"public"}', '2026-07-14')$$,
  '23514', null, 'faculty contact visibility requires the exact field manifest'
);
select throws_ok(
  $$insert into public.faculty(name, title, employment_type, consultation_role, expertise_summary, bio, contact_visibility, source_date, weekly_capacity)
    values ('정원 오류', '교수', 'full_time', 'primary', '사진', '소개', '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}', '2026-07-14', -1)$$,
  '23514', null, 'faculty consultation capacity cannot be negative'
);
select throws_ok(
  $$insert into public.faculty_tags(faculty_id, tag_key, tag_label, category, weight)
    values ((select id from public.faculty where name = '전임 교수'), 'bad_category', '잘못된 분류', 'unknown', 1)$$,
  '23514', null, 'faculty tag categories are allow-listed'
);
select throws_ok(
  $$insert into public.faculty_specialist_links(primary_faculty_id, specialist_faculty_id, tag_key, priority, explanation_template)
    values ((select id from public.faculty where name = '전임 교수'), (select id from public.faculty where name = '전임 교수'), 'self', 1, '잘못된 연결')$$,
  '23514', null, 'faculty links cannot point to the same person'
);
select throws_ok(
  $$insert into public.faculty_specialist_links(primary_faculty_id, specialist_faculty_id, tag_key, priority, explanation_template)
    values (null, (select id from public.faculty where name = '전문 교수'), 'curating', 2, '중복 연결')$$,
  '23505', null, 'null-primary specialist links are still unique'
);
select throws_ok(
  $$set local role service_role;
    insert into public.resources(type, title, summary, connection_template, source_date)
    values ('course', '서비스 쓰기', '설명', '템플릿', '2026-07-14')$$,
  '42501', null, 'service role cannot write result matching data'
);

select is(
  (select count(*)::integer
   from unnest(array[
     'public.is_valid_result_track_scores(jsonb)'::regprocedure,
     'public.is_valid_bounded_json_object(jsonb,integer)'::regprocedure,
     'public.is_safe_relative_asset_path(text)'::regprocedure,
     'public.is_valid_faculty_contact_visibility(jsonb)'::regprocedure
   ]) procedure_oid
   cross join unnest(array['anon', 'authenticated', 'service_role']) role_name
   where pg_catalog.has_function_privilege(role_name, procedure_oid, 'EXECUTE'))
  +
  (select count(*)::integer
   from unnest(array[
     'public.is_valid_result_track_scores(jsonb)'::regprocedure,
     'public.is_valid_bounded_json_object(jsonb,integer)'::regprocedure,
     'public.is_safe_relative_asset_path(text)'::regprocedure,
     'public.is_valid_faculty_contact_visibility(jsonb)'::regprocedure
   ]) procedure_oid
   join pg_catalog.pg_proc procedure on procedure.oid = procedure_oid
   cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, '{}'::aclitem[])) privilege
   where privilege.grantee = 0),
  0,
  'validation helpers are not executable by client or service roles'
);

select * from finish();

rollback;
