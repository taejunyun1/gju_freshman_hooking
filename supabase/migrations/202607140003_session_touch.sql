create function public.touch_student_session(p_token_hash bytea)
returns table(
  prospect_id bigint,
  nickname text,
  expires_at timestamptz,
  idle_expires_at timestamptz,
  last_seen_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with database_clock as (
    select pg_catalog.clock_timestamp() as now_at
  ), touched_session as (
    update public.student_sessions as session
    set
      idle_expires_at = least(session.expires_at, database_clock.now_at + interval '30 minutes'),
      last_seen_at = database_clock.now_at
    from database_clock
    where session.token_hash = p_token_hash
      and session.revoked_at is null
      and session.idle_expires_at > database_clock.now_at
      and session.expires_at > database_clock.now_at
    returning session.prospect_id, session.expires_at, session.idle_expires_at, session.last_seen_at
  )
  select
    touched_session.prospect_id,
    prospect.nickname,
    touched_session.expires_at,
    touched_session.idle_expires_at,
    touched_session.last_seen_at
  from touched_session
  join public.prospects as prospect on prospect.id = touched_session.prospect_id;
$$;

revoke all privileges on function public.touch_student_session(bytea)
  from public, anon, authenticated;
grant execute on function public.touch_student_session(bytea)
  to service_role;
