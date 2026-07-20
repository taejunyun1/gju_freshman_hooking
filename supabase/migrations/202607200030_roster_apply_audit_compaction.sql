-- Large annual rosters can have up to 500 additions.  The original audit payload
-- persisted every 64-character HMAC under metadata.result.added, exceeding the
-- audit metadata's 4 KiB safety cap before 74 applicants could be committed.
-- Store compact row indexes in the audit record and reconstruct the non-PII HMAC
-- response on an idempotent retry from the request rows instead.

create or replace function public.apply_applicant_roster_v1(
  p_cycle_id uuid, p_expected_version integer, p_admin_user_id uuid, p_request_digest bytea, p_request_id uuid, p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cycle public.admission_cycles%rowtype;
  v_existing jsonb;
  v_digest text;
  v_row jsonb;
  v_row_index bigint;
  v_id bigint;
  v_add integer := 0;
  v_update integer := 0;
  v_inactive integer := 0;
  v_unchanged integer := 0;
  v_result jsonb;
  v_audit_result jsonb;
  v_replay_added jsonb;
  v_added jsonb := '[]'::jsonb;
  v_added_indices jsonb := '[]'::jsonb;
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
    if v_existing->>'requestDigest' <> v_digest then
      return pg_catalog.jsonb_build_object('kind','conflict','code','IDEMPOTENCY_DIGEST_MISMATCH');
    end if;
    v_result := v_existing->'result';
    -- Historical, short roster records stored added HMACs directly.  Keep those
    -- replays compatible while new records use compact row indexes.
    if pg_catalog.jsonb_typeof(v_result->'addedIndices') <> 'array' then
      return v_result;
    end if;
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('hmac', item.value->>'phoneHmac', 'generation', coalesce((item.value->>'passwordGeneration')::integer, 1))
      order by item.ordinality
    ), '[]'::jsonb)
      into v_replay_added
      from pg_catalog.jsonb_array_elements(p_rows) with ordinality item(value, ordinality)
      join pg_catalog.jsonb_array_elements_text(v_result->'addedIndices') added(index_text)
        on item.ordinality = added.index_text::bigint;
    return (v_result - 'addedIndices') || pg_catalog.jsonb_build_object('added', v_replay_added);
  end if;
  if not exists (select 1 from public.admin_users where id=p_admin_user_id and is_active) then
    return pg_catalog.jsonb_build_object('kind','forbidden');
  end if;
  select * into v_cycle from public.admission_cycles where id=p_cycle_id and status='current' for update;
  if not found then
    return pg_catalog.jsonb_build_object('kind','conflict','code','CURRENT_CYCLE_REQUIRED');
  end if;
  if v_cycle.roster_version <> p_expected_version then
    return pg_catalog.jsonb_build_object('kind','conflict','code','ROSTER_VERSION_CONFLICT','rosterVersion',v_cycle.roster_version);
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_rows) x(value)
    where pg_catalog.jsonb_typeof(value) <> 'object'
      or pg_catalog.octet_length(pg_catalog.decode(value->>'phoneHmac','hex')) <> 32
      or pg_catalog.octet_length(pg_catalog.decode(value->>'passwordDigest','hex')) <> 32
      or pg_catalog.octet_length(pg_catalog.decode(value->>'nameHmac','hex')) <> 32
      or pg_catalog.octet_length(pg_catalog.decode(value->>'phoneCiphertext','hex')) < 16
      or pg_catalog.octet_length(pg_catalog.decode(value->>'phoneIv','hex')) <> 12
      or pg_catalog.octet_length(pg_catalog.decode(value->>'nameCiphertext','hex')) < 16
      or pg_catalog.octet_length(pg_catalog.decode(value->>'nameIv','hex')) <> 12
  ) then
    return pg_catalog.jsonb_build_object('kind','validation_error');
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_rows) x(value)
    group by value->>'phoneHmac' having pg_catalog.count(*) > 1
  ) then
    return pg_catalog.jsonb_build_object('kind','validation_error');
  end if;
  for v_row, v_row_index in
    select value, ordinality from pg_catalog.jsonb_array_elements(p_rows) with ordinality
  loop
    select id into v_id from public.prospects
      where admission_cycle_id=p_cycle_id and phone_hmac=pg_catalog.decode(v_row->>'phoneHmac','hex')
      for update;
    if found then
      if exists (
        select 1 from public.prospects
        where id=v_id and status='active' and name_hmac=pg_catalog.decode(v_row->>'nameHmac','hex')
          and school_name=v_row->>'schoolName' and applicant_stage=v_row->>'applicantStage'
      ) then
        v_unchanged:=v_unchanged+1;
      else
        update public.prospects
          set name_hmac=pg_catalog.decode(v_row->>'nameHmac','hex'),
              name_ciphertext=pg_catalog.decode(v_row->>'nameCiphertext','hex'),
              name_iv=pg_catalog.decode(v_row->>'nameIv','hex'),
              school_name=v_row->>'schoolName', applicant_stage=v_row->>'applicantStage',
              status='active', updated_at=pg_catalog.clock_timestamp()
          where id=v_id;
        v_update:=v_update+1;
      end if;
    else
      insert into public.prospects(
        nickname,phone_hmac,phone_ciphertext,phone_iv,school_name,applicant_stage,region,
        admission_cycle_id,name_hmac,name_ciphertext,name_iv
      ) values(
        'roster:' || p_cycle_id::text || ':' || (v_row->>'phoneHmac'),
        pg_catalog.decode(v_row->>'phoneHmac','hex'), pg_catalog.decode(v_row->>'phoneCiphertext','hex'),
        pg_catalog.decode(v_row->>'phoneIv','hex'), v_row->>'schoolName', v_row->>'applicantStage','other',p_cycle_id,
        pg_catalog.decode(v_row->>'nameHmac','hex'), pg_catalog.decode(v_row->>'nameCiphertext','hex'),
        pg_catalog.decode(v_row->>'nameIv','hex')
      ) returning id into v_id;
      insert into public.student_credentials(
        prospect_id,password_hash,password_salt,password_bcrypt,password_generation
      ) values(
        v_id, pg_catalog.decode(repeat('00',32),'hex'), pg_catalog.decode(repeat('00',16),'hex'),
        extensions.crypt(
          pg_catalog.encode(pg_catalog.decode(v_row->>'passwordDigest','hex'),'hex'),
          extensions.gen_salt('bf',10)
        ),
        coalesce((v_row->>'passwordGeneration')::integer,1)
      );
      v_add:=v_add+1;
      v_added := v_added || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('hmac', v_row->>'phoneHmac', 'generation', coalesce((v_row->>'passwordGeneration')::integer, 1))
      );
      v_added_indices := v_added_indices || pg_catalog.jsonb_build_array(v_row_index);
    end if;
  end loop;
  update public.prospects p set status='inactive', updated_at=pg_catalog.clock_timestamp()
    where p.admission_cycle_id=p_cycle_id and not p.is_test and p.status='active'
      and not exists(
        select 1 from pg_catalog.jsonb_array_elements(p_rows) x(value)
        where p.phone_hmac=pg_catalog.decode(x.value->>'phoneHmac','hex')
      );
  get diagnostics v_inactive = row_count;
  update public.student_sessions s set revoked_at=pg_catalog.clock_timestamp()
    from public.prospects p
    where p.id=s.prospect_id and p.admission_cycle_id=p_cycle_id and p.status='inactive' and s.revoked_at is null;
  update public.admission_cycles set roster_version=roster_version+1
    where id=p_cycle_id returning roster_version into v_cycle.roster_version;
  v_result:=pg_catalog.jsonb_build_object(
    'kind','success','cycleId',p_cycle_id,'previousVersion',p_expected_version,'rosterVersion',v_cycle.roster_version,
    'counts',pg_catalog.jsonb_build_object('add',v_add,'update',v_update,'inactive',v_inactive,'unchanged',v_unchanged),
    'added',v_added,'credentials','[]'::jsonb
  );
  v_audit_result := (v_result - 'added') || pg_catalog.jsonb_build_object('addedIndices',v_added_indices);
  insert into public.audit_events(admin_user_id,action,target_type,target_id,metadata,request_id) values(
    p_admin_user_id,'admission_roster_apply','admission_cycle',p_cycle_id::text,
    pg_catalog.jsonb_build_object(
      'requestDigest',v_digest,'beforeVersion',p_expected_version,'afterVersion',v_cycle.roster_version,
      'counts',v_result->'counts','result',v_audit_result
    ),
    p_request_id
  );
  return v_result;
exception when others then
  return pg_catalog.jsonb_build_object('kind','validation_error');
end $$;
