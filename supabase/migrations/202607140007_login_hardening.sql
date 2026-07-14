create function public.complete_student_login(
  p_prospect_id bigint,
  p_expected_password_hash bytea,
  p_expected_password_salt bytea,
  p_token_hash bytea,
  p_expires_at timestamptz,
  p_idle_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential public.student_credentials%rowtype;
  v_now timestamptz;
begin
  if p_prospect_id is null
    or p_expected_password_hash is null
    or pg_catalog.octet_length(p_expected_password_hash) <> 32
    or p_expected_password_salt is null
    or pg_catalog.octet_length(p_expected_password_salt) < 16
    or p_token_hash is null
    or pg_catalog.octet_length(p_token_hash) <> 32
    or p_expires_at is null
    or p_idle_expires_at is null
  then
    return false;
  end if;

  -- Every credential mutation and login completion acquires this row first.
  select credential.*
  into v_credential
  from public.student_credentials as credential
  where credential.prospect_id = p_prospect_id
  for update;

  if not found then
    return false;
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_credential.password_hash <> p_expected_password_hash
    or v_credential.password_salt <> p_expected_password_salt
    or (v_credential.locked_until is not null and v_credential.locked_until > v_now)
    or p_expires_at <= v_now
    or p_idle_expires_at <= v_now
    or p_idle_expires_at > p_expires_at
  then
    return false;
  end if;

  update public.student_credentials
  set
    failed_attempts = 0,
    locked_until = null,
    updated_at = v_now
  where prospect_id = v_credential.prospect_id;

  insert into public.student_sessions (
    prospect_id,
    token_hash,
    expires_at,
    idle_expires_at,
    last_seen_at
  ) values (
    v_credential.prospect_id,
    p_token_hash,
    p_expires_at,
    p_idle_expires_at,
    v_now
  );

  return true;
end;
$$;

revoke all privileges on function public.complete_student_login(bigint, bytea, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.complete_student_login(bigint, bytea, bytea, bytea, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_student_login(bigint, bytea, bytea, bytea, timestamptz, timestamptz)
  to service_role;
