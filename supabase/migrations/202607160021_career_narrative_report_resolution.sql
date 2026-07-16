alter table public.career_narrative_reports
  add column priority smallint generated always as (
    case when category = 'unsafe' then 0 else 1 end
  ) stored;

drop index public.career_narrative_reports_open_queue_idx;

create index career_narrative_reports_priority_queue_idx
  on public.career_narrative_reports(priority, created_at, id)
  where status = 'open';

create function public.resolve_career_narrative_report(
  p_admin_user_id uuid,
  p_report_id bigint,
  p_expected_updated_at timestamptz,
  p_resolution text,
  p_audit_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_report public.career_narrative_reports%rowtype;
  v_assessment_public_id uuid;
  v_now timestamptz;
  v_current jsonb;
begin
  if p_admin_user_id is null
    or p_report_id is null
    or p_report_id <= 0
    or p_expected_updated_at is null
    or p_audit_request_id is null
    or p_resolution is null
    or p_resolution not in (
      'resolved_inaccurate',
      'resolved_unsafe',
      'resolved_copy',
      'dismissed'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'NARRATIVE_REPORT_INPUT_INVALID';
  end if;

  if not exists (
    select 1
    from public.admin_users admin_user
    where admin_user.id = p_admin_user_id
      and admin_user.role = 'admin'
      and admin_user.is_active
  ) then
    raise exception using
      errcode = '22023',
      message = 'NARRATIVE_REPORT_ACTIVE_ADMIN_REQUIRED';
  end if;

  select report.*
  into v_report
  from public.career_narrative_reports report
  where report.id = p_report_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'NARRATIVE_REPORT_NOT_FOUND';
  end if;

  select assessment.public_id
  into v_assessment_public_id
  from public.assessments assessment
  where assessment.id = v_report.assessment_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'NARRATIVE_REPORT_ASSESSMENT_NOT_FOUND';
  end if;

  v_current := pg_catalog.jsonb_build_object(
    'id', v_report.id,
    'category', v_report.category,
    'priority', case when v_report.category = 'unsafe' then 0 else 1 end,
    'createdAt', v_report.created_at,
    'updatedAt', v_report.updated_at,
    'status', v_report.status,
    'assessmentPublicId', v_assessment_public_id
  );

  if v_report.status <> 'open'
    or v_report.updated_at is distinct from p_expected_updated_at
  then
    return pg_catalog.jsonb_build_object(
      'kind', 'conflict',
      'current', v_current
    );
  end if;

  v_now := pg_catalog.clock_timestamp();
  update public.career_narrative_reports report
  set
    status = p_resolution,
    resolved_by_admin_id = p_admin_user_id,
    resolved_at = v_now,
    updated_at = v_now
  where report.id = v_report.id
  returning report.* into v_report;

  insert into public.audit_events (
    admin_user_id,
    action,
    target_type,
    target_id,
    metadata,
    request_id
  ) values (
    p_admin_user_id,
    'career_narrative_report_resolved',
    'career_narrative_report',
    v_report.id::text,
    pg_catalog.jsonb_build_object(
      'reportId', v_report.id,
      'category', v_report.category,
      'resolution', p_resolution
    ),
    p_audit_request_id
  );

  return pg_catalog.jsonb_build_object(
    'kind', 'resolved',
    'current', pg_catalog.jsonb_build_object(
      'id', v_report.id,
      'category', v_report.category,
      'priority', case when v_report.category = 'unsafe' then 0 else 1 end,
      'createdAt', v_report.created_at,
      'updatedAt', v_report.updated_at,
      'status', v_report.status,
      'assessmentPublicId', v_assessment_public_id
    )
  );
end;
$function$;

revoke all privileges on function public.resolve_career_narrative_report(
  uuid, bigint, timestamptz, text, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.resolve_career_narrative_report(
  uuid, bigint, timestamptz, text, uuid
) to service_role;
