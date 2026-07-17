begin;

create function pg_temp.safe_schema_count(p_sql text)
returns integer
language plpgsql
as $function$
declare
  v_count integer;
begin
  execute p_sql into v_count;
  return v_count;
exception
  when undefined_table or undefined_column then
    return null;
end;
$function$;

select plan(64);

select has_table('public', 'admission_cycles', 'admission cycles exist');
select col_type_is('public', 'admission_cycles', 'id', 'uuid', 'cycle IDs are UUIDs supplied by the Worker');
select col_is_pk('public', 'admission_cycles', 'id', 'cycle IDs are the primary key');
select col_type_is('public', 'admission_cycles', 'year', 'integer', 'cycle year is an integer');
select col_not_null('public', 'admission_cycles', 'year', 'cycle year is required');
select col_is_unique('public', 'admission_cycles', 'year', 'cycle year is unique');
select col_not_null('public', 'admission_cycles', 'status', 'cycle status is required');
select col_not_null('public', 'admission_cycles', 'roster_version', 'roster version is required');
select col_default_is('public', 'admission_cycles', 'roster_version', '0', 'roster version starts at zero');
select col_not_null('public', 'admission_cycles', 'password_key_version', 'password key version is required');
select col_not_null('public', 'admission_cycles', 'created_at', 'cycle creation time is required');
select col_is_null('public', 'admission_cycles', 'archived_at', 'cycle archive time is nullable');
select has_index(
  'public',
  'admission_cycles',
  'admission_cycles_one_current_idx',
  'only one current admission cycle can exist'
);
select ok(
  (select relrowsecurity
   from pg_catalog.pg_class
   where oid = pg_catalog.to_regclass('public.admission_cycles')),
  'admission cycles have RLS enabled'
);
select policies_are('public', 'admission_cycles', array[]::text[], 'admission cycles have no direct client policy');
select is(
  (select count(*)::integer
   from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'admission_cycles'
     and grantee = any(array['PUBLIC', 'anon', 'authenticated'])),
  0,
  'public and browser roles have no admission-cycle table privileges'
);

select is(
  pg_temp.safe_schema_count(
    $sql$select count(*)::integer from public.admission_cycles where status = 'archived'$sql$
  ),
  1,
  'the expand migration creates exactly one archived legacy cycle'
);
select is(
  pg_temp.safe_schema_count(
    $sql$select count(*)::integer from public.admission_cycles where status = 'current'$sql$
  ),
  0,
  'the expand migration does not create a current cycle'
);
select is(
  pg_temp.safe_schema_count(
    $sql$select count(*)::integer
      from public.admission_cycles
      where status = 'archived'
        and archived_at is not null$sql$
  ),
  1,
  'the legacy cycle records its archive time'
);
select is(
  pg_temp.safe_schema_count(
    $sql$select count(*)::integer
      from public.prospects prospect
      left join public.admission_cycles cycle on cycle.id = prospect.admission_cycle_id
      where cycle.id is null$sql$
  ),
  0,
  'all prospects present at reset belong to a cycle'
);
select is(
  (select count(*)::integer from public.student_sessions where revoked_at is null),
  0,
  'no pre-expand session remains active'
);

select lives_ok(
  $$insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
    values ('10000000-0000-4000-8000-000000000001', 2026, 'archived', 0, 1)$$,
  'a valid archived cycle can be inserted'
);
select throws_ok(
  $$insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
    values ('10000000-0000-4000-8000-000000000002', 2019, 'archived', 0, 1)$$,
  '23514',
  null,
  'cycle years before 2020 are rejected'
);
select throws_ok(
  $$insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
    values ('10000000-0000-4000-8000-000000000003', 2027, 'planned', 0, 1)$$,
  '23514',
  null,
  'unknown cycle statuses are rejected'
);
select throws_ok(
  $$insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
    values ('10000000-0000-4000-8000-000000000004', 2028, 'archived', -1, 1)$$,
  '23514',
  null,
  'negative roster versions are rejected'
);
select throws_ok(
  $$insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
    values ('10000000-0000-4000-8000-000000000005', 2029, 'current', 0, 0)$$,
  '23514',
  null,
  'password key versions must be positive'
);
select lives_ok(
  $$insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
    values ('10000000-0000-4000-8000-000000000006', 2030, 'current', 0, 1)$$,
  'one valid current cycle can be inserted'
);
select throws_ok(
  $$insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
    values ('10000000-0000-4000-8000-000000000007', 2031, 'current', 0, 1)$$,
  '23505',
  null,
  'a second current cycle is rejected'
);

select col_type_is('public', 'prospects', 'admission_cycle_id', 'uuid', 'prospects reference admission cycles by UUID');
select col_is_null('public', 'prospects', 'admission_cycle_id', 'cycle assignment remains nullable during expand');
select fk_ok(
  'public', 'prospects', 'admission_cycle_id',
  'public', 'admission_cycles', 'id',
  'prospect cycle assignments are foreign keys'
);
select col_type_is('public', 'prospects', 'name_hmac', 'bytea', 'normalized-name HMAC is binary');
select col_is_null('public', 'prospects', 'name_hmac', 'name HMAC remains nullable during expand');
select col_type_is('public', 'prospects', 'name_ciphertext', 'bytea', 'encrypted names are binary');
select col_is_null('public', 'prospects', 'name_ciphertext', 'encrypted names remain nullable during expand');
select col_type_is('public', 'prospects', 'name_iv', 'bytea', 'name IVs are binary');
select col_is_null('public', 'prospects', 'name_iv', 'name IVs remain nullable during expand');
select col_type_is('public', 'prospects', 'is_test', 'boolean', 'test-roster membership is boolean');
select col_not_null('public', 'prospects', 'is_test', 'test-roster membership is always known');
select col_default_is('public', 'prospects', 'is_test', 'false', 'ordinary prospects are not tests by default');
select col_is_unique('public', 'prospects', 'phone_hmac', 'global phone uniqueness remains during expand');

select lives_ok(
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region, status
    ) values (
      '확장비활성', decode(repeat('11', 32), 'hex'), decode(repeat('12', 16), 'hex'), decode(repeat('13', 12), 'hex'),
      '확장고등학교', 'high3', 'gwangju', 'inactive'
    )$$,
  'prospect status accepts inactive'
);
select lives_ok(
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region, admission_cycle_id,
      name_hmac, name_ciphertext, name_iv
    ) values (
      '확장이름', decode(repeat('21', 32), 'hex'), decode(repeat('22', 16), 'hex'), decode(repeat('23', 12), 'hex'),
      '확장고등학교', 'high3', 'gwangju', '10000000-0000-4000-8000-000000000001',
      decode(repeat('24', 32), 'hex'), decode(repeat('25', 16), 'hex'), decode(repeat('26', 12), 'hex')
    )$$,
  'valid encrypted name material is accepted'
);
select throws_ok(
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region, name_hmac
    ) values (
      '잘못된이름HMAC', decode(repeat('31', 32), 'hex'), decode(repeat('32', 16), 'hex'), decode(repeat('33', 12), 'hex'),
      '확장고등학교', 'high3', 'gwangju', decode(repeat('34', 31), 'hex')
    )$$,
  '23514',
  null,
  'name HMACs must be exactly 32 bytes'
);
select throws_ok(
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region, name_ciphertext
    ) values (
      '잘못된이름암호문', decode(repeat('41', 32), 'hex'), decode(repeat('42', 16), 'hex'), decode(repeat('43', 12), 'hex'),
      '확장고등학교', 'high3', 'gwangju', decode(repeat('44', 15), 'hex')
    )$$,
  '23514',
  null,
  'name ciphertext must be at least 16 bytes'
);
select throws_ok(
  $$insert into public.prospects(
      nickname, phone_hmac, phone_ciphertext, phone_iv,
      school_name, applicant_stage, region, name_iv
    ) values (
      '잘못된이름IV', decode(repeat('51', 32), 'hex'), decode(repeat('52', 16), 'hex'), decode(repeat('53', 12), 'hex'),
      '확장고등학교', 'high3', 'gwangju', decode(repeat('54', 11), 'hex')
    )$$,
  '23514',
  null,
  'name IVs must be exactly 12 bytes'
);

select col_type_is('public', 'student_credentials', 'password_bcrypt', 'text', 'bcrypt digests are text');
select col_is_null('public', 'student_credentials', 'password_bcrypt', 'bcrypt remains nullable during expand');
select col_type_is('public', 'student_credentials', 'password_generation', 'integer', 'password generation is an integer');
select col_is_null('public', 'student_credentials', 'password_generation', 'password generation remains nullable during expand');
select lives_ok(
  $$insert into public.student_credentials(
      prospect_id, password_hash, password_salt, password_bcrypt, password_generation
    )
    select id, decode(repeat('61', 32), 'hex'), decode(repeat('62', 16), 'hex'),
      '$2b$10$' || repeat('A', 53), 1
    from public.prospects where nickname = '확장이름'$$,
  'valid bcrypt cost 10 and generation are accepted alongside PBKDF2'
);
select throws_ok(
  $$update public.student_credentials set password_bcrypt = '$2b$09$' || repeat('A', 53)
    where prospect_id = (select id from public.prospects where nickname = '확장이름')$$,
  '23514',
  null,
  'bcrypt costs other than 10 are rejected'
);
select throws_ok(
  $$update public.student_credentials set password_bcrypt = 'not-a-bcrypt-digest'
    where prospect_id = (select id from public.prospects where nickname = '확장이름')$$,
  '23514',
  null,
  'malformed bcrypt digests are rejected'
);
select throws_ok(
  $$update public.student_credentials set password_generation = 0
    where prospect_id = (select id from public.prospects where nickname = '확장이름')$$,
  '23514',
  null,
  'password generation zero is rejected'
);
select throws_ok(
  $$update public.student_credentials set password_generation = 2147483648::bigint
    where prospect_id = (select id from public.prospects where nickname = '확장이름')$$,
  '22003',
  null,
  'password generations above integer range are rejected'
);

select has_column('public', 'student_credentials', 'password_hash', 'PBKDF2 hashes remain during expand');
select has_column('public', 'student_credentials', 'password_salt', 'PBKDF2 salts remain during expand');
select has_table('public', 'credential_recovery_requests', 'credential recovery remains during expand');
select has_function(
  'public', 'register_student',
  array['bytea', 'bytea', 'bytea', 'text', 'text', 'text', 'text', 'bytea', 'bytea'],
  'legacy registration RPC remains during expand'
);
select has_function(
  'public', 'complete_student_login',
  array['bigint', 'bytea', 'timestamp with time zone', 'timestamp with time zone'],
  'legacy login RPC remains during expand'
);
select has_function(
  'public', 'complete_credential_recovery',
  array['bytea', 'bytea', 'bytea'],
  'legacy recovery RPC remains during expand'
);
select has_function(
  'public', 'change_student_password',
  array['bytea', 'bytea', 'bytea'],
  'legacy password-change RPC remains during expand'
);

select fk_ok(
  'public', 'assessments', 'prospect_id',
  'public', 'prospects', 'id',
  'assessment-to-prospect history remains intact'
);
select fk_ok(
  'public', 'counseling_requests', 'prospect_id',
  'public', 'prospects', 'id',
  'counseling-to-prospect history remains intact'
);

select * from finish();

rollback;
