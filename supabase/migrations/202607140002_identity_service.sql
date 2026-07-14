create function public.register_student(
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
  with inserted_prospect as (
    insert into public.prospects (
      phone_hmac,
      phone_ciphertext,
      phone_iv,
      nickname,
      school_name,
      applicant_stage,
      region
    )
    values (
      p_phone_hmac,
      p_phone_ciphertext,
      p_phone_iv,
      p_nickname,
      p_school_name,
      p_applicant_stage,
      p_region
    )
    on conflict (phone_hmac) do nothing
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

create function public.record_student_login_failure(p_phone_hmac bytea)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with updated_credential as (
    update public.student_credentials as credential
    set
      failed_attempts = case
        when credential.locked_until is not null and credential.locked_until > pg_catalog.clock_timestamp()
          then credential.failed_attempts
        else credential.failed_attempts + 1
      end,
      locked_until = case
        when credential.locked_until is not null and credential.locked_until > pg_catalog.clock_timestamp()
          then credential.locked_until
        when credential.failed_attempts + 1 >= 5
          then pg_catalog.clock_timestamp() + pg_catalog.make_interval(mins => 15)
        else null
      end,
      updated_at = pg_catalog.clock_timestamp()
    from public.prospects as prospect
    where credential.prospect_id = prospect.id
      and prospect.phone_hmac = p_phone_hmac
    returning credential.prospect_id
  )
  select exists (select 1 from updated_credential);
$$;

create function public.complete_student_login(
  p_prospect_id bigint,
  p_token_hash bytea,
  p_expires_at timestamptz,
  p_idle_expires_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with authenticated_credential as (
    update public.student_credentials
    set
      failed_attempts = 0,
      locked_until = null,
      updated_at = pg_catalog.clock_timestamp()
    where prospect_id = p_prospect_id
      and (locked_until is null or locked_until <= pg_catalog.clock_timestamp())
    returning prospect_id
  ), inserted_session as (
    insert into public.student_sessions (
      prospect_id,
      token_hash,
      expires_at,
      idle_expires_at,
      last_seen_at
    )
    select
      prospect_id,
      p_token_hash,
      p_expires_at,
      p_idle_expires_at,
      pg_catalog.clock_timestamp()
    from authenticated_credential
    returning id
  )
  select exists (select 1 from inserted_session);
$$;

revoke all privileges on function public.register_student(bytea, bytea, bytea, text, text, text, text, bytea, bytea)
  from public, anon, authenticated;
revoke all privileges on function public.record_student_login_failure(bytea)
  from public, anon, authenticated;
revoke all privileges on function public.complete_student_login(bigint, bytea, timestamptz, timestamptz)
  from public, anon, authenticated;

grant execute on function public.register_student(bytea, bytea, bytea, text, text, text, text, bytea, bytea)
  to service_role;
grant execute on function public.record_student_login_failure(bytea)
  to service_role;
grant execute on function public.complete_student_login(bigint, bytea, timestamptz, timestamptz)
  to service_role;
