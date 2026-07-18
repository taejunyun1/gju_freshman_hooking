-- Return encrypted roster names to the service-role Worker; plaintext stays out of SQL responses.

create or replace function public.read_roster_student_session_v1(p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.octet_length(p_token_hash) <> 32 then
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;

  return coalesce(
    (
      select pg_catalog.jsonb_build_object(
        'kind', 'active',
        'prospectId', p.id,
        'nameCiphertext', pg_catalog.encode(p.name_ciphertext, 'hex'),
        'nameIv', pg_catalog.encode(p.name_iv, 'hex'),
        'expiresAt', s.expires_at
      )
      from public.student_sessions s
      join public.prospects p on p.id = s.prospect_id
      join public.admission_cycles a on a.id = p.admission_cycle_id
      where s.token_hash = p_token_hash
        and s.revoked_at is null
        and s.expires_at > pg_catalog.clock_timestamp()
        and p.status = 'active'
        and a.status = 'current'
      limit 1
    ),
    pg_catalog.jsonb_build_object('kind', 'failed')
  );
end;
$$;

revoke all on function public.read_roster_student_session_v1(bytea)
  from public, anon, authenticated;

grant execute on function public.read_roster_student_session_v1(bytea)
  to service_role;
