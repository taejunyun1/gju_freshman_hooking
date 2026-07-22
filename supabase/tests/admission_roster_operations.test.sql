begin;

select plan(62);

insert into auth.users(id) values ('a4000000-0000-4000-8000-000000000001');
insert into public.admin_users(id, is_active) values ('a4000000-0000-4000-8000-000000000001', true);

create temporary table roster_fixture(cycle_id uuid, admin_id uuid, rows jsonb, test_rows jsonb);
insert into roster_fixture values (
  'a4000000-0000-4000-8000-000000000010', 'a4000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('nameHmac',repeat('21',32),'nameCiphertext',repeat('22',16),'nameIv',repeat('23',12),'phoneHmac',repeat('24',32),'phoneCiphertext',repeat('25',16),'phoneIv',repeat('26',12),'schoolName','광주고등학교','applicantStage','high3','passwordDigest',repeat('27',32),'passwordGeneration',1)),
  (select jsonb_agg(jsonb_build_object('nameHmac',lpad(to_hex(n),64,'0'),'nameCiphertext',repeat('31',16),'nameIv',repeat('32',12),'phoneHmac',lpad(to_hex(n+10),64,'0'),'phoneCiphertext',repeat('33',16),'phoneIv',repeat('34',12),'schoolName','테스트고','applicantStage','high3','passwordDigest',lpad(to_hex(n+20),64,'0'),'passwordGeneration',1)) from generate_series(1,5) n)
);

select is((public.start_admission_cycle_v1(cycle_id,2030,1,admin_id,test_rows)->>'kind'),'success','cycle start succeeds') from roster_fixture;
select is((select count(*) from public.admission_cycles where status='current'),1::bigint,'cycle start creates one current cycle');
select is((select count(*) from public.prospects p join public.admission_cycles c on c.id=p.admission_cycle_id where c.status='current' and p.is_test),5::bigint,'cycle start creates exactly five current test accounts');
select is((public.preview_applicant_roster_v1((select cycle_id from roster_fixture),(select rows from roster_fixture))->>'rosterVersion')::integer,0,'preview reports roster version zero');
select is((select count(*) from public.prospects where not is_test),0::bigint,'preview is read-only');
select is((public.preview_applicant_roster_v1((select cycle_id from roster_fixture), (select jsonb_agg(rows->0) from roster_fixture, generate_series(1,501)))->>'kind'),'validation_error','preview rejects more than 500 rows');

create temporary table apply_one as select public.apply_applicant_roster_v1(cycle_id,0,admin_id,decode(repeat('41',32),'hex'),'a4000000-0000-4000-8000-000000000020',rows) result from roster_fixture;
select is((select result->>'kind' from apply_one),'success','first roster apply succeeds');
select is((select count(*) from public.prospects where not is_test),1::bigint,'apply creates roster student');
select is((select result->'added'->0->>'hmac' from apply_one),repeat('24',32),'apply returns non-PII identity for each newly issued credential');
select ok(position('->>''name''' in pg_get_functiondef('public.apply_applicant_roster_v1(uuid,integer,uuid,bytea,uuid,jsonb)'::regprocedure)) = 0, 'apply never reads plaintext names from its payload');
select ok(position('->>''name''' in pg_get_functiondef('public.start_admission_cycle_v1(uuid,integer,integer,uuid,jsonb)'::regprocedure)) = 0, 'cycle start never reads plaintext test names from its payload');
select ok((select nickname like 'roster:%' and nickname not like '%운영지원자%' from public.prospects where not is_test), 'legacy nickname is a non-PII roster placeholder');
select ok((select substring(password_bcrypt from 1 for 7) in ('$2a$10$','$2b$10$') from public.student_credentials c join public.prospects p on p.id=c.prospect_id where not p.is_test),'bcrypt is cost 10');
select is((select count(*) from information_schema.columns where table_schema='public' and table_name='student_credentials' and column_name ~ 'password.*digest'),0::bigint,'raw password digest has no storage column');
select is((public.add_roster_student_v1((select cycle_id from roster_fixture),(select admin_id from roster_fixture),(select rows->0 from roster_fixture))->>'code'),'PHONE_CONFLICT','same-cycle individual phone conflict is rejected');

select is((public.apply_applicant_roster_v1((select cycle_id from roster_fixture),0,(select admin_id from roster_fixture),decode(repeat('42',32),'hex'),'a4000000-0000-4000-8000-000000000021',(select rows from roster_fixture))->>'code'),'ROSTER_VERSION_CONFLICT','roster version CAS rejects stale apply');
select is((public.apply_applicant_roster_v1((select cycle_id from roster_fixture),1,(select admin_id from roster_fixture),decode(repeat('41',32),'hex'),'a4000000-0000-4000-8000-000000000020',(select rows from roster_fixture))->>'rosterVersion')::integer,1,'same request ID and digest replays saved result');
select is((select roster_version from public.admission_cycles where id=(select cycle_id from roster_fixture)),1,'idempotent replay does not mutate roster twice');
select is((public.apply_applicant_roster_v1((select cycle_id from roster_fixture),1,(select admin_id from roster_fixture),decode(repeat('43',32),'hex'),'a4000000-0000-4000-8000-000000000020',(select rows from roster_fixture))->>'code'),'IDEMPOTENCY_DIGEST_MISMATCH','same request ID with another digest conflicts');
select is((public.apply_applicant_roster_v1((select cycle_id from roster_fixture),1,(select admin_id from roster_fixture),decode(repeat('44',32),'hex'),'a4000000-0000-4000-8000-000000000022',jsonb_build_array((select rows->0 from roster_fixture),'{}'::jsonb))->>'kind'),'validation_error','one invalid row rejects the complete batch');
select is((select roster_version from public.admission_cycles where id=(select cycle_id from roster_fixture)),1,'invalid batch rolls back all partial roster writes');

insert into public.student_sessions(prospect_id,token_hash,expires_at,idle_expires_at) select id,decode(repeat('61',32),'hex'),now()+interval '1 hour',now()+interval '1 hour' from public.prospects where not is_test;
select is((public.set_roster_student_status_v1((select id from public.prospects where not is_test),'inactive')->>'kind'),'success','deactivation succeeds');
select is((select count(*) from public.student_sessions where revoked_at is null),0::bigint,'deactivation revokes every active session');

select is((public.set_roster_student_status_v1((select id from public.prospects where not is_test),'active')->>'kind'),'success','reactivation succeeds');
insert into public.student_sessions(prospect_id,token_hash,expires_at,idle_expires_at) select id,decode(repeat('62',32),'hex'),now()+interval '1 hour',now()+interval '1 hour' from public.prospects where not is_test;
select is((public.reissue_roster_student_password_v1((select id from public.prospects where not is_test),1,2,decode(repeat('63',32),'hex'))->>'kind'),'success','password reissue CAS succeeds');
select is((select count(*) from public.student_sessions where revoked_at is null),0::bigint,'password reissue revokes every active session');

-- Adding one student must not implement an implicit full-roster replacement.
select public.set_roster_student_status_v1((select id from public.prospects where not is_test),'active');
create temporary table second_student as select jsonb_build_object('nameHmac',repeat('81',32),'nameCiphertext',repeat('82',16),'nameIv',repeat('83',12),'phoneHmac',repeat('84',32),'phoneCiphertext',repeat('85',16),'phoneIv',repeat('86',12),'schoolName','두번째고','applicantStage','high2','passwordDigest',repeat('87',32),'passwordGeneration',1) student;
select is((public.add_roster_student_v1((select cycle_id from roster_fixture),(select admin_id from roster_fixture),(select student from second_student))->>'kind'),'success','add creates a second active non-test student');
insert into public.student_sessions(prospect_id,token_hash,expires_at,idle_expires_at)
select id, decode(case when phone_hmac=decode(repeat('24',32),'hex') then repeat('88',32) else repeat('89',32) end,'hex'), now()+interval '1 hour', now()+interval '1 hour'
from public.prospects where not is_test and status='active';
create temporary table third_student as select jsonb_build_object('nameHmac',repeat('91',32),'nameCiphertext',repeat('92',16),'nameIv',repeat('93',12),'phoneHmac',repeat('94',32),'phoneCiphertext',repeat('95',16),'phoneIv',repeat('96',12),'schoolName','세번째고','applicantStage','high1','passwordDigest',repeat('97',32),'passwordGeneration',1) student;
select is((public.add_roster_student_v1((select cycle_id from roster_fixture),(select admin_id from roster_fixture),(select student from third_student))->>'kind'),'success','add creates a third student without roster replacement');
select is((select count(*) from public.prospects where not is_test and status='active'),3::bigint,'add keeps the original two students active');
select is((select count(*) from public.student_sessions s join public.prospects p on p.id=s.prospect_id where not p.is_test and p.phone_hmac in (decode(repeat('24',32),'hex'),decode(repeat('84',32),'hex')) and s.revoked_at is null),2::bigint,'add does not revoke original student sessions');

-- Preview and apply use exactly the same change classifier.
create temporary table roster_delta as select jsonb_build_array(
  (select rows->0 from roster_fixture),
  jsonb_set((select student from second_student), '{schoolName}', '"변경고"'::jsonb)
) rows;
select is((public.preview_applicant_roster_v1((select cycle_id from roster_fixture),(select rows from roster_delta))->'counts'->>'unchanged')::integer,1,'preview counts only matching active rows as unchanged');
select is((public.preview_applicant_roster_v1((select cycle_id from roster_fixture),(select rows from roster_delta))->'counts'->>'update')::integer,1,'preview counts changed active rows as updates');
select is((public.preview_applicant_roster_v1((select cycle_id from roster_fixture),(select rows from roster_delta))->'counts'->>'inactive')::integer,1,'preview counts absent active non-test rows as inactive');
create temporary table delta_apply as select public.apply_applicant_roster_v1((select cycle_id from roster_fixture),1,(select admin_id from roster_fixture),decode(repeat('98',32),'hex'),'a4000000-0000-4000-8000-000000000023',(select rows from roster_delta)) result;
select is((select result->'counts'->>'unchanged' from delta_apply)::integer,1,'apply counts matching active rows as unchanged');
select is((select result->'counts'->>'update' from delta_apply)::integer,1,'apply counts changed active rows as updates');
select is((select result->'counts'->>'inactive' from delta_apply)::integer,1,'apply counts absent active non-test rows as inactive');

-- A self-registration survives a CSV omission, then becomes ordinary roster data
-- as soon as the official CSV includes its phone number.
insert into public.prospects(
  nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage,
  region, admission_cycle_id, name_hmac, name_ciphertext, name_iv, is_self_registered
) values (
  'roster:self-registration-preserve', decode(repeat('a7',32),'hex'), decode(repeat('a8',16),'hex'), decode(repeat('a9',12),'hex'),
  '자율등록고', 'high2', 'other', (select cycle_id from roster_fixture), decode(repeat('aa',32),'hex'), decode(repeat('ab',16),'hex'), decode(repeat('ac',12),'hex'), true
);
select is((public.apply_applicant_roster_v1((select cycle_id from roster_fixture),2,(select admin_id from roster_fixture),decode(repeat('ad',32),'hex'),'a4000000-0000-4000-8000-000000000024',(select rows from roster_delta))->>'kind'),'success','CSV apply succeeds while self-registered student is absent');
select ok((select status='active' and is_self_registered from public.prospects where phone_hmac=decode(repeat('a7',32),'hex')),'absent self-registered student remains active');
create temporary table roster_with_official_self_registration as select (select rows from roster_delta) || jsonb_build_array(jsonb_build_object(
  'nameHmac',repeat('b7',32),'nameCiphertext',repeat('b8',16),'nameIv',repeat('b9',12),
  'phoneHmac',repeat('a7',32),'phoneCiphertext',repeat('ba',16),'phoneIv',repeat('bb',12),
  'schoolName','공식명단고','applicantStage','high3','passwordDigest',repeat('bc',32),'passwordGeneration',1
)) rows;
select is((public.apply_applicant_roster_v1((select cycle_id from roster_fixture),3,(select admin_id from roster_fixture),decode(repeat('bd',32),'hex'),'a4000000-0000-4000-8000-000000000025',(select rows from roster_with_official_self_registration))->>'kind'),'success','CSV apply matches a self-registered student by phone');
select ok((select status='active' and not is_self_registered and school_name='공식명단고' and applicant_stage='high3' from public.prospects where phone_hmac=decode(repeat('a7',32),'hex')),'matching CSV row converts the student to regular roster behavior');

-- Both generation CAS paths reject a non-increasing or stale request without side effects.
insert into public.student_sessions(prospect_id,token_hash,expires_at,idle_expires_at)
select id,decode(repeat('a1',32),'hex'),now()+interval '1 hour',now()+interval '1 hour' from public.prospects where phone_hmac=decode(repeat('24',32),'hex');
create temporary table cas_before as select p.phone_hmac, c.password_bcrypt, c.password_generation from public.prospects p join public.student_credentials c on c.prospect_id=p.id where p.phone_hmac=decode(repeat('24',32),'hex');
select is((public.reissue_roster_student_password_v1((select id from public.prospects where phone_hmac=decode(repeat('24',32),'hex')),2,2,decode(repeat('a2',32),'hex'))->>'code'),'PASSWORD_GENERATION_CONFLICT','reissue rejects non-increasing generation');
select is((select password_bcrypt from public.student_credentials c join public.prospects p on p.id=c.prospect_id where p.phone_hmac=decode(repeat('24',32),'hex')),(select password_bcrypt from cas_before),'reissue conflict leaves credential unchanged');
select is((select count(*) from public.student_sessions s join public.prospects p on p.id=s.prospect_id where p.phone_hmac=decode(repeat('24',32),'hex') and s.revoked_at is null),2::bigint,'reissue conflict leaves sessions active');
select is((public.change_roster_student_phone_v1((select id from public.prospects where phone_hmac=decode(repeat('24',32),'hex')),2,2,decode(repeat('a3',32),'hex'),decode(repeat('a4',16),'hex'),decode(repeat('a5',12),'hex'),decode(repeat('a6',32),'hex'))->>'code'),'PASSWORD_GENERATION_CONFLICT','phone change rejects non-increasing generation');
select is((select phone_hmac from public.prospects where phone_hmac=decode(repeat('24',32),'hex')),(select phone_hmac from cas_before),'phone conflict leaves phone unchanged');
select is((public.change_roster_student_phone_v1((select id from public.prospects where phone_hmac=decode(repeat('24',32),'hex')),1,3,decode(repeat('a3',32),'hex'),decode(repeat('a4',16),'hex'),decode(repeat('a5',12),'hex'),decode(repeat('a6',32),'hex'))->>'code'),'PASSWORD_GENERATION_CONFLICT','phone change rejects stale generation');
select is((select count(*) from public.student_sessions s join public.prospects p on p.id=s.prospect_id where p.phone_hmac=decode(repeat('24',32),'hex') and s.revoked_at is null),2::bigint,'stale phone change leaves sessions active');

-- The bridge-era global phone uniqueness blocks a test-account collision without altering the current cycle.
select is((public.start_admission_cycle_v1('a4000000-0000-4000-8000-000000000030',2031,1,(select admin_id from roster_fixture),(select test_rows from roster_fixture))->>'code'),'TEST_PHONE_CONFLICT','test-account phone collision aborts a cycle start');
select is((select status from public.admission_cycles where id=(select cycle_id from roster_fixture)),'current','collision leaves the existing cycle current');

-- Annual rollover archives/revokes the old cycle, then creates exactly five new test accounts.
select is((public.start_admission_cycle_v1('a4000000-0000-4000-8000-000000000031',2032,1,(select admin_id from roster_fixture),
  (select jsonb_agg(jsonb_build_object('nameHmac',lpad(to_hex(n+600),64,'0'),'nameCiphertext',repeat('b1',16),'nameIv',repeat('b2',12),'phoneHmac',lpad(to_hex(n+610),64,'0'),'phoneCiphertext',repeat('b3',16),'phoneIv',repeat('b4',12),'schoolName','다음고','applicantStage','high3','passwordDigest',lpad(to_hex(n+620),64,'0'),'passwordGeneration',1)) from generate_series(1,5) n)) ->>'kind'),'success','annual rollover starts the next cycle');
select is((select status from public.admission_cycles where id=(select cycle_id from roster_fixture)),'archived','annual rollover archives the previous current cycle');
select is((select count(*) from public.student_sessions s join public.prospects p on p.id=s.prospect_id where p.admission_cycle_id=(select cycle_id from roster_fixture) and s.revoked_at is null),0::bigint,'annual rollover revokes every previous-cycle session');
select is((select status from public.admission_cycles where id='a4000000-0000-4000-8000-000000000031'),'current','annual rollover makes the new cycle current');
select is((select count(*) from public.prospects where admission_cycle_id='a4000000-0000-4000-8000-000000000031' and is_test),5::bigint,'annual rollover creates five new test accounts');

-- A 200-person annual roster must fit the audit metadata contract while keeping
-- an idempotent retry able to return every newly issued credential reference.
create temporary table high_volume_roster as
select jsonb_agg(jsonb_build_object(
  'nameHmac',lpad(to_hex(n + 1000),64,'0'),'nameCiphertext',repeat('c1',16),'nameIv',repeat('c2',12),
  'phoneHmac',lpad(to_hex(n + 1300),64,'0'),'phoneCiphertext',repeat('c3',16),'phoneIv',repeat('c4',12),
  'schoolName','대용량고','applicantStage','high3','passwordDigest',lpad(to_hex(n + 1600),64,'0'),'passwordGeneration',1
) order by n) rows
from generate_series(1,200) n;
create temporary table high_volume_apply as
select public.apply_applicant_roster_v1(
  'a4000000-0000-4000-8000-000000000031',0,'a4000000-0000-4000-8000-000000000001',
  decode(repeat('d1',32),'hex'),'a4000000-0000-4000-8000-000000000032',(select rows from high_volume_roster)
) result;
select is((select result->>'kind' from high_volume_apply),'success','200-person roster apply succeeds within the audit metadata limit');
select is((select jsonb_array_length(result->'added') from high_volume_apply),200,'200-person apply returns every newly issued credential reference');
select ok((select public.is_sanitized_metadata(metadata) and octet_length(metadata::text) <= 4096 from public.audit_events where request_id='a4000000-0000-4000-8000-000000000032'),'large roster audit metadata is bounded and sanitized');
select is(jsonb_array_length(public.apply_applicant_roster_v1(
  'a4000000-0000-4000-8000-000000000031',1,'a4000000-0000-4000-8000-000000000001',
  decode(repeat('d1',32),'hex'),'a4000000-0000-4000-8000-000000000032',(select rows from high_volume_roster)
)->'added'),200,'idempotent retry returns every original credential reference');
create temporary table global_phone_collision as
select jsonb_build_object(
  'nameHmac',repeat('e1',32),'nameCiphertext',repeat('e2',16),'nameIv',repeat('e3',12),
  'phoneHmac',repeat('24',32),'phoneCiphertext',repeat('e4',16),'phoneIv',repeat('e5',12),
  'schoolName','중복진단고','applicantStage','high3','passwordDigest',repeat('e6',32),'passwordGeneration',1
) student;
select is((public.apply_applicant_roster_v1(
  'a4000000-0000-4000-8000-000000000031',1,'a4000000-0000-4000-8000-000000000001',
  decode(repeat('e7',32),'hex'),'a4000000-0000-4000-8000-000000000033',jsonb_build_array((select student from global_phone_collision))
)->>'diagnosticCode'),'23505','database failures return a safe SQLSTATE for Worker diagnostics');

-- The RPC surface is executable only by service_role.
select is((select count(*) from (values
  ('public'::name),('anon'::name),('authenticated'::name)
) roles(role) cross join (values
  ('start_admission_cycle_v1(uuid,integer,integer,uuid,jsonb)'::text),('list_admission_cycles_v1()'),('preview_applicant_roster_v1(uuid,jsonb)'),('apply_applicant_roster_v1(uuid,integer,uuid,bytea,uuid,jsonb)'),('list_roster_students_v1(uuid,text,boolean)'),('read_roster_student_v1(bigint)'),('read_current_roster_credentials_v1()'),('add_roster_student_v1(uuid,uuid,jsonb)'),('update_roster_student_profile_v1(bigint,bytea,bytea,bytea,text,text)'),('change_roster_student_phone_v1(bigint,integer,integer,bytea,bytea,bytea,bytea)'),('set_roster_student_status_v1(bigint,text)'),('reissue_roster_student_password_v1(bigint,integer,integer,bytea)'),('register_roster_student_v1(bytea,bytea,bytea,bytea,bytea,bytea,bytea,integer,bytea,bytea,timestamptz,text,text)')
) functions(signature) where has_function_privilege(roles.role, ('public.' || functions.signature)::regprocedure, 'execute')),0::bigint,'public anon and authenticated cannot execute roster mutations');
select is((select count(*) from (values
  ('start_admission_cycle_v1(uuid,integer,integer,uuid,jsonb)'::text),('list_admission_cycles_v1()'),('preview_applicant_roster_v1(uuid,jsonb)'),('apply_applicant_roster_v1(uuid,integer,uuid,bytea,uuid,jsonb)'),('list_roster_students_v1(uuid,text,boolean)'),('read_roster_student_v1(bigint)'),('read_current_roster_credentials_v1()'),('add_roster_student_v1(uuid,uuid,jsonb)'),('update_roster_student_profile_v1(bigint,bytea,bytea,bytea,text,text)'),('change_roster_student_phone_v1(bigint,integer,integer,bytea,bytea,bytea,bytea)'),('set_roster_student_status_v1(bigint,text)'),('reissue_roster_student_password_v1(bigint,integer,integer,bytea)'),('register_roster_student_v1(bytea,bytea,bytea,bytea,bytea,bytea,bytea,integer,bytea,bytea,timestamptz,text,text)')
) functions(signature) where has_function_privilege('service_role', ('public.' || functions.signature)::regprocedure, 'execute')),13::bigint,'service_role can execute every roster RPC');

select * from finish();
rollback;
