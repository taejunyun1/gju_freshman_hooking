-- Bound unauthenticated bcrypt work and make roster credential lockouts atomic.
-- The Worker continues to pass only HMACs, digests, and opaque session tokens.

create or replace function public.login_roster_student_v1(
  p_phone_hmac bytea,
  p_current_digest bytea,
  p_current_version integer,
  p_previous_digest bytea,
  p_previous_version integer,
  p_ip_hmac bytea,
  p_token_hash bytea,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_prospect_id bigint;
  v_nickname text;
  v_password_bcrypt text;
  v_password_key_version integer;
  v_failed_attempts smallint;
  v_locked_until timestamptz;
  v_rate_shard integer;
  v_digest bytea := p_current_digest;
  v_bcrypt_hash text := '$2a$10$o7JqKHhe/plhLc9TKesE3./nRKCpqgQLO3uChM4EEe35p3V60KgOu';
  v_password_matches boolean;
begin
  if pg_catalog.octet_length(p_phone_hmac) <> 32
    or pg_catalog.octet_length(p_current_digest) <> 32
    or pg_catalog.octet_length(p_ip_hmac) <> 32
    or pg_catalog.octet_length(p_token_hash) <> 32
    or p_current_version is null
    or p_current_version < 1
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '12 hours 1 minute'
    or (p_previous_digest is not null and pg_catalog.octet_length(p_previous_digest) <> 32)
    or (p_previous_digest is not null and (p_previous_version is null or p_previous_version < 1)) then
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  v_rate_shard := pg_catalog.get_byte(p_token_hash, 0) % 4;

  if not public.consume_rate_limit(
    'roster-login-global:' || v_rate_shard, 'roster-login-global', 200, interval '10 minutes'
  ) then
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  if not public.consume_rate_limit(
    pg_catalog.encode(p_ip_hmac, 'hex') || ':' || v_rate_shard, 'roster-login-ip', 100, interval '10 minutes'
  ) then
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  select
    p.id,
    p.nickname,
    c.password_bcrypt,
    a.password_key_version,
    c.failed_attempts,
    c.locked_until
  into
    v_prospect_id,
    v_nickname,
    v_password_bcrypt,
    v_password_key_version,
    v_failed_attempts,
    v_locked_until
  from public.admission_cycles a
  join public.prospects p on p.admission_cycle_id = a.id
  join public.student_credentials c on c.prospect_id = p.id
  where a.status = 'current'
    and p.status = 'active'
    and p.phone_hmac = p_phone_hmac
  for update of c;

  if found and v_password_bcrypt is not null then
    if v_password_key_version = p_current_version then
      v_bcrypt_hash := v_password_bcrypt;
    elsif p_previous_digest is not null and v_password_key_version = p_previous_version then
      v_digest := p_previous_digest;
      v_bcrypt_hash := v_password_bcrypt;
    else
      v_digest := p_current_digest;
    end if;
  end if;

  v_password_matches := extensions.crypt(
    pg_catalog.encode(v_digest, 'hex'), v_bcrypt_hash
  ) = v_bcrypt_hash;

  if not found or v_password_bcrypt is null or v_bcrypt_hash = '$2a$10$o7JqKHhe/plhLc9TKesE3./nRKCpqgQLO3uChM4EEe35p3V60KgOu' or not v_password_matches then
    if found and (v_locked_until is null or v_locked_until <= v_now) then
      update public.student_credentials
      set failed_attempts = failed_attempts + 1,
          locked_until = case
            when failed_attempts + 1 >= 5 then v_now + interval '30 minutes'
            else locked_until
          end
      where prospect_id = v_prospect_id;
    end if;
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  if v_locked_until is not null and v_locked_until > v_now then
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  update public.student_credentials
  set failed_attempts = 0,
      locked_until = null
  where prospect_id = v_prospect_id;

  insert into public.student_sessions(prospect_id, token_hash, expires_at, idle_expires_at)
  values (v_prospect_id, p_token_hash, p_expires_at, p_expires_at);

  return pg_catalog.jsonb_build_object(
    'kind', 'authenticated',
    'prospectId', v_prospect_id,
    'nickname', v_nickname,
    'expiresAt', p_expires_at
  );
end;
$$;

revoke all on function public.login_roster_student_v1(
  bytea, bytea, integer, bytea, integer, bytea, bytea, timestamptz
) from public, anon, authenticated;

grant execute on function public.login_roster_student_v1(
  bytea, bytea, integer, bytea, integer, bytea, bytea, timestamptz
) to service_role;
