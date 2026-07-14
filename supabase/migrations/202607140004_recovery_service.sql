create function public.complete_credential_recovery(
  p_code_hash bytea,
  p_password_hash bytea,
  p_password_salt bytea
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recovery public.credential_recovery_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_code_hash is null or pg_catalog.octet_length(p_code_hash) <> 32 then
    return false;
  end if;

  if p_password_hash is null or pg_catalog.octet_length(p_password_hash) <> 32 then
    return false;
  end if;

  if p_password_salt is null or pg_catalog.octet_length(p_password_salt) < 16 then
    return false;
  end if;

  select *
  into v_recovery
  from public.credential_recovery_requests
  where code_hash = p_code_hash
  for update;

  if not found then
    return false;
  end if;

  if v_recovery.status <> 'verified' or v_recovery.expires_at <= v_now then
    if v_recovery.status = 'verified' and v_recovery.expires_at <= v_now then
      update public.credential_recovery_requests
      set status = 'expired'
      where id = v_recovery.id;
    end if;
    return false;
  end if;

  update public.student_credentials
  set
    password_hash = p_password_hash,
    password_salt = p_password_salt,
    failed_attempts = 0,
    locked_until = null,
    password_changed_at = v_now,
    updated_at = v_now
  where prospect_id = v_recovery.prospect_id;

  if not found then
    return false;
  end if;

  update public.credential_recovery_requests
  set status = 'consumed', consumed_at = v_now
  where id = v_recovery.id;

  update public.student_sessions
  set revoked_at = v_now
  where prospect_id = v_recovery.prospect_id
    and revoked_at is null;

  return true;
end;
$$;

revoke all privileges on function public.complete_credential_recovery(bytea, bytea, bytea)
  from public, anon, authenticated;
grant execute on function public.complete_credential_recovery(bytea, bytea, bytea)
  to service_role;
