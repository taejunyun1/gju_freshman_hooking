-- Student-facing PIN self-service.  The Worker supplies only HMAC-derived
-- credential digests; PostgreSQL stores only their bcrypt representation.

create function public.change_roster_student_pin_self_v1(
  p_session_token_hash bytea,
  p_current_digest bytea,
  p_current_key_version integer,
  p_next_digest bytea,
  p_next_token_hash bytea,
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
  v_password_bcrypt text;
  v_password_key_version integer;
  v_password_generation integer;
  v_dummy_bcrypt text := '$2a$10$o7JqKHhe/plhLc9TKesE3./nRKCpqgQLO3uChM4EEe35p3V60KgOu';
begin
  if pg_catalog.octet_length(p_session_token_hash) <> 32
    or pg_catalog.octet_length(p_current_digest) <> 32
    or pg_catalog.octet_length(p_next_digest) <> 32
    or pg_catalog.octet_length(p_next_token_hash) <> 32
    or p_current_key_version is null
    or p_current_key_version < 1
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '12 hours 1 minute' then
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  select p.id, c.password_bcrypt, a.password_key_version, c.password_generation
  into v_prospect_id, v_password_bcrypt, v_password_key_version, v_password_generation
  from public.student_sessions s
  join public.prospects p on p.id = s.prospect_id
  join public.admission_cycles a on a.id = p.admission_cycle_id
  join public.student_credentials c on c.prospect_id = p.id
  where s.token_hash = p_session_token_hash
    and s.revoked_at is null
    and s.expires_at > v_now
    and s.idle_expires_at > v_now
    and p.status = 'active'
    and a.status = 'current'
  for update of s, c;

  if not found
    or v_password_bcrypt is null
    or v_password_key_version <> p_current_key_version
    or v_password_generation is null
    or v_password_generation >= 2147483647
    or extensions.crypt(pg_catalog.encode(p_current_digest, 'hex'), coalesce(v_password_bcrypt, v_dummy_bcrypt))
      <> coalesce(v_password_bcrypt, v_dummy_bcrypt) then
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  update public.student_credentials
  set password_bcrypt = extensions.crypt(pg_catalog.encode(p_next_digest, 'hex'), extensions.gen_salt('bf', 10)),
      password_generation = v_password_generation + 1,
      failed_attempts = 0,
      locked_until = null,
      password_changed_at = v_now,
      updated_at = v_now
  where prospect_id = v_prospect_id;

  update public.student_sessions
  set revoked_at = v_now
  where prospect_id = v_prospect_id
    and revoked_at is null;

  insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
  values (v_prospect_id, p_next_token_hash, p_expires_at, p_expires_at);

  return pg_catalog.jsonb_build_object(
    'kind', 'authenticated',
    'prospectId', v_prospect_id,
    'expiresAt', p_expires_at
  );
end;
$$;

create function public.reset_roster_student_pin_and_assessment_v1(
  p_phone_hmac bytea,
  p_initial_digest bytea,
  p_current_key_version integer,
  p_next_token_hash bytea,
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
  v_password_key_version integer;
  v_password_generation integer;
begin
  if pg_catalog.octet_length(p_phone_hmac) <> 32
    or pg_catalog.octet_length(p_initial_digest) <> 32
    or pg_catalog.octet_length(p_next_token_hash) <> 32
    or p_current_key_version is null
    or p_current_key_version < 1
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '12 hours 1 minute' then
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  select p.id, a.password_key_version, c.password_generation
  into v_prospect_id, v_password_key_version, v_password_generation
  from public.prospects p
  join public.admission_cycles a on a.id = p.admission_cycle_id
  join public.student_credentials c on c.prospect_id = p.id
  where p.phone_hmac = p_phone_hmac
    and p.status = 'active'
    and a.status = 'current'
  for update of p, c;

  if not found
    or v_password_key_version <> p_current_key_version
    or v_password_generation is null
    or v_password_generation >= 2147483647 then
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  -- Deleting assessments cascades responses, generated narratives, and reports.
  -- The counseling foreign key intentionally changes only assessment_id to NULL.
  delete from public.assessments where prospect_id = v_prospect_id;

  delete from public.events
  where prospect_id = v_prospect_id
    and event_name in (
      'assessment_started', 'assessment_step_completed', 'assessment_completed',
      'result_viewed', 'resource_opened'
    );

  update public.student_credentials
  set password_bcrypt = extensions.crypt(pg_catalog.encode(p_initial_digest, 'hex'), extensions.gen_salt('bf', 10)),
      password_generation = v_password_generation + 1,
      failed_attempts = 0,
      locked_until = null,
      password_changed_at = v_now,
      updated_at = v_now
  where prospect_id = v_prospect_id;

  update public.student_sessions
  set revoked_at = v_now
  where prospect_id = v_prospect_id
    and revoked_at is null;

  insert into public.student_sessions (prospect_id, token_hash, expires_at, idle_expires_at)
  values (v_prospect_id, p_next_token_hash, p_expires_at, p_expires_at);

  return pg_catalog.jsonb_build_object(
    'kind', 'authenticated',
    'prospectId', v_prospect_id,
    'expiresAt', p_expires_at
  );
end;
$$;

revoke all on function public.change_roster_student_pin_self_v1(bytea, bytea, integer, bytea, bytea, timestamptz)
  from public, anon, authenticated;
revoke all on function public.reset_roster_student_pin_and_assessment_v1(bytea, bytea, integer, bytea, timestamptz)
  from public, anon, authenticated;

grant execute on function public.change_roster_student_pin_self_v1(bytea, bytea, integer, bytea, bytea, timestamptz)
  to service_role;
grant execute on function public.reset_roster_student_pin_and_assessment_v1(bytea, bytea, integer, bytea, timestamptz)
  to service_role;
