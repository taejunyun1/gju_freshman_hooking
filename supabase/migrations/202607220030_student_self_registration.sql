-- Allow a newly registered applicant to remain available until an official
-- roster row claims the same protected phone identity.
alter table public.prospects
  add column is_self_registered boolean not null default false;

-- Phone identity is annual. Archived applicants must not prevent the same
-- person from participating in the current admission cycle.
alter table public.prospects
  drop constraint if exists prospects_phone_hmac_key,
  add constraint prospects_admission_cycle_phone_hmac_key
    unique (admission_cycle_id, phone_hmac);

-- The legacy identity RPC predates annual admission cycles. Keep its protected
-- input and table-return contract while letting the active unique constraints
-- decide whether the prospect insert is a duplicate.
create or replace function public.register_student(
  p_phone_hmac bytea,
  p_phone_ciphertext bytea,
  p_phone_iv bytea,
  p_nickname text,
  p_school_name text,
  p_applicant_stage text,
  p_region text,
  p_password_hash bytea,
  p_password_salt bytea
)
returns table(kind text)
language sql
security definer
set search_path = ''
as $$
  with current_cycle as (
    select id
    from public.admission_cycles
    where status = 'current'
  ), inserted_prospect as (
    insert into public.prospects (
      phone_hmac,
      phone_ciphertext,
      phone_iv,
      nickname,
      school_name,
      applicant_stage,
      region,
      admission_cycle_id
    )
    select
      p_phone_hmac,
      p_phone_ciphertext,
      p_phone_iv,
      p_nickname,
      p_school_name,
      p_applicant_stage,
      p_region,
      current_cycle.id
    from current_cycle
    on conflict do nothing
    returning id
  ), inserted_credential as (
    insert into public.student_credentials (
      prospect_id,
      password_hash,
      password_salt
    )
    select id, p_password_hash, p_password_salt
    from inserted_prospect
    returning prospect_id
  )
  select case
    when exists (select 1 from inserted_credential) then 'created'
    else 'existing'
  end;
$$;

create function public.register_roster_student_v1(
  p_expected_cycle_id uuid,
  p_expected_cycle_year integer,
  p_phone_hmac bytea,
  p_phone_ciphertext bytea,
  p_phone_iv bytea,
  p_name_hmac bytea,
  p_name_ciphertext bytea,
  p_name_iv bytea,
  p_password_digest bytea,
  p_password_key_version integer,
  p_ip_hmac bytea,
  p_token_hash bytea,
  p_expires_at timestamptz,
  p_school_name text,
  p_applicant_stage text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle record;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_prospect_id bigint;
begin
  -- The expected cycle is a server-originated compare-and-swap value. It is
  -- never accepted from the browser and cannot select a non-current cycle.
  if p_expected_cycle_id is null
    or p_expected_cycle_year is null or p_expected_cycle_year not between 2020 and 2200
    or p_phone_hmac is null or pg_catalog.octet_length(p_phone_hmac) <> 32
    or p_phone_ciphertext is null or pg_catalog.octet_length(p_phone_ciphertext) < 16
    or p_phone_iv is null or pg_catalog.octet_length(p_phone_iv) <> 12
    or p_name_hmac is null or pg_catalog.octet_length(p_name_hmac) <> 32
    or p_name_ciphertext is null or pg_catalog.octet_length(p_name_ciphertext) < 16
    or p_name_iv is null or pg_catalog.octet_length(p_name_iv) <> 12
    or p_password_digest is null or pg_catalog.octet_length(p_password_digest) <> 32
    or p_ip_hmac is null or pg_catalog.octet_length(p_ip_hmac) <> 32
    or p_token_hash is null or pg_catalog.octet_length(p_token_hash) <> 32
    or p_password_key_version is null
    or p_expires_at is null or p_expires_at <= v_now or p_expires_at > v_now + interval '12 hours'
    or p_school_name is null or pg_catalog.char_length(p_school_name) not between 1 and 40
    or p_applicant_stage is null
    or p_applicant_stage not in ('high1', 'high2', 'high3', 'graduate', 'ged', 'other')
  then
    return pg_catalog.jsonb_build_object('kind', 'validation_error');
  end if;

  select id, year, password_key_version
  into v_cycle
  from public.admission_cycles
  where status = 'current'
  for update;

  if not found
    or p_expected_cycle_id <> v_cycle.id
    or p_expected_cycle_year <> v_cycle.year
  then
    return pg_catalog.jsonb_build_object('kind', 'cycle_changed');
  end if;

  if p_password_key_version <> v_cycle.password_key_version then
    return pg_catalog.jsonb_build_object('kind', 'validation_error');
  end if;

  if not public.consume_rate_limit(
    'roster-register-global', 'roster-register-global', 64, interval '10 minutes'
  ) or not public.consume_rate_limit(
    pg_catalog.encode(p_ip_hmac, 'hex'), 'roster-register-ip', 8, interval '10 minutes'
  ) or not public.consume_rate_limit(
    pg_catalog.encode(p_phone_hmac, 'hex'), 'roster-register-phone', 3, interval '24 hours'
  ) then
    return pg_catalog.jsonb_build_object('kind', 'rate_limited');
  end if;

  select id into v_prospect_id
  from public.prospects
  where admission_cycle_id = v_cycle.id
    and phone_hmac = p_phone_hmac
  for update;

  if found then
    return pg_catalog.jsonb_build_object('kind', 'existing');
  end if;

  insert into public.prospects(
    nickname, phone_hmac, phone_ciphertext, phone_iv, school_name, applicant_stage,
    region, admission_cycle_id, name_hmac, name_ciphertext, name_iv, is_self_registered
  ) values (
    'roster:' || v_cycle.id::text || ':' || pg_catalog.encode(p_phone_hmac, 'hex'),
    p_phone_hmac, p_phone_ciphertext, p_phone_iv, p_school_name, p_applicant_stage,
    'other', v_cycle.id, p_name_hmac, p_name_ciphertext, p_name_iv, true
  ) returning id into v_prospect_id;

  insert into public.student_credentials(
    prospect_id, password_hash, password_salt, password_bcrypt, password_generation
  ) values (
    v_prospect_id, pg_catalog.decode(repeat('00', 32), 'hex'), pg_catalog.decode(repeat('00', 16), 'hex'),
    extensions.crypt(pg_catalog.encode(p_password_digest, 'hex'), extensions.gen_salt('bf', 10)), 1
  );

  insert into public.student_sessions(prospect_id, token_hash, expires_at, idle_expires_at)
  values (v_prospect_id, p_token_hash, p_expires_at, p_expires_at);

  return pg_catalog.jsonb_build_object(
    'kind', 'created', 'prospectId', v_prospect_id, 'expiresAt', p_expires_at
  );
exception
  when unique_violation then
    if exists (
      select 1 from public.prospects
      where admission_cycle_id = v_cycle.id and phone_hmac = p_phone_hmac
    ) then
      return pg_catalog.jsonb_build_object('kind', 'existing');
    end if;
    return pg_catalog.jsonb_build_object('kind', 'validation_error');
  when others then
    return pg_catalog.jsonb_build_object('kind', 'validation_error');
end;
$$;

-- Preview must use the same classifier as apply: self-registered students are
-- neither deactivated when omitted nor unchanged when an official CSV claims
-- their protected phone identity.
do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.preview_applicant_roster_v1(uuid,jsonb)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, E'p.status = ''active'' and p.name_hmac = pg_catalog.decode(x.value->>''nameHmac'', ''hex'') and p.school_name = x.value->>''schoolName'' and p.applicant_stage = x.value->>''applicantStage''') = 0
    or pg_catalog.strpos(v_definition, E'where p.admission_cycle_id = p_cycle_id and not p.is_test and p.status = ''active''') = 0
  then
    raise exception 'self-registration migration requires the expected roster preview definition';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    E'p.status = ''active'' and p.name_hmac = pg_catalog.decode(x.value->>''nameHmac'', ''hex'') and p.school_name = x.value->>''schoolName'' and p.applicant_stage = x.value->>''applicantStage''',
    E'p.status = ''active'' and not p.is_self_registered and p.name_hmac = pg_catalog.decode(x.value->>''nameHmac'', ''hex'') and p.school_name = x.value->>''schoolName'' and p.applicant_stage = x.value->>''applicantStage'''
  );
  v_definition := pg_catalog.replace(
    v_definition,
    E'where p.admission_cycle_id = p_cycle_id and not p.is_test and p.status = ''active''',
    E'where p.admission_cycle_id = p_cycle_id and not p.is_test and not p.is_self_registered and p.status = ''active'''
  );
  execute v_definition;
end;
$$;

-- The latest roster apply function is intentionally amended in place: its
-- idempotency and diagnostic behavior remains unchanged while the self-registered
-- source flag controls only official CSV reconciliation.
do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.apply_applicant_roster_v1(uuid,integer,uuid,bytea,uuid,jsonb)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, E'and school_name=v_row->>''schoolName'' and applicant_stage=v_row->>''applicantStage''\n      ) then') = 0
    or pg_catalog.strpos(v_definition, E'school_name=v_row->>''schoolName'', applicant_stage=v_row->>''applicantStage'',\n              status=') = 0
    or pg_catalog.strpos(v_definition, E'where p.admission_cycle_id=p_cycle_id and not p.is_test and p.status=''active''') = 0
  then
    raise exception 'self-registration migration requires the expected roster apply definition';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    E'and school_name=v_row->>''schoolName'' and applicant_stage=v_row->>''applicantStage''\n      ) then',
    E'and school_name=v_row->>''schoolName'' and applicant_stage=v_row->>''applicantStage'' and not is_self_registered\n      ) then'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    E'school_name=v_row->>''schoolName'', applicant_stage=v_row->>''applicantStage'',\n              status=',
    E'school_name=v_row->>''schoolName'', applicant_stage=v_row->>''applicantStage'', is_self_registered=false,\n              status='
  );
  v_definition := pg_catalog.replace(
    v_definition,
    E'where p.admission_cycle_id=p_cycle_id and not p.is_test and p.status=''active''',
    E'where p.admission_cycle_id=p_cycle_id and not p.is_test and not p.is_self_registered and p.status=''active'''
  );
  execute v_definition;
end;
$$;

revoke all on function public.register_roster_student_v1(
  uuid, integer, bytea, bytea, bytea, bytea, bytea, bytea, bytea, integer, bytea, bytea, timestamptz, text, text
) from public, anon, authenticated;

grant execute on function public.register_roster_student_v1(
  uuid, integer, bytea, bytea, bytea, bytea, bytea, bytea, bytea, integer, bytea, bytea, timestamptz, text, text
) to service_role;
