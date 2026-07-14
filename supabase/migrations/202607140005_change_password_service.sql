create function public.change_student_password(
  p_session_hash bytea,
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
  v_session public.student_sessions%rowtype;
  v_now timestamptz;
begin
  if p_session_hash is null or pg_catalog.octet_length(p_session_hash) <> 32 then
    return false;
  end if;

  if p_password_hash is null or pg_catalog.octet_length(p_password_hash) <> 32 then
    return false;
  end if;

  if p_password_salt is null or pg_catalog.octet_length(p_password_salt) < 16 then
    return false;
  end if;

  -- Lock credentials before sessions so recovery and password changes share one lock order.
  select credential.*
  into v_credential
  from public.student_credentials as credential
  where exists (
    select 1
    from public.student_sessions as session
    where session.prospect_id = credential.prospect_id
      and session.token_hash = p_session_hash
  )
  for update;

  if not found then
    return false;
  end if;

  select session.*
  into v_session
  from public.student_sessions as session
  where session.prospect_id = v_credential.prospect_id
    and session.token_hash = p_session_hash
  order by session.created_at desc, session.id desc
  limit 1
  for update;

  if not found then
    return false;
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_session.revoked_at is not null
    or v_session.expires_at <= v_now
    or v_session.idle_expires_at <= v_now then
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

  update public.student_sessions
  set revoked_at = v_now
  where prospect_id = v_credential.prospect_id
    and id <> v_session.id
    and revoked_at is null;

  return true;
end;
$$;

create function public.approve_credential_recovery_request(
  p_request_id bigint,
  p_admin_user_id uuid
)
returns table(code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recovery public.credential_recovery_requests%rowtype;
  v_code_bytes bytea;
  v_code text;
  v_expires_at timestamptz;
  v_now timestamptz;
begin
  if p_request_id is null or p_request_id < 1 or p_admin_user_id is null then
    return;
  end if;

  select *
  into v_recovery
  from public.credential_recovery_requests
  where id = p_request_id
  for update;

  if not found or v_recovery.status <> 'requested' then
    return;
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_recovery.expires_at <= v_now then
    update public.credential_recovery_requests
    set status = 'expired'
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

  return query select v_code, v_expires_at;
end;
$$;

revoke all privileges on function public.change_student_password(bytea, bytea, bytea)
  from public, anon, authenticated;
revoke all privileges on function public.approve_credential_recovery_request(bigint, uuid)
  from public, anon, authenticated;

grant execute on function public.change_student_password(bytea, bytea, bytea)
  to service_role;
grant execute on function public.approve_credential_recovery_request(bigint, uuid)
  to service_role;
