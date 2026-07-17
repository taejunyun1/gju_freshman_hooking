-- Annual applicant roster operations.  All values which can identify an applicant
-- arrive already protected by the Worker; this migration never persists a password
-- digest outside bcrypt.

create unique index audit_events_admission_roster_request_once_idx
  on public.audit_events (action, request_id)
  where action = 'admission_roster_apply';

create function public.start_admission_cycle_v1(
  p_cycle_id uuid,
  p_year integer,
  p_password_key_version integer,
  p_admin_user_id uuid,
  p_test_students jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_test jsonb;
  v_prospect_id bigint;
begin
  if p_cycle_id is null or p_year not between 2020 and 2200 or p_password_key_version < 1
     or p_admin_user_id is null or pg_catalog.jsonb_typeof(p_test_students) <> 'array'
     or pg_catalog.jsonb_array_length(p_test_students) <> 5 then
    return pg_catalog.jsonb_build_object('kind', 'validation_error');
  end if;
  if not exists (select 1 from public.admin_users where id = p_admin_user_id and is_active) then
    return pg_catalog.jsonb_build_object('kind', 'forbidden');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admission-cycle-current', 0));
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_test_students) item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
      or pg_catalog.octet_length(pg_catalog.decode(item.value->>'phoneHmac', 'hex')) <> 32
      or pg_catalog.octet_length(pg_catalog.decode(item.value->>'phoneCiphertext', 'hex')) < 16
      or pg_catalog.octet_length(pg_catalog.decode(item.value->>'phoneIv', 'hex')) <> 12
      or pg_catalog.octet_length(pg_catalog.decode(item.value->>'nameHmac', 'hex')) <> 32
      or pg_catalog.octet_length(pg_catalog.decode(item.value->>'nameCiphertext', 'hex')) < 16
      or pg_catalog.octet_length(pg_catalog.decode(item.value->>'nameIv', 'hex')) <> 12
      or pg_catalog.octet_length(pg_catalog.decode(item.value->>'passwordDigest', 'hex')) <> 32
      or coalesce((item.value->>'passwordGeneration')::integer, 0) < 1
      or coalesce(item.value->>'schoolName', '') = ''
      or coalesce(item.value->>'applicantStage', '') not in ('high1','high2','high3','graduate','ged','other')
  ) then
    return pg_catalog.jsonb_build_object('kind', 'validation_error');
  end if;
  -- The bridge schema still has a global phone HMAC unique constraint.  Check the
  -- full synthetic set before creating the cycle so collisions roll back cleanly.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_test_students) item(value)
    join public.prospects p on p.phone_hmac = pg_catalog.decode(item.value->>'phoneHmac', 'hex')
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_test_students) item(value)
    group by item.value->>'phoneHmac' having pg_catalog.count(*) <> 1
  ) then
    return pg_catalog.jsonb_build_object('kind', 'conflict', 'code', 'TEST_PHONE_CONFLICT');
  end if;
  update public.admission_cycles set status = 'archived', archived_at = pg_catalog.clock_timestamp()
    where status = 'current';
  update public.student_sessions s set revoked_at = pg_catalog.clock_timestamp()
    from public.prospects p where p.id = s.prospect_id and p.admission_cycle_id in
      (select id from public.admission_cycles where status = 'archived') and s.revoked_at is null;
  insert into public.admission_cycles(id, year, status, roster_version, password_key_version)
    values (p_cycle_id, p_year, 'current', 0, p_password_key_version);
  for v_test in select value from pg_catalog.jsonb_array_elements(p_test_students) loop
    insert into public.prospects(nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage, region,
      admission_cycle_id, name_hmac, name_ciphertext, name_iv, is_test)
    values ('roster:' || p_cycle_id::text || ':' || (v_test->>'phoneHmac'), pg_catalog.decode(v_test->>'phoneHmac','hex'), pg_catalog.decode(v_test->>'phoneCiphertext','hex'),
      pg_catalog.decode(v_test->>'phoneIv','hex'), v_test->>'schoolName', v_test->>'applicantStage', 'other', p_cycle_id,
      pg_catalog.decode(v_test->>'nameHmac','hex'), pg_catalog.decode(v_test->>'nameCiphertext','hex'), pg_catalog.decode(v_test->>'nameIv','hex'), true)
    returning id into v_prospect_id;
    insert into public.student_credentials(prospect_id, password_hash, password_salt, password_bcrypt, password_generation)
    values (v_prospect_id, pg_catalog.decode(repeat('00',32),'hex'), pg_catalog.decode(repeat('00',16),'hex'),
      extensions.crypt(pg_catalog.encode(pg_catalog.decode(v_test->>'passwordDigest','hex'), 'hex'), extensions.gen_salt('bf',10)),
      (v_test->>'passwordGeneration')::integer);
  end loop;
  return pg_catalog.jsonb_build_object('kind','success','cycleId',p_cycle_id,'rosterVersion',0);
exception when others then
  return pg_catalog.jsonb_build_object('kind','validation_error');
end $$;

create function public.list_admission_cycles_v1() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'year',year,'status',status,
    'rosterVersion',roster_version,'passwordKeyVersion',password_key_version,'createdAt',created_at,'archivedAt',archived_at)
    order by year desc) from public.admission_cycles), '[]'::jsonb);
end $$;

create function public.preview_applicant_roster_v1(p_cycle_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_add integer := 0; v_update integer := 0; v_inactive integer := 0; v_unchanged integer := 0; v_rows jsonb; v_inactive_ids jsonb;
begin
  select roster_version into v_version from public.admission_cycles where id=p_cycle_id;
  if v_version is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' or pg_catalog.jsonb_array_length(p_rows) not between 1 and 500 then
    return pg_catalog.jsonb_build_object('kind','validation_error');
  end if;
  select count(*) filter (where p.id is null),
         count(*) filter (where p.id is not null and not (p.status = 'active' and p.name_hmac = pg_catalog.decode(x.value->>'nameHmac', 'hex') and p.school_name = x.value->>'schoolName' and p.applicant_stage = x.value->>'applicantStage')),
         count(*) filter (where p.id is not null and p.status = 'active' and p.name_hmac = pg_catalog.decode(x.value->>'nameHmac', 'hex') and p.school_name = x.value->>'schoolName' and p.applicant_stage = x.value->>'applicantStage')
    into v_add, v_update, v_unchanged
    from pg_catalog.jsonb_array_elements(p_rows) x(value)
    left join public.prospects p on p.admission_cycle_id = p_cycle_id and p.phone_hmac = pg_catalog.decode(x.value->>'phoneHmac', 'hex');
  select count(*) into v_inactive from public.prospects p
    where p.admission_cycle_id = p_cycle_id and not p.is_test and p.status = 'active'
      and not exists (select 1 from pg_catalog.jsonb_array_elements(p_rows) x(value) where p.phone_hmac = pg_catalog.decode(x.value->>'phoneHmac', 'hex'));
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'rowNumber', x.ordinality,
    'action', case when p.id is null then 'add' when p.status = 'active' and p.name_hmac = pg_catalog.decode(x.value->>'nameHmac', 'hex') and p.school_name = x.value->>'schoolName' and p.applicant_stage = x.value->>'applicantStage' then 'unchanged' else 'update' end,
    'phoneHmac', x.value->>'phoneHmac',
    'changedFields', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
      case when p.id is not null and p.name_hmac is distinct from pg_catalog.decode(x.value->>'nameHmac', 'hex') then 'name' end,
      case when p.id is not null and p.school_name is distinct from x.value->>'schoolName' then 'highSchool' end,
      case when p.id is not null and p.applicant_stage is distinct from x.value->>'applicantStage' then 'grade' end
    ]::text[], null))
  ) order by x.ordinality), '[]'::jsonb) into v_rows
  from pg_catalog.jsonb_array_elements(p_rows) with ordinality x(value, ordinality)
  left join public.prospects p on p.admission_cycle_id = p_cycle_id and p.phone_hmac = pg_catalog.decode(x.value->>'phoneHmac', 'hex');
  select coalesce(pg_catalog.jsonb_agg(p.id order by p.id), '[]'::jsonb) into v_inactive_ids
  from public.prospects p where p.admission_cycle_id = p_cycle_id and not p.is_test and p.status = 'active'
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_rows) x(value) where p.phone_hmac = pg_catalog.decode(x.value->>'phoneHmac', 'hex'));
  return pg_catalog.jsonb_build_object('cycleId',p_cycle_id,'rosterVersion',v_version,'counts',
    pg_catalog.jsonb_build_object('add',v_add,'update',v_update,'inactive',v_inactive,'unchanged',v_unchanged),'rows',v_rows,'inactiveApplicantIds',v_inactive_ids);
end $$;

create function public.apply_applicant_roster_v1(
  p_cycle_id uuid, p_expected_version integer, p_admin_user_id uuid, p_request_digest bytea, p_request_id uuid, p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_cycle public.admission_cycles%rowtype; v_existing jsonb; v_digest text; v_row jsonb; v_id bigint;
  v_add integer := 0; v_update integer := 0; v_inactive integer := 0; v_unchanged integer := 0; v_result jsonb; v_added jsonb := '[]'::jsonb;
begin
  perform pg_catalog.set_config('statement_timeout','60s', true);
  if p_request_digest is null or pg_catalog.octet_length(p_request_digest) <> 32 or p_request_id is null or p_expected_version < 0
    or pg_catalog.jsonb_typeof(p_rows) <> 'array' or pg_catalog.jsonb_array_length(p_rows) not between 1 and 500 then
    return pg_catalog.jsonb_build_object('kind','validation_error');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  v_digest := pg_catalog.encode(p_request_digest,'hex');
  select metadata into v_existing from public.audit_events where action='admission_roster_apply' and request_id=p_request_id;
  if v_existing is not null then
    if v_existing->>'requestDigest' = v_digest then return v_existing->'result'; end if;
    return pg_catalog.jsonb_build_object('kind','conflict','code','IDEMPOTENCY_DIGEST_MISMATCH');
  end if;
  if not exists (select 1 from public.admin_users where id=p_admin_user_id and is_active) then return pg_catalog.jsonb_build_object('kind','forbidden'); end if;
  select * into v_cycle from public.admission_cycles where id=p_cycle_id and status='current' for update;
  if not found then return pg_catalog.jsonb_build_object('kind','conflict','code','CURRENT_CYCLE_REQUIRED'); end if;
  if v_cycle.roster_version <> p_expected_version then return pg_catalog.jsonb_build_object('kind','conflict','code','ROSTER_VERSION_CONFLICT','rosterVersion',v_cycle.roster_version); end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_rows) x(value) where pg_catalog.jsonb_typeof(value) <> 'object'
    or pg_catalog.octet_length(pg_catalog.decode(value->>'phoneHmac','hex')) <> 32
    or pg_catalog.octet_length(pg_catalog.decode(value->>'passwordDigest','hex')) <> 32
    or pg_catalog.octet_length(pg_catalog.decode(value->>'nameHmac','hex')) <> 32
    or pg_catalog.octet_length(pg_catalog.decode(value->>'phoneCiphertext','hex')) < 16
    or pg_catalog.octet_length(pg_catalog.decode(value->>'phoneIv','hex')) <> 12
    or pg_catalog.octet_length(pg_catalog.decode(value->>'nameCiphertext','hex')) < 16
    or pg_catalog.octet_length(pg_catalog.decode(value->>'nameIv','hex')) <> 12) then return pg_catalog.jsonb_build_object('kind','validation_error'); end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_rows) x(value) group by value->>'phoneHmac' having pg_catalog.count(*)>1) then return pg_catalog.jsonb_build_object('kind','validation_error'); end if;
  for v_row in select value from pg_catalog.jsonb_array_elements(p_rows) loop
    select id into v_id from public.prospects where admission_cycle_id=p_cycle_id and phone_hmac=pg_catalog.decode(v_row->>'phoneHmac','hex') for update;
    if found then
      if exists (select 1 from public.prospects where id=v_id and status='active' and name_hmac=pg_catalog.decode(v_row->>'nameHmac','hex') and school_name=v_row->>'schoolName' and applicant_stage=v_row->>'applicantStage') then v_unchanged:=v_unchanged+1;
      else
        update public.prospects set name_hmac=pg_catalog.decode(v_row->>'nameHmac','hex'), name_ciphertext=pg_catalog.decode(v_row->>'nameCiphertext','hex'), name_iv=pg_catalog.decode(v_row->>'nameIv','hex'), school_name=v_row->>'schoolName', applicant_stage=v_row->>'applicantStage', status='active', updated_at=pg_catalog.clock_timestamp() where id=v_id;
        v_update:=v_update+1;
      end if;
    else
      insert into public.prospects(nickname,phone_hmac,phone_ciphertext,phone_iv,school_name,applicant_stage,region,admission_cycle_id,name_hmac,name_ciphertext,name_iv)
        values('roster:' || p_cycle_id::text || ':' || (v_row->>'phoneHmac'),pg_catalog.decode(v_row->>'phoneHmac','hex'),pg_catalog.decode(v_row->>'phoneCiphertext','hex'),pg_catalog.decode(v_row->>'phoneIv','hex'),v_row->>'schoolName',v_row->>'applicantStage','other',p_cycle_id,pg_catalog.decode(v_row->>'nameHmac','hex'),pg_catalog.decode(v_row->>'nameCiphertext','hex'),pg_catalog.decode(v_row->>'nameIv','hex')) returning id into v_id;
      insert into public.student_credentials(prospect_id,password_hash,password_salt,password_bcrypt,password_generation) values(v_id,pg_catalog.decode(repeat('00',32),'hex'),pg_catalog.decode(repeat('00',16),'hex'),extensions.crypt(pg_catalog.encode(pg_catalog.decode(v_row->>'passwordDigest','hex'),'hex'),extensions.gen_salt('bf',10)),coalesce((v_row->>'passwordGeneration')::integer,1));
      v_add:=v_add+1;
      v_added := v_added || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('hmac', v_row->>'phoneHmac', 'generation', coalesce((v_row->>'passwordGeneration')::integer, 1)));
    end if;
  end loop;
  update public.prospects p set status='inactive', updated_at=pg_catalog.clock_timestamp() where p.admission_cycle_id=p_cycle_id and not p.is_test and p.status='active' and not exists(select 1 from pg_catalog.jsonb_array_elements(p_rows) x(value) where p.phone_hmac=pg_catalog.decode(x.value->>'phoneHmac','hex'));
  get diagnostics v_inactive = row_count;
  update public.student_sessions s set revoked_at=pg_catalog.clock_timestamp() from public.prospects p where p.id=s.prospect_id and p.admission_cycle_id=p_cycle_id and p.status='inactive' and s.revoked_at is null;
  update public.admission_cycles set roster_version=roster_version+1 where id=p_cycle_id returning roster_version into v_cycle.roster_version;
  v_result:=pg_catalog.jsonb_build_object('kind','success','cycleId',p_cycle_id,'previousVersion',p_expected_version,'rosterVersion',v_cycle.roster_version,'counts',pg_catalog.jsonb_build_object('add',v_add,'update',v_update,'inactive',v_inactive,'unchanged',v_unchanged),'added',v_added,'credentials','[]'::jsonb);
  insert into public.audit_events(admin_user_id,action,target_type,target_id,metadata,request_id) values(p_admin_user_id,'admission_roster_apply','admission_cycle',p_cycle_id::text,pg_catalog.jsonb_build_object('requestDigest',v_digest,'beforeVersion',p_expected_version,'afterVersion',v_cycle.roster_version,'counts',v_result->'counts','result',v_result),p_request_id);
  return v_result;
exception when others then
  return pg_catalog.jsonb_build_object('kind','validation_error');
end $$;

create function public.list_roster_students_v1(p_cycle_id uuid, p_status text default null, p_is_test boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin
 return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id,'status',p.status,'isTest',p.is_test,'schoolName',p.school_name,'applicantStage',p.applicant_stage,'cycleId',p.admission_cycle_id) order by p.id) from public.prospects p where p.admission_cycle_id=p_cycle_id and (p_status is null or p.status=p_status) and (p_is_test is null or p.is_test=p_is_test)),'[]'::jsonb); end $$;

create function public.read_roster_student_v1(p_prospect_id bigint) returns jsonb language plpgsql security definer set search_path = '' as $$ begin
 return (select pg_catalog.jsonb_build_object('id',p.id,'cycleId',p.admission_cycle_id,'status',p.status,'isTest',p.is_test,'nameCiphertext',pg_catalog.encode(p.name_ciphertext,'hex'),'nameIv',pg_catalog.encode(p.name_iv,'hex'),'phoneCiphertext',pg_catalog.encode(p.phone_ciphertext,'hex'),'phoneIv',pg_catalog.encode(p.phone_iv,'hex'),'schoolName',p.school_name,'applicantStage',p.applicant_stage,'passwordGeneration',c.password_generation) from public.prospects p join public.student_credentials c on c.prospect_id=p.id where p.id=p_prospect_id); end $$;
create function public.read_current_roster_credentials_v1() returns jsonb language plpgsql security definer set search_path = '' as $$ begin
 return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id,'cycleId',a.id,'nameCiphertext',pg_catalog.encode(p.name_ciphertext,'hex'),'nameIv',pg_catalog.encode(p.name_iv,'hex'),'phoneCiphertext',pg_catalog.encode(p.phone_ciphertext,'hex'),'phoneIv',pg_catalog.encode(p.phone_iv,'hex'),'passwordGeneration',c.password_generation,'passwordKeyVersion',a.password_key_version)) from public.admission_cycles a join public.prospects p on p.admission_cycle_id=a.id join public.student_credentials c on c.prospect_id=p.id where a.status='current' and p.status='active'),'[]'::jsonb); end $$;

create function public.add_roster_student_v1(p_cycle_id uuid,p_admin_user_id uuid,p_student jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$ declare v_id bigint; begin
 if pg_catalog.jsonb_typeof(p_student) <> 'object'
    or pg_catalog.octet_length(pg_catalog.decode(p_student->>'phoneHmac','hex')) <> 32
    or pg_catalog.octet_length(pg_catalog.decode(p_student->>'phoneCiphertext','hex')) < 16
    or pg_catalog.octet_length(pg_catalog.decode(p_student->>'phoneIv','hex')) <> 12
    or pg_catalog.octet_length(pg_catalog.decode(p_student->>'nameHmac','hex')) <> 32
    or pg_catalog.octet_length(pg_catalog.decode(p_student->>'nameCiphertext','hex')) < 16
    or pg_catalog.octet_length(pg_catalog.decode(p_student->>'nameIv','hex')) <> 12
    or pg_catalog.octet_length(pg_catalog.decode(p_student->>'passwordDigest','hex')) <> 32
    or coalesce((p_student->>'passwordGeneration')::integer, 0) < 1
    or coalesce(p_student->>'schoolName','') = ''
    or coalesce(p_student->>'applicantStage','') not in ('high1','high2','high3','graduate','ged','other') then
   return pg_catalog.jsonb_build_object('kind','validation_error');
 end if;
 if exists (select 1 from public.prospects where admission_cycle_id=p_cycle_id and phone_hmac=pg_catalog.decode(p_student->>'phoneHmac','hex')) then
   return pg_catalog.jsonb_build_object('kind','conflict','code','PHONE_CONFLICT');
 end if;
 perform 1 from public.admission_cycles where id=p_cycle_id and status='current' for update;
 if not found or not exists(select 1 from public.admin_users where id=p_admin_user_id and is_active) then return pg_catalog.jsonb_build_object('kind','conflict'); end if;
 insert into public.prospects(nickname,phone_hmac,phone_ciphertext,phone_iv,school_name,applicant_stage,region,admission_cycle_id,name_hmac,name_ciphertext,name_iv) values('roster:' || p_cycle_id::text || ':' || (p_student->>'phoneHmac'),pg_catalog.decode(p_student->>'phoneHmac','hex'),pg_catalog.decode(p_student->>'phoneCiphertext','hex'),pg_catalog.decode(p_student->>'phoneIv','hex'),p_student->>'schoolName',p_student->>'applicantStage','other',p_cycle_id,pg_catalog.decode(p_student->>'nameHmac','hex'),pg_catalog.decode(p_student->>'nameCiphertext','hex'),pg_catalog.decode(p_student->>'nameIv','hex')) returning id into v_id;
 insert into public.student_credentials(prospect_id,password_hash,password_salt,password_bcrypt,password_generation) values(v_id,pg_catalog.decode(repeat('00',32),'hex'),pg_catalog.decode(repeat('00',16),'hex'),extensions.crypt(pg_catalog.encode(pg_catalog.decode(p_student->>'passwordDigest','hex'),'hex'),extensions.gen_salt('bf',10)),coalesce((p_student->>'passwordGeneration')::integer,1)); return pg_catalog.jsonb_build_object('kind','success','prospectId',v_id); exception when unique_violation then return pg_catalog.jsonb_build_object('kind','conflict','code','PHONE_CONFLICT'); end $$;
create function public.update_roster_student_profile_v1(p_prospect_id bigint,p_name_hmac bytea,p_name_ciphertext bytea,p_name_iv bytea,p_school_name text,p_applicant_stage text) returns jsonb language plpgsql security definer set search_path = '' as $$ begin
 if pg_catalog.octet_length(p_name_hmac)<>32 or pg_catalog.octet_length(p_name_ciphertext)<16 or pg_catalog.octet_length(p_name_iv)<>12 or p_applicant_stage not in ('high1','high2','high3','graduate','ged','other') then return pg_catalog.jsonb_build_object('kind','validation_error'); end if;
 update public.prospects set name_hmac=p_name_hmac,name_ciphertext=p_name_ciphertext,name_iv=p_name_iv,school_name=p_school_name,applicant_stage=p_applicant_stage,updated_at=pg_catalog.clock_timestamp() where id=p_prospect_id and admission_cycle_id in(select id from public.admission_cycles where status='current'); if not found then return pg_catalog.jsonb_build_object('kind','conflict'); end if; return pg_catalog.jsonb_build_object('kind','success'); end $$;
create function public.change_roster_student_phone_v1(p_prospect_id bigint,p_expected_generation integer,p_next_generation integer,p_phone_hmac bytea,p_phone_ciphertext bytea,p_phone_iv bytea,p_password_digest bytea) returns jsonb language plpgsql security definer set search_path = '' as $$ declare v_generation integer; begin
 if p_expected_generation is null or p_next_generation is null or pg_catalog.octet_length(p_phone_hmac)<>32 or pg_catalog.octet_length(p_phone_ciphertext)<16 or pg_catalog.octet_length(p_phone_iv)<>12 or pg_catalog.octet_length(p_password_digest)<>32 or p_next_generation<1 or p_next_generation>2147483647 then return pg_catalog.jsonb_build_object('kind','validation_error'); end if; if p_next_generation<=p_expected_generation then return pg_catalog.jsonb_build_object('kind','conflict','code','PASSWORD_GENERATION_CONFLICT'); end if;
 select c.password_generation into v_generation from public.student_credentials c join public.prospects p on p.id=c.prospect_id join public.admission_cycles a on a.id=p.admission_cycle_id where p.id=p_prospect_id and a.status='current' for update; if v_generation is distinct from p_expected_generation then return pg_catalog.jsonb_build_object('kind','conflict','code','PASSWORD_GENERATION_CONFLICT'); end if;
 update public.prospects set phone_hmac=p_phone_hmac,phone_ciphertext=p_phone_ciphertext,phone_iv=p_phone_iv,updated_at=pg_catalog.clock_timestamp() where id=p_prospect_id; update public.student_credentials set password_bcrypt=extensions.crypt(pg_catalog.encode(p_password_digest,'hex'),extensions.gen_salt('bf',10)),password_generation=p_next_generation,failed_attempts=0,locked_until=null,password_changed_at=pg_catalog.clock_timestamp() where prospect_id=p_prospect_id; update public.student_sessions set revoked_at=pg_catalog.clock_timestamp() where prospect_id=p_prospect_id and revoked_at is null; return pg_catalog.jsonb_build_object('kind','success','passwordGeneration',p_next_generation); end $$;
create function public.set_roster_student_status_v1(p_prospect_id bigint,p_status text) returns jsonb language plpgsql security definer set search_path = '' as $$ begin
 if p_status not in ('active','inactive') then return pg_catalog.jsonb_build_object('kind','validation_error'); end if; update public.prospects set status=p_status,updated_at=pg_catalog.clock_timestamp() where id=p_prospect_id and admission_cycle_id in(select id from public.admission_cycles where status='current'); if not found then return pg_catalog.jsonb_build_object('kind','conflict'); end if; if p_status='inactive' then update public.student_sessions set revoked_at=pg_catalog.clock_timestamp() where prospect_id=p_prospect_id and revoked_at is null; end if; return pg_catalog.jsonb_build_object('kind','success'); end $$;
create function public.reissue_roster_student_password_v1(p_prospect_id bigint,p_expected_generation integer,p_next_generation integer,p_password_digest bytea) returns jsonb language plpgsql security definer set search_path = '' as $$ declare v_generation integer; begin
 if p_expected_generation is null or p_next_generation is null or pg_catalog.octet_length(p_password_digest)<>32 or p_next_generation<1 or p_next_generation>2147483647 then return pg_catalog.jsonb_build_object('kind','validation_error'); end if; if p_next_generation<=p_expected_generation then return pg_catalog.jsonb_build_object('kind','conflict','code','PASSWORD_GENERATION_CONFLICT'); end if; select c.password_generation into v_generation from public.student_credentials c join public.prospects p on p.id=c.prospect_id join public.admission_cycles a on a.id=p.admission_cycle_id where p.id=p_prospect_id and a.status='current' for update; if v_generation is distinct from p_expected_generation then return pg_catalog.jsonb_build_object('kind','conflict','code','PASSWORD_GENERATION_CONFLICT'); end if; update public.student_credentials set password_bcrypt=extensions.crypt(pg_catalog.encode(p_password_digest,'hex'),extensions.gen_salt('bf',10)),password_generation=p_next_generation,failed_attempts=0,locked_until=null,password_changed_at=pg_catalog.clock_timestamp() where prospect_id=p_prospect_id; update public.student_sessions set revoked_at=pg_catalog.clock_timestamp() where prospect_id=p_prospect_id and revoked_at is null; return pg_catalog.jsonb_build_object('kind','success','passwordGeneration',p_next_generation); end $$;

create function public.login_roster_student_v1(p_phone_hmac bytea,p_current_digest bytea,p_current_version integer,p_previous_digest bytea,p_previous_version integer,p_ip_hmac bytea,p_token_hash bytea,p_expires_at timestamptz) returns jsonb language plpgsql security definer set search_path = '' as $$ declare v_now timestamptz:=pg_catalog.clock_timestamp(); v_prospect record; v_digest bytea; v_dummy text:='$2b$10$CwTycUXWue0Thq9StjUM0uJ8oKe6eT3fYqOGl7bYJd2N0HC8oQ0iW'; begin
 if pg_catalog.octet_length(p_phone_hmac)<>32 or pg_catalog.octet_length(p_current_digest)<>32 or pg_catalog.octet_length(p_ip_hmac)<>32 or pg_catalog.octet_length(p_token_hash)<>32 or p_current_version is null or p_current_version<1 or p_expires_at<=v_now or p_expires_at>v_now+interval '12 hours 1 minute' or (p_previous_digest is not null and pg_catalog.octet_length(p_previous_digest)<>32) or (p_previous_digest is not null and (p_previous_version is null or p_previous_version<1)) then return pg_catalog.jsonb_build_object('kind','failed'); end if;
 perform extensions.crypt(pg_catalog.encode(p_current_digest,'hex'),v_dummy);
 select p.id,p.nickname,c.password_bcrypt,a.password_key_version into v_prospect from public.admission_cycles a join public.prospects p on p.admission_cycle_id=a.id join public.student_credentials c on c.prospect_id=p.id where a.status='current' and p.status='active' and p.phone_hmac=p_phone_hmac for update;
 if not found then return pg_catalog.jsonb_build_object('kind','failed'); end if;
 v_digest:=case when v_prospect.password_key_version=p_current_version then p_current_digest when p_previous_digest is not null and v_prospect.password_key_version=p_previous_version then p_previous_digest else null end;
 if v_digest is null or v_prospect.password_bcrypt is null or extensions.crypt(pg_catalog.encode(v_digest,'hex'),v_prospect.password_bcrypt)<>v_prospect.password_bcrypt then
   update public.student_credentials set failed_attempts=failed_attempts+1,locked_until=case when failed_attempts+1>=5 then v_now+interval '30 minutes' else locked_until end where prospect_id=v_prospect.id;
   return pg_catalog.jsonb_build_object('kind','failed');
 end if;
 update public.student_credentials set failed_attempts=0,locked_until=null where prospect_id=v_prospect.id;
 insert into public.student_sessions(prospect_id,token_hash,expires_at,idle_expires_at) values(v_prospect.id,p_token_hash,p_expires_at,p_expires_at);
 return pg_catalog.jsonb_build_object('kind','authenticated','prospectId',v_prospect.id,'nickname',v_prospect.nickname,'expiresAt',p_expires_at);
end $$;
create function public.read_roster_student_session_v1(p_token_hash bytea) returns jsonb language plpgsql security definer set search_path = '' as $$ begin
 if pg_catalog.octet_length(p_token_hash)<>32 then return pg_catalog.jsonb_build_object('kind','failed'); end if;
 return coalesce((select pg_catalog.jsonb_build_object('kind','active','prospectId',p.id,'nickname',p.nickname,'expiresAt',s.expires_at) from public.student_sessions s join public.prospects p on p.id=s.prospect_id join public.admission_cycles a on a.id=p.admission_cycle_id where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>pg_catalog.clock_timestamp() and p.status='active' and a.status='current' limit 1),pg_catalog.jsonb_build_object('kind','failed'));
end $$;
create function public.revoke_roster_student_session_v1(p_token_hash bytea) returns jsonb language plpgsql security definer set search_path = '' as $$ begin
 if pg_catalog.octet_length(p_token_hash)<>32 then return pg_catalog.jsonb_build_object('kind','success'); end if;
 update public.student_sessions set revoked_at=pg_catalog.clock_timestamp() where token_hash=p_token_hash and revoked_at is null;
 return pg_catalog.jsonb_build_object('kind','success');
end $$;

revoke all on function public.start_admission_cycle_v1(uuid,integer,integer,uuid,jsonb), public.list_admission_cycles_v1(), public.preview_applicant_roster_v1(uuid,jsonb), public.apply_applicant_roster_v1(uuid,integer,uuid,bytea,uuid,jsonb), public.list_roster_students_v1(uuid,text,boolean), public.read_roster_student_v1(bigint), public.read_current_roster_credentials_v1(), public.add_roster_student_v1(uuid,uuid,jsonb), public.update_roster_student_profile_v1(bigint,bytea,bytea,bytea,text,text), public.change_roster_student_phone_v1(bigint,integer,integer,bytea,bytea,bytea,bytea), public.set_roster_student_status_v1(bigint,text), public.reissue_roster_student_password_v1(bigint,integer,integer,bytea) from public, anon, authenticated;
grant execute on function public.start_admission_cycle_v1(uuid,integer,integer,uuid,jsonb), public.list_admission_cycles_v1(), public.preview_applicant_roster_v1(uuid,jsonb), public.apply_applicant_roster_v1(uuid,integer,uuid,bytea,uuid,jsonb), public.list_roster_students_v1(uuid,text,boolean), public.read_roster_student_v1(bigint), public.read_current_roster_credentials_v1(), public.add_roster_student_v1(uuid,uuid,jsonb), public.update_roster_student_profile_v1(bigint,bytea,bytea,bytea,text,text), public.change_roster_student_phone_v1(bigint,integer,integer,bytea,bytea,bytea,bytea), public.set_roster_student_status_v1(bigint,text), public.reissue_roster_student_password_v1(bigint,integer,integer,bytea) to service_role;
revoke all on function public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz), public.read_roster_student_session_v1(bytea), public.revoke_roster_student_session_v1(bytea) from public, anon, authenticated;
grant execute on function public.login_roster_student_v1(bytea,bytea,integer,bytea,integer,bytea,bytea,timestamptz), public.read_roster_student_session_v1(bytea), public.revoke_roster_student_session_v1(bytea) to service_role;
