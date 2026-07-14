create or replace function public.complete_credential_recovery(
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
  v_credential public.student_credentials%rowtype;
  v_prospect_id bigint;
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

  select request.prospect_id
  into v_prospect_id
  from public.credential_recovery_requests as request
  where request.code_hash = p_code_hash
  order by request.id
  limit 1;

  if not found then
    return false;
  end if;

  -- Password change and every recovery mutation acquire credentials first.
  select credential.*
  into v_credential
  from public.student_credentials as credential
  where credential.prospect_id = v_prospect_id
  for update;

  if not found then
    return false;
  end if;

  -- Lock every recovery row for the prospect in one deterministic order.
  perform request.id
  from public.credential_recovery_requests as request
  where request.prospect_id = v_prospect_id
  order by request.id
  for update;

  select request.*
  into v_recovery
  from public.credential_recovery_requests as request
  where request.prospect_id = v_prospect_id
    and request.code_hash = p_code_hash
  order by request.id
  limit 1;

  if not found then
    return false;
  end if;

  if v_recovery.status <> 'verified' or v_recovery.expires_at <= v_now then
    if v_recovery.status = 'verified' and v_recovery.expires_at <= v_now then
      update public.credential_recovery_requests
      set status = 'expired', code_hash = null
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
  where prospect_id = v_credential.prospect_id;

  update public.credential_recovery_requests
  set status = 'consumed', code_hash = null, consumed_at = v_now
  where id = v_recovery.id;

  update public.credential_recovery_requests
  set status = 'expired', code_hash = null
  where prospect_id = v_credential.prospect_id
    and id <> v_recovery.id
    and status in ('requested', 'verified');

  update public.student_sessions
  set revoked_at = v_now
  where prospect_id = v_credential.prospect_id
    and revoked_at is null;

  return true;
end;
$$;

create function public.approve_credential_recovery_request(
  p_request_id bigint,
  p_admin_user_id uuid,
  p_trace_id uuid
)
returns table(code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential public.student_credentials%rowtype;
  v_recovery public.credential_recovery_requests%rowtype;
  v_code_bytes bytea;
  v_code text;
  v_expires_at timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_prospect_id bigint;
begin
  if p_request_id is null or p_request_id < 1 or p_admin_user_id is null or p_trace_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.admin_users as admin_user
    where admin_user.id = p_admin_user_id
      and admin_user.is_active
      and admin_user.role = 'admin'
  ) then
    return;
  end if;

  select request.prospect_id
  into v_prospect_id
  from public.credential_recovery_requests as request
  where request.id = p_request_id;

  if not found then
    return;
  end if;

  select credential.*
  into v_credential
  from public.student_credentials as credential
  where credential.prospect_id = v_prospect_id
  for update;

  if not found then
    return;
  end if;

  perform request.id
  from public.credential_recovery_requests as request
  where request.prospect_id = v_credential.prospect_id
  order by request.id
  for update;

  select request.*
  into v_recovery
  from public.credential_recovery_requests as request
  where request.id = p_request_id
    and request.prospect_id = v_credential.prospect_id;

  if not found or v_recovery.status <> 'requested' then
    return;
  end if;

  if v_recovery.expires_at <= v_now then
    update public.credential_recovery_requests
    set status = 'expired', code_hash = null
    where id = v_recovery.id
      and status = 'requested';
    return;
  end if;

  v_code_bytes := extensions.gen_random_bytes(16);
  v_code := pg_catalog.rtrim(
    pg_catalog.translate(pg_catalog.encode(v_code_bytes, 'base64'), '+/', '-_'),
    '='
  );
  v_expires_at := v_now + interval '15 minutes';

  update public.credential_recovery_requests as request
  set
    code_hash = extensions.digest(pg_catalog.convert_to(v_code, 'UTF8'), 'sha256'),
    expires_at = v_expires_at,
    status = 'verified',
    verified_at = v_now,
    verified_by_admin_id = p_admin_user_id
  where request.id = v_recovery.id
    and request.status = 'requested'
    and request.expires_at > v_now;

  if not found then
    return;
  end if;

  insert into public.audit_events (
    admin_user_id,
    action,
    target_type,
    target_id,
    metadata,
    request_id
  ) values (
    p_admin_user_id,
    'credential_recovery_approved',
    'credential_recovery_request',
    p_request_id::text,
    '{}'::jsonb,
    p_trace_id
  );

  return query select v_code, v_expires_at;
end;
$$;

revoke all privileges on function public.complete_credential_recovery(bytea, bytea, bytea)
  from public, anon, authenticated;
grant execute on function public.complete_credential_recovery(bytea, bytea, bytea)
  to service_role;

revoke all privileges on function public.approve_credential_recovery_request(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.approve_credential_recovery_request(bigint, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.approve_credential_recovery_request(bigint, uuid, uuid)
  to service_role;
