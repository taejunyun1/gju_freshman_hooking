begin;

create function pg_temp.safe_upgrade_count(p_sql text)
returns integer
language plpgsql
as $function$
declare
  v_count integer;
begin
  execute p_sql into v_count;
  return v_count;
exception
  when undefined_table or undefined_column then
    return null;
end;
$function$;

select plan(6);

create temporary table upgrade_fixture_state as
select exists (
  select 1
  from public.prospects prospect
  join public.credential_recovery_requests recovery
    on recovery.prospect_id = prospect.id
  where prospect.nickname = '연도전환기존지원자'
    and recovery.code_hash = decode(repeat('76', 32), 'hex')
) as is_present;

select skip(
  6,
  'requires the pre-expand admission-roster upgrade fixture'
)
from pg_temp.upgrade_fixture_state
where not is_present;

select is(
  pg_temp.safe_upgrade_count(
    $sql$
      select count(*)::integer
      from public.prospects prospect
      join public.admission_cycles cycle
        on cycle.id = prospect.admission_cycle_id
      where prospect.nickname = '연도전환기존지원자'
        and cycle.id = '00000000-0000-4000-8000-000000000001'
        and cycle.status = 'archived'
    $sql$
  ),
  1,
  'the pre-expand prospect survives and is backfilled into the archived legacy cycle'
)
from pg_temp.upgrade_fixture_state
where is_present;

select is(
  pg_temp.safe_upgrade_count(
    $sql$
      select count(*)::integer
      from public.student_sessions session
      join public.prospects prospect on prospect.id = session.prospect_id
      where prospect.nickname = '연도전환기존지원자'
        and session.token_hash = decode(repeat('74', 32), 'hex')
        and session.revoked_at is not null
    $sql$
  ),
  1,
  'the pre-expand active session survives and is revoked by the upgrade'
)
from pg_temp.upgrade_fixture_state
where is_present;

select is(
  pg_temp.safe_upgrade_count(
    $sql$
      select count(*)::integer
      from public.student_sessions session
      join public.prospects prospect on prospect.id = session.prospect_id
      where prospect.nickname = '연도전환기존지원자'
        and session.token_hash = decode(repeat('75', 32), 'hex')
        and session.revoked_at = timestamptz '2026-07-16 00:00:00+00'
    $sql$
  ),
  1,
  'an already-revoked session survives without its revoke timestamp changing'
)
from pg_temp.upgrade_fixture_state
where is_present;

select is(
  pg_temp.safe_upgrade_count(
    $sql$
      select count(*)::integer
      from public.credential_recovery_requests recovery
      join public.prospects prospect on prospect.id = recovery.prospect_id
      where prospect.nickname = '연도전환기존지원자'
        and recovery.code_hash = decode(repeat('76', 32), 'hex')
        and recovery.status = 'requested'
    $sql$
  ),
  1,
  'the pre-expand recovery history row and its prospect foreign key survive'
)
from pg_temp.upgrade_fixture_state
where is_present;

select is(
  pg_temp.safe_upgrade_count(
    $sql$
      select count(*)::integer
      from public.prospects
      where nickname = '연도전환기존지원자'
    $sql$
  ),
  1,
  'the upgrade retains the original prospect row instead of replacing it'
)
from pg_temp.upgrade_fixture_state
where is_present;

select is(
  pg_temp.safe_upgrade_count(
    $sql$
      select count(*)::integer
      from public.admission_cycles
      where status = 'current'
    $sql$
  ),
  0,
  'the upgrade fixture does not introduce a current cycle'
)
from pg_temp.upgrade_fixture_state
where is_present;

select * from finish();

rollback;
